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
    pub(crate) comments: Vec<Value>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SubmitReviewAction {
    Approve,
    Comment,
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
