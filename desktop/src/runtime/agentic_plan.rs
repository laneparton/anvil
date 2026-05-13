use super::{
    app_server::{CodexAppServerClient, StructuredAgentTurn, StructuredAgentTurnResult},
    types::{DiffFile, PrMetadata},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

const SLICE_PLAN_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schema": { "type": "string", "const": "slice-plan.v0" },
    "pr": {
      "type": "object",
      "properties": {
        "repo": { "type": "string" },
        "number": { "anyOf": [{ "type": "number" }, { "type": "string" }] },
        "title": { "type": "string" },
        "url": { "type": "string" },
        "baseRef": { "type": "string" },
        "headRef": { "type": "string" },
        "headSha": { "type": "string" },
        "changedFiles": { "type": "number" },
        "additions": { "type": "number" },
        "deletions": { "type": "number" }
      },
      "required": ["repo", "number", "title", "url", "baseRef", "headRef", "headSha", "changedFiles", "additions", "deletions"],
      "additionalProperties": false
    },
    "slices": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "risk": { "type": "string", "enum": ["high", "medium", "low"] },
          "primaryRisk": { "type": "string" },
          "decisionQuestion": { "type": "string" },
          "whyTheseFilesTogether": { "type": "string" },
          "why": { "type": "string" },
          "acceptConditions": { "type": "array", "items": { "type": "string" } },
          "commentConditions": { "type": "array", "items": { "type": "string" } },
          "files": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["id", "title", "risk", "primaryRisk", "decisionQuestion", "whyTheseFilesTogether", "why", "acceptConditions", "commentConditions", "files"],
        "additionalProperties": false
      }
    },
    "plannerNotes": { "type": "string" }
  },
  "required": ["schema", "pr", "slices", "plannerNotes"],
  "additionalProperties": false
}"#;

const MAX_PRIMARY_SLICE_FILES: usize = 18;
const PLANNER_REPAIR_ATTEMPTS: usize = 2;
const DEFAULT_SLICE_REVIEW_CONCURRENCY: usize = 2;

const SLICE_PLAN_CRITIQUE_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schema": { "type": "string", "const": "slice-plan-critique.v0" },
    "valid": { "type": "boolean" },
    "failures": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sliceId": { "type": "string" },
          "issue": { "type": "string" },
          "evidence": { "type": "string" },
          "repairHint": { "type": "string" }
        },
        "required": ["sliceId", "issue", "evidence", "repairHint"],
        "additionalProperties": false
      }
    },
    "summary": { "type": "string" }
  },
  "required": ["schema", "valid", "failures", "summary"],
  "additionalProperties": false
}"#;

const SLICE_REVIEW_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schema": { "type": "string", "const": "slice-review.v0" },
    "sliceId": { "type": "string" },
    "status": { "type": "string", "enum": ["blocked", "needs-human", "agent-reviewed"] },
    "deferred": { "type": "boolean" },
    "deferReason": { "type": "string" },
    "filesReviewed": { "type": "array", "items": { "type": "string" } },
    "hunks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "hunkId": { "type": "string" },
          "reason": { "type": "string" }
        },
        "required": ["file", "hunkId", "reason"],
        "additionalProperties": false
      }
    },
    "inlineComments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "hunkId": { "type": "string" },
          "line": { "anyOf": [{ "type": "number" }, { "type": "string" }] },
          "severity": { "type": "string", "enum": ["blocking", "nonblocking", "question"] },
          "body": { "type": "string" }
        },
        "required": ["file", "hunkId", "line", "severity", "body"],
        "additionalProperties": false
      }
    },
    "remainingQuestions": { "type": "array", "items": { "type": "string" } },
    "hiddenGroups": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "files": { "type": "array", "items": { "type": "string" } },
          "reason": { "type": "string" }
        },
        "required": ["title", "files", "reason"],
        "additionalProperties": false
      }
    },
    "evidence": { "type": "array", "items": { "type": "string" } },
    "acceptConditions": { "type": "array", "items": { "type": "string" } },
    "commentConditions": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" }
  },
  "required": ["schema", "sliceId", "status", "deferred", "deferReason", "filesReviewed", "hunks", "inlineComments", "remainingQuestions", "hiddenGroups", "evidence", "acceptConditions", "commentConditions", "notes"],
  "additionalProperties": false
}"#;

#[derive(Clone)]
struct PlanContext {
    pr: Value,
    all_files: Vec<String>,
    planner_files: Vec<Value>,
    files: Vec<DiffFile>,
    stats: Value,
}

#[derive(Clone, Debug)]
pub(crate) struct ReviewPipelineEvent {
    pub(crate) event_type: String,
    pub(crate) message: String,
    pub(crate) data: Value,
}

pub(crate) fn build_review_plan(
    metadata: &PrMetadata,
    base_sha: &str,
    head_sha: &str,
    files: &[DiffFile],
    cwd: &Path,
    progress: &mut dyn FnMut(ReviewPipelineEvent),
) -> Result<Value, String> {
    let context = build_context(metadata, base_sha, head_sha, files);
    let effort = review_reasoning_effort();
    let mut client = CodexAppServerClient::spawn()?;
    progress(ReviewPipelineEvent::raw(
        "app_server.started",
        "Codex app-server started.",
        json!({ "pid": client.child_id(), "phase": "app-server", "status": "running" }),
    ));

    progress(ReviewPipelineEvent::phase(
        "planner.started",
        "planner",
        "running",
        "Planning review slices with Codex app-server.",
        0,
        1,
        None,
        None,
    ));
    let planner_result = client.run_turn(
        &StructuredAgentTurn {
            phase: "planner".into(),
            prompt: planner_prompt(&context),
            output_schema: schema_value(SLICE_PLAN_SCHEMA)?,
            cwd: cwd.to_path_buf(),
            effort: effort.clone(),
            slice_id: None,
            slice_title: None,
        },
        |_| {},
    )?;
    let mut planner = planner_result.value.clone();
    progress(ReviewPipelineEvent::phase(
        "planner.completed",
        "planner",
        "completed",
        "Review slices planned.",
        1,
        1,
        Some(&planner_result),
        None,
    ));

    let mut failures = validate_slice_plan_contract(&planner, &context);
    if failures.is_empty() {
        failures = critique_slice_plan(&mut client, cwd, &effort, &context, &planner, progress)?;
    }

    for attempt in 0..PLANNER_REPAIR_ATTEMPTS {
        if failures.is_empty() {
            break;
        }
        progress(ReviewPipelineEvent::phase(
            "repair.started",
            "repair",
            "running",
            "Repairing the slice plan after validation.",
            attempt,
            PLANNER_REPAIR_ATTEMPTS,
            None,
            None,
        ));
        let repair_result = client.run_turn(
            &StructuredAgentTurn {
                phase: "repair".into(),
                prompt: planner_repair_prompt(&context, &planner, &failures),
                output_schema: schema_value(SLICE_PLAN_SCHEMA)?,
                cwd: cwd.to_path_buf(),
                effort: effort.clone(),
                slice_id: None,
                slice_title: None,
            },
            |_| {},
        )?;
        planner = repair_result.value.clone();
        progress(ReviewPipelineEvent::phase(
            "repair.completed",
            "repair",
            "completed",
            "Slice plan repair completed.",
            attempt + 1,
            PLANNER_REPAIR_ATTEMPTS,
            Some(&repair_result),
            None,
        ));
        failures = validate_slice_plan_contract(&planner, &context);
        if failures.is_empty() {
            failures = critique_slice_plan(&mut client, cwd, &effort, &context, &planner, progress)?;
        }
    }

    if !failures.is_empty() {
        return Err(format!(
            "planner failed generic slice-quality validation after repair: {}",
            failures.join("; ")
        ));
    }

    let slices = planner
        .get("slices")
        .and_then(Value::as_array)
        .ok_or_else(|| "planner returned no slices".to_string())?
        .clone();
    let mut reviews = Vec::new();

    progress(ReviewPipelineEvent::raw(
        "planner.ready",
        "Review slices planned by Codex app-server.",
        json!({
            "phase": "planner",
            "status": "completed",
            "current": slices.len(),
            "total": slices.len(),
            "plannedSlices": planned_slice_payloads(&slices)
        }),
    ));

    let review_turns = slices
        .iter()
        .map(|slice| {
            let slice_id = slice.get("id").and_then(Value::as_str).map(str::to_string);
            let slice_title = slice
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string);
            Ok(StructuredAgentTurn {
                phase: "slice-review".into(),
                prompt: slice_review_prompt(&context, slice),
                output_schema: schema_value(SLICE_REVIEW_SCHEMA)?,
                cwd: cwd.to_path_buf(),
                effort: effort.clone(),
                slice_id,
                slice_title,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let slices_by_id = slices
        .iter()
        .filter_map(|slice| Some((slice.get("id")?.as_str()?.to_string(), slice.clone())))
        .collect::<HashMap<_, _>>();
    let mut pending_reviews = Vec::new();
    {
        let progress_cell = std::cell::RefCell::new(&mut *progress);
        client.run_turns_bounded(
            &review_turns,
            slice_review_concurrency(),
            |turn, thread_id, turn_id, current, total| {
                (progress_cell.borrow_mut())(ReviewPipelineEvent::phase(
                    "slice.review.started",
                    "slice-review",
                    "running",
                    "Reviewing planned slice.",
                    current.saturating_sub(1),
                    total,
                    None,
                    Some((turn, thread_id, turn_id)),
                ));
            },
            |turn, result, current, total| {
                let slice_id = result
                    .value
                    .get("sliceId")
                    .and_then(Value::as_str)
                    .or(turn.slice_id.as_deref())
                    .ok_or_else(|| "slice reviewer returned no sliceId".to_string())?
                    .to_string();
                let slice = slices_by_id
                    .get(&slice_id)
                    .ok_or_else(|| format!("slice reviewer returned unknown sliceId `{slice_id}`"))?;
                validate_slice_review(&result.value, slice, &context)?;
                let plan_slice = build_plan_slice(&context, slice, Some(&result.value));
                pending_reviews.push(result.value.clone());
                (progress_cell.borrow_mut())(ReviewPipelineEvent::raw(
                    "slice.ready",
                    "Slice is ready to review.",
                    json!({
                        "phase": "slice-review",
                        "status": "completed",
                        "current": current,
                        "total": total,
                        "elapsedMs": result.elapsed_ms,
                        "sliceId": slice_id,
                        "sliceTitle": turn.slice_title,
                        "threadId": result.thread_id,
                        "turnId": result.turn_id,
                        "slice": plan_slice,
                        "reviewedSlices": current,
                        "totalSlices": total
                    }),
                ));
                Ok(())
            },
            |_, _| {},
        )?;
    }
    reviews.append(&mut pending_reviews);

    progress(ReviewPipelineEvent::phase(
        "reducer.started",
        "reducer",
        "running",
        "Reducing slice reviews into the final plan.",
        0,
        1,
        None,
        None,
    ));
    let plan = merge_review_plan(&context, &planner, &reviews);
    validate_review_plan(&plan)?;
    progress(ReviewPipelineEvent::phase(
        "reducer.completed",
        "reducer",
        "completed",
        "Final review plan reduced.",
        1,
        1,
        None,
        None,
    ));
    Ok(plan)
}

fn critique_slice_plan(
    client: &mut CodexAppServerClient,
    cwd: &Path,
    effort: &str,
    context: &PlanContext,
    planner: &Value,
    progress: &mut dyn FnMut(ReviewPipelineEvent),
) -> Result<Vec<String>, String> {
    progress(ReviewPipelineEvent::phase(
        "critic.started",
        "critic",
        "running",
        "Critiquing the slice plan.",
        0,
        1,
        None,
        None,
    ));
    let critique_result = client.run_turn(
        &StructuredAgentTurn {
            phase: "critic".into(),
            prompt: planner_critique_prompt(context, planner),
            output_schema: schema_value(SLICE_PLAN_CRITIQUE_SCHEMA)?,
            cwd: cwd.to_path_buf(),
            effort: effort.to_string(),
            slice_id: None,
            slice_title: None,
        },
        |_| {},
    )?;
    progress(ReviewPipelineEvent::phase(
        "critic.completed",
        "critic",
        "completed",
        "Slice plan critique completed.",
        1,
        1,
        Some(&critique_result),
        None,
    ));
    let critique = critique_result.value;
    if critique.get("schema").and_then(Value::as_str) != Some("slice-plan-critique.v0") {
        return Err("planner critic returned unexpected schema".into());
    }
    if critique.get("valid").and_then(Value::as_bool) == Some(true) {
        return Ok(Vec::new());
    }

    Ok(critique
        .get("failures")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|failure| {
            format!(
                "critic: slice `{}` issue: {}; evidence: {}; repair: {}",
                failure
                    .get("sliceId")
                    .and_then(Value::as_str)
                    .unwrap_or("plan"),
                failure
                    .get("issue")
                    .and_then(Value::as_str)
                    .unwrap_or("slice quality issue"),
                failure
                    .get("evidence")
                    .and_then(Value::as_str)
                    .unwrap_or("no evidence supplied"),
                failure
                    .get("repairHint")
                    .and_then(Value::as_str)
                    .unwrap_or("repair the slice plan")
            )
        })
        .collect())
}

fn build_context(
    metadata: &PrMetadata,
    base_sha: &str,
    head_sha: &str,
    files: &[DiffFile],
) -> PlanContext {
    let additions = files.iter().map(|file| file.added).sum::<u64>();
    let deletions = files.iter().map(|file| file.removed).sum::<u64>();
    let hunk_count = files.iter().map(|file| file.hunks.len()).sum::<usize>();
    let all_files = files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let pr = json!({
        "repo": metadata.repo,
        "number": metadata.number.parse::<u64>().map(Value::from).unwrap_or_else(|_| Value::from(metadata.number.clone())),
        "title": metadata.title,
        "url": metadata.url,
        "baseRef": metadata.base_ref,
        "headRef": metadata.head_ref,
        "baseSha": base_sha,
        "headSha": head_sha,
        "changedFiles": if metadata.changed_files == 0 { files.len() as u64 } else { metadata.changed_files },
        "additions": if metadata.additions == 0 { additions } else { metadata.additions },
        "deletions": if metadata.deletions == 0 { deletions } else { metadata.deletions }
    });
    let planner_files = files
        .iter()
        .map(|file| {
            json!({
                "path": file.path,
                "added": file.added,
                "removed": file.removed,
                "hunks": file.hunks.iter().map(|hunk| json!({
                    "id": hunk.id,
                    "header": hunk.header,
                    "oldStart": hunk.old_start,
                    "newStart": hunk.new_start
                })).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();

    PlanContext {
        pr,
        all_files,
        planner_files,
        files: files.to_vec(),
        stats: json!({
            "fileCount": files.len(),
            "hunkCount": hunk_count
        }),
    }
}

fn planner_prompt(context: &PlanContext) -> String {
    format!(
        r#"You are the planner in an agentic PR review pipeline.

Your job is only to map the PR into review slices. Do not write inline review comments.

Return only JSON matching the supplied schema.

Required planning contract:
- PR identity: preserve repo, PR number, title, URL, baseRef, headRef, and headSha exactly from context.
- semantic file groups: split by reviewer decision/risk surface, not directory, package, framework, or broad topic label.
- risk ranking: high-risk runtime, API, auth, storage, lifecycle, data-loss, concurrency, and public contract slices come before docs, examples, generated files, changesets, and lockfiles.
- trust-anchor hunks: slice titles and why fields must be grounded in concrete files/hunks from context.
- decisionQuestion: each slice must answer one reviewer decision question.
- primaryRisk: each slice must name one dominant risk. If there are multiple unrelated dominant risks, split the slice.
- whyTheseFilesTogether: explain the shared invariant or code path that makes the files belong together.
- accept/comment conditions: each slice must include draft acceptConditions and commentConditions for the reviewer to refine.
- Every changed file must appear in exactly one slice. Do not omit support files; put them in a low-risk support slice if needed.
- Avoid giant catch-all slices. If unrelated concerns appear in one package, split them.

Planner context:
{}"#,
        serde_json::to_string_pretty(&json!({
            "pr": context.pr,
            "allFiles": context.all_files,
            "files": context.planner_files,
            "stats": context.stats
        }))
        .unwrap_or_else(|_| "{}".into())
    )
}

fn planner_repair_prompt(context: &PlanContext, planner: &Value, failures: &[String]) -> String {
    format!(
        r#"You are repairing a PR review slice plan.

The previous plan failed generic quality checks. Do not write inline review comments.

Return a complete replacement JSON object matching the supplied schema.

Repair rules:
- Fix every listed failure.
- Preserve PR identity exactly.
- Preserve exact file paths from context.
- Every changed file must appear exactly once.
- Split slices when a bucket contains multiple independent review decisions or multiple unrelated dominant risks.
- Keep files together only when whyTheseFilesTogether can name a shared invariant, code path, API contract, or proof obligation.
- Do not encode repo-specific or PR-specific golden answers; infer boundaries from changed files and hunk headers.

Generic validation failures:
{}

Previous plan:
{}

Planner context:
{}"#,
        serde_json::to_string_pretty(failures).unwrap_or_else(|_| "[]".into()),
        serde_json::to_string_pretty(planner).unwrap_or_else(|_| "{}".into()),
        serde_json::to_string_pretty(&json!({
            "pr": context.pr,
            "allFiles": context.all_files,
            "files": context.planner_files,
            "stats": context.stats
        }))
        .unwrap_or_else(|_| "{}".into())
    )
}

fn planner_critique_prompt(context: &PlanContext, planner: &Value) -> String {
    format!(
        r#"You are the critic in an agentic PR review planning pipeline.

Judge whether the candidate slice plan is useful for review. Do not rewrite the plan. Return only JSON matching the supplied schema.

Critique rubric:
- A slice is good when it gives a reviewer one coherent decision to make.
- A slice is weak when it is a broad bucket joined mainly by directory, package, framework, or vague topic.
- Different files can stay together when the plan explains a shared invariant, code path, API contract, lifecycle, or proof obligation.
- Support files may be grouped when they are not the main risk.
- Do not require a specific number of slices or any repository-specific category names.
- Do not fail phrasing. Fail only when the candidate would materially make review worse.
- Every failure must cite candidate slice id plus concrete file paths, hunk ids, or candidate fields as evidence.

Planner context:
{}

Candidate plan:
{}"#,
        serde_json::to_string_pretty(&json!({
            "pr": context.pr,
            "allFiles": context.all_files,
            "files": context.planner_files,
            "stats": context.stats
        }))
        .unwrap_or_else(|_| "{}".into()),
        serde_json::to_string_pretty(planner).unwrap_or_else(|_| "{}".into())
    )
}

fn slice_review_prompt(context: &PlanContext, slice: &Value) -> String {
    let slice_files = slice
        .get("files")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let files = context
        .files
        .iter()
        .filter(|file| slice_files.contains(file.path.as_str()))
        .map(file_context)
        .collect::<Vec<_>>();

    format!(
        r#"You are a focused PR reviewer for one planned slice.

Inspect the complete hunks provided for this slice. Inline comments are allowed only for these hunks.

Return only JSON matching the supplied schema.

Required review contract:
- No prose summary outside JSON.
- Prefer zero inline comments over weak comments.
- Every inline comment must reference a supplied hunkId and a concrete file.
- Every inline comment must include a line number from the supplied hunk.
- Return every hunk you inspected in hunks.
- filesReviewed must include every file in this slice that you inspected.
- evidence must name concrete files, functions, hunks, or behavioral checks. Do not use generic evidence like "parsed the diff".
- acceptConditions must say what proof would make this slice acceptable.
- commentConditions must say what concrete findings should produce review comments.
- status is blocked when there is a blocking comment, needs-human when open questions remain, otherwise agent-reviewed.
- remainingQuestions should name what a human still needs to decide.

Slice:
{}

Full slice context:
{}"#,
        serde_json::to_string_pretty(slice).unwrap_or_else(|_| "{}".into()),
        serde_json::to_string_pretty(&json!({
            "pr": context.pr,
            "files": files
        }))
        .unwrap_or_else(|_| "{}".into())
    )
}

fn file_context(file: &DiffFile) -> Value {
    json!({
        "path": file.path,
        "added": file.added,
        "removed": file.removed,
        "hunks": file.hunks.iter().map(|hunk| json!({
            "id": hunk.id,
            "header": hunk.header,
            "oldStart": hunk.old_start,
            "newStart": hunk.new_start,
            "lines": hunk.lines
        })).collect::<Vec<_>>()
    })
}

impl ReviewPipelineEvent {
    fn raw(event_type: &str, message: &str, data: Value) -> Self {
        Self {
            event_type: event_type.to_string(),
            message: message.to_string(),
            data,
        }
    }

    fn phase(
        event_type: &str,
        phase: &str,
        status: &str,
        message: &str,
        current: usize,
        total: usize,
        result: Option<&StructuredAgentTurnResult>,
        slice: Option<(&StructuredAgentTurn, &str, &str)>,
    ) -> Self {
        let mut data = json!({
            "phase": phase,
            "status": status,
            "current": current,
            "total": total
        });

        if let Some(result) = result {
            data["elapsedMs"] = json!(result.elapsed_ms);
            data["threadId"] = json!(result.thread_id);
            data["turnId"] = json!(result.turn_id);
        }

        if let Some((turn, thread_id, turn_id)) = slice {
            data["sliceId"] = json!(turn.slice_id);
            data["sliceTitle"] = json!(turn.slice_title);
            data["threadId"] = json!(thread_id);
            data["turnId"] = json!(turn_id);
        }

        Self::raw(event_type, message, data)
    }
}

fn schema_value(schema: &str) -> Result<Value, String> {
    serde_json::from_str(schema).map_err(|error| format!("Invalid internal output schema: {error}"))
}

fn review_reasoning_effort() -> String {
    super::process::config_var("ANVIL_REVIEW_REASONING_EFFORT").unwrap_or_else(|| "medium".into())
}

fn slice_review_concurrency() -> usize {
    super::process::config_var("ANVIL_REVIEW_SLICE_CONCURRENCY")
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_SLICE_REVIEW_CONCURRENCY)
}

fn planned_slice_payloads(slices: &[Value]) -> Vec<Value> {
    slices
        .iter()
        .map(|slice| {
            json!({
                "id": slice.get("id").cloned().unwrap_or_else(|| json!("review")),
                "title": slice.get("title").cloned().unwrap_or_else(|| json!("Review changes")),
                "risk": slice.get("risk").cloned().unwrap_or_else(|| json!("medium")),
                "primaryRisk": slice.get("primaryRisk").cloned().unwrap_or_else(|| json!("")),
                "decisionQuestion": slice.get("decisionQuestion").cloned().unwrap_or_else(|| json!("")),
                "whyTheseFilesTogether": slice.get("whyTheseFilesTogether").cloned().unwrap_or_else(|| json!("")),
                "why": slice.get("why").cloned().unwrap_or_else(|| json!("Changed files grouped by Codex app-server.")),
                "acceptConditions": slice.get("acceptConditions").cloned().unwrap_or_else(|| json!([])),
                "commentConditions": slice.get("commentConditions").cloned().unwrap_or_else(|| json!([])),
                "files": slice.get("files").cloned().unwrap_or_else(|| json!([]))
            })
        })
        .collect()
}

fn validate_slice_plan_contract(plan: &Value, context: &PlanContext) -> Vec<String> {
    let mut failures = Vec::new();
    if plan.get("schema").and_then(Value::as_str) != Some("slice-plan.v0") {
        failures.push("planner returned unexpected schema".into());
    }
    let Some(slices) = plan.get("slices").and_then(Value::as_array) else {
        failures.push("planner returned no slices".into());
        return failures;
    };
    if slices.is_empty() {
        failures.push("planner returned no slices".into());
    }

    let expected = context.all_files.iter().cloned().collect::<HashSet<_>>();
    let mut owners: HashMap<String, String> = HashMap::new();
    for slice in slices {
        let id = slice.get("id").and_then(Value::as_str).unwrap_or("unknown");
        let files = string_array(slice.get("files"));
        if files.is_empty() {
            failures.push(format!("slice `{id}` has no files"));
        }
        if slice.get("risk").and_then(Value::as_str) != Some("low")
            && files.len() > MAX_PRIMARY_SLICE_FILES
        {
            failures.push(format!(
                "slice `{id}` owns {} primary files; split large review buckets by decision boundary",
                files.len()
            ));
        }
        validate_planner_slice_contract(slice, id, &mut failures);

        for file in files {
            if !expected.contains(&file) {
                failures.push(format!(
                    "planner referenced unknown file `{file}` in slice `{id}`"
                ));
                continue;
            }
            if let Some(previous) = owners.insert(file.clone(), id.to_string()) {
                failures.push(format!(
                    "planner assigned `{file}` to both `{previous}` and `{id}`"
                ));
            }
        }
    }

    let missing = expected
        .iter()
        .filter(|file| !owners.contains_key(*file))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        failures.push(format!(
            "planner omitted changed files: {}",
            missing.join(", ")
        ));
    }
    failures
}

fn validate_planner_slice_contract(slice: &Value, id: &str, failures: &mut Vec<String>) {
    for field in [
        "primaryRisk",
        "decisionQuestion",
        "whyTheseFilesTogether",
        "why",
    ] {
        let value = slice.get(field).and_then(Value::as_str).unwrap_or_default();
        if value.trim().is_empty() {
            failures.push(format!("slice `{id}` is missing `{field}`"));
        }
    }

    if string_array(slice.get("acceptConditions")).is_empty() {
        failures.push(format!("slice `{id}` has no planner acceptConditions"));
    }
    if string_array(slice.get("commentConditions")).is_empty() {
        failures.push(format!("slice `{id}` has no planner commentConditions"));
    }
}

fn validate_slice_review(
    review: &Value,
    slice: &Value,
    context: &PlanContext,
) -> Result<(), String> {
    if review.get("schema").and_then(Value::as_str) != Some("slice-review.v0") {
        return Err("slice reviewer returned unexpected schema".into());
    }
    let slice_id = slice.get("id").and_then(Value::as_str).unwrap_or_default();
    if review.get("sliceId").and_then(Value::as_str) != Some(slice_id) {
        return Err(format!("slice review id mismatch for `{slice_id}`"));
    }

    let allowed_files = string_array(slice.get("files"))
        .into_iter()
        .collect::<HashSet<_>>();
    let allowed_hunks = context
        .files
        .iter()
        .filter(|file| allowed_files.contains(&file.path))
        .flat_map(|file| file.hunks.iter().map(|hunk| hunk.id.clone()))
        .collect::<HashSet<_>>();

    for comment in review
        .get("inlineComments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let file = comment
            .get("file")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let hunk_id = comment
            .get("hunkId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if comment.get("line").is_none() {
            return Err(format!(
                "comment references `{file}`/`{hunk_id}` without a line anchor in slice `{slice_id}`"
            ));
        }
        if !allowed_files.contains(file) {
            return Err(format!(
                "comment references file outside slice `{slice_id}`: {file}"
            ));
        }
        if !allowed_hunks.contains(hunk_id) {
            return Err(format!(
                "comment references hunk outside slice `{slice_id}`: {hunk_id}"
            ));
        }
    }
    Ok(())
}

fn merge_review_plan(context: &PlanContext, planner: &Value, reviews: &[Value]) -> Value {
    let reviews_by_slice = reviews
        .iter()
        .filter_map(|review| Some((review.get("sliceId")?.as_str()?.to_string(), review.clone())))
        .collect::<HashMap<_, _>>();
    let slices = planner
        .get("slices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|slice| {
            let id = slice.get("id").and_then(Value::as_str).unwrap_or_default();
            let review = reviews_by_slice.get(id);
            build_plan_slice(context, &slice, review)
        })
        .collect::<Vec<_>>();

    json!({
        "schema": "review-plan.v0",
        "pr": context.pr,
        "completion": completion_for_plan(context, reviews),
        "slices": slices,
        "hiddenGroups": reviews.iter().flat_map(|review| {
            review.get("hiddenGroups").and_then(Value::as_array).cloned().unwrap_or_default()
        }).collect::<Vec<_>>(),
        "fallbackFileList": context.all_files,
        "agentRuns": std::iter::once(json!({
            "role": "planner",
            "provider": "codex",
            "status": "completed",
            "notes": planner.get("plannerNotes").and_then(Value::as_str).unwrap_or_default()
        })).chain(reviews.iter().map(|review| json!({
            "role": format!("slice-review:{}", review.get("sliceId").and_then(Value::as_str).unwrap_or_default()),
            "provider": "codex",
            "status": "completed",
            "notes": review.get("notes").and_then(Value::as_str).unwrap_or_default()
        }))).collect::<Vec<_>>()
    })
}

fn build_plan_slice(context: &PlanContext, slice: &Value, review: Option<&Value>) -> Value {
    json!({
        "id": slice.get("id").cloned().unwrap_or_else(|| json!("review")),
        "title": slice.get("title").cloned().unwrap_or_else(|| json!("Review changes")),
        "risk": slice.get("risk").cloned().unwrap_or_else(|| json!("medium")),
        "primaryRisk": slice.get("primaryRisk").cloned().unwrap_or_else(|| json!("")),
        "decisionQuestion": slice.get("decisionQuestion").cloned().unwrap_or_else(|| json!("")),
        "whyTheseFilesTogether": slice.get("whyTheseFilesTogether").cloned().unwrap_or_else(|| json!("")),
        "status": review.and_then(|value| value.get("status")).cloned().unwrap_or_else(|| json!("needs-human")),
        "deferred": review.and_then(|value| value.get("deferred")).cloned().unwrap_or_else(|| json!(false)),
        "deferReason": review.and_then(|value| value.get("deferReason")).cloned().unwrap_or_else(|| json!("")),
        "why": slice.get("why").cloned().unwrap_or_else(|| json!("Planned by agentic Rust review runtime.")),
        "files": slice.get("files").cloned().unwrap_or_else(|| json!([])),
        "filesReviewed": review.and_then(|value| value.get("filesReviewed")).cloned().unwrap_or_else(|| json!([])),
        "hunks": complete_hunk_refs_for_slice(context, slice, review),
        "inlineComments": review.and_then(|value| value.get("inlineComments")).cloned().unwrap_or_else(|| json!([])),
        "remainingQuestions": review.and_then(|value| value.get("remainingQuestions")).cloned().unwrap_or_else(|| json!([])),
        "evidence": review.and_then(|value| value.get("evidence")).cloned().unwrap_or_else(|| json!([])),
        "acceptConditions": review.and_then(|value| value.get("acceptConditions")).cloned().or_else(|| slice.get("acceptConditions").cloned()).unwrap_or_else(|| json!([])),
        "commentConditions": review.and_then(|value| value.get("commentConditions")).cloned().or_else(|| slice.get("commentConditions").cloned()).unwrap_or_else(|| json!([]))
    })
}

fn complete_hunk_refs_for_slice(
    context: &PlanContext,
    slice: &Value,
    review: Option<&Value>,
) -> Value {
    let reviewed = review
        .and_then(|value| value.get("hunks"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|hunk| Some((hunk.get("hunkId")?.as_str()?.to_string(), hunk)))
        .collect::<HashMap<_, _>>();
    let slice_files = string_array(slice.get("files"))
        .into_iter()
        .collect::<HashSet<_>>();

    json!(context
        .files
        .iter()
        .filter(|file| slice_files.contains(&file.path))
        .flat_map(|file| {
            let reviewed = &reviewed;
            file.hunks.iter().map(move |hunk| {
                let agent_hunk = reviewed.get(&hunk.id);
                json!({
                    "file": file.path,
                    "hunkId": hunk.id,
                    "reason": agent_hunk.and_then(|value| value.get("reason")).and_then(Value::as_str).unwrap_or("Included in full local-git slice review context."),
                    "lines": diff_lines_for_hunk(hunk)
                })
            })
        })
        .collect::<Vec<_>>())
}

fn completion_for_plan(context: &PlanContext, reviews: &[Value]) -> Value {
    let reviewed_files = reviews
        .iter()
        .flat_map(|review| string_array(review.get("filesReviewed")))
        .collect::<HashSet<_>>();
    let reviewed_hunks = reviews
        .iter()
        .flat_map(|review| {
            review
                .get("hunks")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|hunk| {
                    hunk.get("hunkId")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        })
        .collect::<HashSet<_>>();
    let total_hunks = context
        .files
        .iter()
        .map(|file| file.hunks.len())
        .sum::<usize>();
    let blocking_comments = reviews
        .iter()
        .flat_map(|review| {
            review
                .get("inlineComments")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .filter(|comment| comment.get("severity").and_then(Value::as_str) == Some("blocking"))
        .count();
    let open_questions = reviews
        .iter()
        .map(|review| {
            review
                .get("remainingQuestions")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default()
        })
        .sum::<usize>();
    let status = if blocking_comments > 0 {
        "blocked"
    } else if open_questions > 0
        || reviewed_files.len() != context.all_files.len()
        || reviewed_hunks.len() != total_hunks
    {
        "needs-human"
    } else {
        "agent-reviewed"
    };

    json!({
        "status": status,
        "reviewedFiles": reviewed_files.len(),
        "totalFiles": context.all_files.len(),
        "reviewedHunks": reviewed_hunks.len(),
        "totalHunks": total_hunks,
        "blockingComments": blocking_comments,
        "openQuestions": open_questions,
        "summary": match status {
            "blocked" => "Agent review found blocking issues for a human to resolve.",
            "needs-human" => "Agent inspected the PR and left explicit human decisions.",
            _ => "Agent inspected every changed file and hunk with no blocking findings."
        }
    })
}

fn validate_review_plan(plan: &Value) -> Result<(), String> {
    if plan.get("schema").and_then(Value::as_str) != Some("review-plan.v0") {
        return Err("review reducer returned unexpected schema".into());
    }
    if !plan
        .get("slices")
        .and_then(Value::as_array)
        .is_some_and(|slices| !slices.is_empty())
    {
        return Err("review reducer returned no slices".into());
    }
    Ok(())
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn diff_lines_for_hunk(hunk: &super::types::DiffHunk) -> Vec<Value> {
    let mut old_number = hunk.old_start;
    let mut new_number = hunk.new_start;
    hunk.lines
        .iter()
        .map(|line| {
            let (kind, old, new, text) = if line.starts_with('+') && !line.starts_with("+++") {
                let current_new = new_number;
                new_number = new_number.map(|value| value + 1);
                ("add", None, current_new, line.trim_start_matches('+'))
            } else if line.starts_with('-') && !line.starts_with("---") {
                let current_old = old_number;
                old_number = old_number.map(|value| value + 1);
                ("remove", current_old, None, line.trim_start_matches('-'))
            } else {
                let current_old = old_number;
                let current_new = new_number;
                old_number = old_number.map(|value| value + 1);
                new_number = new_number.map(|value| value + 1);
                (
                    "context",
                    current_old,
                    current_new,
                    line.strip_prefix(' ').unwrap_or(line),
                )
            };

            json!({
                "kind": kind,
                "oldNumber": old,
                "newNumber": new,
                "text": text
            })
        })
        .collect()
}
