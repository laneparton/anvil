import { describe, expect, it } from "vitest";
import { parseManualPullRequestUrl } from "./LauncherScreen";

describe("parseManualPullRequestUrl", () => {
  it("parses GitHub pull request URLs with or without a scheme", () => {
    expect(parseManualPullRequestUrl("https://github.com/owner/repo/pull/123")).toEqual({
      source: "github",
      repo: "owner/repo",
      number: "123",
    });
    expect(parseManualPullRequestUrl("github.com/owner/repo/pull/456")).toEqual({
      source: "github",
      repo: "owner/repo",
      number: "456",
    });
  });

  it("parses Bitbucket pull request URLs", () => {
    expect(parseManualPullRequestUrl("https://bitbucket.org/workspace/repo/pull-requests/7")).toEqual({
      source: "bitbucket",
      repo: "workspace/repo",
      number: "7",
    });
  });

  it("rejects unsupported hosts, non-PR paths, and non-numeric pull request ids", () => {
    expect(parseManualPullRequestUrl("https://github.com/owner/repo/issues/123")).toBeUndefined();
    expect(parseManualPullRequestUrl("https://github.example.com/owner/repo/pull/123")).toBeUndefined();
    expect(parseManualPullRequestUrl("https://bitbucket.org/workspace/repo/pull-requests/not-a-number")).toBeUndefined();
  });
});
