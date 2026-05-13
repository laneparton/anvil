# Anvil

Anvil is a local-first desktop workbench for AI-assisted pull request review.

It prepares a pull request into reviewable slices, streams progress while agent work is running, opens the review workspace as soon as the plan is ready, and lets the human finish the review from a PR-like interface.

## Status

Early desktop app. The current runtime supports GitHub and Bitbucket Cloud pull requests through local credentials and the Codex app-server path for review preparation.

## Requirements

- Node.js and npm
- Rust toolchain
- Tauri prerequisites for your platform
- Codex CLI available on `PATH` with `codex app-server`
- `gh` CLI for GitHub repository discovery, or Bitbucket environment variables for Bitbucket Cloud

## Development

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run build
cargo test --manifest-path desktop/Cargo.toml
npm run e2e:browser
```

## Provider Setup

GitHub uses `gh` where possible and can also use `GH_TOKEN` or `GITHUB_TOKEN`.

Bitbucket Cloud uses environment variables:

- `BITBUCKET_ACCESS_TOKEN` plus `BITBUCKET_EMAIL` or `BITBUCKET_USERNAME`
- `BITBUCKET_API_TOKEN` plus `BITBUCKET_EMAIL` or `BITBUCKET_USERNAME`
- `BITBUCKET_WORKSPACE` or `BITBUCKET_WORKSPACES` for workspace discovery
- `BITBUCKET_PINNED_REPOS` for an explicit comma-separated repo list

Secret values are not saved in app settings. Set them in your shell, launch environment, or OS credential workflow.

## Architecture

The product path is Rust/Tauri-first:

```text
SCM metadata -> local git checkout -> diff context -> planner -> critic/repair -> slice reviewers -> reducer -> review workspace
```

See [docs/](./docs/README.md) for the pipeline contract and eval notes.

## License

MIT
