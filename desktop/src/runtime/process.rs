use super::{
    types::{
        AppSettingsPayload, CommandOutput, ReviewSessionStore, StoredAppSettingsPayload,
        API_COMMAND_TIMEOUT, LIST_COMMAND_TIMEOUT,
    },
    util::unix_millis,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest::blocking::Client;

static CONFIG_OVERRIDES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[tauri::command]
pub(crate) fn configure_app_settings(settings: AppSettingsPayload) -> Result<(), String> {
    let overrides = settings
        .env
        .into_iter()
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .filter(|(key, value)| !key.is_empty() && !value.is_empty())
        .collect::<HashMap<_, _>>();
    let config = CONFIG_OVERRIDES.get_or_init(|| Mutex::new(HashMap::new()));
    *config.lock().map_err(|error| error.to_string())? = overrides;

    Ok(())
}

#[tauri::command]
pub(crate) fn load_app_settings(app: AppHandle) -> Result<Option<Value>, String> {
    let path = app_settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read app settings at {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map(Some).map_err(|error| {
        format!(
            "Could not parse app settings at {}: {error}",
            path.display()
        )
    })
}

#[tauri::command]
pub(crate) fn save_app_settings(
    app: AppHandle,
    payload: StoredAppSettingsPayload,
) -> Result<(), String> {
    let path = app_settings_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Could not resolve parent directory for {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Could not create app settings directory {}: {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(&payload.settings).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{raw}\n")).map_err(|error| {
        format!(
            "Could not write app settings at {}: {error}",
            path.display()
        )
    })
}

#[tauri::command]
pub(crate) fn reset_app_settings(app: AppHandle) -> Result<(), String> {
    let path = app_settings_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove app settings at {}: {error}",
            path.display()
        )),
    }
}

fn app_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|error| error.to_string())
}

pub(crate) fn emit_session_event(
    app: &AppHandle,
    session_id: &str,
    event_type: &str,
    message: &str,
    data: Value,
) {
    let _ = app.emit(
        "review-session-event",
        json!({
            "sessionId": session_id,
            "type": event_type,
            "message": message,
            "at": unix_millis(),
            "data": data
        }),
    );
}

pub(crate) fn exec_json(command: &str, args: &[&str], cwd: Option<&Path>) -> Result<Value, String> {
    exec_json_timeout(command, args, cwd, LIST_COMMAND_TIMEOUT)
}

pub(crate) fn exec_json_timeout(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<Value, String> {
    let output = run_command(command, args, cwd, timeout)?;
    serde_json::from_slice(&output).map_err(|error| error.to_string())
}

pub(crate) fn github_api(path: &str) -> Result<Value, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("https://api.github.com{path}")
    };

    let mut request = http_client()
        .get(&url)
        .header("Accept", "application/vnd.github+json");

    if let Some(token) = github_auth_token() {
        request = request.bearer_auth(token);
    }

    send_json(request, &url)
}

pub(crate) fn github_post_json(path: &str, body: &Value) -> Result<Value, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("https://api.github.com{path}")
    };

    let mut request = http_client()
        .post(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(body);

    if let Some(token) = github_auth_token() {
        request = request.bearer_auth(token);
    }

    send_json(request, &url)
}

fn github_auth_token() -> Option<String> {
    config_var("GH_TOKEN")
        .or_else(|| config_var("GITHUB_TOKEN"))
        .or_else(gh_auth_token)
}

fn gh_auth_token() -> Option<String> {
    static TOKEN: OnceLock<Option<String>> = OnceLock::new();

    TOKEN
        .get_or_init(|| {
            let output =
                run_command_timeout("gh", &["auth", "token"], None, Duration::from_secs(5)).ok()?;
            let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (!token.is_empty()).then_some(token)
        })
        .clone()
}

pub(crate) fn bitbucket_api(path: &str) -> Result<Value, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("https://api.bitbucket.org/2.0{path}")
    };
    let BitbucketApiAuth::Basic { username, password } = bitbucket_api_auth()?;
    let request = http_client()
        .get(&url)
        .header("Accept", "application/json")
        .basic_auth(username, Some(password));

    send_json(request, &url)
}

pub(crate) fn bitbucket_post_json(path: &str, body: Option<&Value>) -> Result<Value, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("https://api.bitbucket.org/2.0{path}")
    };
    let BitbucketApiAuth::Basic { username, password } = bitbucket_api_auth()?;
    let mut request = http_client()
        .post(&url)
        .header("Accept", "application/json")
        .basic_auth(username, Some(password));

    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .json(body);
    }

    send_json(request, &url)
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(API_COMMAND_TIMEOUT)
            .user_agent("anvil-review")
            .build()
            .expect("failed to create HTTP client")
    })
}

fn send_json(
    request: tauri_plugin_http::reqwest::blocking::RequestBuilder,
    url: &str,
) -> Result<Value, String> {
    let response = request.send().map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().map_err(|error| error.to_string())?;

    if !status.is_success() {
        let mut message = redact_url_credentials(&format!("HTTP {status} for {url}\n{body}"));
        if url.contains("api.bitbucket.org") && (status.as_u16() == 401 || status.as_u16() == 403) {
            message.push_str(
                "\n\nBitbucket approval/comment submission requires a token with Pull requests write access, such as OAuth pullrequest:write or API token write:pullrequest:bitbucket.",
            );
        }
        if url.contains("api.github.com") && (status.as_u16() == 401 || status.as_u16() == 403) {
            message.push_str(
                "\n\nGitHub approval/comment submission requires a token with pull request review write access.",
            );
        }
        return Err(message);
    }

    serde_json::from_str(&body).map_err(|error| error.to_string())
}

pub(crate) fn bitbucket_paginated(path: &str, limit: usize) -> Result<Vec<Value>, String> {
    let mut next = path.to_string();
    let mut values = Vec::new();

    while !next.is_empty() && values.len() < limit {
        let page = bitbucket_api(&next)?;
        if let Some(items) = page.get("values").and_then(Value::as_array) {
            for item in items {
                values.push(item.clone());
                if values.len() >= limit {
                    break;
                }
            }
        }

        next = page
            .get("next")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    }

    Ok(values)
}

pub(crate) fn bitbucket_clone_url(repo: &Value) -> Option<String> {
    let links = repo
        .get("links")
        .and_then(|links| links.get("clone"))
        .and_then(Value::as_array)?;
    let https = links
        .iter()
        .find(|link| link.get("name").and_then(Value::as_str) == Some("https"))
        .and_then(|link| link.get("href"))
        .and_then(Value::as_str)
        .map(with_bitbucket_git_auth);
    let ssh = links
        .iter()
        .find(|link| link.get("name").and_then(Value::as_str) == Some("ssh"))
        .and_then(|link| link.get("href"))
        .and_then(Value::as_str)
        .map(String::from);

    https.or(ssh)
}

pub(crate) fn with_bitbucket_git_auth(repo_url: &str) -> String {
    let repo_url = normalize_bitbucket_https_url(repo_url);
    if !repo_url.starts_with("https://") {
        return repo_url;
    }

    let Some((username, password)) = bitbucket_git_credentials() else {
        return repo_url;
    };
    if username.is_empty() || password.is_empty() {
        return repo_url;
    }

    repo_url.replacen(
        "https://",
        &format!(
            "https://{}:{}@",
            percent_encode_url_userinfo(&username),
            percent_encode_url_userinfo(&password)
        ),
        1,
    )
}

fn normalize_bitbucket_https_url(repo_url: &str) -> String {
    let Some(rest) = repo_url.strip_prefix("https://") else {
        return repo_url.to_string();
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return repo_url.to_string();
    };
    let Some(host) = authority.rsplit('@').next() else {
        return repo_url.to_string();
    };
    if !host.eq_ignore_ascii_case("bitbucket.org") {
        return repo_url.to_string();
    }

    format!("https://bitbucket.org/{path}")
}

pub(crate) fn git_url_without_credentials(repo_url: &str) -> String {
    let Some(rest) = repo_url.strip_prefix("https://") else {
        return repo_url.to_string();
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return repo_url.to_string();
    };
    let Some(at_index) = authority.rfind('@') else {
        return repo_url.to_string();
    };

    format!("https://{}/{}", &authority[at_index + 1..], path)
}

fn bitbucket_git_credentials() -> Option<(String, String)> {
    if let Some(token) = config_var("BITBUCKET_ACCESS_TOKEN") {
        let username = config_var("BITBUCKET_GIT_USERNAME").unwrap_or_else(|| {
            if config_var("BITBUCKET_EMAIL").is_some() || config_var("BITBUCKET_USERNAME").is_some()
            {
                "x-bitbucket-api-token-auth".into()
            } else {
                "x-token-auth".into()
            }
        });
        return Some((username, token));
    }

    let username = config_var("BITBUCKET_USERNAME")?;
    let app_password = config_var("BITBUCKET_APP_PASSWORD")?;
    Some((username, app_password))
}

enum BitbucketApiAuth {
    Basic { username: String, password: String },
}

fn bitbucket_api_auth() -> Result<BitbucketApiAuth, String> {
    if let Some(token) = config_var("BITBUCKET_API_TOKEN") {
        if token.trim().is_empty() {
            return Err(bitbucket_auth_error());
        }

        return Ok(BitbucketApiAuth::Basic {
            username: bitbucket_basic_username(),
            password: token,
        });
    }

    if let Some(token) = config_var("BITBUCKET_ACCESS_TOKEN") {
        if token.trim().is_empty() {
            return Err(bitbucket_auth_error());
        }

        return Ok(BitbucketApiAuth::Basic {
            username: bitbucket_basic_username(),
            password: token,
        });
    }

    if let (Some(username), Some(app_password)) = (
        config_var("BITBUCKET_USERNAME"),
        config_var("BITBUCKET_APP_PASSWORD"),
    ) {
        if !username.trim().is_empty() && !app_password.trim().is_empty() {
            return Ok(BitbucketApiAuth::Basic {
                username,
                password: app_password,
            });
        }
    }

    Err(bitbucket_auth_error())
}

fn bitbucket_auth_error() -> String {
    "Configure Bitbucket REST auth with BITBUCKET_API_TOKEN plus BITBUCKET_EMAIL or BITBUCKET_USERNAME, BITBUCKET_ACCESS_TOKEN, or BITBUCKET_USERNAME/BITBUCKET_APP_PASSWORD.".into()
}

fn bitbucket_basic_username() -> String {
    config_var("BITBUCKET_EMAIL")
        .or_else(|| config_var("BITBUCKET_USERNAME"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "x-bitbucket-api-token-auth".into())
}

pub(crate) fn config_var(key: &str) -> Option<String> {
    CONFIG_OVERRIDES
        .get()
        .and_then(|config| config.lock().ok()?.get(key).cloned())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| launchctl_getenv(key))
        })
}

fn launchctl_getenv(key: &str) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Some(value) = cache.lock().ok()?.get(key).cloned() {
        return value;
    }

    let output = Command::new("launchctl")
        .args(["getenv", key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let value = (!value.is_empty()).then_some(value);

    if let Ok(mut cache) = cache.lock() {
        cache.insert(key.to_string(), value.clone());
    }

    value
}

fn percent_encode_url_userinfo(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn run_command(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    Ok(run_command_timeout(command, args, cwd, timeout)?.stdout)
}

pub(crate) fn run_command_status(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<(), String> {
    let _ = run_command_timeout(command, args, cwd, timeout)?;
    Ok(())
}

pub(crate) fn run_command_timeout(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<CommandOutput, String> {
    run_command_inner(command, args, None, cwd, timeout)
}

fn run_command_inner(
    command: &str,
    args: &[&str],
    input: Option<&str>,
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<CommandOutput, String> {
    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = cwd {
        command_builder.current_dir(cwd);
    }

    let mut child = command_builder.spawn().map_err(|error| {
        format!(
            "Failed to run `{}`. Is it installed and available on PATH? {}",
            command, error
        )
    })?;
    if let Some(input) = input {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(input.as_bytes())
                .map_err(|error| error.to_string())?;
        }
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = read_pipe(stdout);
    let stderr_reader = read_pipe(stderr);
    let started = Instant::now();

    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }

        if started.elapsed() >= timeout {
            terminate_child(child.id());
            let _ = child.wait();
            return Err(format!(
                "`{}` timed out after {}s",
                command,
                timeout.as_secs()
            ));
        }

        thread::sleep(Duration::from_millis(100));
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let output = CommandOutput {
        status,
        stdout,
        stderr,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let mut parts = Vec::new();

        if !stderr.is_empty() {
            parts.push(stderr);
        }

        if !stdout.is_empty() {
            parts.push(stdout);
        }

        if parts.is_empty() {
            parts.push(format!("`{command}` exited with status {}", output.status));
        }

        return Err(redact_url_credentials(&parts.join("\n")));
    }

    Ok(output)
}

fn redact_url_credentials(input: &str) -> String {
    let mut redacted = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(index) = rest.find("https://") {
        redacted.push_str(&rest[..index + "https://".len()]);
        let after_scheme = &rest[index + "https://".len()..];
        let authority_end = after_scheme
            .find(|ch: char| matches!(ch, '/' | ' ' | '\n' | '\r' | '\t' | '\''))
            .unwrap_or(after_scheme.len());
        let authority = &after_scheme[..authority_end];

        if let Some(at_index) = authority.rfind('@') {
            redacted.push_str("***@");
            redacted.push_str(&authority[at_index + 1..]);
        } else {
            redacted.push_str(authority);
        }

        rest = &after_scheme[authority_end..];
    }

    redacted.push_str(rest);
    redacted
}

#[cfg(test)]
mod tests {
    use super::{
        git_url_without_credentials, normalize_bitbucket_https_url, percent_encode_url_userinfo,
        redact_url_credentials,
    };

    #[test]
    fn normalize_bitbucket_https_url_removes_userinfo() {
        assert_eq!(
            normalize_bitbucket_https_url(
                "https://user@example.com@bitbucket.org/acme/widgets.git"
            ),
            "https://bitbucket.org/acme/widgets.git"
        );
    }

    #[test]
    fn percent_encode_url_userinfo_escapes_auth_delimiters() {
        assert_eq!(
            percent_encode_url_userinfo("lane@example.com:abc/123"),
            "lane%40example.com%3Aabc%2F123"
        );
    }

    #[test]
    fn redact_url_credentials_hides_userinfo_in_errors() {
        assert_eq!(
            redact_url_credentials(
                "fatal: unable to access 'https://user:secret@bitbucket.org/org/repo.git/'"
            ),
            "fatal: unable to access 'https://***@bitbucket.org/org/repo.git/'"
        );
    }

    #[test]
    fn git_url_without_credentials_strips_userinfo() {
        assert_eq!(
            git_url_without_credentials("https://user:secret@bitbucket.org/org/repo.git"),
            "https://bitbucket.org/org/repo.git"
        );
    }
}

fn read_pipe(pipe: Option<impl Read + Send + 'static>) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    })
}

pub(crate) fn terminate_child(pid: u32) {
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .output();
}

pub(crate) fn ensure_session_active(
    state: &ReviewSessionStore,
    session_id: &str,
) -> Result<(), String> {
    let cancelled = state
        .cancelled
        .lock()
        .map_err(|_| "Could not lock review session store.".to_string())?
        .contains(session_id);
    if cancelled {
        Err("Review session was cancelled.".into())
    } else {
        Ok(())
    }
}
