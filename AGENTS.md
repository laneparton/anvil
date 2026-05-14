# Repository Guidelines

## Project Structure & Module Organization

Anvil is a Tauri desktop app with a React frontend and Rust runtime.

- `ui/`: React app, components, styling, review workspace, settings, and API bindings.
- `desktop/src/runtime/`: Rust runtime for SCM lookup, git checkout/diff parsing, app-server orchestration, sessions, and review submission.
- `desktop/src/bin/`: smoke-test binaries for inbox and review-plan flows.
- `e2e/tests/`: Playwright browser-mode tests.
- `evals/review-plans/`: deterministic review-plan fixtures and scorer tests.
- `docs/`: current architecture, product contract, eval, and brand notes.
- `skills/`: agent-facing review skill material.

Build output and local runtime artifacts such as `dist/`, `desktop/target/`, `.tauri-smoke/`, and `test-results/` are ignored.

## Build, Test, and Development Commands

- `npm install`: install frontend and tooling dependencies.
- `npm run dev`: start the Tauri desktop app.
- `npm run dev:frontend`: start Vite only for frontend debugging.
- `npm run build`: run TypeScript checking and build the Vite app.
- `cargo test --manifest-path desktop/Cargo.toml`: run Rust unit tests.
- `npm run test:evals`: run review-plan scorer tests with Vitest.
- `npm run e2e:browser`: run browser-mode Playwright tests.
- `npm run smoke:tauri`: launch the native Tauri smoke check.

## Coding Style & Naming Conventions

Use TypeScript for UI code and Rust for runtime code. Keep React components in PascalCase, hooks/helpers in camelCase, and Rust modules/functions in snake_case. Prefer existing local patterns over new abstractions. Keep comments short and only where they clarify non-obvious behavior. Use ASCII text unless a file already requires otherwise.

## Testing Guidelines

Add focused tests for behavior changes. Use Vitest for deterministic scorer logic, Playwright for UI flows, and Rust unit tests for runtime parsing/process behavior. Name browser specs by feature, for example `e2e/tests/review-inbox.spec.ts`. Before publishing runtime or UI changes, run `npm run build`, `cargo test --manifest-path desktop/Cargo.toml`, and the relevant e2e or eval command.

## Commit & Pull Request Guidelines

Use Conventional Commits: `type(scope): summary`. Keep summaries imperative and specific. Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, and `ci`. Examples: `fix(ui): preserve manual PR target` or `feat(runtime): stream review preparation events`. Pull requests should include a clear summary, validation commands run, screenshots for visible UI changes, and any setup implications for GitHub, Bitbucket, or Codex app-server.

## Security & Configuration Tips

Do not commit tokens or local paths. Store `GH_TOKEN`, `GITHUB_TOKEN`, `BITBUCKET_API_TOKEN`, `BITBUCKET_ACCESS_TOKEN`, and `BITBUCKET_APP_PASSWORD` outside app settings. Keep `.env*` files local.
