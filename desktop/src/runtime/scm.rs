use super::{
    process::{bitbucket_api, bitbucket_paginated, config_var, exec_json, github_api},
    types::{ReviewInboxRequest, ReviewInboxRow, ReviewPullRequest, ReviewRepo},
    util::{parse_bitbucket_repo, parse_iso_timestamp, relative_age},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const BITBUCKET_PR_FIELDS: &str = "next,size,values.id,values.title,values.state,values.updated_on,values.links.html.href,values.source.branch.name,values.source.repository.full_name,values.source.repository.name,values.destination.branch.name,values.destination.repository.full_name,values.destination.repository.name,values.author.display_name,values.author.nickname,values.author.uuid,values.author.account_id,values.reviewers.display_name,values.reviewers.nickname,values.reviewers.uuid,values.reviewers.account_id,values.participants.user.uuid,values.participants.user.account_id,values.participants.user.nickname";
const BITBUCKET_REPO_FIELDS: &str = "next,size,values.full_name,values.scm,values.name,values.slug,values.description,values.is_private,values.links.html.href,values.updated_on,values.project.name";
const BITBUCKET_INBOX_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const BITBUCKET_RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
struct CachedInboxRows {
    rows: Vec<ReviewInboxRow>,
    cached_at: Instant,
}

static BITBUCKET_INBOX_CACHE: OnceLock<Mutex<HashMap<String, CachedInboxRows>>> = OnceLock::new();
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

pub(crate) fn list_review_inbox_blocking(
    request: Option<ReviewInboxRequest>,
) -> Result<Value, String> {
    let request = request.unwrap_or_default();
    let limit = request.limit.unwrap_or(100).clamp(1, 500);
    let mut rows = Vec::new();
    let mut errors = Vec::new();

    if provider_enabled(&request, "github") {
        match github_inbox_all_open(&request, limit) {
            Ok(mut provider_rows) => rows.append(&mut provider_rows),
            Err(error) => errors.push(json!({ "provider": "GitHub", "message": error })),
        }
    }

    if provider_enabled(&request, "bitbucket") {
        match bitbucket_inbox(&request, limit) {
            Ok(mut provider_rows) => rows.append(&mut provider_rows),
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
        .map(|pull| ReviewPullRequest {
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
            files: pull.get("changedFiles").and_then(Value::as_u64),
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
            needs_review: current_user
                .as_deref()
                .is_some_and(|login| github_review_requests_include(pull, login)),
            is_created_by_me: current_user
                .as_deref()
                .is_some_and(|login| github_author_login(pull) == Some(login)),
            is_assigned_to_me: current_user
                .as_deref()
                .is_some_and(|login| github_assignees_include(pull, login)),
        })
        .collect::<Vec<_>>())
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
    Ok(bitbucket_pull_requests_from_values(
        repo,
        bitbucket_paginated(path, 30)?,
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
) -> Result<Vec<ReviewInboxRow>, String> {
    if request.repos.as_ref().is_none_or(Vec::is_empty) {
        if let Ok(rows) = github_inbox_search_all_open(limit) {
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

fn github_inbox_search_all_open(limit: usize) -> Result<Vec<ReviewInboxRow>, String> {
    let current_user = github_current_user_login()
        .ok_or_else(|| "Could not resolve GitHub current user.".to_string())?;
    let query = percent_encode_path_component(&format!("is:pr is:open user:{current_user}"));
    let output = match github_api(&format!(
        "/search/issues?q={query}&sort=updated&order=desc&per_page={}",
        limit.clamp(1, 100)
    )) {
        Ok(output) => output,
        Err(_) => return github_inbox_search_all_open_via_cli(limit, &current_user),
    };

    Ok(output
        .get("items")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|pull| github_search_issue_row(pull, &current_user))
        .collect())
}

fn github_current_user_login() -> Option<String> {
    github_api("/user")
        .or_else(|_| exec_json("gh", &["api", "user"], None))
        .ok()?
        .get("login")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(String::from)
}

fn github_search_issue_row(pull: &Value, current_user: &str) -> Option<ReviewInboxRow> {
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
) -> Result<Vec<ReviewInboxRow>, String> {
    if bitbucket_backoff_active() {
        return Err("Bitbucket inbox discovery is cooling down after a rate limit response. Open a PR manually or retry after the cooldown.".into());
    }

    let cache_key = bitbucket_inbox_cache_key(request, limit);
    if let Some(rows) = bitbucket_cached_inbox_rows(&cache_key) {
        return Ok(rows.into_iter().take(limit).collect());
    }

    let result = bitbucket_inbox_uncached(request, limit);
    match result {
        Ok(rows) => {
            bitbucket_store_cached_inbox_rows(cache_key, rows.clone());
            Ok(rows)
        }
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
) -> Result<Vec<ReviewInboxRow>, String> {
    let current_user = bitbucket_current_user().map_err(|error| {
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
            return bitbucket_current_user_inbox(&current_user, limit);
        }
        return Ok(Vec::new());
    }

    let mut rows = Vec::new();
    let mut last_error = None;

    for repo in repos {
        if rows.len() >= limit {
            break;
        }

        match bitbucket_pull_requests_for_repo_query(&repo, current_user_ref) {
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

fn bitbucket_inbox_cache_key(request: &ReviewInboxRequest, limit: usize) -> String {
    let repos = request
        .repos
        .as_ref()
        .map(|repos| repos.join(","))
        .unwrap_or_default();
    [
        format!("limit={limit}"),
        format!("repos={repos}"),
        format!(
            "pinned={}",
            config_var("BITBUCKET_PINNED_REPOS").unwrap_or_default()
        ),
        format!(
            "workspace={}",
            config_var("BITBUCKET_WORKSPACE").unwrap_or_default()
        ),
        format!(
            "workspaces={}",
            config_var("BITBUCKET_WORKSPACES").unwrap_or_default()
        ),
        format!(
            "recentDays={}",
            config_var("BITBUCKET_RECENT_REPO_DAYS").unwrap_or_default()
        ),
        format!(
            "repoLimit={}",
            config_var("BITBUCKET_INBOX_REPO_LIMIT")
                .or_else(|| config_var("BITBUCKET_REVIEW_REPO_LIMIT"))
                .unwrap_or_default()
        ),
    ]
    .join(";")
}

fn bitbucket_cached_inbox_rows(cache_key: &str) -> Option<Vec<ReviewInboxRow>> {
    let cache = BITBUCKET_INBOX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().ok()?;
    let cached = cache.get(cache_key)?;
    if cached.cached_at.elapsed() > BITBUCKET_INBOX_CACHE_TTL {
        cache.remove(cache_key);
        return None;
    }

    Some(cached.rows.clone())
}

fn bitbucket_store_cached_inbox_rows(cache_key: String, rows: Vec<ReviewInboxRow>) {
    let cache = BITBUCKET_INBOX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            cache_key,
            CachedInboxRows {
                rows,
                cached_at: Instant::now(),
            },
        );
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
) -> Result<Vec<ReviewInboxRow>, String> {
    let mut rows_by_key = HashMap::new();
    let rows = bitbucket_authored_inbox(current_user, limit)?;

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
        match bitbucket_paginated(&path, limit - rows.len()) {
            Ok(pulls) => {
                rows.extend(
                    bitbucket_inbox_rows_from_values(pulls, &workspace, Some(current_user))
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
                    let row = inbox_row_from_pull("bitbucket", "Bitbucket", &repo, pull);
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
) -> Result<Vec<ReviewPullRequest>, String> {
    let (workspace, repo_slug) = parse_bitbucket_repo(repo)?;
    let path = format!(
        "/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&pagelen=30&sort=-updated_on&{}",
        bitbucket_fields_query(BITBUCKET_PR_FIELDS)
    );

    bitbucket_pull_requests_from_path(repo, &path, current_user)
}

fn bitbucket_current_user() -> Result<Value, String> {
    bitbucket_api("/user")
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
    }
}

fn review_inbox_row_key(row: &ReviewInboxRow) -> String {
    format!("{}:{}:{}", row.source, row.repo_id, row.number.unwrap_or(0))
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
    })
}
