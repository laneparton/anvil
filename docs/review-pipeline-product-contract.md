# Review Pipeline Product Contract

The product starts before the UI.

```text
PR diff -> review plan -> focused UI
```

The UI should not invent structure. It should render the structure produced by the pipeline.

The pipeline should be agentic first. Rules are guardrails for parsing, anchoring, and validation.

## Input

- PR metadata
- file list
- diff hunks
- changed symbols
- tests touched
- generated-file signals
- dependency changes

## Pipeline

See [Agentic Review Pipeline](./agentic-review-pipeline.md) for the build shape.

### 1. Classify

Label files and hunks.

- runtime
- public API
- adapter/integration
- persistence
- security boundary
- tests
- generated
- mechanical
- dependency

### 2. Slice

Group hunks by review intent, not by folder.

Good slices are small enough to review in one pass and large enough to preserve context.

### 3. Rank

Order slices by review risk.

Top signals:

- new trust boundary
- changed public contract
- async lifecycle
- persistence/migration
- auth/permission behavior
- test oracle changed with implementation

### 4. Hide

Hide files only when the pipeline can explain why.

Examples:

- generated docs from unchanged generator
- lockfile from one dependency bump
- mechanical call-site rename
- release metadata

### 5. Comment

Inline comments are sparse.

They should point at code that may need reviewer action, not explain every change.

## Output

The pipeline emits one review plan.

```json
{
  "pr": {},
  "slices": [],
  "hiddenGroups": [],
  "inlineComments": [],
  "rewritePlan": null
}
```

## UI Rules

- show code first
- use slices as navigation
- keep comments inline
- show hidden groups collapsed
- avoid summary blocks by default
- let reviewers fall back to the raw file list

## Product Bet

The valuable thing is not a smarter diff viewer.

The valuable thing is a compiler that turns a messy PR into a reviewable plan.
