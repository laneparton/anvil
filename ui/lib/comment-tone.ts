export type CommentTonePreset = "original" | "soft" | "socratic";

export const commentTonePresets = [
  { id: "original", label: "Original" },
  { id: "soft", label: "Soft" },
  { id: "socratic", label: "Socratic" },
] as const satisfies ReadonlyArray<{ id: CommentTonePreset; label: string }>;

export function isCommentTonePreset(value: unknown): value is CommentTonePreset {
  return commentTonePresets.some((preset) => preset.id === value);
}

export function applyCommentTonePreset(body: string, preset: CommentTonePreset): string {
  const normalized = normalizeBody(body);
  if (!normalized || preset === "original") return normalized;
  if (preset === "soft") return toSoftComment(normalized);
  return toSocraticComment(normalized);
}

function toSoftComment(body: string): string {
  const sentence = stripTrailingPunctuation(body);
  const lowerSentence = lowerFirst(sentence);

  if (startsWithVerb(sentence, ["Add", "Guard", "Handle", "Preserve", "Return", "Use", "Validate"])) {
    return `Could we ${lowerSentence}?`;
  }

  if (sentence.startsWith("This ")) {
    return `Could we double-check this before landing?\n\n${body}`;
  }

  return `Could we look at this before landing?\n\n${body}`;
}

function toSocraticComment(body: string): string {
  const sentence = stripTrailingPunctuation(body);
  const lowerSentence = lowerFirst(sentence);

  if (sentence.endsWith("?")) return sentence;
  if (startsWithVerb(sentence, ["Guard", "Handle", "Preserve", "Return", "Validate"])) {
    return `Are we sure this ${thirdPersonVerb(lowerSentence)}?`;
  }
  if (startsWithVerb(sentence, ["Add", "Use"])) {
    return `Are we sure this should ${lowerSentence}?`;
  }
  if (sentence.startsWith("This ")) {
    return `Are we sure ${lowerSentence}?`;
  }

  return `Are we sure this handles the case we need?\n\n${body}`;
}

function normalizeBody(body: string): string {
  return body.trim().replace(/\r\n/g, "\n");
}

function stripTrailingPunctuation(body: string): string {
  return normalizeBody(body).replace(/[.!]+$/u, "");
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function startsWithVerb(value: string, verbs: string[]): boolean {
  return verbs.some((verb) => value.startsWith(`${verb} `));
}

function thirdPersonVerb(value: string): string {
  const [verb, ...rest] = value.split(" ");
  const suffix = verb.endsWith("s") ? "" : verb.endsWith("sh") || verb.endsWith("ch") ? "es" : "s";
  return [verb + suffix, ...rest].join(" ");
}
