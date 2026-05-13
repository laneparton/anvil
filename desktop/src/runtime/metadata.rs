use super::{
    process::{
        bitbucket_api, bitbucket_clone_url, exec_json_timeout, github_api, with_bitbucket_git_auth,
    },
    types::{PrMetadata, API_COMMAND_TIMEOUT},
    util::parse_bitbucket_repo,
};
use serde_json::Value;

pub(crate) fn github_pr_metadata(repo: &str, pull_request: &str) -> Result<PrMetadata, String> {
    let output = exec_json_timeout(
        "gh",
        &[
            "pr",
            "view",
            pull_request,
            "--repo",
            repo,
            "--json",
            "number,title,url,baseRefName,headRefName,changedFiles,additions,deletions",
        ],
        None,
        API_COMMAND_TIMEOUT,
    )
    .or_else(|_| github_api(&format!("/repos/{repo}/pulls/{pull_request}")))?;

    let number = output
        .get("number")
        .and_then(Value::as_u64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| pull_request.to_string());
    let title = output
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled PR")
        .to_string();
    let url = output
        .get("url")
        .and_then(Value::as_str)
        .or_else(|| output.get("html_url").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let base_ref = output
        .get("baseRefName")
        .and_then(Value::as_str)
        .or_else(|| {
            output
                .get("base")
                .and_then(|base| base.get("ref"))
                .and_then(Value::as_str)
        })
        .unwrap_or("main")
        .to_string();
    let head_ref = output
        .get("headRefName")
        .and_then(Value::as_str)
        .or_else(|| {
            output
                .get("head")
                .and_then(|head| head.get("ref"))
                .and_then(Value::as_str)
        })
        .unwrap_or("HEAD")
        .to_string();

    Ok(PrMetadata {
        repo: repo.to_string(),
        number,
        title,
        url,
        changed_files: output
            .get("changedFiles")
            .and_then(Value::as_u64)
            .or_else(|| output.get("changed_files").and_then(Value::as_u64))
            .unwrap_or(0),
        additions: output.get("additions").and_then(Value::as_u64).unwrap_or(0),
        deletions: output.get("deletions").and_then(Value::as_u64).unwrap_or(0),
        base_ref,
        head_ref,
        base_repo_url: format!("https://github.com/{repo}.git"),
        head_repo_url: format!("https://github.com/{repo}.git"),
    })
}

pub(crate) fn bitbucket_pr_metadata(repo: &str, pull_request: &str) -> Result<PrMetadata, String> {
    let (workspace, repo_slug) = parse_bitbucket_repo(repo)?;
    let pr = bitbucket_api(&format!(
        "/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request}"
    ))?;
    let destination_repo = pr
        .get("destination")
        .and_then(|source| source.get("repository"))
        .and_then(|repository| repository.get("full_name"))
        .and_then(Value::as_str)
        .unwrap_or(repo);
    let source_repo = pr
        .get("source")
        .and_then(|source| source.get("repository"))
        .and_then(|repository| repository.get("full_name"))
        .and_then(Value::as_str)
        .unwrap_or(destination_repo);
    let destination_repo_data = bitbucket_api(&format!("/repositories/{destination_repo}"))?;
    let source_repo_data = if source_repo == destination_repo {
        destination_repo_data.clone()
    } else {
        bitbucket_api(&format!("/repositories/{source_repo}"))?
    };

    Ok(PrMetadata {
        repo: repo.to_string(),
        number: pr
            .get("id")
            .and_then(Value::as_u64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| pull_request.to_string()),
        title: pr
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled PR")
            .to_string(),
        url: pr
            .get("links")
            .and_then(|links| links.get("html"))
            .and_then(|html| html.get("href"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        changed_files: 0,
        additions: 0,
        deletions: 0,
        base_ref: pr
            .get("destination")
            .and_then(|destination| destination.get("branch"))
            .and_then(|branch| branch.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("main")
            .to_string(),
        head_ref: pr
            .get("source")
            .and_then(|source| source.get("branch"))
            .and_then(|branch| branch.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("HEAD")
            .to_string(),
        base_repo_url: bitbucket_clone_url(&destination_repo_data).unwrap_or_else(|| {
            with_bitbucket_git_auth(&format!("https://bitbucket.org/{destination_repo}.git"))
        }),
        head_repo_url: bitbucket_clone_url(&source_repo_data).unwrap_or_else(|| {
            with_bitbucket_git_auth(&format!("https://bitbucket.org/{source_repo}.git"))
        }),
    })
}
