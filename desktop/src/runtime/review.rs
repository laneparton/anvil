use super::{
    agentic_plan::{build_review_plan, ReviewPipelineEvent},
    diff::parse_patch,
    git::{git_stdout, prepare_git_checkout},
    metadata::{bitbucket_pr_metadata, github_pr_metadata},
    process::{emit_session_event, ensure_session_active},
    types::{ReviewSessionStore, REVIEW_COMMAND_TIMEOUT},
};
use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::AppHandle;

pub(crate) fn run_review_session(
    app: &AppHandle,
    state: &ReviewSessionStore,
    session_id: &str,
    _root: &Path,
    source: &str,
    repo: &str,
    pull_request: &str,
    worktree: &Path,
    plan_path: &Path,
    ui_path: &Path,
) -> Result<(), String> {
    ensure_session_active(state, session_id)?;

    let output_root = plan_path
        .parent()
        .ok_or_else(|| "Could not resolve review output directory.".to_string())?;
    fs::create_dir_all(output_root).map_err(|error| error.to_string())?;

    emit_session_event(
        app,
        session_id,
        "review.pipeline.started",
        "Preparing review in the Tauri runtime.",
        json!({ "worktree": worktree, "planPath": plan_path }),
    );

    emit_session_event(
        app,
        session_id,
        "metadata.fetch.started",
        "Fetching pull request metadata.",
        json!({ "source": source, "repo": repo, "pullRequest": pull_request }),
    );
    let metadata = match source {
        "github" => github_pr_metadata(repo, pull_request)?,
        "bitbucket" => bitbucket_pr_metadata(repo, pull_request)?,
        _ => return Err(format!("Unsupported review source: {source}")),
    };

    ensure_session_active(state, session_id)?;

    emit_session_event(
        app,
        session_id,
        "metadata.fetch.completed",
        "Pull request metadata fetched.",
        json!({
            "repo": metadata.repo,
            "pullRequest": metadata.number,
            "title": metadata.title,
            "changedFiles": metadata.changed_files,
            "additions": metadata.additions,
            "deletions": metadata.deletions
        }),
    );

    emit_session_event(
        app,
        session_id,
        "git.fetch.started",
        "Fetching refs into the local review worktree.",
        json!({ "worktree": worktree, "base": metadata.base_ref, "head": metadata.head_ref }),
    );
    let checkout = prepare_git_checkout(&metadata, worktree, pull_request)?;

    ensure_session_active(state, session_id)?;

    emit_session_event(
        app,
        session_id,
        "git.fetch.completed",
        "Local review worktree is ready.",
        json!({
            "worktree": checkout.path,
            "base": checkout.base_sha,
            "head": checkout.head_sha
        }),
    );

    let patch = git_stdout(
        &checkout.path,
        &[
            "diff",
            "--find-renames",
            "--patch",
            &format!("{}...{}", checkout.base_sha, checkout.head_sha),
        ],
        REVIEW_COMMAND_TIMEOUT,
    )?;
    let files = parse_patch(&patch);

    emit_session_event(
        app,
        session_id,
        "context.built",
        "Review context built from local git diff.",
        json!({
            "files": files.len(),
            "hunks": files.iter().map(|file| file.hunks.len()).sum::<usize>(),
            "additions": files.iter().map(|file| file.added).sum::<u64>(),
            "deletions": files.iter().map(|file| file.removed).sum::<u64>()
        }),
    );

    let mut app_server_pid = None;
    let mut progress = |event: ReviewPipelineEvent| {
        if event.event_type == "app_server.started" {
            if let Some(pid) = event.data.get("pid").and_then(Value::as_u64) {
                app_server_pid = Some(pid as u32);
                let _ = state.track_child(session_id, pid as u32);
            }
        }
        emit_session_event(
            app,
            session_id,
            &event.event_type,
            &event.message,
            event.data,
        );
    };

    let plan_result = build_review_plan(
        &metadata,
        &checkout.base_sha,
        &checkout.head_sha,
        &files,
        &checkout.path,
        &mut progress,
    );

    if app_server_pid.is_some() {
        let _ = state.untrack_child(session_id);
    }
    let plan = plan_result?;

    let plan_text = serde_json::to_string_pretty(&plan).map_err(|error| error.to_string())?;
    fs::write(plan_path, format!("{plan_text}\n")).map_err(|error| error.to_string())?;
    fs::write(ui_path, format!("{plan_text}\n")).map_err(|error| error.to_string())?;

    emit_session_event(
        app,
        session_id,
        "review.plan.ready",
        "Review plan written.",
        json!({ "planPath": plan_path, "uiPath": ui_path }),
    );

    emit_session_event(
        app,
        session_id,
        "review.ready",
        "Review is ready.",
        json!({
            "plan": plan,
            "artifacts": {
                "planPath": plan_path,
                "uiPath": ui_path,
                "worktree": worktree
            }
        }),
    );

    emit_session_event(
        app,
        session_id,
        "review.completed",
        "Review session completed.",
        json!({ "uiPath": ui_path, "worktree": worktree }),
    );

    Ok(())
}
