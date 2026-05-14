use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::ExitStatus,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    pub(crate) records: Mutex<HashMap<String, ReviewSessionRecord>>,
}

impl ReviewSessionStore {
    pub(crate) fn start_session(&self, record: ReviewSessionRecord) -> Result<(), String> {
        let session_id = record.session_id.clone();
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
        let mut records = self
            .records
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;

        if records.get(&session_id).is_some_and(|existing| {
            matches!(
                existing.status,
                ReviewSessionStatus::Running | ReviewSessionStatus::Submitting
            )
        }) {
            return Err(format!("Review session '{session_id}' is already running."));
        }

        sessions.insert(session_id.clone());
        cancelled.remove(&session_id);
        children.remove(&session_id);
        records.insert(session_id, record);

        Ok(())
    }

    pub(crate) fn cancel_session(&self, session_id: &str) -> Result<(bool, Vec<u32>), String> {
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
        let mut records = self
            .records
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;

        let had_session = sessions.remove(session_id);
        let was_cancelled = cancelled.contains(session_id);
        let had_record = records.contains_key(session_id);
        if had_session || was_cancelled || had_record {
            cancelled.insert(session_id.to_string());
        }
        let mut pids = Vec::new();
        if let Some(pid) = children.remove(session_id) {
            pids.push(pid);
        }
        if let Some(record) = records.get_mut(session_id) {
            record.status = ReviewSessionStatus::Cancelled;
            record.updated_at = review_session_timestamp();
            record.cancelled_at = Some(record.updated_at);
            for pid in &record.child_ids {
                if !pids.contains(pid) {
                    pids.push(*pid);
                }
            }
            record.child_ids.clear();
        }

        Ok((had_session || was_cancelled || had_record, pids))
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
        if let Some(record) = self
            .records
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?
            .get_mut(session_id)
        {
            if !record.child_ids.contains(&pid) {
                record.child_ids.push(pid);
            }
            record.updated_at = review_session_timestamp();
        }

        Ok(())
    }

    pub(crate) fn untrack_child(&self, session_id: &str) -> Result<Option<u32>, String> {
        let pid = self
            .children
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())
            .map(|mut children| children.remove(session_id))?;
        if let Some(pid) = pid {
            if let Some(record) = self
                .records
                .lock()
                .map_err(|_| "Could not lock review session store.".to_string())?
                .get_mut(session_id)
            {
                record.child_ids.retain(|tracked| *tracked != pid);
                record.updated_at = review_session_timestamp();
            }
        }
        Ok(pid)
    }

    pub(crate) fn session_record(&self, session_id: &str) -> Result<ReviewSessionRecord, String> {
        self.records
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Review session '{session_id}' is not known."))
    }

    pub(crate) fn set_status(
        &self,
        session_id: &str,
        status: ReviewSessionStatus,
    ) -> Result<(), String> {
        let is_active = matches!(
            status,
            ReviewSessionStatus::Running | ReviewSessionStatus::Submitting
        );
        let mut records = self
            .records
            .lock()
            .map_err(|_| "Could not lock review session store.".to_string())?;
        let record = records
            .get_mut(session_id)
            .ok_or_else(|| format!("Review session '{session_id}' is not known."))?;
        if record.status == ReviewSessionStatus::Cancelled
            && status != ReviewSessionStatus::Cancelled
        {
            return Ok(());
        }
        record.status = status;
        record.updated_at = review_session_timestamp();
        match record.status {
            ReviewSessionStatus::Completed => record.completed_at = Some(record.updated_at),
            ReviewSessionStatus::Submitted => record.submitted_at = Some(record.updated_at),
            ReviewSessionStatus::Cancelled => record.cancelled_at = Some(record.updated_at),
            ReviewSessionStatus::Failed => record.failed_at = Some(record.updated_at),
            ReviewSessionStatus::Running | ReviewSessionStatus::Submitting => {}
        }
        drop(records);

        if is_active {
            self.sessions
                .lock()
                .map_err(|_| "Could not lock review session store.".to_string())?
                .insert(session_id.to_string());
        } else {
            self.sessions
                .lock()
                .map_err(|_| "Could not lock review session store.".to_string())?
                .remove(session_id);
        }

        Ok(())
    }

    pub(crate) fn mark_failed(&self, session_id: &str) -> Result<(), String> {
        if self.is_cancelled(session_id)? {
            return Ok(());
        }
        self.set_status(session_id, ReviewSessionStatus::Failed)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ReviewSessionRecord {
    pub(crate) session_id: String,
    pub(crate) source: String,
    pub(crate) repo: String,
    pub(crate) pull_request: String,
    pub(crate) status: ReviewSessionStatus,
    pub(crate) worktree: PathBuf,
    pub(crate) plan_path: PathBuf,
    pub(crate) ui_path: PathBuf,
    pub(crate) child_ids: Vec<u32>,
    pub(crate) created_at: u128,
    pub(crate) updated_at: u128,
    pub(crate) completed_at: Option<u128>,
    pub(crate) submitted_at: Option<u128>,
    pub(crate) cancelled_at: Option<u128>,
    pub(crate) failed_at: Option<u128>,
}

impl ReviewSessionRecord {
    pub(crate) fn new(
        session_id: String,
        source: String,
        repo: String,
        pull_request: String,
        worktree: PathBuf,
        plan_path: PathBuf,
        ui_path: PathBuf,
    ) -> Self {
        let now = review_session_timestamp();
        Self {
            session_id,
            source,
            repo,
            pull_request,
            status: ReviewSessionStatus::Running,
            worktree,
            plan_path,
            ui_path,
            child_ids: Vec::new(),
            created_at: now,
            updated_at: now,
            completed_at: None,
            submitted_at: None,
            cancelled_at: None,
            failed_at: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ReviewSessionStatus {
    Running,
    Completed,
    Submitting,
    Submitted,
    Cancelled,
    Failed,
}

impl ReviewSessionStatus {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Submitting => "submitting",
            Self::Submitted => "submitted",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

fn review_session_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
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
    use super::{ReviewSessionRecord, ReviewSessionStatus, ReviewSessionStore};
    use std::path::PathBuf;

    fn record(session_id: &str) -> ReviewSessionRecord {
        ReviewSessionRecord::new(
            session_id.into(),
            "github".into(),
            "acme/widgets".into(),
            "12".into(),
            PathBuf::from(format!("/tmp/review-plan/{session_id}")),
            PathBuf::from(format!(
                "/tmp/anvil-review/{session_id}/review-plan.codex.json"
            )),
            PathBuf::from(format!(
                "/tmp/anvil-review/{session_id}/review-plan.ui.json"
            )),
        )
    }

    #[test]
    fn start_session_resets_stale_state() {
        let store = ReviewSessionStore::default();
        store.cancelled.lock().unwrap().insert("review-1".into());
        store.children.lock().unwrap().insert("review-1".into(), 42);

        store.start_session(record("review-1")).unwrap();

        assert!(store.sessions.lock().unwrap().contains("review-1"));
        assert!(!store.cancelled.lock().unwrap().contains("review-1"));
        assert!(!store.children.lock().unwrap().contains_key("review-1"));
        assert_eq!(
            store.session_record("review-1").unwrap().status,
            ReviewSessionStatus::Running
        );
    }

    #[test]
    fn cancel_session_removes_active_session_and_preserves_cancel_marker() {
        let store = ReviewSessionStore::default();
        store.start_session(record("review-1")).unwrap();
        store.track_child("review-1", 42).unwrap();

        let (had_session, pids) = store.cancel_session("review-1").unwrap();

        assert!(had_session);
        assert_eq!(pids, vec![42]);
        assert!(!store.sessions.lock().unwrap().contains("review-1"));
        assert!(store.cancelled.lock().unwrap().contains("review-1"));
        assert!(!store.children.lock().unwrap().contains_key("review-1"));
        assert_eq!(
            store.session_record("review-1").unwrap().status,
            ReviewSessionStatus::Cancelled
        );

        let (had_session, pids) = store.cancel_session("review-1").unwrap();
        assert!(had_session);
        assert!(pids.is_empty());
        assert!(store.cancelled.lock().unwrap().contains("review-1"));
    }

    #[test]
    fn cancel_unknown_session_does_not_leave_stale_cancel_marker() {
        let store = ReviewSessionStore::default();

        let (had_session, pids) = store.cancel_session("review-1").unwrap();

        assert!(!had_session);
        assert!(pids.is_empty());
        assert!(!store.cancelled.lock().unwrap().contains("review-1"));
    }

    #[test]
    fn start_session_rejects_concurrent_duplicate_session() {
        let store = ReviewSessionStore::default();
        store.start_session(record("review-1")).unwrap();

        assert_eq!(
            store.start_session(record("review-1")).unwrap_err(),
            "Review session 'review-1' is already running."
        );
    }

    #[test]
    fn concurrent_sessions_for_same_pull_request_keep_distinct_records() {
        let store = ReviewSessionStore::default();
        let first = record("review-1");
        let second = record("review-2");

        store.start_session(first.clone()).unwrap();
        store.start_session(second.clone()).unwrap();

        assert_eq!(
            store.session_record("review-1").unwrap().ui_path,
            first.ui_path
        );
        assert_eq!(
            store.session_record("review-2").unwrap().ui_path,
            second.ui_path
        );
        assert!(store.sessions.lock().unwrap().contains("review-1"));
        assert!(store.sessions.lock().unwrap().contains("review-2"));
    }
}
