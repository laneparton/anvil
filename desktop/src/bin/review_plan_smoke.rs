use std::env;

fn main() {
    let mut source = "github".to_string();
    let mut repo = None;
    let mut pull_request = None;
    let mut expected_head_sha = None;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--source" => {
                source = args
                    .next()
                    .unwrap_or_else(|| fail("--source requires a value"));
            }
            "--repo" => {
                repo = Some(
                    args.next()
                        .unwrap_or_else(|| fail("--repo requires a value")),
                );
            }
            "--pull-request" | "--pr" => {
                pull_request = Some(
                    args.next()
                        .unwrap_or_else(|| fail("--pull-request requires a value")),
                );
            }
            "--expected-head-sha" => {
                expected_head_sha = Some(
                    args.next()
                        .unwrap_or_else(|| fail("--expected-head-sha requires a value")),
                );
            }
            "--help" | "-h" => {
                print_help();
                return;
            }
            other => fail(&format!("Unknown argument `{other}`")),
        }
    }

    let repo = repo.unwrap_or_else(|| fail("--repo is required"));
    let pull_request = pull_request.unwrap_or_else(|| fail("--pull-request is required"));

    match anvil_review_lib::review_plan_smoke_json(
        &source,
        &repo,
        &pull_request,
        expected_head_sha.as_deref(),
    ) {
        Ok(value) => println!(
            "{}",
            serde_json::to_string_pretty(&value)
                .unwrap_or_else(|error| fail(&format!("Failed to encode JSON: {error}")))
        ),
        Err(error) => fail(&error),
    }
}

fn print_help() {
    println!(
        "review_plan_smoke --source github|bitbucket --repo owner/name --pull-request N [--expected-head-sha SHA]"
    );
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}
