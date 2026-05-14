use super::{
    process::{bitbucket_post_json, emit_session_event, github_post_json, terminate_child},
    review::run_review_session,
    types::{
        QueuedReviewComment, QueuedReviewCommentLine, ReviewSessionStore,
        StartReviewSessionRequest, SubmitReviewAction, SubmitReviewRequest,
    },
    util::{parse_bitbucket_repo, review_lab_root, slug, unix_millis},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::Arc,
};
use tauri::{AppHandle, State};

struct ReviewSessionCleanup {
    state: Arc<ReviewSessionStore>,
    session_id: String,
}

impl ReviewSessionCleanup {
    fn new(state: Arc<ReviewSessionStore>, session_id: String) -> Self {
        Self { state, session_id }
    }
}

impl Drop for ReviewSessionCleanup {
    fn drop(&mut self) {
        let _ = self.state.cleanup_session(&self.session_id);
    }
}

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
    state.start_session(&session_id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let _cleanup = ReviewSessionCleanup::new(state.clone(), session_id_for_thread.clone());

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
            if state.is_cancelled(&session_id_for_thread).unwrap_or(false) {
                return;
            }

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
    let (has_session, pid) = state.cancel_session(&session_id)?;

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
    if request.session_id.trim().is_empty() {
        return Err("A review session id is required.".into());
    }

    if state.is_cancelled(&request.session_id)? {
        return Err(format!(
            "Review session '{}' was cancelled.",
            request.session_id
        ));
    }

    validate_submit_comments(&request.comments)?;
    validate_submit_comment_anchors(&request)?;

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
    validate_submit_comments(&request.comments)?;

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
    let review_comments = github_review_comments(&request.comments)?;
    let body = github_review_body(&request.comments, review_comments.len(), &request.action)?;
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

fn validate_submit_comments(comments: &[QueuedReviewComment]) -> Result<(), String> {
    for (index, comment) in comments.iter().enumerate() {
        if comment_body(comment).trim().is_empty() {
            return Err(format!("Review comment {} cannot be empty.", index + 1));
        }
        comment_line_number(comment)
            .map_err(|error| format!("Review comment {} {error}", index + 1))?;
    }

    Ok(())
}

fn validate_submit_comment_anchors(request: &SubmitReviewRequest) -> Result<(), String> {
    if request.comments.is_empty() {
        return Ok(());
    }

    let plan = load_submit_review_plan(request)?;
    let anchors = comment_anchor_surface_from_review_plan(&plan)?;
    validate_submit_comments_against_anchors(&request.comments, &anchors)
}

fn validate_submit_comments_against_anchors(
    comments: &[QueuedReviewComment],
    anchors: &HashMap<String, HashSet<i64>>,
) -> Result<(), String> {
    for (index, comment) in comments.iter().enumerate() {
        let number = index + 1;
        let Some(path) = comment_file(comment) else {
            return Err(format!(
                "Review comment {number} must include a file anchor."
            ));
        };
        let Some(line) = comment_line_number(comment)? else {
            return Err(format!(
                "Review comment {number} must include a line anchor."
            ));
        };
        let Some(lines) = anchors.get(path) else {
            return Err(format!(
                "Review comment {number} references file outside the pull request diff: {path}."
            ));
        };

        if !lines.contains(&line) {
            return Err(format!(
                "Review comment {number} references {path}:{line}, which is not in the pull request diff."
            ));
        }
    }

    Ok(())
}

fn load_submit_review_plan(request: &SubmitReviewRequest) -> Result<Value, String> {
    let id = format!("{}-pr-{}", slug(&request.repo), slug(&request.pull_request));
    let path = PathBuf::from("/tmp/anvil-review").join(format!("{id}.review-plan.ui.json"));
    let text = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Could not load prepared review diff anchors from {}: {error}",
            path.display()
        )
    })?;

    serde_json::from_str(&text).map_err(|error| {
        format!(
            "Prepared review diff anchors are not valid JSON in {}: {error}",
            path.display()
        )
    })
}

fn comment_anchor_surface_from_review_plan(
    plan: &Value,
) -> Result<HashMap<String, HashSet<i64>>, String> {
    let slices = plan
        .get("slices")
        .and_then(Value::as_array)
        .ok_or_else(|| "Prepared review plan does not include diff slices.".to_string())?;
    let mut anchors: HashMap<String, HashSet<i64>> = HashMap::new();

    for slice in slices {
        for hunk in slice
            .get("hunks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(path) = hunk
                .get("file")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };

            for line in hunk
                .get("lines")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if line.get("kind").and_then(Value::as_str) == Some("remove") {
                    continue;
                }

                if let Some(new_number) = line
                    .get("newNumber")
                    .and_then(Value::as_i64)
                    .filter(|value| *value > 0)
                {
                    anchors
                        .entry(path.to_string())
                        .or_default()
                        .insert(new_number);
                }
            }
        }
    }

    if anchors.is_empty() {
        return Err("Prepared review plan does not include diff line anchors.".into());
    }

    Ok(anchors)
}

fn github_review_comments(comments: &[QueuedReviewComment]) -> Result<Vec<Value>, String> {
    let mut review_comments = Vec::new();
    for comment in comments {
        if let Some((path, line)) = comment_inline_location(comment)? {
            review_comments.push(json!({
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": comment_body(comment),
            }));
        }
    }

    Ok(review_comments)
}

fn github_review_body(
    comments: &[QueuedReviewComment],
    inline_count: usize,
    action: &SubmitReviewAction,
) -> Result<String, String> {
    match action {
        SubmitReviewAction::Approve => Ok("Reviewed with Anvil.".into()),
        SubmitReviewAction::Comment => {
            let mut fallback_comments = Vec::new();
            for comment in comments {
                if comment_inline_location(comment)?.is_none() {
                    let file = comment_file(comment).unwrap_or("unknown file");
                    let line = comment
                        .line
                        .as_ref()
                        .map(comment_line_to_string)
                        .unwrap_or_default();
                    fallback_comments.push(format!("{file}:{line}\n\n{}", comment_body(comment)));
                } else {
                    continue;
                };
            }

            if fallback_comments.is_empty() {
                Ok(format!(
                    "Anvil submitted {inline_count} inline review comments."
                ))
            } else {
                Ok(fallback_comments.join("\n\n---\n\n"))
            }
        }
    }
}

fn bitbucket_comment_payload(comment: &QueuedReviewComment) -> Result<Value, String> {
    let body = comment_body(comment);
    if body.trim().is_empty() {
        return Err("Cannot submit an empty review comment.".into());
    }

    let mut payload = json!({
        "content": {
            "raw": body,
        },
    });

    if let Some((path, line)) = comment_inline_location(comment)? {
        payload["inline"] = json!({
            "path": path,
            "to": line,
        });
    }

    Ok(payload)
}

fn comment_body(comment: &QueuedReviewComment) -> &str {
    comment
        .draft
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(comment.body.as_deref())
        .unwrap_or_default()
}

fn comment_inline_location(comment: &QueuedReviewComment) -> Result<Option<(&str, i64)>, String> {
    let Some(line) = comment_line_number(comment)? else {
        return Ok(None);
    };
    let Some(path) = comment_file(comment) else {
        return Ok(None);
    };

    Ok(Some((path, line)))
}

fn comment_file(comment: &QueuedReviewComment) -> Option<&str> {
    comment
        .file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn comment_line_number(comment: &QueuedReviewComment) -> Result<Option<i64>, String> {
    let Some(line) = &comment.line else {
        return Ok(None);
    };

    let number = match line {
        QueuedReviewCommentLine::Number(number) => *number,
        QueuedReviewCommentLine::String(value) => value
            .trim()
            .parse::<i64>()
            .map_err(|_| "line must be a positive integer.".to_string())?,
    };

    if number <= 0 {
        return Err("line must be a positive integer.".into());
    }

    Ok(Some(number))
}

fn comment_line_to_string(line: &QueuedReviewCommentLine) -> String {
    match line {
        QueuedReviewCommentLine::Number(number) => number.to_string(),
        QueuedReviewCommentLine::String(value) => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        bitbucket_comment_payload, comment_anchor_surface_from_review_plan, comment_body,
        comment_line_number, github_review_body, github_review_comments, submit_provider_review,
        validate_submit_comments_against_anchors,
    };
    use crate::runtime::types::{SubmitReviewAction, SubmitReviewRequest};
    use serde_json::{json, Value};

    fn request_with_comments(comments: Value) -> SubmitReviewRequest {
        serde_json::from_value(json!({
            "sessionId": "session-1",
            "source": "github",
            "repo": "acme/widgets",
            "pullRequest": "12",
            "action": "comment",
            "comments": comments,
        }))
        .unwrap()
    }

    fn anchor_plan() -> Value {
        json!({
            "schema": "review-plan.v0",
            "slices": [
                {
                    "id": "slice-1",
                    "hunks": [
                        {
                            "file": "src/lib.rs",
                            "hunkId": "src/lib.rs#h1",
                            "lines": [
                                {
                                    "kind": "context",
                                    "oldNumber": 9,
                                    "newNumber": 9,
                                    "text": "fn existing() {}"
                                },
                                {
                                    "kind": "add",
                                    "oldNumber": null,
                                    "newNumber": 10,
                                    "text": "fn added() {}"
                                },
                                {
                                    "kind": "remove",
                                    "oldNumber": 11,
                                    "newNumber": null,
                                    "text": "fn removed() {}"
                                }
                            ]
                        }
                    ]
                }
            ]
        })
    }

    #[test]
    fn submit_request_deserializes_typed_comments() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": "42",
                "draft": "Use the checked value.",
                "body": "ignored while draft is present"
            },
            {
                "body": "Top-level review note."
            }
        ]));

        assert_eq!(request.comments.len(), 2);
        assert_eq!(comment_line_number(&request.comments[0]).unwrap(), Some(42));
        assert_eq!(comment_body(&request.comments[0]), "Use the checked value.");
        assert_eq!(comment_line_number(&request.comments[1]).unwrap(), None);
        assert_eq!(comment_body(&request.comments[1]), "Top-level review note.");
    }

    #[test]
    fn malformed_line_shape_fails_deserialization() {
        let result = serde_json::from_value::<SubmitReviewRequest>(json!({
            "sessionId": "session-1",
            "source": "github",
            "repo": "acme/widgets",
            "pullRequest": "12",
            "action": "comment",
            "comments": [
                {
                    "file": "src/lib.rs",
                    "line": { "start": 1 },
                    "body": "This should not deserialize."
                }
            ],
        }));

        assert!(result.is_err());
    }

    #[test]
    fn github_inline_comments_require_file_and_positive_line() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 7,
                "draft": "Inline draft comment.",
                "body": "Inline body comment."
            },
            {
                "file": "src/other.rs",
                "body": "No line means body fallback."
            },
            {
                "line": 9,
                "body": "No file means body fallback."
            }
        ]));

        assert_eq!(
            github_review_comments(&request.comments).unwrap(),
            vec![json!({
                "path": "src/lib.rs",
                "line": 7,
                "side": "RIGHT",
                "body": "Inline draft comment.",
            })]
        );
    }

    #[test]
    fn github_body_preserves_comments_that_cannot_be_inline() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 7,
                "body": "Inline comment."
            },
            {
                "file": "src/other.rs",
                "body": "No line means body fallback."
            },
            {
                "line": "9",
                "body": "No file means body fallback."
            }
        ]));

        assert_eq!(
            github_review_body(&request.comments, 1, &SubmitReviewAction::Comment).unwrap(),
            "src/other.rs:\n\nNo line means body fallback.\n\n---\n\nunknown file:9\n\nNo file means body fallback."
        );
    }

    #[test]
    fn invalid_comment_body_or_line_fails_before_provider_submission() {
        let empty_comment = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 7,
                "body": "   "
            }
        ]));
        assert_eq!(
            submit_provider_review(&empty_comment).unwrap_err(),
            "Review comment 1 cannot be empty."
        );

        let invalid_line = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 0,
                "body": "Line zero is invalid."
            }
        ]));
        assert_eq!(
            submit_provider_review(&invalid_line).unwrap_err(),
            "Review comment 1 line must be a positive integer."
        );
    }

    #[test]
    fn bitbucket_payload_uses_inline_location_only_when_complete() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": "12",
                "body": "Inline on Bitbucket."
            },
            {
                "file": "src/lib.rs",
                "body": "Body-level on Bitbucket."
            }
        ]));

        assert_eq!(
            bitbucket_comment_payload(&request.comments[0]).unwrap(),
            json!({
                "content": { "raw": "Inline on Bitbucket." },
                "inline": { "path": "src/lib.rs", "to": 12 },
            })
        );
        assert_eq!(
            bitbucket_comment_payload(&request.comments[1]).unwrap(),
            json!({
                "content": { "raw": "Body-level on Bitbucket." },
            })
        );
    }

    #[test]
    fn diff_anchor_validation_accepts_valid_changed_line() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 10,
                "body": "Comment on the added line."
            }
        ]));
        let anchors = comment_anchor_surface_from_review_plan(&anchor_plan()).unwrap();

        validate_submit_comments_against_anchors(&request.comments, &anchors).unwrap();
    }

    #[test]
    fn diff_anchor_validation_rejects_invalid_file() {
        let request = request_with_comments(json!([
            {
                "file": "src/missing.rs",
                "line": 10,
                "body": "Comment on the wrong file."
            }
        ]));
        let anchors = comment_anchor_surface_from_review_plan(&anchor_plan()).unwrap();

        assert_eq!(
            validate_submit_comments_against_anchors(&request.comments, &anchors).unwrap_err(),
            "Review comment 1 references file outside the pull request diff: src/missing.rs."
        );
    }

    #[test]
    fn diff_anchor_validation_rejects_line_outside_hunks() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "line": 42,
                "body": "Comment on an unchanged line outside the diff hunk."
            }
        ]));
        let anchors = comment_anchor_surface_from_review_plan(&anchor_plan()).unwrap();

        assert_eq!(
            validate_submit_comments_against_anchors(&request.comments, &anchors).unwrap_err(),
            "Review comment 1 references src/lib.rs:42, which is not in the pull request diff."
        );
    }

    #[test]
    fn diff_anchor_validation_rejects_missing_line() {
        let request = request_with_comments(json!([
            {
                "file": "src/lib.rs",
                "body": "Comment without a line."
            }
        ]));
        let anchors = comment_anchor_surface_from_review_plan(&anchor_plan()).unwrap();

        assert_eq!(
            validate_submit_comments_against_anchors(&request.comments, &anchors).unwrap_err(),
            "Review comment 1 must include a line anchor."
        );
    }
}
