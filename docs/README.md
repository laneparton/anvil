# Anvil Docs

This folder keeps durable project docs only. Prototype snapshots, exploratory notes, and one-off research dumps are intentionally excluded from the public tree.

## Current Docs

- [Agentic Review Pipeline](./agentic-review-pipeline.md): runtime architecture and review-prep flow.
- [Review Pipeline Product Contract](./review-pipeline-product-contract.md): review-plan input/output contract.
- [Review Pipeline Eval Suite](./review-pipeline-evals.md): fixture-based quality checks for generated plans.
- [Anvil Brand Direction](./anvil-brand-direction.md): product and UI direction.

## Runtime Notes

Anvil is a local desktop app. Tauri owns source-control lookup, local checkout, diff parsing, review session lifecycle, cancellation, and artifact writing. Model work runs through local agent runtimes, currently Codex app-server for progressive review preparation.

Generated review artifacts are written outside the repo under `/tmp/anvil-review`.
