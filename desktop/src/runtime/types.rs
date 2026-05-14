use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::ExitStatus,
    sync::Mutex,
    time::Duration,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartReviewSessionRequest {
    pub(crate) session_id: Option<String>,
    pub(crate) source: String,
    pub(crate) repo: Option<String>,
    pub(crate) pull_request: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmitReviewRequest {
    pub(crate) session_id: String,
    pub(crate) source: String,
    pub(crate) repo: String,
    pub(crate) pull_request: String,
    pub(crate) action: SubmitReviewAction,
    pub(crate) comments: Vec<QueuedReviewComment>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SubmitReviewAction {
    Approve,
    Comment,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueuedReviewComment {
    pub(crate) file: Option<String>,
    pub(crate) line: Option<QueuedReviewCommentLine>,
    pub(crate) draft: Option<String>,
    pub(crate) body: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub(crate) enum QueuedReviewCommentLine {
    Number(i64),
    String(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenReviewAgentRequest {
    pub(crate) agent: String,
    pub(crate) worktree: String,
    pub(crate) repo: Option<String>,
    pub(crate) pull_request: Option<Value>,
    pub(crate) title: Option<String>,
    pub(crate) slice: Option<Value>,
    pub(crate) terminal_app: Option<String>,
    pub(crate) prompt_template: Option<String>,
    pub(crate) review_skill_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettingsPayload {
    pub(crate) env: HashMap<String, String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppSettingsPayload {
    pub(crate) settings: Value,
}

#[derive(Default)]
pub(crate) struct ReviewSessionStore {
    pub(crate) children: Mutex<HashMap<String, u32>>,
    pub(crate) cancelled: Mutex<HashSet<String>>,
    pub(crate) sessions: Mutex<HashSet<String>>,
}

impl ReviewSessionStore {
    pub(crate) fn start_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut cancelled = self
            .cancelled
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut children = self
            .children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;

        sessions.insert(session_id.to_string());
        cancelled.remove(session_id);
        children.remove(session_id);

        Ok(())
    }

    pub(crate) fn cancel_session(&self, session_id: &str) -> Result<(bool, Option<u32>), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut cancelled = self
            .cancelled
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut children = self
            .children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;

        let had_session = sessions.remove(session_id);
        let was_cancelled = cancelled.contains(session_id);
        if had_session || was_cancelled {
            cancelled.insert(session_id.to_string());
        }
        let pid = children.remove(session_id);

        Ok((had_session || was_cancelled, pid))
    }

    pub(crate) fn cleanup_session(&self, session_id: &str) -> Result<Option<u32>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut cancelled = self
            .cancelled
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let mut children = self
            .children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;

        sessions.remove(session_id);
        cancelled.remove(session_id);
        Ok(children.remove(session_id))
    }

    pub(crate) fn is_cancelled(&self, session_id: &str) -> Result<bool, String> {
        self.cancelled
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())
            .map(|cancelled| cancelled.contains(session_id))
    }

    pub(crate) fn track_child(&self, session_id: &str, pid: u32) -> Result<(), String> {
        self.children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?
            .insert(session_id.to_string(), pid);

        Ok(())
    }

    pub(crate) fn untrack_child(&self, session_id: &str) -> Result<Option<u32>, String> {
        self.children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())
            .map(|mut children| children.remove(session_id))
    }
}

pub(crate) struct CommandOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

pub(crate) const LIST_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const API_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);
pub(crate) const REVIEW_COMMAND_TIMEOUT: Duration = Duration::from_secs(20 * 60);
pub(crate) const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewRepo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) provider: String,
    pub(crate) open_prs: Option<u64>,
    pub(crate) description: Option<String>,
    pub(crate) updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewPullRequest {
    pub(crate) id: String,
    pub(crate) number: Option<u64>,
    pub(crate) title: String,
    pub(crate) repo: String,
    pub(crate) author: String,
    pub(crate) age: String,
    pub(crate) files: Option<u64>,
    pub(crate) status: String,
    pub(crate) url: Option<String>,
    pub(crate) head_ref_name: Option<String>,
    pub(crate) base_ref_name: Option<String>,
    pub(crate) needs_review: bool,
    pub(crate) is_created_by_me: bool,
    pub(crate) is_assigned_to_me: bool,
}

#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReviewInboxFilter {
    NeedsReview,
    CreatedByMe,
    AssignedToMe,
    #[default]
    AllOpen,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewInboxRequest {
    pub(crate) filter: Option<ReviewInboxFilter>,
    pub(crate) providers: Option<Vec<String>>,
    pub(crate) repos: Option<Vec<String>>,
    pub(crate) limit: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewInboxRow {
    pub(crate) source: String,
    pub(crate) provider: String,
    pub(crate) repo_id: String,
    pub(crate) repo_name: String,
    pub(crate) id: String,
    pub(crate) number: Option<u64>,
    pub(crate) title: String,
    pub(crate) author: String,
    pub(crate) age: String,
    pub(crate) files: Option<u64>,
    pub(crate) status: String,
    pub(crate) url: Option<String>,
    pub(crate) head_ref_name: Option<String>,
    pub(crate) base_ref_name: Option<String>,
    pub(crate) needs_review: bool,
    pub(crate) is_created_by_me: bool,
    pub(crate) is_assigned_to_me: bool,
}

#[derive(Clone)]
pub(crate) struct PrMetadata {
    pub(crate) repo: String,
    pub(crate) number: String,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) changed_files: u64,
    pub(crate) additions: u64,
    pub(crate) deletions: u64,
    pub(crate) base_ref: String,
    pub(crate) head_ref: String,
    pub(crate) base_repo_url: String,
    pub(crate) head_repo_url: String,
}

pub(crate) struct GitCheckout {
    pub(crate) path: PathBuf,
    pub(crate) base_sha: String,
    pub(crate) head_sha: String,
}

#[derive(Clone)]
pub(crate) struct DiffFile {
    pub(crate) path: String,
    pub(crate) added: u64,
    pub(crate) removed: u64,
    pub(crate) hunks: Vec<DiffHunk>,
}

#[derive(Clone)]
pub(crate) struct DiffHunk {
    pub(crate) id: String,
    pub(crate) header: String,
    pub(crate) old_start: Option<u64>,
    pub(crate) new_start: Option<u64>,
    pub(crate) lines: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::ReviewSessionStore;

    #[test]
    fn start_session_resets_stale_state() {
        let store = ReviewSessionStore::default();
        store.cancelled.lock().unwrap().insert("review-1".into());
        store.children.lock().unwrap().insert("review-1".into(), 42);

        store.start_session("review-1").unwrap();

        assert!(store.sessions.lock().unwrap().contains("review-1"));
        assert!(!store.cancelled.lock().unwrap().contains("review-1"));
        assert!(!store.children.lock().unwrap().contains_key("review-1"));
    }

    #[test]
    fn cancel_session_removes_active_session_and_preserves_cancel_marker() {
        let store = ReviewSessionStore::default();
        store.start_session("review-1").unwrap();
        store.children.lock().unwrap().insert("review-1".into(), 42);

        let (had_session, pid) = store.cancel_session("review-1").unwrap();

        assert!(had_session);
        assert_eq!(pid, Some(42));
        assert!(!store.sessions.lock().unwrap().contains("review-1"));
        assert!(store.cancelled.lock().unwrap().contains("review-1"));
        assert!(!store.children.lock().unwrap().contains_key("review-1"));

        let (had_session, pid) = store.cancel_session("review-1").unwrap();
        assert!(had_session);
        assert_eq!(pid, None);
        assert!(store.cancelled.lock().unwrap().contains("review-1"));
    }

    #[test]
    fn cleanup_session_removes_session_cancel_marker_and_child() {
        let store = ReviewSessionStore::default();
        store.start_session("review-1").unwrap();
        store.cancelled.lock().unwrap().insert("review-1".into());
        store.children.lock().unwrap().insert("review-1".into(), 42);

        let pid = store.cleanup_session("review-1").unwrap();

        assert_eq!(pid, Some(42));
        assert!(!store.sessions.lock().unwrap().contains("review-1"));
        assert!(!store.cancelled.lock().unwrap().contains("review-1"));
        assert!(!store.children.lock().unwrap().contains_key("review-1"));
    }

    #[test]
    fn cancel_unknown_session_does_not_leave_stale_cancel_marker() {
        let store = ReviewSessionStore::default();

        let (had_session, pid) = store.cancel_session("review-1").unwrap();

        assert!(!had_session);
        assert_eq!(pid, None);
        assert!(!store.cancelled.lock().unwrap().contains("review-1"));
    }
}
