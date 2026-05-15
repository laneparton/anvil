use super::{
    process::{
        bitbucket_api_get, bitbucket_paginated, bitbucket_paginated_with_cache, config_var,
        exec_json, github_api, github_api_get,
    },
    provider_cache::{ProviderCacheMode, ProviderCacheStatus},
    types::{
        ReviewInboxActivity, ReviewInboxApprovalSummary, ReviewInboxCacheMode,
        ReviewInboxChangedFile, ReviewInboxChangedFileGroup, ReviewInboxCheckSummary,
        ReviewInboxHydrateRequest, ReviewInboxRequest, ReviewInboxRow, ReviewPullRequest,
        ReviewRepo,
    },
    util::{parse_bitbucket_repo, parse_iso_timestamp, relative_age},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const BITBUCKET_PR_FIELDS: &str = "next,size,values.id,values.title,values.state,values.summary.raw,values.rendered.description.raw,values.comment_count,values.task_count,values.updated_on,values.links.html.href,values.source.branch.name,values.source.repository.full_name,values.source.repository.name,values.destination.branch.name,values.destination.repository.full_name,values.destination.repository.name,values.author.display_name,values.author.nickname,values.author.uuid,values.author.account_id,values.reviewers.display_name,values.reviewers.nickname,values.reviewers.uuid,values.reviewers.account_id,values.participants.approved,values.participants.state,values.participants.participated_on,values.participants.user.display_name,values.participants.user.uuid,values.participants.user.account_id,values.participants.user.nickname";
const BITBUCKET_REPO_FIELDS: &str = "next,size,values.full_name,values.scm,values.name,values.slug,values.description,values.is_private,values.links.html.href,values.updated_on,values.project.name";
const BITBUCKET_PR_DETAIL_FIELDS: &str = "id,title,state,summary.raw,rendered.description.raw,comment_count,task_count,created_on,updated_on,links.html.href,source.branch.name,source.repository.full_name,destination.branch.name,destination.repository.full_name,author.display_name,author.nickname,author.uuid,author.account_id,reviewers.display_name,reviewers.nickname,reviewers.uuid,reviewers.account_id,participants.approved,participants.state,participants.participated_on,participants.user.display_name,participants.user.nickname,participants.user.uuid,participants.user.account_id";
const BITBUCKET_DIFFSTAT_FIELDS: &str = "next,size,values.status,values.lines_added,values.lines_removed,values.old.path,values.new.path";
const BITBUCKET_COMMIT_FIELDS: &str = "next,size,values.hash,values.date";
const BITBUCKET_STATUS_FIELDS: &str = "next,size,values.state,values.key,values.name,values.updated_on";
const BITBUCKET_ACTIVITY_FIELDS: &str = "next,size,values.update,values.approval,values.comment,values.changes_requested,values.actor.display_name,values.actor.nickname,values.user.display_name,values.user.nickname,values.created_on,values.updated_on";
const BITBUCKET_RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(10 * 60);
const TTL_CURRENT_USER_SECONDS: u64 = 24 * 60 * 60;
const TTL_INBOX_SECONDS: u64 = 5 * 60;
const TTL_PR_METADATA_SECONDS: u64 = 10 * 60;
const TTL_PR_DETAIL_SECONDS: u64 = 5 * 60;

static BITBUCKET_BACKOFF_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

#[tauri::command]
pub(crate) fn list_github_repos() -> Result<Value, String> {
    let fallback = ReviewRepo {
        id: "assistant-ui/assistant-ui".into(),
        name: "assistant-ui/assistant-ui".into(),
        provider: "GitHub".into(),
        open_prs: None,
        description: Some("Typescript/React Library for AI Chat".into()),
        updated_at: None,
    };
    let output = match exec_json(
        "gh",
        &[
            "repo",
            "list",
            "--limit",
            "40",
            "--json",
            "nameWithOwner,description,isPrivate,updatedAt",
        ],
        None,
    ) {
        Ok(output) => output,
        Err(_) => return Ok(json!({ "repos": [fallback] })),
    };

    let mut seen = HashSet::new();
    let mut repos = vec![fallback];

    if let Some(items) = output.as_array() {
        for repo in items {
            let name = repo
                .get("nameWithOwner")
                .and_then(Value::as_str)
                .unwrap_or_default();

            if name.is_empty() {
                continue;
            }

            let description = repo
                .get("description")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(String::from)
                .or_else(|| {
                    repo.get("isPrivate")
                        .and_then(Value::as_bool)
                        .map(|is_private| {
                            if is_private {
                                "Private repository".into()
                            } else {
                                "Public repository".into()
                            }
                        })
                });

            repos.push(ReviewRepo {
                id: name.into(),
                name: name.into(),
                provider: "GitHub".into(),
                open_prs: None,
                description,
                updated_at: repo
                    .get("updatedAt")
                    .and_then(Value::as_str)
                    .map(String::from),
            });
        }
    }

    repos.retain(|repo| seen.insert(repo.id.clone()));

    Ok(json!({ "repos": repos }))
}

#[tauri::command]
pub(crate) fn list_github_pull_requests(repo: String) -> Result<Value, String> {
    Ok(json!({ "pulls": github_pull_requests_for_repo(&repo)? }))
}

#[tauri::command]
pub(crate) fn list_bitbucket_repos() -> Result<Value, String> {
    let mut seen = HashSet::new();
    let mut repos = Vec::new();
    let workspaces = bitbucket_repo_discovery_workspaces()?;

    for workspace in workspaces {
        let path = format!(
            "/repositories/{workspace}?pagelen=100&sort=-updated_on&{}",
            bitbucket_fields_query(BITBUCKET_REPO_FIELDS)
        );
        for item in bitbucket_paginated(&path, 100)? {
            let repo = item.get("repository").unwrap_or(&item);
            if let Some(repo) = bitbucket_repo_from_value(repo, &mut seen) {
                repos.push(repo);
            }
        }
    }

    repos.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(json!({ "repos": repos }))
}

fn bitbucket_repo_discovery_workspaces() -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut workspaces = Vec::new();

    for key in ["BITBUCKET_WORKSPACES", "BITBUCKET_WORKSPACE"] {
        if let Some(value) = config_var(key) {
            for workspace in value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if seen.insert(workspace.to_string()) {
                    workspaces.push(workspace.to_string());
                }
            }
        }
    }

    if workspaces.is_empty() {
        for workspace in bitbucket_workspaces_from_local_remotes() {
            if seen.insert(workspace.clone()) {
                workspaces.push(workspace);
            }
        }
    }

    if workspaces.is_empty() {
        let workspace_values = bitbucket_paginated("/user/workspaces?pagelen=100", 100)?;
        for workspace in workspace_values
            .iter()
            .filter_map(|workspace| workspace.get("slug").and_then(Value::as_str))
            .filter(|value| !value.trim().is_empty())
        {
            if seen.insert(workspace.to_string()) {
                workspaces.push(workspace.to_string());
            }
        }
    }

    if workspaces.is_empty() {
        return Err(
            "No Bitbucket workspaces found. Set BITBUCKET_WORKSPACE or BITBUCKET_WORKSPACES."
                .into(),
        );
    }

    Ok(workspaces)
}

fn bitbucket_repo_from_value(repo: &Value, seen: &mut HashSet<String>) -> Option<ReviewRepo> {
    if repo
        .get("scm")
        .and_then(Value::as_str)
        .is_some_and(|scm| scm != "git")
    {
        return None;
    }

    let id = repo.get("full_name").and_then(Value::as_str)?;
    if !seen.insert(id.to_string()) {
        return None;
    }

    let description = repo
        .get("description")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .or_else(|| {
            repo.get("is_private")
                .and_then(Value::as_bool)
                .map(|is_private| {
                    if is_private {
                        "Private repository".into()
                    } else {
                        "Bitbucket repository".into()
                    }
                })
        });

    Some(ReviewRepo {
        id: id.into(),
        name: id.into(),
        provider: "Bitbucket".into(),
        open_prs: None,
        description,
        updated_at: repo
            .get("updated_on")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

fn bitbucket_workspaces_from_local_remotes() -> Vec<String> {
    let mut seen = HashSet::new();
    let mut workspaces = Vec::new();

    for root in bitbucket_discovery_roots() {
        collect_bitbucket_workspaces_from_root(&root, 0, &mut seen, &mut workspaces);
    }

    workspaces
}

fn bitbucket_discovery_roots() -> Vec<PathBuf> {
    if let Some(roots) = config_var("BITBUCKET_DISCOVERY_ROOTS") {
        return roots
            .split(':')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .collect();
    }

    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join("Projects"));
    }

    roots
}

fn collect_bitbucket_workspaces_from_root(
    root: &Path,
    depth: usize,
    seen: &mut HashSet<String>,
    workspaces: &mut Vec<String>,
) {
    if depth > 8 || !root.is_dir() {
        return;
    }

    if root.join(".git").exists() {
        if let Some(workspace) = bitbucket_workspace_from_git_remote(root) {
            if seen.insert(workspace.clone()) {
                workspaces.push(workspace);
            }
        }
        return;
    }

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, ".git" | "node_modules" | "target" | "dist"))
        {
            continue;
        }
        collect_bitbucket_workspaces_from_root(&path, depth + 1, seen, workspaces);
    }
}

fn bitbucket_workspace_from_git_remote(repo: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", repo.to_str()?, "remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    parse_bitbucket_workspace_from_url(String::from_utf8_lossy(&output.stdout).trim())
}

fn parse_bitbucket_workspace_from_url(url: &str) -> Option<String> {
    let path = url
        .strip_prefix("git@bitbucket.org:")
        .or_else(|| url.strip_prefix("ssh://git@bitbucket.org/"))
        .or_else(|| {
            url.strip_prefix("https://bitbucket.org/")
                .map(|rest| rest.rsplit('@').next().unwrap_or(rest))
        })?;
    let workspace = path.split('/').next()?.trim();

    if workspace.is_empty() {
        None
    } else {
        Some(workspace.to_string())
    }
}

#[tauri::command]
pub(crate) fn list_bitbucket_pull_requests(repo: String) -> Result<Value, String> {
    Ok(json!({ "pulls": bitbucket_pull_requests_for_repo(&repo)? }))
}

#[tauri::command]
pub(crate) async fn list_review_inbox(
    request: Option<ReviewInboxRequest>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || list_review_inbox_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn hydrate_review_inbox_row(
    request: ReviewInboxHydrateRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || hydrate_review_inbox_row_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn hydrate_review_inbox_row_blocking(
    request: ReviewInboxHydrateRequest,
) -> Result<Value, String> {
    let cache_mode = provider_cache_mode(request.cache_mode);
    let row = match request.source.to_ascii_lowercase().as_str() {
        "github" => hydrate_github_inbox_row(&request.repo, &request.pull_request, cache_mode),
        "bitbucket" => hydrate_bitbucket_inbox_row(&request.repo, &request.pull_request, cache_mode),
        other => Err(format!("Unsupported review inbox provider `{other}`.")),
    }?;

    Ok(json!({ "row": row }))
}

pub(crate) fn list_review_inbox_blocking(
    request: Option<ReviewInboxRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or_default();
    let limit = request.limit.unwrap_or(100).clamp(1, 500);
    let cache_mode = provider_cache_mode(request.cache_mode);
    let mut rows = Vec::new();
    let mut errors = Vec::new();

    if provider_enabled(&request, "github") {
        match github_inbox_all_open(&request, limit, cache_mode) {
            Ok(mut provider_rows) => rows.append(&mut provider_rows),
            Err(_error) if cache_mode == ProviderCacheMode::CacheFirst => {}
            Err(error) => errors.push(json!({ "provider": "GitHub", "message": error })),
        }
    }

    if provider_enabled(&request, "bitbucket") {
        match bitbucket_inbox(&request, limit, cache_mode) {
            Ok(mut provider_rows) => rows.append(&mut provider_rows),
            Err(_error) if cache_mode == ProviderCacheMode::CacheFirst => {}
            Err(error) => errors.push(json!({ "provider": "Bitbucket", "message": error })),
        }
    }

    rows.truncate(limit);
    Ok(json!({ "rows": rows, "errors": errors }))
}

fn github_pull_requests_for_repo(repo: &str) -> Result<Vec<ReviewPullRequest>, String> {
    let current_user = github_current_user_login();
    let output = exec_json(
        "gh",
        &[
            "pr",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--limit",
            "30",
            "--json",
            "number,title,author,assignees,reviewRequests,updatedAt,isDraft,url,headRefName,baseRefName,changedFiles",
        ],
        None,
    )
    .or_else(|_| github_api(&format!("/repos/{repo}/pulls?state=open&per_page=30")))?;

    Ok(output
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|pull| github_pull_request_from_value(repo, pull, current_user.as_deref()))
        .collect::<Vec<_>>())
}

fn github_pull_request_from_value(
    repo: &str,
    pull: &Value,
    current_user: Option<&str>,
) -> ReviewPullRequest {
    ReviewPullRequest {
        id: pull
            .get("number")
            .and_then(Value::as_u64)
            .map(|number| number.to_string())
            .unwrap_or_default(),
        number: pull.get("number").and_then(Value::as_u64),
        title: pull
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled PR")
            .into(),
        repo: repo.into(),
        author: pull
            .get("author")
            .and_then(|author| author.get("login"))
            .and_then(Value::as_str)
            .or_else(|| {
                pull.get("user")
                    .and_then(|user| user.get("login"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("unknown")
            .into(),
        age: relative_age(
            pull.get("updatedAt")
                .and_then(Value::as_str)
                .or_else(|| pull.get("updated_at").and_then(Value::as_str)),
        ),
        files: pull
            .get("changedFiles")
            .and_then(Value::as_u64)
            .or_else(|| pull.get("changed_files").and_then(Value::as_u64)),
        status: if pull
            .get("isDraft")
            .and_then(Value::as_bool)
            .or_else(|| pull.get("draft").and_then(Value::as_bool))
            .unwrap_or(false)
        {
            "draft".into()
        } else {
            "ready".into()
        },
        url: pull
            .get("url")
            .and_then(Value::as_str)
            .or_else(|| pull.get("html_url").and_then(Value::as_str))
            .map(String::from),
        head_ref_name: pull
            .get("headRefName")
            .and_then(Value::as_str)
            .or_else(|| {
                pull.get("head")
                    .and_then(|head| head.get("ref"))
                    .and_then(Value::as_str)
            })
            .map(String::from),
        base_ref_name: pull
            .get("baseRefName")
            .and_then(Value::as_str)
            .or_else(|| {
                pull.get("base")
                    .and_then(|base| base.get("ref"))
                    .and_then(Value::as_str)
            })
            .map(String::from),
        needs_review: current_user.is_some_and(|login| github_review_requests_include(pull, login)),
        is_created_by_me: current_user.is_some_and(|login| github_author_login(pull) == Some(login)),
        is_assigned_to_me: current_user.is_some_and(|login| github_assignees_include(pull, login)),
    }
}

fn bitbucket_pull_requests_for_repo(repo: &str) -> Result<Vec<ReviewPullRequest>, String> {
    let (workspace, repo_slug) = parse_bitbucket_repo(repo)?;
    let path = format!(
        "/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&pagelen=30&sort=-updated_on&{}",
        bitbucket_fields_query(BITBUCKET_PR_FIELDS)
    );
    let current_user = bitbucket_current_user().ok();
    bitbucket_pull_requests_from_path(repo, &path, current_user.as_ref())
}

fn bitbucket_pull_requests_from_path(
    repo: &str,
    path: &str,
    current_user: Option<&Value>,
) -> Result<Vec<ReviewPullRequest>, String> {
    bitbucket_pull_requests_from_path_with_cache(
        repo,
        path,
        current_user,
        ProviderCacheMode::Refresh,
    )
}

fn bitbucket_pull_requests_from_path_with_cache(
    repo: &str,
    path: &str,
    current_user: Option<&Value>,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewPullRequest>, String> {
    Ok(bitbucket_pull_requests_from_values(
        repo,
        bitbucket_paginated_with_cache(path, 30, TTL_INBOX_SECONDS, cache_mode)?.values,
        current_user,
    ))
}

fn bitbucket_pull_requests_from_values(
    repo: &str,
    pulls: Vec<Value>,
    current_user: Option<&Value>,
) -> Vec<ReviewPullRequest> {
    let concurrency = config_var("BITBUCKET_DIFFSTAT_CONCURRENCY")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 32);
    let mut results = Vec::new();

    for (chunk_index, chunk) in pulls.chunks(concurrency).enumerate() {
        thread::scope(|scope| {
            let (tx, rx) = mpsc::channel();

            for (index, pull) in chunk.iter().cloned().enumerate() {
                let repo = repo.to_string();
                let current_user = current_user.cloned();
                let tx = tx.clone();
                scope.spawn(move || {
                    let row_index = chunk_index * concurrency + index;
                    let pull =
                        bitbucket_pull_request_from_value(&repo, &pull, current_user.as_ref());
                    let _ = tx.send((row_index, pull));
                });
            }

            drop(tx);
            results.extend(rx);
        });
    }

    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, pull)| pull).collect()
}

fn bitbucket_pull_request_from_value(
    repo: &str,
    pull: &Value,
    current_user: Option<&Value>,
) -> ReviewPullRequest {
    ReviewPullRequest {
        id: pull
            .get("id")
            .and_then(Value::as_u64)
            .map(|number| number.to_string())
            .unwrap_or_default(),
        number: pull.get("id").and_then(Value::as_u64),
        title: pull
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled PR")
            .into(),
        repo: repo.into(),
        author: pull
            .get("author")
            .and_then(|author| {
                author
                    .get("display_name")
                    .and_then(Value::as_str)
                    .or_else(|| author.get("nickname").and_then(Value::as_str))
            })
            .unwrap_or("unknown")
            .into(),
        age: relative_age(pull.get("updated_on").and_then(Value::as_str)),
        files: None,
        status: pull
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("OPEN")
            .to_lowercase(),
        url: pull
            .get("links")
            .and_then(|links| links.get("html"))
            .and_then(|html| html.get("href"))
            .and_then(Value::as_str)
            .map(String::from),
        head_ref_name: pull
            .get("source")
            .and_then(|source| source.get("branch"))
            .and_then(|branch| branch.get("name"))
            .and_then(Value::as_str)
            .map(String::from),
        base_ref_name: pull
            .get("destination")
            .and_then(|destination| destination.get("branch"))
            .and_then(|branch| branch.get("name"))
            .and_then(Value::as_str)
            .map(String::from),
        needs_review: current_user.is_some_and(|user| bitbucket_reviewers_include(pull, user)),
        is_created_by_me: current_user.is_some_and(|user| bitbucket_author_matches(pull, user)),
        is_assigned_to_me: false,
    }
}

fn github_inbox_all_open(
    request: &ReviewInboxRequest,
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    if request.repos.as_ref().is_none_or(Vec::is_empty) {
        if let Ok(rows) = github_inbox_search_all_open(limit, cache_mode) {
            return Ok(rows);
        }
    }

    let repos = match request.repos.as_ref().filter(|repos| !repos.is_empty()) {
        Some(repos) => repos.clone(),
        None => github_repo_ids_for_inbox()?,
    };
    let mut rows = Vec::new();
    let mut last_error = None;

    for repo in repos {
        if rows.len() >= limit {
            break;
        }

        match github_pull_requests_for_repo(&repo) {
            Ok(pulls) => {
                rows.extend(
                    pulls
                        .into_iter()
                        .map(|pull| inbox_row_from_pull("github", "GitHub", &repo, pull))
                        .take(limit - rows.len()),
                );
            }
            Err(error) => last_error = Some(error),
        }
    }

    if rows.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }

    Ok(rows)
}

fn github_inbox_search_all_open(
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    let current_user = github_current_user_login_with_cache(cache_mode)
        .ok_or_else(|| "Could not resolve GitHub current user.".to_string())?;
    let query = percent_encode_path_component(&format!("is:pr is:open user:{current_user}"));
    let output = match github_api_get(&format!(
        "/search/issues?q={query}&sort=updated&order=desc&per_page={}",
        limit.clamp(1, 100)
    ), TTL_INBOX_SECONDS, cache_mode) {
        Ok(output) => output,
        Err(error) if cache_mode == ProviderCacheMode::CacheFirst => return Err(error),
        Err(_) => return github_inbox_search_all_open_via_cli(limit, &current_user),
    };
    let cache_status = output.cache_status;
    let cached_at = output.cached_at;

    Ok(output.value
        .get("items")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|pull| github_search_issue_row(pull, &current_user, cache_status, cached_at))
        .collect())
}

fn github_current_user_login() -> Option<String> {
    github_current_user_login_with_cache(ProviderCacheMode::Refresh)
}

fn github_current_user_login_with_cache(cache_mode: ProviderCacheMode) -> Option<String> {
    let user = github_api_get("/user", TTL_CURRENT_USER_SECONDS, cache_mode)
        .map(|response| response.value);
    let user = if cache_mode == ProviderCacheMode::CacheFirst {
        user.ok()?
    } else {
        user.or_else(|_| exec_json("gh", &["api", "user"], None)).ok()?
    };

    user
        .get("login")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(String::from)
}

fn github_search_issue_row(
    pull: &Value,
    current_user: &str,
    cache_status: ProviderCacheStatus,
    cached_at: Option<u64>,
) -> Option<ReviewInboxRow> {
    let repo = pull
        .get("repository_url")
        .and_then(Value::as_str)
        .and_then(github_repo_from_api_url)?;
    let author = pull
        .get("user")
        .and_then(|author| author.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    Some(ReviewInboxRow {
        source: "github".into(),
        provider: "GitHub".into(),
        repo_id: repo.clone(),
        repo_name: repo,
        id: pull
            .get("number")
            .and_then(Value::as_u64)
            .map(|number| number.to_string())
            .unwrap_or_default(),
        number: pull.get("number").and_then(Value::as_u64),
        title: pull
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled PR")
            .into(),
        author: author.clone(),
        age: relative_age(pull.get("updated_at").and_then(Value::as_str)),
        files: None,
        status: "ready".into(),
        url: pull
            .get("html_url")
            .and_then(Value::as_str)
            .map(String::from),
        head_ref_name: None,
        base_ref_name: None,
        needs_review: false,
        is_created_by_me: author.eq_ignore_ascii_case(current_user),
        is_assigned_to_me: github_assignees_include(pull, current_user),
        cache_status: Some(cache_status.as_str().into()),
        cached_at,
        description: None,
        labels: github_labels(pull),
        commits_count: None,
        comments_count: pull.get("comments").and_then(Value::as_u64),
        tasks_count: None,
        additions_count: None,
        deletions_count: None,
        checks: None,
        approvals: None,
        requested_reviewers: Vec::new(),
        changed_file_groups: Vec::new(),
        activity: github_activity(pull, &author),
    })
}

fn github_repo_from_api_url(url: &str) -> Option<String> {
    let marker = "/repos/";
    let rest = url.split_once(marker)?.1;
    let mut parts = rest.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    Some(format!("{owner}/{repo}"))
}

fn github_inbox_search_all_open_via_cli(
    limit: usize,
    current_user: &str,
) -> Result<Vec<ReviewInboxRow>, String> {
    let limit_string = limit.to_string();
    let output = exec_json(
        "gh",
        &[
            "search",
            "prs",
            "--owner",
            current_user,
            "--state",
            "open",
            "--limit",
            limit_string.as_str(),
            "--json",
            "number,title,author,updatedAt,isDraft,url,repository,assignees",
        ],
        None,
    )?;

    Ok(output
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|pull| github_search_all_open_row(pull, current_user))
        .collect())
}

fn bitbucket_inbox(
    request: &ReviewInboxRequest,
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    if bitbucket_backoff_active() {
        return Err("Bitbucket inbox discovery is cooling down after a rate limit response. Open a PR manually or retry after the cooldown.".into());
    }

    let result = bitbucket_inbox_uncached(request, limit, cache_mode);
    match result {
        Ok(rows) => Ok(rows),
        Err(error) => {
            if error.contains("HTTP 429") {
                bitbucket_start_backoff();
            }
            Err(error)
        }
    }
}

fn bitbucket_inbox_uncached(
    request: &ReviewInboxRequest,
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    let current_user = bitbucket_current_user_with_cache(cache_mode).map_err(|error| {
        format!("Bitbucket auth check failed before listing pull requests. Use BITBUCKET_EMAIL or BITBUCKET_USERNAME with BITBUCKET_ACCESS_TOKEN/BITBUCKET_API_TOKEN. {error}")
    })?;
    let current_user_ref = Some(&current_user);

    let repos = request
        .repos
        .as_ref()
        .filter(|repos| !repos.is_empty())
        .cloned()
        .unwrap_or_else(bitbucket_repos_for_inbox);
    if repos.is_empty() {
        if config_var("BITBUCKET_WORKSPACE_USER_INBOX").is_some() {
            return bitbucket_current_user_inbox(&current_user, limit, cache_mode);
        }
        return Ok(Vec::new());
    }

    let mut rows = Vec::new();
    let mut last_error = None;

    for repo in repos {
        if rows.len() >= limit {
            break;
        }

        match bitbucket_pull_requests_for_repo_query(&repo, current_user_ref, cache_mode) {
            Ok(pulls) => {
                rows.extend(
                    pulls
                        .into_iter()
                        .map(|pull| inbox_row_from_pull("bitbucket", "Bitbucket", &repo, pull))
                        .take(limit - rows.len()),
                );
            }
            Err(error) => last_error = Some(error),
        }
    }

    if rows.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }

    Ok(rows)
}

fn bitbucket_repos_for_inbox() -> Vec<String> {
    let mut repos = Vec::new();
    let mut seen = HashSet::new();

    for repo in bitbucket_pinned_repos() {
        if seen.insert(repo.clone()) {
            repos.push(repo);
        }
    }

    let max_repos = config_var("BITBUCKET_INBOX_REPO_LIMIT")
        .or_else(|| config_var("BITBUCKET_REVIEW_REPO_LIMIT"))
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(20);
    if repos.len() >= max_repos {
        repos.truncate(max_repos);
        return repos;
    }

    for repo in bitbucket_recent_repos() {
        if repos.len() >= max_repos {
            break;
        }
        if seen.insert(repo.clone()) {
            repos.push(repo);
        }
    }

    repos
}

fn bitbucket_pinned_repos() -> Vec<String> {
    config_var("BITBUCKET_PINNED_REPOS")
        .unwrap_or_default()
        .split(|ch: char| ch == ',' || ch == '\n' || ch == ' ' || ch == '\t')
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.contains('/'))
        .map(String::from)
        .collect()
}

fn bitbucket_recent_repos() -> Vec<String> {
    let recent_days = config_var("BITBUCKET_RECENT_REPO_DAYS")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(7);
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
        .saturating_sub(recent_days * 24 * 60 * 60);

    match list_bitbucket_repos() {
        Ok(response) => response
            .get("repos")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .filter(|repo| {
                repo.get("updatedAt")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_timestamp)
                    .is_some_and(|updated_at| updated_at >= cutoff)
            })
            .filter_map(|repo| repo.get("id").and_then(Value::as_str).map(String::from))
            .collect(),
        Err(error) => {
            if config_var("BITBUCKET_DEBUG_INBOX").is_some() {
                eprintln!("Bitbucket recent repo discovery failed: {error}");
            }
            Vec::new()
        }
    }
}

fn bitbucket_backoff_active() -> bool {
    let backoff = BITBUCKET_BACKOFF_UNTIL.get_or_init(|| Mutex::new(None));
    let Ok(mut backoff) = backoff.lock() else {
        return false;
    };
    match *backoff {
        Some(until) if Instant::now() < until => true,
        Some(_) => {
            *backoff = None;
            false
        }
        None => false,
    }
}

fn bitbucket_start_backoff() {
    let backoff = BITBUCKET_BACKOFF_UNTIL.get_or_init(|| Mutex::new(None));
    if let Ok(mut backoff) = backoff.lock() {
        *backoff = Some(Instant::now() + BITBUCKET_RATE_LIMIT_BACKOFF);
    }
}

fn bitbucket_current_user_inbox(
    current_user: &Value,
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    let mut rows_by_key = HashMap::new();
    let rows = bitbucket_authored_inbox(current_user, limit, cache_mode)?;

    for row in rows {
        rows_by_key.insert(review_inbox_row_key(&row), row);
    }

    let mut rows = rows_by_key.into_values().collect::<Vec<_>>();
    rows.truncate(limit);
    Ok(rows)
}

fn bitbucket_authored_inbox(
    current_user: &Value,
    limit: usize,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewInboxRow>, String> {
    let selected_user = current_user
        .get("uuid")
        .and_then(Value::as_str)
        .or_else(|| current_user.get("nickname").and_then(Value::as_str))
        .ok_or_else(|| "Bitbucket /user did not include uuid or nickname.".to_string())?;
    let selected_user = percent_encode_path_component(selected_user);
    let workspaces = bitbucket_repo_discovery_workspaces()?;
    let mut rows = Vec::new();
    let mut last_error = None;

    for workspace in workspaces {
        if rows.len() >= limit {
            break;
        }

        let path = format!(
            "/workspaces/{workspace}/pullrequests/{selected_user}?state=OPEN&pagelen={}&{}",
            limit.min(50),
            bitbucket_fields_query(BITBUCKET_PR_FIELDS)
        );
        match bitbucket_paginated_with_cache(&path, limit - rows.len(), TTL_INBOX_SECONDS, cache_mode) {
            Ok(pulls) => {
                rows.extend(
                    bitbucket_inbox_rows_from_values(
                        pulls.values,
                        &workspace,
                        Some(current_user),
                        pulls.cache_status,
                        pulls.cached_at,
                    )
                        .into_iter()
                        .take(limit - rows.len()),
                );
            }
            Err(error) => last_error = Some(error),
        }
    }

    if rows.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }

    Ok(rows)
}

fn bitbucket_inbox_rows_from_values(
    pulls: Vec<Value>,
    fallback_repo: &str,
    current_user: Option<&Value>,
    cache_status: ProviderCacheStatus,
    cached_at: Option<u64>,
) -> Vec<ReviewInboxRow> {
    let concurrency = config_var("BITBUCKET_DIFFSTAT_CONCURRENCY")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 32);
    let mut results = Vec::new();

    for (chunk_index, chunk) in pulls.chunks(concurrency).enumerate() {
        thread::scope(|scope| {
            let (tx, rx) = mpsc::channel();

            for (index, pull) in chunk.iter().cloned().enumerate() {
                let fallback_repo = fallback_repo.to_string();
                let current_user = current_user.cloned();
                let tx = tx.clone();
                scope.spawn(move || {
                    let row_index = chunk_index * concurrency + index;
                    let repo = bitbucket_pull_repo_name(&pull).unwrap_or(fallback_repo);
                    let pull =
                        bitbucket_pull_request_from_value(&repo, &pull, current_user.as_ref());
                    let mut row = inbox_row_from_pull("bitbucket", "Bitbucket", &repo, pull);
                    mark_row_cache(&mut row, cache_status, cached_at);
                    let _ = tx.send((row_index, row));
                });
            }

            drop(tx);
            results.extend(rx);
        });
    }

    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, row)| row).collect()
}

fn bitbucket_pull_requests_for_repo_query(
    repo: &str,
    current_user: Option<&Value>,
    cache_mode: ProviderCacheMode,
) -> Result<Vec<ReviewPullRequest>, String> {
    let (workspace, repo_slug) = parse_bitbucket_repo(repo)?;
    let path = format!(
        "/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&pagelen=30&sort=-updated_on&{}",
        bitbucket_fields_query(BITBUCKET_PR_FIELDS)
    );

    bitbucket_pull_requests_from_path_with_cache(repo, &path, current_user, cache_mode)
}

fn bitbucket_current_user() -> Result<Value, String> {
    bitbucket_current_user_with_cache(ProviderCacheMode::Refresh)
}

fn bitbucket_current_user_with_cache(cache_mode: ProviderCacheMode) -> Result<Value, String> {
    bitbucket_api_get("/user", TTL_CURRENT_USER_SECONDS, cache_mode).map(|response| response.value)
}

fn github_repo_ids_for_inbox() -> Result<Vec<String>, String> {
    let output = exec_json(
        "gh",
        &["repo", "list", "--limit", "100", "--json", "nameWithOwner"],
        None,
    )?;

    Ok(output
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|repo| {
            repo.get("nameWithOwner")
                .and_then(Value::as_str)
                .map(String::from)
        })
        .collect())
}

fn provider_enabled(request: &ReviewInboxRequest, provider: &str) -> bool {
    request
        .providers
        .as_ref()
        .filter(|providers| !providers.is_empty())
        .map(|providers| {
            providers
                .iter()
                .any(|value| value.eq_ignore_ascii_case(provider))
        })
        .unwrap_or(true)
}

fn inbox_row_from_pull(
    source: &str,
    provider: &str,
    repo: &str,
    pull: ReviewPullRequest,
) -> ReviewInboxRow {
    ReviewInboxRow {
        source: source.into(),
        provider: provider.into(),
        repo_id: repo.into(),
        repo_name: repo.into(),
        id: pull.id,
        number: pull.number,
        title: pull.title,
        author: pull.author,
        age: pull.age,
        files: pull.files,
        status: pull.status,
        url: pull.url,
        head_ref_name: pull.head_ref_name,
        base_ref_name: pull.base_ref_name,
        needs_review: pull.needs_review,
        is_created_by_me: pull.is_created_by_me,
        is_assigned_to_me: pull.is_assigned_to_me,
        cache_status: None,
        cached_at: None,
        description: None,
        labels: Vec::new(),
        commits_count: None,
        comments_count: None,
        tasks_count: None,
        additions_count: None,
        deletions_count: None,
        checks: None,
        approvals: None,
        requested_reviewers: Vec::new(),
        changed_file_groups: Vec::new(),
        activity: Vec::new(),
    }
}

fn mark_row_cache(row: &mut ReviewInboxRow, status: ProviderCacheStatus, cached_at: Option<u64>) {
    let next = status.as_str().to_string();
    row.cache_status = row
        .cache_status
        .as_deref()
        .map(|current| combine_cache_status(current, status).as_str().to_string())
        .or(Some(next));
    row.cached_at = row.cached_at.or(cached_at);
}

fn combine_cache_status(current: &str, next: ProviderCacheStatus) -> ProviderCacheStatus {
    let current = match current {
        "stale" => ProviderCacheStatus::Stale,
        "cached" => ProviderCacheStatus::Cached,
        _ => ProviderCacheStatus::Fresh,
    };
    current.combine(next)
}

fn review_inbox_row_key(row: &ReviewInboxRow) -> String {
    format!("{}:{}:{}", row.source, row.repo_id, row.number.unwrap_or(0))
}

fn hydrate_github_inbox_row(
    repo: &str,
    pull_request: &str,
    cache_mode: ProviderCacheMode,
) -> Result<ReviewInboxRow, String> {
    let detail = github_api_get(
        &format!("/repos/{repo}/pulls/{pull_request}"),
        TTL_PR_METADATA_SECONDS,
        cache_mode,
    )?;
    let cache_status = detail.cache_status;
    let cached_at = detail.cached_at;
    let current_user = github_current_user_login_with_cache(cache_mode);
    let pull = github_pull_request_from_value(repo, &detail.value, current_user.as_deref());
    let mut row = inbox_row_from_pull("github", "GitHub", repo, pull);
    mark_row_cache(&mut row, cache_status, cached_at);
    Ok(enrich_github_inbox_row(row, cache_mode))
}

fn enrich_github_inbox_row(mut row: ReviewInboxRow, cache_mode: ProviderCacheMode) -> ReviewInboxRow {
    let Some(number) = row.number else {
        return row;
    };
    let repo = row.repo_id.clone();

    if let Ok(detail) = github_api_get(
        &format!("/repos/{repo}/pulls/{number}"),
        TTL_PR_METADATA_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, detail.cache_status, detail.cached_at);
        let detail = detail.value;
        row.description = detail
            .get("body")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(String::from)
            .or(row.description);
        row.files = detail
            .get("changed_files")
            .and_then(Value::as_u64)
            .or(row.files);
        row.additions_count = detail.get("additions").and_then(Value::as_u64).or(row.additions_count);
        row.deletions_count = detail.get("deletions").and_then(Value::as_u64).or(row.deletions_count);
        row.commits_count = detail.get("commits").and_then(Value::as_u64).or(row.commits_count);
        row.comments_count = detail
            .get("comments")
            .and_then(Value::as_u64)
            .zip(detail.get("review_comments").and_then(Value::as_u64))
            .map(|(comments, review_comments)| comments + review_comments)
            .or_else(|| detail.get("comments").and_then(Value::as_u64))
            .or(row.comments_count);
        row.head_ref_name = detail
            .get("head")
            .and_then(|head| head.get("ref"))
            .and_then(Value::as_str)
            .map(String::from)
            .or(row.head_ref_name);
        row.base_ref_name = detail
            .get("base")
            .and_then(|base| base.get("ref"))
            .and_then(Value::as_str)
            .map(String::from)
            .or(row.base_ref_name);
        row.requested_reviewers = github_requested_reviewers(&detail);
    }

    if let Ok(issue) = github_api_get(
        &format!("/repos/{repo}/issues/{number}"),
        TTL_PR_METADATA_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, issue.cache_status, issue.cached_at);
        let issue = issue.value;
        if row.labels.is_empty() {
            row.labels = github_labels(&issue);
        }
        row.activity = github_activity(&issue, &row.author);
    }

    if let Ok(files) = github_api_get(
        &format!("/repos/{repo}/pulls/{number}/files?per_page=100"),
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, files.cache_status, files.cached_at);
        row.changed_file_groups = changed_file_groups_from_values(
            files.value.as_array().map(Vec::as_slice).unwrap_or(&[]),
            |file| file.get("filename").and_then(Value::as_str),
            |file| file.get("additions").and_then(Value::as_u64).unwrap_or(0),
            |file| file.get("deletions").and_then(Value::as_u64).unwrap_or(0),
        );
    }

    if let Ok(reviews) = github_api_get(
        &format!("/repos/{repo}/pulls/{number}/reviews?per_page=100"),
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, reviews.cache_status, reviews.cached_at);
        row.approvals = Some(ReviewInboxApprovalSummary {
            received: github_approval_count(&reviews.value),
            required: 1,
        });
    }

    row
}

fn hydrate_bitbucket_inbox_row(
    repo: &str,
    pull_request: &str,
    cache_mode: ProviderCacheMode,
) -> Result<ReviewInboxRow, String> {
    let current_user = bitbucket_current_user_with_cache(cache_mode).ok();
    let (workspace, repo_slug) = parse_bitbucket_repo(repo)?;
    let base_path = format!("/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request}");
    let detail = bitbucket_api_get(
        &format!("{base_path}?{}", bitbucket_fields_query(BITBUCKET_PR_DETAIL_FIELDS)),
        TTL_PR_METADATA_SECONDS,
        cache_mode,
    )?;
    let cache_status = detail.cache_status;
    let cached_at = detail.cached_at;
    let pull = bitbucket_pull_request_from_value(repo, &detail.value, current_user.as_ref());
    let mut row = inbox_row_from_pull("bitbucket", "Bitbucket", repo, pull);
    mark_row_cache(&mut row, cache_status, cached_at);
    apply_bitbucket_pull_detail(&mut row, &detail.value);

    Ok(enrich_bitbucket_inbox_row(row, cache_mode))
}

fn enrich_bitbucket_inbox_row(mut row: ReviewInboxRow, cache_mode: ProviderCacheMode) -> ReviewInboxRow {
    let Some(number) = row.number else {
        return row;
    };
    let Ok((workspace, repo_slug)) = parse_bitbucket_repo(&row.repo_id) else {
        return row;
    };
    let base_path = format!("/repositories/{workspace}/{repo_slug}/pullrequests/{number}");

    if let Ok(detail) = bitbucket_api_get(
        &format!("{base_path}?{}", bitbucket_fields_query(BITBUCKET_PR_DETAIL_FIELDS)),
        TTL_PR_METADATA_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, detail.cache_status, detail.cached_at);
        apply_bitbucket_pull_detail(&mut row, &detail.value);
    }

    if let Ok(diffstat) = bitbucket_paginated_with_cache(
        &format!(
            "{base_path}/diffstat?pagelen=100&{}",
            bitbucket_fields_query(BITBUCKET_DIFFSTAT_FIELDS)
        ),
        500,
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, diffstat.cache_status, diffstat.cached_at);
        row.changed_file_groups = changed_file_groups_from_values(
            &diffstat.values,
            bitbucket_diffstat_path,
            |file| file.get("lines_added").and_then(Value::as_u64).unwrap_or(0),
            |file| file.get("lines_removed").and_then(Value::as_u64).unwrap_or(0),
        );
        let additions = row
            .changed_file_groups
            .iter()
            .flat_map(|group| group.files.iter())
            .map(|file| file.additions)
            .sum::<u64>();
        let deletions = row
            .changed_file_groups
            .iter()
            .flat_map(|group| group.files.iter())
            .map(|file| file.deletions)
            .sum::<u64>();
        if !row.changed_file_groups.is_empty() {
            row.files = Some(
                row.changed_file_groups
                    .iter()
                    .map(|group| group.files.len() as u64)
                    .sum(),
            );
            row.additions_count = Some(additions);
            row.deletions_count = Some(deletions);
        }
    }

    if let Ok(commits) = bitbucket_paginated_with_cache(
        &format!(
            "{base_path}/commits?pagelen=100&{}",
            bitbucket_fields_query(BITBUCKET_COMMIT_FIELDS)
        ),
        500,
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, commits.cache_status, commits.cached_at);
        row.commits_count = Some(commits.values.len() as u64);
    }

    if let Ok(statuses) = bitbucket_paginated_with_cache(
        &format!(
            "{base_path}/statuses?pagelen=100&{}",
            bitbucket_fields_query(BITBUCKET_STATUS_FIELDS)
        ),
        500,
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, statuses.cache_status, statuses.cached_at);
        row.checks = Some(bitbucket_status_summary(&statuses.values));
    }

    if let Ok(activity) = bitbucket_paginated_with_cache(
        &format!(
            "{base_path}/activity?pagelen=30&{}",
            bitbucket_fields_query(BITBUCKET_ACTIVITY_FIELDS)
        ),
        30,
        TTL_PR_DETAIL_SECONDS,
        cache_mode,
    ) {
        mark_row_cache(&mut row, activity.cache_status, activity.cached_at);
        let events = bitbucket_activity_from_values(&activity.values);
        if !events.is_empty() {
            row.activity = events;
        }
    }

    row
}

fn apply_bitbucket_pull_detail(row: &mut ReviewInboxRow, detail: &Value) {
    row.description = bitbucket_description(detail).or(row.description.take());
    row.comments_count = detail
        .get("comment_count")
        .and_then(Value::as_u64)
        .or(row.comments_count);
    row.tasks_count = detail
        .get("task_count")
        .and_then(Value::as_u64)
        .or(row.tasks_count);
    row.requested_reviewers = bitbucket_reviewers(detail);
    row.approvals = Some(ReviewInboxApprovalSummary {
        received: bitbucket_approval_count(detail),
        required: row.requested_reviewers.len().max(1) as u64,
    });
    row.activity = bitbucket_activity(detail, &row.author);
}

fn changed_file_groups_from_values(
    values: &[Value],
    path: impl Fn(&Value) -> Option<&str>,
    additions: impl Fn(&Value) -> u64,
    deletions: impl Fn(&Value) -> u64,
) -> Vec<ReviewInboxChangedFileGroup> {
    let mut groups = BTreeMap::<String, Vec<ReviewInboxChangedFile>>::new();
    for value in values {
        let Some(path) = path(value).filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let label = path
            .split('/')
            .next()
            .filter(|value| !value.is_empty() && *value != path)
            .unwrap_or("root")
            .to_string();
        groups.entry(label).or_default().push(ReviewInboxChangedFile {
            path: path.to_string(),
            additions: additions(value),
            deletions: deletions(value),
        });
    }

    groups
        .into_iter()
        .map(|(label, files)| ReviewInboxChangedFileGroup { label, files })
        .collect()
}

fn bitbucket_diffstat_path(value: &Value) -> Option<&str> {
    value
        .get("new")
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("old")
                .and_then(|file| file.get("path"))
                .and_then(Value::as_str)
        })
}

fn github_labels(value: &Value) -> Vec<String> {
    value
        .get("labels")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|label| label.get("name").and_then(Value::as_str).map(String::from))
        .collect()
}

fn github_requested_reviewers(value: &Value) -> Vec<String> {
    value
        .get("requested_reviewers")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|reviewer| reviewer.get("login").and_then(Value::as_str).map(String::from))
        .collect()
}

fn bitbucket_reviewers(value: &Value) -> Vec<String> {
    value
        .get("reviewers")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|reviewer| {
            reviewer
                .get("display_name")
                .and_then(Value::as_str)
                .or_else(|| reviewer.get("nickname").and_then(Value::as_str))
                .map(String::from)
        })
        .collect()
}

fn bitbucket_description(value: &Value) -> Option<String> {
    value
        .get("summary")
        .and_then(|summary| summary.get("raw"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("rendered")
                .and_then(|rendered| rendered.get("description"))
                .and_then(|description| description.get("raw"))
                .and_then(Value::as_str)
        })
        .or_else(|| value.get("description").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(String::from)
}

fn github_approval_count(value: &Value) -> u64 {
    value
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter(|review| review.get("state").and_then(Value::as_str) == Some("APPROVED"))
        .filter_map(|review| {
            review
                .get("user")
                .and_then(|user| user.get("login"))
                .and_then(Value::as_str)
        })
        .collect::<HashSet<_>>()
        .len() as u64
}

fn bitbucket_approval_count(value: &Value) -> u64 {
    value
        .get("participants")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter(|participant| {
            participant
                .get("approved")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count() as u64
}

fn bitbucket_status_summary(values: &[Value]) -> ReviewInboxCheckSummary {
    let mut summary = ReviewInboxCheckSummary {
        passing: 0,
        failing: 0,
        pending: 0,
    };

    for status in values {
        match status
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_uppercase()
            .as_str()
        {
            "SUCCESSFUL" => summary.passing += 1,
            "FAILED" | "STOPPED" => summary.failing += 1,
            _ => summary.pending += 1,
        }
    }

    summary
}

fn github_activity(value: &Value, author: &str) -> Vec<ReviewInboxActivity> {
    vec![
        ReviewInboxActivity {
            actor: author.to_string(),
            detail: "opened or updated this pull request".into(),
            age: relative_age(
                value
                    .get("created_at")
                    .and_then(Value::as_str)
                    .or_else(|| value.get("updated_at").and_then(Value::as_str)),
            ),
        },
        ReviewInboxActivity {
            actor: "GitHub".into(),
            detail: "last synced provider metadata".into(),
            age: relative_age(value.get("updated_at").and_then(Value::as_str)),
        },
    ]
}

fn bitbucket_activity(value: &Value, author: &str) -> Vec<ReviewInboxActivity> {
    vec![
        ReviewInboxActivity {
            actor: author.to_string(),
            detail: "opened or updated this pull request".into(),
            age: relative_age(value.get("created_on").and_then(Value::as_str)),
        },
        ReviewInboxActivity {
            actor: "Bitbucket".into(),
            detail: "last synced provider metadata".into(),
            age: relative_age(value.get("updated_on").and_then(Value::as_str)),
        },
    ]
}

fn bitbucket_activity_from_values(values: &[Value]) -> Vec<ReviewInboxActivity> {
    values
        .iter()
        .take(8)
        .filter_map(bitbucket_activity_item)
        .collect()
}

fn bitbucket_activity_item(value: &Value) -> Option<ReviewInboxActivity> {
    let actor = bitbucket_activity_actor(value)?;
    let detail = if value.get("approval").is_some() {
        "approved this pull request"
    } else if value.get("changes_requested").is_some() {
        "requested changes"
    } else if value.get("comment").is_some() {
        "commented"
    } else if value.get("update").is_some() {
        "updated this pull request"
    } else {
        "updated pull request activity"
    };
    let timestamp = value
        .get("created_on")
        .and_then(Value::as_str)
        .or_else(|| value.get("updated_on").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("comment")
                .and_then(|comment| comment.get("created_on"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            value
                .get("approval")
                .and_then(|approval| approval.get("date"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            value
                .get("update")
                .and_then(|update| update.get("date"))
                .and_then(Value::as_str)
        });

    Some(ReviewInboxActivity {
        actor,
        detail: detail.into(),
        age: relative_age(timestamp),
    })
}

fn bitbucket_activity_actor(value: &Value) -> Option<String> {
    ["actor", "user"]
        .into_iter()
        .find_map(|key| {
            value.get(key).and_then(|user| {
                user.get("display_name")
                    .and_then(Value::as_str)
                    .or_else(|| user.get("nickname").and_then(Value::as_str))
                    .map(String::from)
            })
        })
        .or_else(|| {
            value
                .get("comment")
                .and_then(|comment| comment.get("user"))
                .and_then(|user| {
                    user.get("display_name")
                        .and_then(Value::as_str)
                        .or_else(|| user.get("nickname").and_then(Value::as_str))
                })
                .map(String::from)
        })
}

fn provider_cache_mode(mode: Option<ReviewInboxCacheMode>) -> ProviderCacheMode {
    match mode.unwrap_or_default() {
        ReviewInboxCacheMode::CacheFirst => ProviderCacheMode::CacheFirst,
        ReviewInboxCacheMode::Refresh => ProviderCacheMode::Refresh,
    }
}

fn github_author_login(pull: &Value) -> Option<&str> {
    pull.get("author")
        .and_then(|author| author.get("login"))
        .and_then(Value::as_str)
        .or_else(|| {
            pull.get("user")
                .and_then(|user| user.get("login"))
                .and_then(Value::as_str)
        })
}

fn github_assignees_include(pull: &Value, login: &str) -> bool {
    pull.get("assignees")
        .and_then(Value::as_array)
        .is_some_and(|assignees| {
            assignees.iter().any(|assignee| {
                assignee
                    .get("login")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(login))
            })
        })
}

fn github_review_requests_include(pull: &Value, login: &str) -> bool {
    pull.get("reviewRequests")
        .and_then(Value::as_array)
        .is_some_and(|requests| {
            requests.iter().any(|request| {
                request
                    .get("login")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        request
                            .get("requestedReviewer")
                            .and_then(|reviewer| reviewer.get("login"))
                            .and_then(Value::as_str)
                    })
                    .is_some_and(|value| value.eq_ignore_ascii_case(login))
            })
        })
}

fn bitbucket_author_matches(pull: &Value, user: &Value) -> bool {
    pull.get("author")
        .is_some_and(|author| bitbucket_identity_matches(author, user))
}

fn bitbucket_reviewers_include(pull: &Value, user: &Value) -> bool {
    pull.get("reviewers")
        .and_then(Value::as_array)
        .is_some_and(|reviewers| {
            reviewers
                .iter()
                .any(|reviewer| bitbucket_identity_matches(reviewer, user))
        })
}

fn bitbucket_identity_matches(identity: &Value, user: &Value) -> bool {
    let user_values = [
        user.get("uuid").and_then(Value::as_str),
        user.get("nickname").and_then(Value::as_str),
        user.get("account_id").and_then(Value::as_str),
    ];

    let identity_values = [
        identity.get("uuid").and_then(Value::as_str),
        identity.get("nickname").and_then(Value::as_str),
        identity.get("account_id").and_then(Value::as_str),
    ];

    user_values
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .any(|user_value| {
            identity_values
                .into_iter()
                .flatten()
                .any(|identity_value| identity_value.eq_ignore_ascii_case(user_value))
        })
}

fn bitbucket_fields_query(fields: &str) -> String {
    format!("fields={}", percent_encode_path_component(fields))
}

fn bitbucket_pull_repo_name(pull: &Value) -> Option<String> {
    pull.get("source")
        .and_then(|source| source.get("repository"))
        .and_then(|repository| repository.get("full_name"))
        .and_then(Value::as_str)
        .or_else(|| {
            pull.get("destination")
                .and_then(|destination| destination.get("repository"))
                .and_then(|repository| repository.get("full_name"))
                .and_then(Value::as_str)
        })
        .map(String::from)
        .or_else(|| {
            pull.get("links")
                .and_then(|links| links.get("self"))
                .and_then(|self_link| self_link.get("href"))
                .and_then(Value::as_str)
                .and_then(bitbucket_repo_from_api_url)
        })
}

fn bitbucket_repo_from_api_url(url: &str) -> Option<String> {
    let marker = "/repositories/";
    let rest = url.split_once(marker)?.1;
    let mut parts = rest.split('/');
    let workspace = parts.next()?;
    let repo = parts.next()?;
    Some(format!("{workspace}/{repo}"))
}

fn percent_encode_path_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn github_search_all_open_row(pull: &Value, current_user: &str) -> Option<ReviewInboxRow> {
    let repo = pull
        .get("repository")
        .and_then(|repo| repo.get("nameWithOwner"))
        .and_then(Value::as_str)
        .map(String::from)?;
    let author = pull
        .get("author")
        .and_then(|author| author.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let is_draft = pull
        .get("isDraft")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Some(ReviewInboxRow {
        source: "github".into(),
        provider: "GitHub".into(),
        repo_id: repo.clone(),
        repo_name: repo,
        id: pull
            .get("number")
            .and_then(Value::as_u64)
            .map(|number| number.to_string())
            .unwrap_or_default(),
        number: pull.get("number").and_then(Value::as_u64),
        title: pull
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled PR")
            .into(),
        author: author.clone(),
        age: relative_age(pull.get("updatedAt").and_then(Value::as_str)),
        files: None,
        status: if is_draft { "draft" } else { "ready" }.into(),
        url: pull.get("url").and_then(Value::as_str).map(String::from),
        head_ref_name: None,
        base_ref_name: None,
        needs_review: false,
        is_created_by_me: author.eq_ignore_ascii_case(current_user),
        is_assigned_to_me: github_assignees_include(pull, current_user),
        cache_status: None,
        cached_at: None,
        description: None,
        labels: Vec::new(),
        commits_count: None,
        comments_count: None,
        tasks_count: None,
        additions_count: None,
        deletions_count: None,
        checks: None,
        approvals: None,
        requested_reviewers: Vec::new(),
        changed_file_groups: Vec::new(),
        activity: github_activity(pull, &author),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::provider_cache;
    use crate::runtime::provider_cache::{stable_identity_hash, ProviderCacheKey};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn list_review_inbox_cache_first_reads_cached_github_search() {
        let _guard = ENV_LOCK.lock().unwrap();
        let cache_path = std::env::temp_dir().join(format!(
            "anvil-inbox-cache-first-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&cache_path);
        std::env::set_var("ANVIL_PROVIDER_CACHE_PATH", &cache_path);
        std::env::set_var("GITHUB_TOKEN", "test-token");

        let auth_hash = stable_identity_hash("github:test-token");
        provider_cache::write(
            &ProviderCacheKey::get("github", "/user", &auth_hash),
            TTL_CURRENT_USER_SECONDS,
            &json!({ "login": "lane" }),
        )
        .unwrap();
        let query = percent_encode_path_component("is:pr is:open user:lane");
        provider_cache::write(
            &ProviderCacheKey::get(
                "github",
                &format!("/search/issues?order=desc&per_page=10&q={query}&sort=updated"),
                &auth_hash,
            ),
            TTL_INBOX_SECONDS,
            &json!({
                "items": [{
                    "number": 42,
                    "title": "Cached PR",
                    "repository_url": "https://api.github.com/repos/acme/widgets",
                    "html_url": "https://github.com/acme/widgets/pull/42",
                    "user": { "login": "lane" },
                    "updated_at": "2026-05-15T00:00:00Z",
                    "comments": 2,
                    "labels": [{ "name": "cached" }]
                }]
            }),
        )
        .unwrap();

        let result = list_review_inbox_blocking(Some(ReviewInboxRequest {
            filter: None,
            providers: Some(vec!["github".into()]),
            repos: None,
            limit: Some(10),
            cache_mode: Some(ReviewInboxCacheMode::CacheFirst),
        }))
        .unwrap();

        let rows = result.get("rows").and_then(Value::as_array).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["title"], "Cached PR");
        assert_eq!(rows[0]["cacheStatus"], "cached");

        let _ = fs::remove_file(&cache_path);
        std::env::remove_var("ANVIL_PROVIDER_CACHE_PATH");
        std::env::remove_var("GITHUB_TOKEN");
    }

    #[test]
    fn bitbucket_description_uses_summary_or_rendered_description() {
        let value = json!({
            "summary": { "raw": "Summary body" },
            "rendered": { "description": { "raw": "Rendered body" } }
        });

        assert_eq!(bitbucket_description(&value).as_deref(), Some("Summary body"));

        let value = json!({
            "rendered": { "description": { "raw": "Rendered body" } }
        });

        assert_eq!(bitbucket_description(&value).as_deref(), Some("Rendered body"));
    }

    #[test]
    fn bitbucket_status_summary_maps_build_states() {
        let summary = bitbucket_status_summary(&[
            json!({ "state": "SUCCESSFUL" }),
            json!({ "state": "FAILED" }),
            json!({ "state": "STOPPED" }),
            json!({ "state": "INPROGRESS" }),
        ]);

        assert_eq!(summary.passing, 1);
        assert_eq!(summary.failing, 2);
        assert_eq!(summary.pending, 1);
    }

    #[test]
    fn bitbucket_activity_items_map_actor_and_event_kind() {
        let activity = bitbucket_activity_from_values(&[
            json!({
                "actor": { "display_name": "Lane" },
                "approval": {},
                "created_on": "2026-05-15T12:00:00Z"
            }),
            json!({
                "comment": {
                    "user": { "nickname": "reviewer" },
                    "created_on": "2026-05-15T12:01:00Z"
                }
            }),
        ]);

        assert_eq!(activity.len(), 2);
        assert_eq!(activity[0].actor, "Lane");
        assert_eq!(activity[0].detail, "approved this pull request");
        assert_eq!(activity[1].actor, "reviewer");
        assert_eq!(activity[1].detail, "commented");
    }
}
