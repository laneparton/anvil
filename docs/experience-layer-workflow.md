# Experience Layer Workflow

This is a working map of the Anvil user experience. It describes what a reviewer can do today and gives us a shared baseline for evaluating the app.

Anvil's core flow is:

```text
Find a PR -> prepare a review plan -> review focused slices -> submit or approve
```

The UI should make that path feel direct. The reviewer should always know what PR they are reviewing, what work remains, which comments will be posted, and where to fall back when automation is incomplete.

## Workflow

### 1. Set Up the Workbench

Settings cover the pieces a reviewer should not have to rethink during a review:

- GitHub and Bitbucket source availability.
- Bitbucket pinned repos.
- Terminal and preferred agent CLI for handoff.
- Default comment tone.
- Bundled or custom review skill.
- Prompt and environment overrides.

Secrets are not stored in app settings. Token fields point the user back to external environment configuration.

### 2. Choose the Next PR

The review inbox is the starting point. It gives the reviewer one queue across GitHub and Bitbucket instead of forcing a Source -> Repo -> PR path.

The inbox supports:

- Filters for `Needs review`, `Created by me`, `Assigned to me`, and `All open`.
- Source filters for all sources, GitHub, or Bitbucket.
- Search by title, repo, author, provider, or PR number.
- Manual PR entry from a GitHub or Bitbucket URL.
- Refresh and provider error display.
- A selected row that becomes the target for `Prepare review`.

The current inbox screenshot shows the intended shape: a simple queue, clear source labels, visible counts, and a highlighted PR ready to prepare.

### 3. Prepare the Review

After `Prepare review`, Anvil moves into a preparation screen while the Tauri runtime fetches refs, builds context, plans slices, reviews them, and finalizes artifacts.

The screen shows:

- The PR identity in the header.
- A single `Cancel` action.
- Current runtime status, such as fetching refs into the local worktree.
- Session id and overall phase progress.
- Four phases: Setup, Planning, Slice Reviews, Finalize.
- Collapsed raw runtime events for debugging.
- Artifact paths when available.

The important experience job here is trust. The user should be able to tell whether Anvil is making progress, waiting, or failing.

### 4. Review Focused Slices

When preparation finishes, the workspace opens into a two-column review surface:

- Main column: active slice, reviewer brief, evidence hunks, inline findings, and agent handoff.
- Right rail: decision ledger, pending slices, staged comments, and the final review packet.

The decision ledger is the user's map. It shows slice order, active slice, risk, pending/deferred/reviewed states, blocker counts, and open questions. The reviewer can jump between slices at any time.

The main panel is code-first. It shows the active slice title, reviewer brief, verification checklist, grouped hunks, line numbers, syntax highlighting, and inline findings anchored to diff lines.

### 5. Decide What to Do

The right rail turns plan output into human decisions.

For an inline finding, the reviewer can:

- Edit the draft PR comment.
- `Comment on PR`.
- Mark it `Looks safe`.
- `Defer` it for local follow-up.

For a slice without an active finding, the reviewer can mark it `Looks safe`, `Defer` it, acknowledge a deferred slice, or resolve an open question before moving on.

Queued comments are staged before provider submission. The review packet shows file, line, severity, and draft preview, and lets the reviewer reopen a staged comment to edit, restore, or keep it local.

### 6. Escalate to an Agent

The `Open with` panel can launch Codex or Claude in the configured terminal, using the review worktree and current slice context.

This is the escape hatch for deeper investigation. It should feel connected to the review currently on screen, not like starting a separate task from scratch.

### 7. Submit or Approve

When all slices are handled and no open findings remain, Anvil shows a completion state.

It summarizes:

- Comments ready to post.
- Findings marked fixed.
- Findings dismissed.
- Remaining questions.
- Deferred slices acknowledged.

The final action becomes either `Submit N comments` or `Approve PR`. Submission is blocked while high-risk pending work remains. Errors and receipts are shown in the same completion area.

## What to Evaluate

Use this workflow to review the experience layer as a whole:

- Can a reviewer quickly choose the next useful PR?
- Does preparation feel trustworthy while work is happening?
- Does the slice queue make the remaining work obvious?
- Does the reviewer brief help, or does it add noise?
- Are `Queue PR comment`, `Dismiss`, and `Fixed` clear enough?
- Does comment staging match how reviewers expect to batch feedback?
- Does agent handoff feel like part of the review flow?
- Is the final provider impact clear before submission?

## Current Boundaries

- The UI depends on review-plan quality. Weak slices or weak findings will still feel weak in the experience.
- The workspace is designed for desktop-width review with three persistent columns.
- Provider discovery and submission are integrated, but auth, rate limits, and slow provider APIs still need clear fallback paths.
- Current captured screenshots cover inbox, preparation, and active review. Settings, non-empty queued comments, and completion still need captured examples.
