mod runtime;

pub use runtime::run;

pub fn review_inbox_smoke_json(
    filter: &str,
    provider: Option<&str>,
    limit: usize,
) -> Result<serde_json::Value, String> {
    runtime::review_inbox_smoke_json(filter, provider, limit)
}

pub fn review_plan_smoke_json(
    source: &str,
    repo: &str,
    pull_request: &str,
    expected_head_sha: Option<&str>,
) -> Result<serde_json::Value, String> {
    runtime::review_plan_smoke_json(source, repo, pull_request, expected_head_sha)
}
