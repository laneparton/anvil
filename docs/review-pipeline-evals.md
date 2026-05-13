# Review Pipeline Eval Suite

The review pipeline eval suite grades `review-plan.json` quality, not the UI. It is intentionally fixture-first: fast candidate grading proves the scoring contract before replay mode regenerates a review plan from a pinned PR.

## Runner

The suite keeps deterministic scorer tests in Vitest.

```sh
npm run test:evals
```

The old Evalite wrapper was removed from the public tree to keep dependency audit noise out of the default install. The scorer contract remains in `evals/review-plans/scorers.ts`.

## Dataset

Cases live under `evals/review-plans/`.

- `manifest.json` lists case ids, pinned PR identity, golden specs, and default fixtures.
- `golden/assistant-ui-4025.json` defines expectations, not exact output JSON.
- `fixtures/*.review-plan.json` contains weak and minimal-good candidate plans.
- `reports/` is ignored for generated reports unless a report is intentionally checked in.

The first golden case is `assistant-ui/assistant-ui#4025`, pinned to head commit `fa412a6d75fac49acbb74f42497ef8d8adb72f7f`. It must not drift with the live PR branch.

## What It Measures

The deterministic scorer checks:

- identity: repo, PR number, title, URL, base/head refs, pinned SHA, file count, additions, deletions
- coverage: all 61 changed files accounted for exactly once
- semantic slicing: required review areas are present and separated
- slice size: no giant primary review slice
- risk ranking: auth/resource/public API files outrank docs/examples/lockfile support material
- actionability: important slices include accept and comment conditions
- evidence quality: concrete file/hunk anchors, not generic "parsed the diff" evidence
- approval safety: no approve/no-comments recommendation unless auth/storage/lifecycle/proof risks are named
- inline comment anchoring: file, hunk, line, and body are present

The LLM judge contract is represented as a second Evalite scorer. By default it uses an offline proxy derived from deterministic evidence, so fixture mode is cheap and reproducible. To plug in a provider-backed judge later, write strict judge JSON to a file and set `REVIEW_PLAN_EVAL_JUDGE_JSON`.

## Golden Case

`assistant-ui#4025` covers a new `@assistant-ui/react-mcp` package for user-managed MCP servers.

Required review areas:

- MCP auth/OAuth state, PKCE, DCR, callback id routing, token persistence, and refresh
- server lifecycle and transport cleanup
- manager/store persistence and custom server records
- Tap/resource/modelContext integration and public API surface
- primitives and render-function list behavior
- example/docs/package/lockfile support material

Known bad patterns:

- one giant `New package` or `UI behavior` slice
- treating docs/examples/lockfile as equal to auth/resource code
- generic evidence like "parsed the diff"
- approval suggestion without concrete OAuth/storage/lifecycle proof
- no mention of token storage or OAuth callback risks

Existing PR review comments are intentionally excluded from this v1 oracle. They can become a later finding-recall benchmark, but this first case comes from the PR body, changed files, and our risk rubric.

## Replay Mode

Replay mode should come later. It should fetch the pinned PR commit, run the local review pipeline, produce a fresh `review-plan.json`, and grade that artifact through the same scorer contract.
