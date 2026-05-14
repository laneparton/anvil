import { describe, expect, it } from "vitest";

import { applyCommentTonePreset, isCommentTonePreset } from "./comment-tone";

describe("comment tone presets", () => {
  it("keeps the original comment available", () => {
    expect(applyCommentTonePreset("  Guard duplicate OAuth callback redemption.  ", "original")).toBe(
      "Guard duplicate OAuth callback redemption.",
    );
  });

  it("softens imperative comments", () => {
    expect(applyCommentTonePreset("Guard duplicate OAuth callback redemption.", "soft")).toBe(
      "Could we guard duplicate OAuth callback redemption?",
    );
  });

  it("turns imperative comments into a socratic question", () => {
    expect(applyCommentTonePreset("Guard duplicate OAuth callback redemption.", "socratic")).toBe(
      "Are we sure this guards duplicate OAuth callback redemption?",
    );
  });

  it("validates stored preset values", () => {
    expect(isCommentTonePreset("socratic")).toBe(true);
    expect(isCommentTonePreset("custom")).toBe(false);
  });
});
