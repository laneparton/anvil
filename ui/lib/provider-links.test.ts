import { describe, expect, it } from "vitest";
import { normalizeProviderPullRequestUrl, resolveProviderPullRequestLink } from "./provider-links";

describe("provider pull request links", () => {
  it("uses a valid plan or inbox URL before deriving a provider URL", () => {
    const link = resolveProviderPullRequestLink({
      source: "bitbucket",
      repo: "workspace/repo",
      pullRequest: 42,
      preferredUrls: ["https://github.com/owner/repo/pull/7"],
    });

    expect(link).toEqual({
      provider: "github",
      label: "Open in GitHub",
      url: "https://github.com/owner/repo/pull/7",
    });
  });

  it("derives GitHub and Bitbucket PR URLs from source, repo, and number", () => {
    expect(
      resolveProviderPullRequestLink({
        source: "github",
        repo: "owner/repo",
        pullRequest: "123",
      }),
    ).toMatchObject({
      provider: "github",
      label: "Open in GitHub",
      url: "https://github.com/owner/repo/pull/123",
    });

    expect(
      resolveProviderPullRequestLink({
        source: "bitbucket",
        repo: "workspace/repo",
        pullRequest: "45",
      }),
    ).toMatchObject({
      provider: "bitbucket",
      label: "Open in Bitbucket",
      url: "https://bitbucket.org/workspace/repo/pull-requests/45",
    });
  });

  it("rejects non-provider, non-https, and non-PR URLs", () => {
    expect(normalizeProviderPullRequestUrl("http://github.com/owner/repo/pull/1")).toBeUndefined();
    expect(normalizeProviderPullRequestUrl("https://example.com/owner/repo/pull/1")).toBeUndefined();
    expect(normalizeProviderPullRequestUrl("https://github.com/owner/repo/issues/1")).toBeUndefined();
    expect(
      resolveProviderPullRequestLink({
        source: "github",
        repo: "owner/repo",
        pullRequest: "branch-name",
      }),
    ).toBeUndefined();
  });

  it("does not derive provider URLs from composite or malformed provider labels", () => {
    expect(
      resolveProviderPullRequestLink({
        source: "notgithub",
        repo: "owner/repo",
        pullRequest: 1,
      }),
    ).toBeUndefined();

    expect(
      resolveProviderPullRequestLink({
        source: "bitbucket-github",
        repo: "owner/repo",
        pullRequest: 1,
      }),
    ).toBeUndefined();

    expect(
      resolveProviderPullRequestLink({
        source: "GitHub Enterprise",
        repo: "owner/repo",
        pullRequest: 1,
      }),
    ).toMatchObject({ provider: "github" });
  });

  it("does not derive provider URLs from unsafe repo slugs", () => {
    expect(
      resolveProviderPullRequestLink({
        source: "github",
        repo: "owner/repo?tab=security",
        pullRequest: 1,
      }),
    ).toBeUndefined();

    expect(
      resolveProviderPullRequestLink({
        source: "github",
        repo: "owner/repo#fragment",
        pullRequest: 1,
      }),
    ).toBeUndefined();

    expect(
      resolveProviderPullRequestLink({
        source: "bitbucket",
        repo: "workspace/../repo",
        pullRequest: 1,
      }),
    ).toBeUndefined();
  });
});
