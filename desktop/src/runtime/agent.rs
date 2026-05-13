use super::{
    types::OpenReviewAgentRequest,
    util::{
        build_agent_prompt, default_review_skill_path, render_agent_prompt_template,
        validate_review_worktree, write_agent_command_script,
    },
};
use serde_json::{json, Value};
use std::{path::Path, process::Command};

#[tauri::command]
pub(crate) fn open_review_agent(request: OpenReviewAgentRequest) -> Result<Value, String> {
    let agent = match request.agent.as_str() {
        "claude" => "claude",
        _ => "codex",
    };
    let worktree = validate_review_worktree(&request.worktree)?;
    let pull_request = request.pull_request.as_ref().and_then(|value| {
        value
            .as_str()
            .map(String::from)
            .or_else(|| value.as_i64().map(|number| number.to_string()))
            .or_else(|| value.as_u64().map(|number| number.to_string()))
    });
    let mut prompt = request
        .prompt_template
        .as_deref()
        .map(str::trim)
        .filter(|template| !template.is_empty())
        .map(|template| {
            render_agent_prompt_template(
                template,
                request.repo.as_deref(),
                pull_request.as_deref(),
                request.title.as_deref(),
                &worktree,
            )
        })
        .unwrap_or_else(|| {
            build_agent_prompt(
                request.repo.as_deref(),
                pull_request.as_deref(),
                request.title.as_deref(),
                &worktree,
            )
        });

    let skill_path = request
        .review_skill_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .map(Ok)
        .unwrap_or_else(default_review_skill_path)?;
    if !Path::new(&skill_path).is_file() {
        return Err(format!("Review skill was not found: {skill_path}"));
    }

    prompt.push_str(&format!(
        "\n\nBefore reviewing, read and follow this per-slice review skill:\n{skill_path}"
    ));

    if let Some(slice) = request.slice.as_ref() {
        let slice_text = serde_json::to_string_pretty(slice).map_err(|error| error.to_string())?;
        prompt.push_str(&format!(
            "\n\nCurrent review slice. Review this slice first, and do not widen scope unless the skill tells you the slice boundary is wrong:\n{slice_text}"
        ));
    }

    let terminal_app = request
        .terminal_app
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Terminal");
    let script_path = write_agent_command_script(agent, &prompt, &worktree)?;
    let output = Command::new("open")
        .args(["-a", terminal_app])
        .arg(&script_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(json!({
        "agent": agent,
        "worktree": worktree,
        "prompt": prompt,
        "scriptPath": script_path,
        "terminalApp": terminal_app
    }))
}
