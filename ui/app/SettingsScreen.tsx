import * as React from "react";
import { ArrowLeft, Bot, ChevronDown, Cloud, GitPullRequest, RotateCcw, Save, Settings, Terminal } from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { appName } from "@/app/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { commentTonePresets } from "@/lib/comment-tone";
import {
  defaultAppSettings,
  envSettingGroups,
  type AppSettings,
  type ProviderId,
  type ReviewSkillMode,
  type TerminalPreference,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

type SettingsScreenProps = {
  settings: AppSettings;
  savedAt?: string;
  onBack: () => void;
  onSave: (settings: AppSettings) => void;
  onReset: () => void;
};

const terminalOptions = [
  { value: "Terminal", label: "Terminal" },
  { value: "iTerm", label: "iTerm" },
  { value: "custom", label: "Custom" },
] as const satisfies ReadonlyArray<{ value: TerminalPreference; label: string }>;

const agentOptions = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
] as const;

const reviewSkillOptions = [
  { value: "default", label: "Default" },
  { value: "custom", label: "Custom path" },
] as const satisfies ReadonlyArray<{ value: ReviewSkillMode; label: string }>;

const commentToneOptions = commentTonePresets.map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

const providerOptions = [
  {
    id: "github",
    label: "GitHub",
    description: "Use GitHub pull requests in the review inbox.",
    icon: GitPullRequest,
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    description: "Use pinned repos first, then a small recent-repo fallback to avoid broad workspace scans.",
    icon: Cloud,
  },
] as const satisfies ReadonlyArray<{
  id: ProviderId;
  label: string;
  description: string;
  icon: typeof GitPullRequest;
}>;

export function SettingsScreen({ settings, savedAt, onBack, onSave, onReset }: SettingsScreenProps) {
  const [draft, setDraft] = React.useState(settings);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const setProviderEnabled = (provider: ProviderId, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      enabledProviders: {
        ...current.enabledProviders,
        [provider]: enabled,
      },
    }));
  };

  const setEnvValue = (key: string, value: string) => {
    setDraft((current) => ({
      ...current,
      env: {
        ...current.env,
        [key]: value,
      },
    }));
  };

  return (
    <AppShell
      title="Settings"
      subtitle={appName}
      contentClassName="overflow-auto"
      actions={
        <>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setDraft(defaultAppSettings);
              onReset();
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
          <Button
            type="button"
            className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
            disabled={!dirty}
            onClick={() => onSave(draft)}
            data-testid="save-settings"
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </>
      }
    >
      <section className="mx-auto grid w-full max-w-5xl gap-5 p-5" data-testid="settings-screen">
        <div className="flex items-end justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Configuration</h2>
            <p className="mt-1 text-sm leading-6 text-foreground">
              Keep the common choices here. Override low-level environment settings only when needed.
            </p>
          </div>
          {savedAt ? <Badge>{savedAt}</Badge> : null}
        </div>

        <SettingsPanel eyebrow="Connections" title="Review inbox sources" icon={Settings}>
          {providerOptions.map((provider) => {
            const Icon = provider.icon;
            const enabled = draft.enabledProviders[provider.id];

            return (
              <SettingsRow
                key={provider.id}
                icon={Icon}
                title={provider.label}
                description={provider.description}
                control={
                  <div className="grid min-w-0 gap-3">
                    <ToggleGroup
                      value={enabled ? "enabled" : "paused"}
                      options={[
                        { value: "enabled", label: "Enabled" },
                        { value: "paused", label: "Paused" },
                      ]}
                      onChange={(value) => setProviderEnabled(provider.id, value === "enabled")}
                      data-testid={`provider-${provider.id}`}
                    />
                    {provider.id === "bitbucket" ? (
                      <SettingField label="Pinned repos" hint="BITBUCKET_PINNED_REPOS">
                        <Textarea
                          value={draft.env.BITBUCKET_PINNED_REPOS ?? ""}
                          onChange={(event) => setEnvValue("BITBUCKET_PINNED_REPOS", event.target.value)}
                          placeholder={"workspace/example-service\nworkspace/api"}
                          spellCheck={false}
                          className="min-h-20 font-mono text-xs leading-5"
                          data-testid="bitbucket-pinned-repos"
                        />
                      </SettingField>
                    ) : null}
                  </div>
                }
              />
            );
          })}
        </SettingsPanel>

        <SettingsPanel eyebrow="Handoff" title="Open reviews in an agent CLI" icon={Terminal}>
          <SettingsRow
            icon={Terminal}
            title="Terminal app"
            description="Anvil opens this app directly instead of guessing a macOS default."
            control={
              <div className="grid min-w-0 gap-2">
                <ToggleGroup
                  value={draft.terminalPreference}
                  options={terminalOptions}
                  onChange={(value) => setDraft((current) => ({ ...current, terminalPreference: value }))}
                />
                {draft.terminalPreference === "custom" ? (
                  <Input
                    value={draft.customTerminalApp}
                    onChange={(event) => setDraft((current) => ({ ...current, customTerminalApp: event.target.value }))}
                    placeholder="Ghostty"
                    data-testid="custom-terminal-app"
                  />
                ) : null}
              </div>
            }
          />
          <SettingsRow
            icon={Bot}
            title="Preferred agent"
            description="This controls the default order for Codex or Claude CLI handoff."
            control={
              <ToggleGroup
                value={draft.preferredAgent}
                options={agentOptions}
                onChange={(value) => setDraft((current) => ({ ...current, preferredAgent: value }))}
              />
            }
          />
          <SettingsRow
            icon={Bot}
            title="Comment tone"
            description="Default style for queued PR comment drafts. You can still edit each draft before submitting."
            control={
              <ToggleGroup
                value={draft.commentTonePreset}
                options={commentToneOptions}
                onChange={(value) => setDraft((current) => ({ ...current, commentTonePreset: value }))}
                data-testid="comment-tone-preset"
              />
            }
          />
          <SettingsRow
            icon={Bot}
            title="Review skill"
            description="Use the shipped review skill or point Anvil at your own."
            control={
              <div className="grid min-w-0 gap-2">
                <ToggleGroup
                  value={draft.reviewSkill.mode}
                  options={reviewSkillOptions}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      reviewSkill: { ...current.reviewSkill, mode: value },
                    }))
                  }
                />
                {draft.reviewSkill.mode === "custom" ? (
                  <Input
                    value={draft.reviewSkill.customPath}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reviewSkill: { ...current.reviewSkill, customPath: event.target.value },
                      }))
                    }
                    placeholder="~/.codex/skills/review/SKILL.md"
                    data-testid="custom-review-skill-path"
                  />
                ) : null}
              </div>
            }
          />
        </SettingsPanel>

        <section className="overflow-hidden rounded-lg border bg-card">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent"
            onClick={() => setAdvancedOpen((open) => !open)}
            data-testid="advanced-settings-toggle"
          >
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Advanced</div>
              <h3 className="truncate text-sm font-semibold">Prompt and environment overrides</h3>
            </div>
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
            />
          </button>

          {advancedOpen ? (
            <div className="grid gap-4 border-t p-4" data-testid="advanced-settings">
              <SettingField label="Prompt template">
                <Textarea
                  value={draft.defaultPromptTemplate}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, defaultPromptTemplate: event.target.value }))
                  }
                  spellCheck={false}
                  className="min-h-40 font-mono text-xs leading-5"
                  data-testid="default-prompt-template"
                />
              </SettingField>

              {envSettingGroups.map((group) => (
                <div key={group.id} className="grid gap-3 rounded-md border bg-background p-3">
                  <div>
                    <h4 className="text-sm font-semibold">{group.title}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Overrides the matching environment variables for this app session.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.variables.map((variable) => (
                      <SettingField
                        key={variable.key}
                        label={variable.label}
                        htmlFor={`env-${variable.key}`}
                        hint={variable.key}
                      >
                        {variable.secret ? (
                          <div
                            className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground"
                            data-testid={`env-${variable.key}`}
                          >
                            {variable.help ?? "Set this secret outside the app."}
                          </div>
                        ) : (
                          <Input
                            id={`env-${variable.key}`}
                            value={draft.env[variable.key] ?? ""}
                            onChange={(event) => setEnvValue(variable.key, event.target.value)}
                            type={variable.type ?? "text"}
                            inputMode={variable.type === "number" ? "numeric" : undefined}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={variable.placeholder}
                            data-testid={`env-${variable.key}`}
                          />
                        )}
                      </SettingField>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </AppShell>
  );
}

function SettingsPanel({
  eyebrow,
  title,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: typeof Settings;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  control,
}: {
  icon: typeof Settings;
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] md:items-center">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{control}</div>
    </div>
  );
}

function SettingField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <span className="truncate font-mono text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function ToggleGroup<TValue extends string>({
  value,
  options,
  onChange,
  "data-testid": dataTestId,
}: {
  value: TValue;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
  "data-testid"?: string;
}) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-1 rounded-md border bg-background p-0.5"
      data-testid={dataTestId}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "h-8 rounded px-2 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
