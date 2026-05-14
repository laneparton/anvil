use std::process::Command;

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_provider_pull_request_url(&url)?;
    open_in_system_browser(url)
}

fn validate_provider_pull_request_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    let rest = trimmed.strip_prefix("https://").ok_or_else(|| {
        "Only https GitHub and Bitbucket pull request URLs can be opened.".to_string()
    })?;
    let (host, path) = rest
        .split_once('/')
        .ok_or_else(|| "Provider URL must include a pull request path.".to_string())?;
    let host = host
        .strip_prefix("www.")
        .unwrap_or(host)
        .to_ascii_lowercase();
    let path = match (path.find('?'), path.find('#')) {
        (Some(query), Some(fragment)) => &path[..query.min(fragment)],
        (Some(query), None) => &path[..query],
        (None, Some(fragment)) => &path[..fragment],
        (None, None) => path,
    };
    let path_parts = path.split('/').collect::<Vec<_>>();

    let valid = if host == "github.com" {
        path_parts.len() >= 4
            && !path_parts[0].is_empty()
            && !path_parts[1].is_empty()
            && path_parts[2] == "pull"
            && is_pr_number(path_parts[3])
    } else if host == "bitbucket.org" {
        path_parts.len() >= 4
            && !path_parts[0].is_empty()
            && !path_parts[1].is_empty()
            && path_parts[2] == "pull-requests"
            && is_pr_number(path_parts[3])
    } else {
        false
    };

    if valid {
        Ok(trimmed)
    } else {
        Err("Only GitHub and Bitbucket pull request URLs can be opened.".to_string())
    }
}

fn is_pr_number(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn open_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open provider URL: {error}"))
}

#[cfg(test)]
mod tests {
    use super::validate_provider_pull_request_url;

    #[test]
    fn validates_supported_provider_pull_request_urls() {
        assert_eq!(
            validate_provider_pull_request_url("https://github.com/owner/repo/pull/42"),
            Ok("https://github.com/owner/repo/pull/42")
        );
        assert_eq!(
            validate_provider_pull_request_url(
                "https://bitbucket.org/workspace/repo/pull-requests/45"
            ),
            Ok("https://bitbucket.org/workspace/repo/pull-requests/45")
        );
    }

    #[test]
    fn rejects_non_provider_or_non_https_urls() {
        assert!(
            validate_provider_pull_request_url("http://github.com/owner/repo/pull/42").is_err()
        );
        assert!(
            validate_provider_pull_request_url("https://example.com/owner/repo/pull/42").is_err()
        );
        assert!(
            validate_provider_pull_request_url("https://github.com/owner/repo/issues/42").is_err()
        );
        assert!(validate_provider_pull_request_url(
            "https://bitbucket.org/workspace/repo/src/main"
        )
        .is_err());
    }
}
