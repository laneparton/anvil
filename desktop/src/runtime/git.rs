use super::{
    process::{git_url_without_credentials, run_command_status, run_command_timeout},
    types::{GitCheckout, PrMetadata, GIT_COMMAND_TIMEOUT},
    util::path_str,
};
use std::{fs, path::Path, time::Duration};

pub(crate) fn prepare_git_checkout(
    metadata: &PrMetadata,
    worktree: &Path,
    pull_request: &str,
) -> Result<GitCheckout, String> {
    ensure_repo(&metadata.base_repo_url, worktree)?;

    let base_ref = format!("refs/remotes/review/base-{pull_request}");
    let head_ref = format!("refs/remotes/review/head-{pull_request}");
    if metadata.base_repo_url == metadata.head_repo_url {
        git_status(
            worktree,
            &[
                "fetch",
                "--no-tags",
                &metadata.base_repo_url,
                &format!("{}:{base_ref}", metadata.base_ref),
                &format!("{}:{head_ref}", metadata.head_ref),
            ],
            GIT_COMMAND_TIMEOUT,
        )?;
    } else {
        git_status(
            worktree,
            &[
                "fetch",
                "--no-tags",
                &metadata.base_repo_url,
                &format!("{}:{base_ref}", metadata.base_ref),
            ],
            GIT_COMMAND_TIMEOUT,
        )?;
        git_status(
            worktree,
            &[
                "fetch",
                "--no-tags",
                &metadata.head_repo_url,
                &format!("{}:{head_ref}", metadata.head_ref),
            ],
            GIT_COMMAND_TIMEOUT,
        )?;
    }

    git_status(
        worktree,
        &["checkout", "--detach", &head_ref],
        GIT_COMMAND_TIMEOUT,
    )?;
    let base_sha = git_stdout(
        worktree,
        &["merge-base", "HEAD", &base_ref],
        GIT_COMMAND_TIMEOUT,
    )?;
    let head_sha = git_stdout(worktree, &["rev-parse", "HEAD"], GIT_COMMAND_TIMEOUT)?;

    Ok(GitCheckout {
        path: worktree.to_path_buf(),
        base_sha: base_sha.trim().to_string(),
        head_sha: head_sha.trim().to_string(),
    })
}

fn ensure_repo(repo_url: &str, worktree: &Path) -> Result<(), String> {
    let origin_url = git_url_without_credentials(repo_url);
    if worktree.join(".git").exists() {
        git_status(
            worktree,
            &["remote", "set-url", "origin", &origin_url],
            GIT_COMMAND_TIMEOUT,
        )?;
        return Ok(());
    }

    let parent = worktree
        .parent()
        .ok_or_else(|| format!("Could not resolve parent for {}", worktree.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    run_command_status(
        "git",
        &["clone", "--no-checkout", repo_url, path_str(worktree)?],
        None,
        GIT_COMMAND_TIMEOUT,
    )?;
    git_status(
        worktree,
        &["remote", "set-url", "origin", &origin_url],
        GIT_COMMAND_TIMEOUT,
    )
}

fn git_status(worktree: &Path, args: &[&str], timeout: Duration) -> Result<(), String> {
    let mut git_args = vec!["-C", path_str(worktree)?];
    git_args.extend_from_slice(args);
    run_command_status("git", &git_args, None, timeout)
}

pub(crate) fn git_stdout(
    worktree: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut git_args = vec!["-C", path_str(worktree)?];
    git_args.extend_from_slice(args);
    let output = run_command_timeout("git", &git_args, None, timeout)?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
