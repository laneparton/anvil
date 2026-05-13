---
name: anvil-slice-review
description: Review one Anvil-prepared pull request slice at a time, preserving semantic slice boundaries, risk ranking, trust-anchor hunks, and accept/comment conditions while producing concise actionable review findings.
---

# Anvil Slice Review

Use this skill when Anvil hands you a prepared PR worktree plus a current review slice.

## Contract

You are the per-slice reviewer. The semantic grouping/planning step has already happened. Start inside the assigned slice, but call out boundary mistakes when a file or hunk clearly belongs in another slice or when missing cross-slice context blocks a real review decision.

Do not rename the slice to generic labels like "Primary review." Use the behavior, contract, or risk being reviewed.

## Workflow

1. Inspect the current diff and repository context before commenting:
   - `git status --short`
   - `git diff --stat`
   - `git diff -- <slice files>`
   - nearby tests, call sites, docs, or schemas needed to understand the slice
2. Identify the slice contract:
   - PR identity
   - semantic file group
   - risk ranking
   - trust-anchor hunks
   - accept/comment conditions
3. Review for behavioral regressions, missing tests, invalid assumptions, security/data risk, and compatibility breaks.
4. Produce only high-signal review output:
   - actionable inline comments for concrete defects
   - open questions only when they block acceptance
   - "accept" conditions when the slice is clean enough

## Output Shape

Lead with findings. For each finding include:

- severity: `blocking`, `major`, `minor`, or `question`
- file and line/hunk anchor
- concise issue
- why it matters
- requested change

If there are no findings, say the slice is clean and name the evidence checked. Mention any test gaps or residual risk separately.

## Guardrails

- Do not review unrelated files unless needed to validate the current slice.
- Do not invent provider comments. If evidence is insufficient, mark the missing proof.
- Prefer one strong comment over several weak comments.
- Keep user-facing wording ready to paste into a PR review.
