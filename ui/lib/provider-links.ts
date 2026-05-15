import { isTauriRuntime, openExternalUrl } from "@/lib/api";

export type ProviderId = "github" | "bitbucket";

export type ProviderPullRequestLink = {
  provider: ProviderId;
  label: string;
  url: string;
};

export type ProviderPullRequestTarget = {
  source?: string;
  repo?: string;
  pullRequest?: string | number;
  preferredUrls?: Array<string | undefined>;
};

export function resolveProviderPullRequestLink({
  source,
  repo,
  pullRequest,
  preferredUrls = [],
}: ProviderPullRequestTarget): ProviderPullRequestLink | undefined {
  for (const candidate of preferredUrls) {
    const normalized = normalizeProviderPullRequestUrl(candidate);
    if (normalized) return toProviderLink(normalized.provider, normalized.url);
  }

  const provider = normalizeProvider(source);
  if (!provider || !repo || pullRequest === undefined || pullRequest === null) {
    return undefined;
  }

  const number = String(pullRequest).trim();
  if (!/^\d+$/.test(number)) {
    return undefined;
  }

  const slug = parseProviderRepoSlug(repo);
  if (!slug) {
    return undefined;
  }
  const [owner, name] = slug;

  if (provider === "github") {
    return toProviderLink(
      provider,
      `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pull/${number}`,
    );
  }

  return toProviderLink(
    provider,
    `https://bitbucket.org/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pull-requests/${number}`,
  );
}

export function normalizeProviderPullRequestUrl(
  value: string | undefined,
): { provider: ProviderId; url: string } | undefined {
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:") {
    return undefined;
  }

  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (hostname === "github.com" && parts.length >= 4 && parts[2] === "pull" && /^\d+$/.test(parts[3])) {
    return { provider: "github", url: url.toString() };
  }

  if (hostname === "bitbucket.org" && parts.length >= 4 && parts[2] === "pull-requests" && /^\d+$/.test(parts[3])) {
    return { provider: "bitbucket", url: url.toString() };
  }

  return undefined;
}

export async function openProviderPullRequestUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await openExternalUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function normalizeProvider(source: unknown): ProviderId | undefined {
  const value = String(source ?? "")
    .trim()
    .toLowerCase();
  if (["github", "github.com", "github enterprise", "github enterprise server"].includes(value)) return "github";
  if (["bitbucket", "bitbucket.org", "bitbucket cloud"].includes(value)) return "bitbucket";
  return undefined;
}

function parseProviderRepoSlug(repo: string): [string, string] | undefined {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    return undefined;
  }

  const [owner, name] = parts.map((part) => part.trim());
  if (!isProviderRepoSegment(owner) || !isProviderRepoSegment(name)) {
    return undefined;
  }

  return [owner, name];
}

function isProviderRepoSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= 100 &&
    segment !== "." &&
    segment !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(segment)
  );
}

function toProviderLink(provider: ProviderId, url: string): ProviderPullRequestLink {
  return {
    provider,
    label: provider === "github" ? "Open in GitHub" : "Open in Bitbucket",
    url,
  };
}
