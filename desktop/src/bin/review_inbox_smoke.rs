use std::env;

fn main() {
    let mut filter = "allOpen".to_string();
    let mut provider = None;
    let mut limit = 20usize;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--filter" => {
                filter = args
                    .next()
                    .unwrap_or_else(|| fail("--filter requires a value"));
            }
            "--provider" => {
                provider = Some(
                    args.next()
                        .unwrap_or_else(|| fail("--provider requires a value")),
                );
            }
            "--limit" => {
                let value = args
                    .next()
                    .unwrap_or_else(|| fail("--limit requires a value"));
                limit = value
                    .parse::<usize>()
                    .unwrap_or_else(|_| fail("--limit must be a positive integer"));
            }
            "--help" | "-h" => {
                print_help();
                return;
            }
            other => fail(&format!("Unknown argument `{other}`")),
        }
    }

    match anvil_review_lib::review_inbox_smoke_json(&filter, provider.as_deref(), limit) {
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
        "review_inbox_smoke [--filter allOpen|needsReview|createdByMe|assignedToMe] [--provider github|bitbucket] [--limit N]"
    );
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}
