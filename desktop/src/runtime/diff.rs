use super::types::{DiffFile, DiffHunk};

pub(crate) fn parse_patch(patch: &str) -> Vec<DiffFile> {
    let mut files = Vec::<DiffFile>::new();
    let mut current: Option<usize> = None;
    let mut hunk: Option<DiffHunk> = None;

    for line in patch.lines() {
        if line.starts_with("diff --git ") {
            if let (Some(file_index), Some(previous_hunk)) = (current, hunk.take()) {
                files[file_index].hunks.push(previous_hunk);
            }

            let path = parse_diff_path(line);
            files.push(DiffFile {
                path,
                added: 0,
                removed: 0,
                hunks: Vec::new(),
            });
            current = Some(files.len() - 1);
            continue;
        }

        let Some(file_index) = current else {
            continue;
        };

        if line.starts_with("@@") {
            if let Some(previous_hunk) = hunk.take() {
                files[file_index].hunks.push(previous_hunk);
            }
            let (old_start, new_start) = parse_hunk_header(line);
            hunk = Some(DiffHunk {
                id: format!(
                    "{}#h{}",
                    files[file_index].path,
                    files[file_index].hunks.len() + 1
                ),
                header: line.to_string(),
                old_start,
                new_start,
                lines: Vec::new(),
            });
            continue;
        }

        let Some(current_hunk) = hunk.as_mut() else {
            continue;
        };

        if line.starts_with('+') && !line.starts_with("+++") {
            files[file_index].added += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            files[file_index].removed += 1;
        }
        current_hunk.lines.push(line.to_string());
    }

    if let (Some(file_index), Some(previous_hunk)) = (current, hunk.take()) {
        files[file_index].hunks.push(previous_hunk);
    }

    files
}

fn parse_diff_path(line: &str) -> String {
    line.split_whitespace()
        .nth(3)
        .and_then(|path| path.strip_prefix("b/"))
        .unwrap_or_else(|| line.trim_start_matches("diff --git ").trim())
        .to_string()
}

fn parse_hunk_header(line: &str) -> (Option<u64>, Option<u64>) {
    let mut parts = line.split_whitespace();
    let _marker = parts.next();
    let old = parts.next().and_then(|value| parse_hunk_start(value, '-'));
    let new = parts.next().and_then(|value| parse_hunk_start(value, '+'));
    (old, new)
}

fn parse_hunk_start(value: &str, prefix: char) -> Option<u64> {
    value
        .strip_prefix(prefix)?
        .split(',')
        .next()?
        .parse::<u64>()
        .ok()
}
