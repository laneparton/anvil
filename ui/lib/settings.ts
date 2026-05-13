import type { ReviewAgent } from "@/lib/api";

export type TerminalPreference = "Terminal" | "iTerm" | "custom";
export type ReviewSkillMode = "default" | "custom";
export type ProviderId = "github" | "bitbucket";

export type ReviewSkillSettings = {
  mode: ReviewSkillMode;
  customPath: string;
};

export type AppSettings = {
  enabledProviders: Record<ProviderId, boolean>;
  terminalPreference: TerminalPreference;
  customTerminalApp: string;
  preferredAgent: ReviewAgent;
  defaultPromptTemplate: string;
  reviewSkill: ReviewSkillSettings;
  env: Record<string, string>;
};

export type EnvSettingDefinition = {
  key: string;
  label: string;
  type?: "password" | "text" | "number";
  secret?: boolean;
  placeholder?: string;
  help?: string;
};

export type EnvSettingGroup = {
  id: string;
  title: string;
  variables: EnvSettingDefinition[];
};

export const defaultPromptTemplate =
  "You are helping review PR {repo} #{pullRequest}: {title}.\n\nThe checked-out review worktree is {worktree}.\n\nStart by inspecting the current diff and repository context, then help answer questions or refine review comments.";

export const defaultEnvOverrides: Record<string, string> = {
  BITBUCKET_INBOX_REPO_LIMIT: "20",
  BITBUCKET_RECENT_REPO_DAYS: "7",
};

export const defaultAppSettings: AppSettings = {
  enabledProviders: {
    github: true,
    bitbucket: true,
  },
  terminalPreference: "Terminal",
  customTerminalApp: "",
  preferredAgent: "codex",
  defaultPromptTemplate,
  reviewSkill: {
    mode: "default",
    customPath: "",
  },
  env: defaultEnvOverrides,
};

export const envSettingGroups: EnvSettingGroup[] = [
  {
    id: "github",
    title: "GitHub",
    variables: [
      {
        key: "GH_TOKEN",
        label: "GitHub token",
        secret: true,
        help: "Use gh auth login, GH_TOKEN, GITHUB_TOKEN, or launchctl setenv outside the app.",
      },
      {
        key: "GITHUB_TOKEN",
        label: "GitHub token fallback",
        secret: true,
        help: "Kept out of app settings until token storage is backed by Keychain.",
      },
    ],
  },
  {
    id: "bitbucket-auth",
    title: "Bitbucket auth",
    variables: [
      { key: "BITBUCKET_EMAIL", label: "Email", placeholder: "you@example.com" },
      { key: "BITBUCKET_USERNAME", label: "Username", placeholder: "workspace-user" },
      {
        key: "BITBUCKET_API_TOKEN",
        label: "API token",
        secret: true,
        help: "Set outside Anvil. Do not store Bitbucket API tokens in local app settings.",
      },
      {
        key: "BITBUCKET_ACCESS_TOKEN",
        label: "Access token",
        secret: true,
        help: "Set outside Anvil. The app will read it from the process or launchctl environment.",
      },
      {
        key: "BITBUCKET_APP_PASSWORD",
        label: "App password",
        secret: true,
        help: "Use environment or Keychain-backed storage later, not localStorage.",
      },
      { key: "BITBUCKET_GIT_USERNAME", label: "Git username", placeholder: "x-token-auth" },
    ],
  },
  {
    id: "bitbucket-discovery",
    title: "Bitbucket discovery",
    variables: [
      { key: "BITBUCKET_WORKSPACE", label: "Workspace", placeholder: "my-workspace" },
      { key: "BITBUCKET_WORKSPACES", label: "Workspaces", placeholder: "workspace-a,workspace-b" },
      { key: "BITBUCKET_DISCOVERY_ROOTS", label: "Discovery roots", placeholder: "~/Projects:/work/repos" },
      { key: "BITBUCKET_INBOX_REPO_LIMIT", label: "Inbox repo limit", type: "number", placeholder: "20" },
      { key: "BITBUCKET_RECENT_REPO_DAYS", label: "Recent repo days", type: "number", placeholder: "7" },
      { key: "BITBUCKET_DEBUG_INBOX", label: "Debug inbox", placeholder: "leave blank" },
    ],
  },
  {
    id: "runtime",
    title: "Runtime",
    variables: [
      { key: "PR_REVIEW_LAB_ROOT", label: "Review lab root", placeholder: "auto-detected" },
    ],
  },
];

const storageKey = "anvil:app-settings:v1";

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") {
    return defaultAppSettings;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultAppSettings;
    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(normalizeAppSettings(settings)));
}

export function resetAppSettings(): AppSettings {
  window.localStorage.removeItem(storageKey);
  return defaultAppSettings;
}

export function resolveTerminalApp(settings: AppSettings): string {
  if (settings.terminalPreference === "custom") {
    return settings.customTerminalApp.trim() || "Terminal";
  }

  return settings.terminalPreference;
}

export function settingsEnv(settings: AppSettings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings.env)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([key, value]) => value.length > 0 && !secretEnvKeys.has(key)),
  );
}

function normalizeAppSettings(input: unknown): AppSettings {
  const value = isRecord(input) ? input : {};
  const reviewSkill = isRecord(value.reviewSkill) ? value.reviewSkill : {};

  return {
    enabledProviders: normalizeEnabledProviders(value.enabledProviders),
    terminalPreference: normalizeTerminalPreference(value.terminalPreference),
    customTerminalApp: stringValue(value.customTerminalApp),
    preferredAgent: value.preferredAgent === "claude" ? "claude" : "codex",
    defaultPromptTemplate: stringValue(value.defaultPromptTemplate) || defaultPromptTemplate,
    reviewSkill: {
      mode: reviewSkill.mode === "custom" ? "custom" : "default",
      customPath: stringValue(reviewSkill.customPath),
    },
    env: normalizeEnv(value.env),
  };
}

function normalizeEnabledProviders(value: unknown): Record<ProviderId, boolean> {
  if (!isRecord(value)) return defaultAppSettings.enabledProviders;

  return {
    github: value.github === false ? false : true,
    bitbucket: value.bitbucket === true,
  };
}

function normalizeTerminalPreference(value: unknown): TerminalPreference {
  if (value === "iTerm" || value === "custom") return value;
  return "Terminal";
}

function normalizeEnv(value: unknown): Record<string, string> {
  const env: Record<string, string> = { ...defaultEnvOverrides };
  if (!isRecord(value)) return env;
  for (const [key, envValue] of Object.entries(value)) {
    if (secretEnvKeys.has(key)) continue;
    env[key] = stringValue(envValue);
  }
  return env;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const secretEnvKeys = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "BITBUCKET_API_TOKEN",
  "BITBUCKET_ACCESS_TOKEN",
  "BITBUCKET_APP_PASSWORD",
]);
