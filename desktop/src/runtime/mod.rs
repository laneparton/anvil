mod agent;
mod agentic_plan;
mod app;
mod app_server;
mod diff;
mod git;
mod metadata;
mod process;
mod review;
mod scm;
mod session;
mod types;
mod util;

pub use app::run;

pub(crate) fn review_plan_smoke_json(
    source: &str,
    repo: &str,
    pull_request: &str,
    expected_head_sha: Option<&str>,
) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::{fs, path::PathBuf};

    let metadata = match source {
        "github" => metadata::github_pr_metadata(repo, pull_request)?,
        "bitbucket" => metadata::bitbucket_pr_metadata(repo, pull_request)?,
        other => return Err(format!("Unsupported review source `{other}`")),
    };
    let id = format!("{}-pr-{}", util::slug(repo), util::slug(pull_request));
    let worktree = PathBuf::from("/tmp/review-plan").join(&id);
    let output_root = PathBuf::from("/tmp/anvil-review");
    fs::create_dir_all(&output_root).map_err(|error| error.to_string())?;

    let checkout = git::prepare_git_checkout(&metadata, &worktree, pull_request)?;
    if let Some(expected) = expected_head_sha {
        if checkout.head_sha != expected {
            return Err(format!(
                "Prepared head SHA {} did not match expected pinned SHA {}",
                checkout.head_sha, expected
            ));
        }
    }

    let patch = git::git_stdout(
        &checkout.path,
        &[
            "diff",
            "--find-renames",
            "--patch",
            &format!("{}...{}", checkout.base_sha, checkout.head_sha),
        ],
        types::REVIEW_COMMAND_TIMEOUT,
    )?;
    let files = diff::parse_patch(&patch);
    let mut progress = |_| {};
    let plan = agentic_plan::build_review_plan(
        &metadata,
        &checkout.base_sha,
        &checkout.head_sha,
        &files,
        &checkout.path,
        &mut progress,
    )?;
    let plan_path = output_root.join(format!("{id}.review-plan.codex.json"));
    let ui_path = output_root.join(format!("{id}.review-plan.ui.json"));
    let plan_text = serde_json::to_string_pretty(&plan).map_err(|error| error.to_string())?;

    fs::write(&plan_path, format!("{plan_text}\n")).map_err(|error| error.to_string())?;
    fs::write(&ui_path, format!("{plan_text}\n")).map_err(|error| error.to_string())?;

    Ok(json!({
        "source": source,
        "repo": repo,
        "pullRequest": pull_request,
        "worktree": worktree,
        "planPath": plan_path,
        "uiPath": ui_path,
        "baseSha": checkout.base_sha,
        "headSha": checkout.head_sha,
        "changedFiles": files.len(),
        "hunks": files.iter().map(|file| file.hunks.len()).sum::<usize>(),
        "plan": plan
    }))
}

pub(crate) fn review_inbox_smoke_json(
    filter: &str,
    provider: Option<&str>,
    limit: usize,
) -> Result<serde_json::Value, String> {
    let filter = match filter {
        "needsReview" => types::ReviewInboxFilter::NeedsReview,
        "createdByMe" => types::ReviewInboxFilter::CreatedByMe,
        "assignedToMe" => types::ReviewInboxFilter::AssignedToMe,
        "allOpen" => types::ReviewInboxFilter::AllOpen,
        other => return Err(format!("Unknown inbox filter `{other}`")),
    };
    let providers = provider
        .filter(|value| !value.trim().is_empty())
        .map(|value| vec![value.to_string()]);
    let request = types::ReviewInboxRequest {
        filter: Some(filter),
        providers,
        repos: None,
        limit: Some(limit),
    };

    scm::list_review_inbox_blocking(Some(request))
}
