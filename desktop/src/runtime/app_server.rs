use super::{
    process::{config_var, terminate_child},
    types::REVIEW_COMMAND_TIMEOUT,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

pub(crate) struct StructuredAgentTurn {
    pub(crate) phase: String,
    pub(crate) prompt: String,
    pub(crate) output_schema: Value,
    pub(crate) cwd: PathBuf,
    pub(crate) effort: String,
    pub(crate) slice_id: Option<String>,
    pub(crate) slice_title: Option<String>,
}

pub(crate) struct StructuredAgentTurnResult {
    pub(crate) value: Value,
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
    pub(crate) elapsed_ms: u128,
}

pub(crate) struct AppServerNotification {
    pub(crate) method: String,
    pub(crate) params: Value,
}

pub(crate) struct CodexAppServerClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<Box<dyn Read + Send>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    next_id: u64,
}

impl CodexAppServerClient {
    pub(crate) fn spawn() -> Result<Self, String> {
        let mut args = vec!["app-server".to_string(), "--listen".to_string(), "stdio://".to_string()];
        if let Some(effort) = config_var("ANVIL_REVIEW_REASONING_EFFORT") {
            args.push("-c".into());
            args.push(format!("model_reasoning_effort=\"{}\"", escape_toml_string(&effort)));
        }

        let mut child = Command::new("codex")
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Codex app-server startup failed. Run `codex app-server --listen stdio://` to verify the local Codex CLI is installed and authenticated. {error}"
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server did not expose stdin.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server did not expose stdout.".to_string())?;
        let stderr_pipe = child.stderr.take();
        let stderr = Arc::new(Mutex::new(Vec::new()));
        read_stderr(stderr_pipe, stderr.clone());

        let mut client = Self {
            child,
            stdin,
            stdout: BufReader::new(Box::new(stdout)),
            stderr,
            next_id: 1,
        };
        client.initialize()?;
        Ok(client)
    }

    pub(crate) fn child_id(&self) -> u32 {
        self.child.id()
    }

    pub(crate) fn run_turn(
        &mut self,
        turn: &StructuredAgentTurn,
        mut on_notification: impl FnMut(&AppServerNotification),
    ) -> Result<StructuredAgentTurnResult, String> {
        let started = Instant::now();
        let thread_id = self.start_thread(&turn.cwd, |notification| on_notification(notification))?;
        let turn_id = self.start_turn(&thread_id, turn, |notification| on_notification(notification))?;
        let mut pending = PendingTurn::new(&thread_id, &turn_id);

        loop {
            let message = self.read_message()?;
            if let Some(notification) = notification_from_message(&message) {
                pending.handle_notification(&notification)?;
                on_notification(&notification);
                if pending.completed {
                    let text = pending.final_text().ok_or_else(|| {
                        format!(
                            "Codex app-server turn `{}` for phase `{}` completed without a final assistant JSON message.",
                            turn_id, turn.phase
                        )
                    })?;
                    let value = extract_json(text)?;
                    return Ok(StructuredAgentTurnResult {
                        value,
                        thread_id,
                        turn_id,
                        elapsed_ms: started.elapsed().as_millis(),
                    });
                }
                continue;
            }

            self.ensure_unexpected_response_ok(&message)?;
        }
    }

    pub(crate) fn run_turns_bounded(
        &mut self,
        turns: &[StructuredAgentTurn],
        concurrency: usize,
        mut on_started: impl FnMut(&StructuredAgentTurn, &str, &str, usize, usize),
        mut on_ready: impl FnMut(&StructuredAgentTurn, StructuredAgentTurnResult, usize, usize) -> Result<(), String>,
        mut on_notification: impl FnMut(&StructuredAgentTurn, &AppServerNotification),
    ) -> Result<(), String> {
        let total = turns.len();
        if total == 0 {
            return Ok(());
        }

        let limit = concurrency.max(1);
        let mut next = 0usize;
        let mut completed = 0usize;
        let mut pending: HashMap<String, (usize, Instant, PendingTurn)> = HashMap::new();

        while completed < total {
            while next < total && pending.len() < limit {
                let turn = &turns[next];
                let mut notification_error = None;
                let thread_id = self.start_thread(&turn.cwd, |notification| {
                    if let Err(error) = handle_pending_notification(&mut pending, notification) {
                        notification_error = Some(error);
                    }
                })?;
                if let Some(error) = notification_error.take() {
                    return Err(error);
                }
                let turn_id = self.start_turn(&thread_id, turn, |notification| {
                    if let Err(error) = handle_pending_notification(&mut pending, notification) {
                        notification_error = Some(error);
                    }
                })?;
                if let Some(error) = notification_error.take() {
                    return Err(error);
                }
                on_started(turn, &thread_id, &turn_id, next + 1, total);
                pending.insert(turn_id.clone(), (next, Instant::now(), PendingTurn::new(&thread_id, &turn_id)));
                next += 1;
                emit_completed_pending(&mut pending, turns, &mut completed, total, &mut on_ready)?;
            }

            emit_completed_pending(&mut pending, turns, &mut completed, total, &mut on_ready)?;
            if completed >= total {
                break;
            }

            let message = self.read_message()?;
            if let Some(notification) = notification_from_message(&message) {
                if let Some(turn_id) = notification_turn_id(&notification) {
                    if let Some((index, _, _)) = pending.get(&turn_id) {
                        on_notification(&turns[*index], &notification);
                    }
                }
                handle_pending_notification(&mut pending, &notification)?;
                emit_completed_pending(&mut pending, turns, &mut completed, total, &mut on_ready)?;
                continue;
            }

            self.ensure_unexpected_response_ok(&message)?;
        }

        Ok(())
    }

    fn initialize(&mut self) -> Result<(), String> {
        let id = self.send_request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "anvil-review",
                    "title": "Anvil",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "optOutNotificationMethods": []
                }
            }),
        )?;
        let _ = self.wait_response(id, |_| {})?;
        Ok(())
    }

    fn start_thread(
        &mut self,
        cwd: &Path,
        mut on_notification: impl FnMut(&AppServerNotification),
    ) -> Result<String, String> {
        let id = self.send_request(
            "thread/start",
            json!({
                "cwd": cwd,
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "ephemeral": true,
                "threadSource": "subagent"
            }),
        )?;
        let response = self.wait_response(id, |notification| on_notification(notification))?;
        response
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("Codex app-server thread/start returned an unexpected response: {response}"))
    }

    fn start_turn(
        &mut self,
        thread_id: &str,
        turn: &StructuredAgentTurn,
        mut on_notification: impl FnMut(&AppServerNotification),
    ) -> Result<String, String> {
        let id = self.send_request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "cwd": turn.cwd,
                "effort": turn.effort,
                "input": [{
                    "type": "text",
                    "text": turn.prompt,
                    "text_elements": []
                }],
                "outputSchema": turn.output_schema
            }),
        )?;
        let response = self.wait_response(id, |notification| on_notification(notification))?;
        response
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("Codex app-server turn/start returned an unexpected response: {response}"))
    }

    fn send_request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        let id = self.next_id;
        self.next_id += 1;
        let message = json!({
            "id": id,
            "method": method,
            "params": params
        });
        writeln!(self.stdin, "{message}").map_err(|error| {
            format!("Codex app-server protocol write failed for `{method}`: {error}")
        })?;
        self.stdin.flush().map_err(|error| {
            format!("Codex app-server protocol flush failed for `{method}`: {error}")
        })?;
        Ok(id)
    }

    fn wait_response(
        &mut self,
        id: u64,
        mut on_notification: impl FnMut(&AppServerNotification),
    ) -> Result<Value, String> {
        let started = Instant::now();
        loop {
            if started.elapsed() >= REVIEW_COMMAND_TIMEOUT {
                return Err(format!(
                    "Codex app-server protocol timed out waiting for response id {id} after {}s.",
                    REVIEW_COMMAND_TIMEOUT.as_secs()
                ));
            }

            let message = self.read_message()?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = message.get("error") {
                    return Err(format!("Codex app-server protocol call {id} failed: {error}"));
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| format!("Codex app-server response {id} did not include `result`: {message}"));
            }

            if let Some(notification) = notification_from_message(&message) {
                on_notification(&notification);
            } else {
                self.ensure_unexpected_response_ok(&message)?;
            }
        }
    }

    fn read_message(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Codex app-server protocol read failed: {error}"))?;
        if bytes == 0 {
            return Err(format!(
                "Codex app-server exited before completing the protocol call.{}",
                self.stderr_suffix()
            ));
        }
        serde_json::from_str(line.trim()).map_err(|error| {
            format!(
                "Codex app-server emitted invalid JSON-RPC: {error}. Line: {}",
                line.trim()
            )
        })
    }

    fn ensure_unexpected_response_ok(&self, message: &Value) -> Result<(), String> {
        if let Some(error) = message.get("error") {
            return Err(format!("Codex app-server protocol error: {error}"));
        }
        Ok(())
    }

    fn stderr_suffix(&self) -> String {
        let stderr = self
            .stderr
            .lock()
            .ok()
            .map(|buffer| String::from_utf8_lossy(&buffer).trim().to_string())
            .unwrap_or_default();
        if stderr.is_empty() {
            String::new()
        } else {
            format!(" Stderr: {stderr}")
        }
    }
}

impl Drop for CodexAppServerClient {
    fn drop(&mut self) {
        terminate_child(self.child.id());
        let _ = self.child.wait();
    }
}

#[derive(Clone)]
struct PendingTurn {
    thread_id: String,
    turn_id: String,
    delta_text: String,
    completed_messages: Vec<String>,
    completed: bool,
}

impl PendingTurn {
    fn new(thread_id: &str, turn_id: &str) -> Self {
        Self {
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
            delta_text: String::new(),
            completed_messages: Vec::new(),
            completed: false,
        }
    }

    fn handle_notification(&mut self, notification: &AppServerNotification) -> Result<(), String> {
        match notification.method.as_str() {
            "item/agentMessage/delta" => {
                if notification.params.get("turnId").and_then(Value::as_str) == Some(&self.turn_id)
                {
                    if let Some(delta) = notification.params.get("delta").and_then(Value::as_str) {
                        self.delta_text.push_str(delta);
                    }
                }
            }
            "item/completed" => {
                if notification.params.get("turnId").and_then(Value::as_str) == Some(&self.turn_id)
                {
                    if let Some(item) = notification.params.get("item") {
                        if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                if !text.trim().is_empty() {
                                    self.completed_messages.push(text.to_string());
                                }
                            }
                        }
                    }
                }
            }
            "turn/completed" => {
                let turn = notification.params.get("turn").unwrap_or(&Value::Null);
                if turn.get("id").and_then(Value::as_str) == Some(&self.turn_id) {
                    if turn.get("status").and_then(Value::as_str) == Some("failed") {
                        return Err(format!(
                            "Codex app-server turn `{}` failed: {}",
                            self.turn_id,
                            turn.get("error").cloned().unwrap_or(Value::Null)
                        ));
                    }
                    self.completed = true;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn final_text(&self) -> Option<&str> {
        self.completed_messages
            .iter()
            .rev()
            .find(|message| !message.trim().is_empty())
            .map(String::as_str)
            .or_else(|| (!self.delta_text.trim().is_empty()).then_some(self.delta_text.as_str()))
    }
}

fn handle_pending_notification(
    pending: &mut HashMap<String, (usize, Instant, PendingTurn)>,
    notification: &AppServerNotification,
) -> Result<(), String> {
    let Some(turn_id) = notification_turn_id(notification) else {
        return Ok(());
    };
    if let Some((_, _, pending_turn)) = pending.get_mut(&turn_id) {
        pending_turn.handle_notification(notification)?;
    }
    Ok(())
}

fn emit_completed_pending(
    pending: &mut HashMap<String, (usize, Instant, PendingTurn)>,
    turns: &[StructuredAgentTurn],
    completed: &mut usize,
    total: usize,
    on_ready: &mut impl FnMut(&StructuredAgentTurn, StructuredAgentTurnResult, usize, usize) -> Result<(), String>,
) -> Result<(), String> {
    let completed_ids = pending
        .iter()
        .filter_map(|(turn_id, (_, _, pending_turn))| pending_turn.completed.then_some(turn_id.clone()))
        .collect::<Vec<_>>();

    for turn_id in completed_ids {
        let Some((index, started, pending_turn)) = pending.remove(&turn_id) else {
            continue;
        };
        let text = pending_turn.final_text().ok_or_else(|| {
            format!(
                "Codex app-server turn `{}` for phase `{}` completed without a final assistant JSON message.",
                turn_id, turns[index].phase
            )
        })?;
        let value = extract_json(text)?;
        let result = StructuredAgentTurnResult {
            value,
            thread_id: pending_turn.thread_id.clone(),
            turn_id,
            elapsed_ms: started.elapsed().as_millis(),
        };
        *completed += 1;
        on_ready(&turns[index], result, *completed, total)?;
    }

    Ok(())
}

fn notification_turn_id(notification: &AppServerNotification) -> Option<String> {
    notification
        .params
        .get("turnId")
        .and_then(Value::as_str)
        .or_else(|| {
            notification
                .params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
}

fn notification_from_message(message: &Value) -> Option<AppServerNotification> {
    let method = message.get("method").and_then(Value::as_str)?;
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    Some(AppServerNotification {
        method: method.to_string(),
        params,
    })
}

fn extract_json(text: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Some(result) = value.get("result").and_then(Value::as_str) {
            return extract_json(result);
        }
        return Ok(value);
    }

    if let Some(start) = text.find("```json") {
        let after = &text[start + "```json".len()..];
        if let Some(end) = after.find("```") {
            return serde_json::from_str(after[..end].trim()).map_err(|error| error.to_string());
        }
    }

    let start = text.find('{').ok_or_else(|| {
        format!(
            "Could not parse JSON from Codex app-server output:\n{}",
            text.chars().take(1000).collect::<String>()
        )
    })?;
    let end = text.rfind('}').ok_or_else(|| {
        format!(
            "Could not parse JSON from Codex app-server output:\n{}",
            text.chars().take(1000).collect::<String>()
        )
    })?;
    serde_json::from_str(&text[start..=end]).map_err(|error| error.to_string())
}

fn read_stderr(pipe: Option<impl Read + Send + 'static>, stderr: Arc<Mutex<Vec<u8>>>) {
    thread::spawn(move || {
        let Some(mut pipe) = pipe else {
            return;
        };
        let mut buffer = [0u8; 4096];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if let Ok(mut stderr) = stderr.lock() {
                        stderr.extend_from_slice(&buffer[..count]);
                        if stderr.len() > 16 * 1024 {
                            let keep_from = stderr.len() - 16 * 1024;
                            stderr.drain(..keep_from);
                        }
                    }
                }
            }
        }
    });
}

fn escape_toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::{extract_json, notification_from_message, PendingTurn};
    use serde_json::json;

    #[test]
    fn extracts_json_from_agent_message_deltas_when_completed_item_is_missing() {
        let mut pending = PendingTurn::new("thread-1", "turn-1");
        for delta in ["{\"schema\"", ":\"test.v0\"", "}"] {
            let notification = notification_from_message(&json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "msg-1",
                    "delta": delta
                }
            }))
            .unwrap();
            pending.handle_notification(&notification).unwrap();
        }
        let completed = notification_from_message(&json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "status": "completed"
                }
            }
        }))
        .unwrap();
        pending.handle_notification(&completed).unwrap();

        assert!(pending.completed);
        assert_eq!(
            extract_json(pending.final_text().unwrap()).unwrap(),
            json!({ "schema": "test.v0" })
        );
    }

    #[test]
    fn prefers_completed_agent_message_text_over_delta_stream() {
        let mut pending = PendingTurn::new("thread-1", "turn-1");
        let delta = notification_from_message(&json!({
            "method": "item/agentMessage/delta",
            "params": { "turnId": "turn-1", "delta": "{\"schema\":\"partial\"}" }
        }))
        .unwrap();
        pending.handle_notification(&delta).unwrap();
        let completed_item = notification_from_message(&json!({
            "method": "item/completed",
            "params": {
                "turnId": "turn-1",
                "item": {
                    "type": "agentMessage",
                    "text": "{\"schema\":\"final\"}"
                }
            }
        }))
        .unwrap();
        pending.handle_notification(&completed_item).unwrap();

        assert_eq!(
            extract_json(pending.final_text().unwrap()).unwrap(),
            json!({ "schema": "final" })
        );
    }
}
