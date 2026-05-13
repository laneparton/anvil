use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) fn validate_review_worktree(worktree: &str) -> Result<String, String> {
    let allowed_root = fs::canonicalize("/tmp/review-plan")
        .map_err(|_| "No prepared review worktree root exists yet.".to_string())?;
    let worktree = fs::canonicalize(worktree)
        .map_err(|_| format!("Prepared review worktree does not exist: {worktree}"))?;

    if worktree != allowed_root && !worktree.starts_with(&allowed_root) {
        return Err("Refusing to open a terminal outside /tmp/review-plan.".into());
    }

    if !worktree.is_dir() {
        return Err(format!(
            "Prepared review worktree is not a directory: {}",
            worktree.display()
        ));
    }

    path_str(&worktree).map(String::from)
}

pub(crate) fn build_agent_prompt(
    repo: Option<&str>,
    pull_request: Option<&str>,
    title: Option<&str>,
    worktree: &str,
) -> String {
    let repo = repo.map(|value| format!(" {value}")).unwrap_or_default();
    let pull_request = pull_request
        .map(|value| format!(" #{value}"))
        .unwrap_or_default();
    let title = title.map(|value| format!(": {value}")).unwrap_or_default();

    format!(
        "You are helping review PR{repo}{pull_request}{title}.\n\n\
The checked-out review worktree is {worktree}.\n\n\
Start by inspecting the current diff and repository context, then help answer questions or refine review comments."
    )
}

pub(crate) fn render_agent_prompt_template(
    template: &str,
    repo: Option<&str>,
    pull_request: Option<&str>,
    title: Option<&str>,
    worktree: &str,
) -> String {
    let replacements = [
        ("{repo}", repo.unwrap_or_default()),
        ("{pullRequest}", pull_request.unwrap_or_default()),
        ("{title}", title.unwrap_or_default()),
        ("{worktree}", worktree),
    ];
    let mut prompt = template.to_string();

    for (placeholder, value) in replacements {
        prompt = prompt.replace(placeholder, value);
    }

    prompt
}

pub(crate) fn default_review_skill_path() -> Result<String, String> {
    let path = review_lab_root()?.join("skills/anvil-slice-review/SKILL.md");
    path_str(&path).map(String::from)
}

pub(crate) fn write_agent_command_script(
    agent: &str,
    prompt: &str,
    worktree: &str,
) -> Result<String, String> {
    let dir = std::env::temp_dir().join(format!("pr-review-agent-{}", unix_millis()));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let script_path = dir.join(format!("open-{agent}.command"));
    let script = format!(
        "#!/bin/zsh\n\
cd {} || exit 1\n\
clear\n\
printf '%s\\n\\n' {}\n\
if command -v {} >/dev/null 2>&1; then\n\
  exec {} {}\n\
fi\n\
printf '%s\\n' {}\n\
exec zsh -l\n",
        shell_quote(worktree),
        shell_quote(&format!("Anvil opened {agent} in {worktree}.")),
        shell_quote(agent),
        shell_quote(agent),
        shell_quote(prompt),
        shell_quote(&format!(
            "{agent} was not found on PATH. Install it or run it manually from this directory."
        )),
    );

    fs::write(&script_path, script).map_err(|error| error.to_string())?;
    fs::set_permissions(&script_path, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;

    path_str(&script_path).map(String::from)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn review_lab_root() -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("PR_REVIEW_LAB_ROOT") {
        return Ok(PathBuf::from(root));
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not resolve Anvil root.".into())
}

pub(crate) fn path_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| format!("Path is not valid UTF-8: {}", path.display()))
}

pub(crate) fn parse_bitbucket_repo(repo: &str) -> Result<(String, String), String> {
    let mut parts = repo.splitn(2, '/');
    let workspace = parts.next().unwrap_or_default();
    let repo_slug = parts.next().unwrap_or_default();

    if workspace.is_empty() || repo_slug.is_empty() {
        return Err("Bitbucket repo must be in workspace/repo_slug format.".into());
    }

    Ok((workspace.into(), repo_slug.into()))
}

pub(crate) fn slug(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn relative_age(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "now".into();
    };

    let then = parse_iso_timestamp(value).unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(then);
    let seconds = now.saturating_sub(then);
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;

    if days > 0 {
        format!("{days}d")
    } else if hours > 0 {
        format!("{hours}h")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        "now".into()
    }
}

pub(crate) fn parse_iso_timestamp(value: &str) -> Option<u64> {
    let normalized = normalize_utc_timestamp(value);
    let output = Command::new("date")
        .args(["-j", "-u", "-f", "%Y-%m-%dT%H:%M:%SZ", &normalized, "+%s"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}

fn normalize_utc_timestamp(value: &str) -> String {
    let value = value.trim();
    let without_offset = value.strip_suffix("+00:00").unwrap_or(value);
    let without_fraction = without_offset
        .split_once('.')
        .map(|(prefix, _)| prefix)
        .unwrap_or(without_offset);

    if without_fraction.ends_with('Z') {
        without_fraction.to_string()
    } else {
        format!("{without_fraction}Z")
    }
}

pub(crate) fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
