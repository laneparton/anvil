# Agentic Review Pipeline

This should work like T3 Code: local app, local provider runtime, streamed agent work.

No hosted inference requirement.

## Shape

```text
SCM adapter
  -> local git worktree
  -> context pack
  -> planner agent
  -> focused reviewer agents
  -> reducer agent
  -> review-plan.json
  -> PR-like UI
```

The pipeline does not try to perfectly classify files with rules.

It asks agents to do review prep, then forces their output into a small contract.

## SCM Boundary

Do not couple the product to GitHub.

Adapters only resolve refs:

- GitHub PR: `repo + pr -> repoUrl + baseRef + headRef`
- Bitbucket Cloud PR: REST metadata -> `repoUrl + baseRef + headRef`
- Local branch: current repo -> `baseRef + headRef`

After that, the pipeline uses local git:

```text
git fetch base/head
git checkout head
git merge-base base head
git diff base...head
```

The review pipeline should never depend on `gh pr diff`.

## Local Runtime

Run inside the Tauri desktop runtime. There is no Node server or Node review pipeline in the product path.

Tauri owns:

- SCM metadata lookup
- local git checkout/fetch/diff
- diff parsing
- review session lifecycle
- cancellation and timeouts
- event streaming to the UI
- review-plan artifact writing

Installed agent providers stay behind a local adapter:

- Codex CLI / app-server
- Claude Code
- later: OpenCode, Cursor agent, others

Provider differences stay behind one adapter:

```ts
type AgentProvider = {
  startSession(input: AgentInput): Promise<AgentSession>;
  send(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  stop(sessionId: string): Promise<void>;
};
```

The product owns orchestration. The provider owns inference.

## Settings Opportunities

These are useful product settings, but not required for the current build:

- Preferred terminal app for agent handoff, for example Terminal, iTerm, or another launcher.
- Preferred handoff agent, for example Codex or Claude.
- Optional default prompt template for "Open with Codex/Claude" sessions.

macOS does not expose a reliable universal default terminal, so this should be explicit app configuration rather than guessed from the environment.

## Agents

### 1. Planner

Reads the whole PR context.

Outputs proposed slices:

- short title label
- concise decision question
- why this belongs together
- files/hunks needed
- risk level
- review order
- what can be hidden

### 2. Slice Reviewers

One focused agent per slice.

Each reviewer gets:

- slice files
- relevant hunks
- nearby source context
- tests touching the slice
- planner rationale

Each reviewer returns only:

- inline comments
- blocking questions
- confidence
- files that should move slices
- files that can be hidden

### 3. Reducer

Merges the agents into one review plan.

Responsibilities:

- dedupe comments
- reject vague comments
- rank slices
- keep hidden-file decisions conservative
- emit final JSON

### 4. UI Compiler

Turns `review-plan.json` into the PR-like interface.

No new thinking here. Render the plan.

## Review Plan Contract

```json
{
  "pr": {},
  "slices": [
    {
      "id": "security-renderer",
      "title": "Security boundary + renderer",
      "risk": "high",
      "files": [],
      "hunks": [],
      "inlineComments": []
    }
  ],
  "hiddenGroups": [],
  "fallbackFileList": [],
  "agentRuns": []
}
```

## Guardrails

Rules are allowed as rails, not as the product.

Use deterministic checks for:

- generated-file detection
- lockfile detection
- diff parsing
- schema validation
- comment anchoring
- stale-line repair

Do not use rules as the primary slicer.

## Current Build

The current build prepares reviews directly in Rust/Tauri:

```text
npm run tauri:dev
```

Select a GitHub or Bitbucket PR in the app. Tauri fetches refs into `/tmp/review-plan/<repo>-pr-<id>`, parses `git diff base...head`, emits review events, and writes artifacts under `/tmp/anvil-review`.

The old Node pipeline was removed from the runtime path. If we bring back provider-based planner/reviewer/reducer work, it should be orchestrated from Rust and surfaced through the same Tauri session events.

Output:

```text
/tmp/anvil-review/<repo>-pr-<id>.review-plan.ui.json
```

## Success Test

A reviewer should be able to say:

```text
I know where to start, what code matters, and what I can ignore for now.
```

without reading a generated essay.
