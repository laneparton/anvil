use super::{
    process::{bitbucket_post_json, emit_session_event, github_post_json, terminate_child},
    review::run_review_session,
    types::{
        ReviewSessionStore, StartReviewSessionRequest, SubmitReviewAction, SubmitReviewRequest,
    },
    util::{parse_bitbucket_repo, review_lab_root, slug, unix_millis},
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, State};

#[tauri::command]
pub(crate) fn start_review_session(
    app: AppHandle,
    state: State<'_, Arc<ReviewSessionStore>>,
    request: StartReviewSessionRequest,
) -> Result<Value, String> {
    if request.source != "github" && request.source != "bitbucket" {
        return Err(
            "Only GitHub and Bitbucket reviews are wired in the desktop app right now.".into(),
        );
    }

    let repo = request
        .repo
        .clone()
        .ok_or_else(|| "A repository is required.".to_string())?;
    let root = review_lab_root()?;
    let session_id = request
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("review-{}", unix_millis()));
    let id = format!("{}-pr-{}", slug(&repo), slug(&request.pull_request));
    let worktree = PathBuf::from("/tmp/review-plan").join(&id);
    let output_root = PathBuf::from("/tmp/anvil-review");
    let plan_path = output_root.join(format!("{id}.review-plan.codex.json"));
    let ui_path = output_root.join(format!("{id}.review-plan.ui.json"));
    let state = state.inner().clone();
    let session_id_for_thread = session_id.clone();
    state
        .sessions
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .insert(session_id.clone());
    state
        .cancelled
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .remove(&session_id);

    tauri::async_runtime::spawn_blocking(move || {
        emit_session_event(
            &app,
            &session_id_for_thread,
            "review.started",
            "Started local review session.",
            json!({
                "source": request.source.clone(),
                "repo": repo,
                "pullRequest": request.pull_request.clone(),
            }),
        );

        let result = run_review_session(
            &app,
            &state,
            &session_id_for_thread,
            &root,
            &request.source,
            &repo,
            &request.pull_request,
            &worktree,
            &plan_path,
            &ui_path,
        );

        if let Err(error) = result {
            emit_session_event(
                &app,
                &session_id_for_thread,
                "review.failed",
                &error,
                json!({ "error": error }),
            );
        }
    });

    Ok(json!({ "sessionId": session_id }))
}

#[tauri::command]
pub(crate) fn cancel_review_session(
    app: AppHandle,
    state: State<'_, Arc<ReviewSessionStore>>,
    session_id: String,
) -> Result<Value, String> {
    let has_session = state
        .sessions
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .contains(&session_id);

    state
        .cancelled
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .insert(session_id.clone());

    let pid = state
        .children
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .remove(&session_id);

    if let Some(pid) = pid {
        terminate_child(pid);
    }

    emit_session_event(
        &app,
        &session_id,
        "review.cancelled",
        "Review session cancellation requested.",
        json!({ "pid": pid }),
    );

    Ok(json!({ "sessionId": session_id, "cancelled": has_session }))
}

#[tauri::command]
pub(crate) fn submit_review_session(
    state: State<'_, Arc<ReviewSessionStore>>,
    request: SubmitReviewRequest,
) -> Result<Value, String> {
    let has_session = state
        .sessions
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .contains(&request.session_id);
    if !has_session {
        return Err(format!(
            "Review session '{}' was not found.",
            request.session_id
        ));
    }

    let provider_result = submit_provider_review(&request)?;
    let receipt_id = format!("receipt-{}", unix_millis());
    Ok(json!({
        "receiptId": receipt_id,
        "sessionId": request.session_id,
        "status": "submitted",
        "submitted": true,
        "submittedAt": unix_millis(),
        "commentCount": request.comments.len(),
        "action": match request.action {
            SubmitReviewAction::Approve => "approve",
            SubmitReviewAction::Comment => "comment",
        },
        "provider": request.source,
        "providerResult": provider_result,
    }))
}

fn submit_provider_review(request: &SubmitReviewRequest) -> Result<Value, String> {
    match request.source.as_str() {
        "github" => submit_github_review(request),
        "bitbucket" => submit_bitbucket_review(request),
        other => Err(format!(
            "Submitting reviews for provider '{other}' is not supported."
        )),
    }
}

fn submit_github_review(request: &SubmitReviewRequest) -> Result<Value, String> {
    let event = match request.action {
        SubmitReviewAction::Approve => "APPROVE",
        SubmitReviewAction::Comment => "COMMENT",
    };
    let review_comments = github_review_comments(&request.comments);
    let body = github_review_body(&request.comments, review_comments.len(), &request.action);
    let payload = json!({
        "event": event,
        "body": body,
        "comments": review_comments,
    });
    let path = format!(
        "/repos/{}/pulls/{}/reviews",
        request.repo, request.pull_request
    );

    github_post_json(&path, &payload)
}

fn submit_bitbucket_review(request: &SubmitReviewRequest) -> Result<Value, String> {
    let (workspace, repo_slug) = parse_bitbucket_repo(&request.repo)?;
    let base_path = format!(
        "/repositories/{workspace}/{repo_slug}/pullrequests/{}",
        request.pull_request
    );

    match request.action {
        SubmitReviewAction::Approve => bitbucket_post_json(&format!("{base_path}/approve"), None),
        SubmitReviewAction::Comment => {
            let mut posted = Vec::new();
            for comment in &request.comments {
                posted.push(bitbucket_post_json(
                    &format!("{base_path}/comments"),
                    Some(&bitbucket_comment_payload(comment)?),
                )?);
            }

            Ok(json!({
                "postedComments": posted.len(),
                "comments": posted,
            }))
        }
    }
}

fn github_review_comments(comments: &[Value]) -> Vec<Value> {
    comments
        .iter()
        .filter_map(|comment| {
            let path = comment.get("file").and_then(Value::as_str)?;
            let line = comment_line_number(comment)?;
            Some(json!({
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": comment_body(comment),
            }))
        })
        .collect()
}

fn github_review_body(
    comments: &[Value],
    inline_count: usize,
    action: &SubmitReviewAction,
) -> String {
    match action {
        SubmitReviewAction::Approve => "Reviewed with Anvil.".into(),
        SubmitReviewAction::Comment => {
            let fallback_comments = comments
                .iter()
                .filter(|comment| comment_line_number(comment).is_none())
                .map(|comment| {
                    let file = comment
                        .get("file")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown file");
                    let line = comment.get("line").map(value_to_string).unwrap_or_default();
                    format!("{file}:{line}\n\n{}", comment_body(comment))
                })
                .collect::<Vec<_>>();

            if fallback_comments.is_empty() {
                format!("Anvil submitted {inline_count} inline review comments.")
            } else {
                fallback_comments.join("\n\n---\n\n")
            }
        }
    }
}

fn bitbucket_comment_payload(comment: &Value) -> Result<Value, String> {
    let body = comment_body(comment);
    if body.trim().is_empty() {
        return Err("Cannot submit an empty review comment.".into());
    }

    let mut payload = json!({
        "content": {
            "raw": body,
        },
    });

    if let (Some(path), Some(line)) = (
        comment.get("file").and_then(Value::as_str),
        comment_line_number(comment),
    ) {
        payload["inline"] = json!({
            "path": path,
            "to": line,
        });
    }

    Ok(payload)
}

fn comment_body(comment: &Value) -> String {
    comment
        .get("draft")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| comment.get("body").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

fn comment_line_number(comment: &Value) -> Option<i64> {
    let line = comment.get("line")?;
    if let Some(number) = line.as_i64() {
        return (number > 0).then_some(number);
    }

    line.as_str()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|number| *number > 0)
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| value.to_string())
}
