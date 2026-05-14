import React from "react";
import ReactDOM from "react-dom/client";
import {
  CheckCircle2,
  FileCode2,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-react";
import {
  LauncherScreen,
  type ReviewInboxFilter,
  type ReviewInboxPullRequest,
  type ReviewInboxSourceFilter,
  type ReviewSourceId,
} from "@/app/LauncherScreen";
import { PreparingScreen, type PrepareState } from "@/app/PreparingScreen";
import { ReviewWorkspaceScreen } from "@/app/ReviewWorkspaceScreen";
import { SettingsScreen } from "@/app/SettingsScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueuedCommentTray } from "@/components/review/queued-comment-tray";
import { ReviewCompletePanel } from "@/components/review/review-complete-panel";
import { ReviewQueue } from "@/components/review/review-queue";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listReviewInbox,
  cancelReviewSession,
  configureAppSettings,
  openReviewAgent,
  startReviewSession,
  subscribeReviewSession,
  submitReviewSession,
  type ReviewAgent,
  type ReviewSessionEvent,
  type ReviewSessionReadyData,
  type ReviewInboxRow,
  type StartReviewSessionRequest,
} from "@/lib/api";
import { highlightTypeScriptLines, type HighlightToken } from "@/lib/syntax-highlight";
import { cn } from "@/lib/utils";
import { filterActionableQuestions } from "@/lib/review-questions";
import {
  type CommentDecision,
  type ReviewProgressComment,
  type ReviewProgressSlice,
  useReviewProgress,
} from "@/lib/review-progress";
import type { Hunk, ReviewPlan, Slice } from "@/lib/review-types";
import {
  defaultAppSettings,
  loadAppSettings,
  resetAppSettings,
  resolveTerminalApp,
  saveAppSettings,
  settingsEnv,
  type AppSettings,
} from "@/lib/settings";
import "./styles.css";

const emptyReviewPlan: ReviewPlan = {
  pr: {
    repo: "",
    number: 0,
    title: "No review loaded",
  },
  completion: {
    status: "needs-human",
    reviewedFiles: 0,
    totalFiles: 0,
    reviewedHunks: 0,
    totalHunks: 0,
    blockingComments: 0,
    openQuestions: 0,
  },
  slices: [
    {
      id: "empty",
      title: "No review loaded",
      risk: "low",
      status: "needs-human",
      deferred: false,
      deferReason: "",
      why: "Choose a pull request to start a review.",
      files: [],
      filesReviewed: [],
      hunks: [],
      inlineComments: [],
      remainingQuestions: [],
      evidence: [],
    },
  ],
};

type PendingPrepareRequest = Omit<StartReviewSessionRequest, "sessionId"> & {
  title?: string;
};

type AppStage = "launcher" | "preparing" | "review" | "settings";
type LoadingState = "idle" | "loading" | "ready" | "error";
type SubmitState = {
  status: "idle" | "submitting" | "submitted" | "error";
  error?: string;
  receiptId?: string;
};
type AgentLaunchState = {
  status: "idle" | "launching" | "launched" | "error";
  agent?: ReviewAgent;
  error?: string;
  worktree?: string;
};

type AppErrorBoundaryState = {
  error?: Error;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="grid h-screen place-items-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-lg border-destructive/25 bg-card shadow-none">
          <CardHeader className="px-5 py-4">
            <h1 className="text-lg font-semibold">The review inbox stopped rendering</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The desktop shell is still running. Reload the app after the current fix lands.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 pt-0">
            <pre className="max-h-44 overflow-auto rounded-md border bg-background p-3 text-xs text-destructive">
              {this.state.error.message}
            </pre>
            <Button
              type="button"
              className="w-fit bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Reload app
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }
}

function App() {
  const [reviewPlan, setReviewPlan] = React.useState<ReviewPlan>(emptyReviewPlan);
  const progress = useReviewProgress(reviewPlan, {
    storageKey: `review-progress:${reviewPlan.pr.repo}:${reviewPlan.pr.number}`,
  });
  const [stage, setStage] = React.useState<AppStage>("launcher");
  const [settingsReturnStage, setSettingsReturnStage] = React.useState<AppStage>("launcher");
  const [appSettings, setAppSettings] = React.useState<AppSettings>(defaultAppSettings);
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = React.useState<string | undefined>();
  const [selectedSource, setSelectedSource] = React.useState<ReviewSourceId>("github");
  const [selectedRepo, setSelectedRepo] = React.useState("");
  const [selectedPullRequest, setSelectedPullRequest] = React.useState("");
  const [reviewInboxRows, setReviewInboxRows] = React.useState<ReviewInboxPullRequest[]>([]);
  const [reviewInboxFilter, setReviewInboxFilter] = React.useState<ReviewInboxFilter>("allOpen");
  const [reviewInboxSourceFilter, setReviewInboxSourceFilter] = React.useState<ReviewInboxSourceFilter>("all");
  const [reviewInboxSearch, setReviewInboxSearch] = React.useState("");
  const [reviewInboxState, setReviewInboxState] = React.useState<LoadingState>("idle");
  const [reviewInboxRefreshId, setReviewInboxRefreshId] = React.useState(0);
  const [launcherError, setLauncherError] = React.useState<string | undefined>();
  const [prepareState, setPrepareState] = React.useState<PrepareState>(() => createPrepareState("idle"));
  const [prepareRunId, setPrepareRunId] = React.useState(0);
  const [prepareRequest, setPrepareRequest] = React.useState<PendingPrepareRequest | undefined>();
  const [pendingSliceIds, setPendingSliceIds] = React.useState<Set<string>>(() => new Set());
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>();
  const [activeId, setActiveId] = React.useState(reviewPlan.slices[0]?.id);
  const [selectedCommentId, setSelectedCommentId] = React.useState<string | undefined>();
  const [submitState, setSubmitState] = React.useState<SubmitState>({ status: "idle" });
  const [agentLaunchState, setAgentLaunchState] = React.useState<AgentLaunchState>({ status: "idle" });
  const returnToLauncherTimer = React.useRef<number | undefined>(undefined);
  const reviewWorktree = React.useMemo(
    () => prepareState.artifacts?.worktree ?? findLatestReviewWorktree(prepareState.events),
    [prepareState.artifacts?.worktree, prepareState.events],
  );
  const active = progress.slices.find((slice) => slice.id === activeId) ?? progress.slices[0];
  const openComments = React.useMemo(
    () => active.comments.filter((comment) => comment.decision === "open"),
    [active.comments],
  );
  const currentComment = openComments.find((comment) => comment.id === selectedCommentId) ?? openComments[0];
  const commentsByHunk = React.useMemo(() => groupComments(openComments), [openComments]);
  const activeIndex = progress.slices.findIndex((slice) => slice.id === active.id);
  const activePending = pendingSliceIds.has(active.id);
  const highRiskPendingCount = progress.slices.filter(
    (slice) => slice.risk === "high" && pendingSliceIds.has(slice.id),
  ).length;
  const deferredSlices = progress.slices.filter((slice) => slice.deferred);
  const acknowledgedDeferredCount = deferredSlices.filter((slice) => slice.reviewed).length;
  const reviewComplete = pendingSliceIds.size === 0 && progress.counts.openComments === 0 && progress.counts.unreviewedSlices === 0;
  const selectedInboxRow =
    reviewInboxRows.find((row) => row.id === selectedPullRequest) ?? reviewInboxRows[0];
  const effectiveSelectedPullRequest = prepareRequest?.pullRequest ?? getReviewPullRequestNumber(selectedInboxRow) ?? "";
  const effectiveSelectedRepo = prepareRequest?.repo ?? selectedInboxRow?.repo ?? selectedRepo;
  const effectiveSelectedSource = normalizeReviewSource(prepareRequest?.source) ?? normalizeReviewSource(selectedInboxRow?.source) ?? selectedSource;
  const launcherLoading = reviewInboxState === "loading" && reviewInboxRows.length === 0;
  const launcherRefreshing = reviewInboxState === "loading" && reviewInboxRows.length > 0;
  const openSettings = React.useCallback(() => {
    setSettingsReturnStage((current) => (stage === "settings" ? current : stage));
    setStage("settings");
  }, [stage]);
  const returnToLauncherAfterSubmit = React.useCallback(() => {
    if (returnToLauncherTimer.current) {
      window.clearTimeout(returnToLauncherTimer.current);
    }

    returnToLauncherTimer.current = window.setTimeout(() => {
      progress.clearProgress();
      setActiveSessionId(undefined);
      setPrepareRequest(undefined);
      setSelectedCommentId(undefined);
      setSubmitState({ status: "idle" });
      setStage("launcher");
      setReviewInboxRefreshId((id) => id + 1);
      returnToLauncherTimer.current = undefined;
    }, 1200);
  }, [progress]);
  const handleSaveSettings = React.useCallback((nextSettings: AppSettings) => {
    const normalizedEnv = settingsEnv(nextSettings);
    const settingsToSave = {
      ...nextSettings,
      env: normalizedEnv,
    };

    setSettingsSavedAt("Saving");
    saveAppSettings(settingsToSave)
      .then((savedSettings) => configureAppSettings({ env: settingsEnv(savedSettings) }).then(() => savedSettings))
      .then((savedSettings) => {
        setAppSettings(savedSettings);
        setSettingsSavedAt("Saved");
      })
      .catch((error: Error) => {
        setSettingsSavedAt(formatUnknownError(error));
      });
  }, []);
  const handleResetSettings = React.useCallback(() => {
    setSettingsSavedAt("Resetting");
    resetAppSettings()
      .then((nextSettings) => configureAppSettings({ env: {} }).then(() => nextSettings))
      .then((nextSettings) => {
        setAppSettings(nextSettings);
        setSettingsSavedAt("Reset");
      })
      .catch((error: Error) => {
        setSettingsSavedAt(formatUnknownError(error));
      });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    loadAppSettings()
      .then((loadedSettings) => {
        if (!cancelled) {
          setAppSettings(loadedSettings);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setSettingsSavedAt(formatUnknownError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const providers = (["github", "bitbucket"] as const).filter((provider) => appSettings.enabledProviders[provider]);
    let pendingProviders = providers.length;
    const providerErrors: Array<{ provider?: string; message?: string }> = [];

    setReviewInboxState("loading");
    setLauncherError(undefined);
    setReviewInboxRows([]);
    setSelectedPullRequest("");
    setPrepareRequest(undefined);

    const finishProvider = () => {
      pendingProviders -= 1;
      if (pendingProviders <= 0 && !cancelled) {
        setReviewInboxState("ready");
        setLauncherError(formatInboxErrors(providerErrors));
      }
    };

    configureAppSettings({ env: settingsEnv(appSettings) })
      .catch((error: Error) => {
        if (!cancelled) {
          providerErrors.push({ provider: "Settings", message: formatUnknownError(error) });
        }
      })
      .finally(() => {
        if (cancelled) return;
        if (providers.length === 0) {
          setReviewInboxState("ready");
          setLauncherError(undefined);
          return;
        }

        for (const provider of providers) {
          withTimeout(
            listReviewInbox({
              providers: [provider],
              limit: 100,
            }),
            providerTimeoutMs(provider),
            `${sourceLabel(provider)} PR loading timed out after ${providerTimeoutMs(provider) / 1000}s.`,
          )
            .then((result) => {
              if (cancelled) return;
              const rows = result.rows.map(reviewInboxRowToPullRequest);
              providerErrors.push(...result.errors);
              setReviewInboxRows((current) => {
                const next = mergeReviewInboxRows(current, rows);
                setSelectedPullRequest((selected) =>
                  next.some((row) => row.id === selected) ? selected : next[0]?.id ?? "",
                );
                return next;
              });
            })
            .catch((error: Error) => {
              if (!cancelled) {
                providerErrors.push({ provider: sourceLabel(provider), message: formatUnknownError(error) });
              }
            })
            .finally(finishProvider);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appSettings, reviewInboxRefreshId, settingsLoaded]);

  React.useEffect(() => {
    if (prepareRunId === 0) {
      return;
    }

    let cancelled = false;
    let completed = false;
    let openedReview = false;
    let subscription: { unsubscribe: () => void } | undefined;
    const sessionId = createReviewSessionId();
    if (!prepareRequest) {
      return;
    }

    const request: StartReviewSessionRequest = {
      sessionId,
      source: prepareRequest.source,
      repo: prepareRequest.repo,
      pullRequest: prepareRequest.pullRequest,
    };

    const appendEvent = (event: ReviewSessionEvent) => {
      setPrepareState((current) => ({
        ...current,
        events: [...current.events, event],
      }));
    };
    const enterReview = (data: ReviewSessionReadyData, sessionId?: string) => {
      if (cancelled) return;
      completed = true;
      setPendingSliceIds(new Set());
      setReviewPlan(normalizeReviewPlan(data.plan));
      if (!openedReview) {
        progress.clearProgress();
      }
      setSubmitState({ status: "idle" });
      setSelectedCommentId(undefined);
      setActiveId(data.plan.slices[0]?.id);
      setActiveSessionId(sessionId);
      setPrepareState((current) => ({
        ...current,
        status: "ready",
        artifacts: data.artifacts,
      }));
      setStage("review");
    };

    setPrepareState({
      ...createPrepareState("loading"),
      sessionId,
      events: [
        createReviewSessionEvent("session.created", `Created review session ${sessionId}.`),
        createReviewSessionEvent("session.subscribing", "Subscribing to Tauri review events."),
      ],
    });
    setActiveSessionId(sessionId);

    subscribeReviewSession(sessionId, {
      onEvent: (event) => {
        if (cancelled) return;
        appendEvent(event);

        const readySlice = getReadySlice(event.data);
        if (event.type === "slice.ready" && readySlice) {
          setPendingSliceIds((current) => {
            const next = new Set(current);
            next.delete(readySlice.id);
            return next;
          });
          setReviewPlan((current) =>
          mergeStreamingSlice(
              current,
              normalizeSlice(readySlice),
              prepareRequest,
              getTotalSlices(event.data),
              !openedReview,
            ),
          );

          if (!openedReview) {
            openedReview = true;
            progress.clearProgress();
            setSubmitState({ status: "idle" });
            setSelectedCommentId(undefined);
            setActiveId(readySlice.id);
            setStage("review");
          }
        }

        const plannedSlices = getPlannedSlices(event.data);
        if (event.type === "planner.ready" && plannedSlices.length > 0 && !openedReview) {
          const orderedPlannedSlices = orderPlannedSlices(plannedSlices);
          openedReview = true;
          setReviewPlan((current) => createPlannedReviewPlan(current, orderedPlannedSlices, prepareRequest));
          setPendingSliceIds(new Set(orderedPlannedSlices.map((slice) => slice.id)));
          progress.clearProgress();
          setSubmitState({ status: "idle" });
          setSelectedCommentId(undefined);
          setActiveId(orderedPlannedSlices[0].id);
          setStage("review");
        }

        const readyData =
          isReviewSessionReadyData(event.data) ? event.data :
          isReviewSessionReadyData(event) ? event :
          undefined;

        if ((event.type === "review.ready" || event.type === "session.completed") && readyData) {
          enterReview(readyData, sessionId);
        }

        if (event.type === "review.failed" || event.type === "session.failed") {
          completed = true;
          setPrepareState((current) => ({
            ...current,
            status: "error",
            error: event.message || "Review session failed.",
          }));
        }
      },
      onError: (error) => {
        if (cancelled || completed) return;
        completed = true;
        appendEvent(createReviewSessionEvent("session.listen_failed", error.message));
        setPrepareState((current) => ({ ...current, status: "error", error: error.message }));
      },
    })
      .then((nextSubscription) => {
        if (cancelled) {
          nextSubscription.unsubscribe();
          return;
        }
        subscription = nextSubscription;
        appendEvent(createReviewSessionEvent("session.invoke", "Starting Tauri review runtime."));
        return startReviewSession(request);
      })
      .then((result) => {
        if (cancelled || !result) return;
        appendEvent(createReviewSessionEvent("session.started", `Review session ${result.sessionId} started.`));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = formatUnknownError(error);
        completed = true;
        appendEvent(createReviewSessionEvent("review.failed", message, { error }));
        setPrepareState((current) => ({ ...current, status: "error", error: message }));
      });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [prepareRequest, prepareRunId, progress.clearProgress]);

  React.useEffect(() => {
    return () => {
      if (returnToLauncherTimer.current) {
        window.clearTimeout(returnToLauncherTimer.current);
      }
    };
  }, []);

  React.useEffect(() => {
    setSelectedCommentId(undefined);
  }, [active.id]);

  React.useEffect(() => {
    if (selectedCommentId && !openComments.some((comment) => comment.id === selectedCommentId)) {
      setSelectedCommentId(undefined);
    }
  }, [openComments, selectedCommentId]);

  const markActiveReviewed = React.useCallback(() => {
    const reviewedIds = new Set(progress.state.reviewedSliceIds);
    reviewedIds.add(active.id);

    progress.setSliceReviewed(active.id, true);
    const nextSlice = findNextReviewSlice(progress.slices, active.id, reviewedIds);

    if (nextSlice) {
      setActiveId(nextSlice.id);
    }
  }, [active.id, progress]);

  const handleCommentDecision = React.useCallback(
    (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => {
      const reviewedIds = new Set(progress.state.reviewedSliceIds);
      const remainingOpenComments = active.comments.filter(
        (candidate) => candidate.id !== comment.id && candidate.decision === "open",
      ).length;
      const finishedSlice = remainingOpenComments === 0 && filterActionableQuestions(active.remainingQuestions).length === 0;

      progress.setCommentDecision(comment.id, decision);
      setSelectedCommentId(undefined);

      if (!finishedSlice) {
        return;
      }

      reviewedIds.add(active.id);
      progress.setSliceReviewed(active.id, true);

      const nextSlice = findNextReviewSlice(progress.slices, active.id, reviewedIds);
      if (nextSlice) {
        setActiveId(nextSlice.id);
      }
    },
    [active.comments, active.id, active.remainingQuestions, progress],
  );

  const handleOpenAgent = React.useCallback(
    (agent: ReviewAgent) => {
      const worktree = reviewWorktree;
      if (!worktree) {
        setAgentLaunchState({
          status: "error",
          agent,
          error: "No prepared review worktree is available yet.",
        });
        return;
      }

      setAgentLaunchState({ status: "launching", agent, worktree });
      openReviewAgent({
        agent,
        worktree,
        repo: reviewPlan.pr.repo,
        pullRequest: reviewPlan.pr.number,
        title: reviewPlan.pr.title,
        slice: active,
        terminalApp: resolveTerminalApp(appSettings),
        promptTemplate: appSettings.defaultPromptTemplate,
        reviewSkillPath: appSettings.reviewSkill.mode === "custom" ? appSettings.reviewSkill.customPath : undefined,
      })
        .then((result) => {
          setAgentLaunchState({
            status: "launched",
            agent: result.agent,
            worktree: result.worktree,
          });
        })
        .catch((error: Error) => {
          setAgentLaunchState({
            status: "error",
            agent,
            worktree,
            error: error.message,
          });
        });
    },
    [active, appSettings, reviewPlan.pr.number, reviewPlan.pr.repo, reviewPlan.pr.title, reviewWorktree],
  );

  if (stage === "settings") {
    return (
      <SettingsScreen
        settings={appSettings}
        savedAt={settingsSavedAt}
        onBack={() => setStage(settingsReturnStage === "settings" ? "launcher" : settingsReturnStage)}
        onSave={handleSaveSettings}
        onReset={handleResetSettings}
      />
    );
  }

  if (stage === "launcher") {
    return (
      <LauncherScreen
        pullRequests={reviewInboxRows}
        selectedRowId={selectedPullRequest}
        activeFilter={reviewInboxFilter}
        sourceFilter={reviewInboxSourceFilter}
        searchQuery={reviewInboxSearch}
        loading={launcherLoading}
        refreshing={launcherRefreshing}
        error={launcherError}
        onSelectRow={(_, pullRequest) => {
          setSelectedPullRequest(pullRequest.id);
          setSelectedRepo(pullRequest.repo);
          setSelectedSource(normalizeReviewSource(pullRequest.source) ?? selectedSource);
        }}
        onActiveFilterChange={(filter) => {
          setReviewInboxFilter(filter);
          setSelectedPullRequest("");
        }}
        onSourceFilterChange={(source) => {
          setReviewInboxSourceFilter(source);
          setSelectedPullRequest("");
          if (source !== "all") {
            setSelectedSource(source);
          }
        }}
        onSearchQueryChange={setReviewInboxSearch}
        onRefresh={() => setReviewInboxRefreshId((id) => id + 1)}
        onOpenSettings={openSettings}
        onPrepare={(pullRequest) => {
          const target = pullRequest ?? selectedInboxRow;
          if (!target) return;
          const source = normalizeReviewSource(target.source) ?? selectedSource;
          const repo = target.repo;
          const pullRequestNumber = getReviewPullRequestNumber(target);
          if (!repo || !pullRequestNumber) return;

          setSelectedPullRequest(target.id);
          setSelectedRepo(repo);
          setSelectedSource(source);
          setPrepareRequest({
            source,
            repo,
            pullRequest: pullRequestNumber,
            title: target.title,
          });
          setActiveSessionId(undefined);
          setPendingSliceIds(new Set());
          setSubmitState({ status: "idle" });
          setPrepareState(createPrepareState("idle"));
          setStage("preparing");
          setPrepareRunId((id) => id + 1);
        }}
      />
    );
  }

  if (stage === "preparing") {
    return (
      <PreparingScreen
        state={prepareState}
        repo={effectiveSelectedRepo}
        pullRequest={effectiveSelectedPullRequest}
        onCancel={() => {
          const sessionId = prepareState.sessionId;
          setPrepareState((current) => ({ ...current, canceling: Boolean(sessionId) }));

          if (!sessionId) {
            setPrepareRequest(undefined);
            setStage("launcher");
            return;
          }

          cancelReviewSession(sessionId)
            .catch((error: Error) => {
              setPrepareState((current) => ({
                ...current,
                events: [...current.events, createReviewSessionEvent("session.cancel_failed", error.message)],
              }));
            })
            .finally(() => {
              setActiveSessionId(undefined);
              setPrepareRequest(undefined);
              setStage("launcher");
            });
        }}
      />
    );
  }

  return (
    <ReviewWorkspaceScreen
      repo={reviewPlan.pr.repo}
      pullRequest={reviewPlan.pr.number}
      title={reviewPlan.pr.title}
      onExitReview={() => {
        setPrepareRequest(undefined);
        setStage("launcher");
      }}
      onOpenSettings={openSettings}
      queue={
        <ScrollArea className="border-r">
          <ReviewQueue
            slices={progress.slices}
            activeId={active.id}
            pendingSliceIds={pendingSliceIds}
            onSelect={setActiveId}
          />
        </ScrollArea>
      }
      content={
        <ScrollArea>
          <section className={cn("p-5", reviewComplete && "grid min-h-full place-items-center")}>
            {reviewComplete ? (
              <div className="grid w-full max-w-3xl gap-3">
                <ReviewCompletePanel
                  queuedCount={progress.queuedComments.length}
                  dismissedCount={progress.counts.dismissedComments}
                  fixedCount={progress.counts.resolvedComments}
                  unresolvedQuestionCount={countOpenQuestions(progress.slices)}
                  deferredCount={deferredSlices.length}
                  acknowledgedDeferredCount={acknowledgedDeferredCount}
                  highRiskPendingCount={highRiskPendingCount}
                  submitLabel={
                    submitState.status === "submitting"
                      ? "Submitting..."
                      : submitState.status === "submitted"
                        ? "Review submitted"
                        : progress.queuedComments.length > 0
                          ? `Submit ${progress.queuedComments.length} ${progress.queuedComments.length === 1 ? "comment" : "comments"}`
                          : "Approve PR"
                  }
                  submitDisabled={
                    submitState.status === "submitted" ||
                    submitState.status === "submitting" ||
                    highRiskPendingCount > 0
                  }
                  sections={[
                    {
                      title: "Ready to post",
                      items: progress.queuedComments.map((comment) => `${comment.file}:${comment.line}`),
                      emptyMessage: "No PR comments queued.",
                    },
                    {
                      title: "Handled locally",
                      items: progress.comments
                        .filter((comment) => comment.decision === "dismissed" || comment.decision === "resolved")
                        .map((comment) => `${comment.decision}: ${comment.file}:${comment.line}`),
                      emptyMessage: "No dismissed or fixed findings.",
                    },
                    {
                      title: "Deferred acknowledged",
                      items: deferredSlices
                        .filter((slice) => slice.reviewed)
                        .map((slice) => `${slice.title}: ${slice.deferReason || "Needs later review."}`),
                      emptyMessage: "No deferred slices.",
                    },
                  ]}
                  onSubmitReview={() => {
                    if (!activeSessionId) {
                      setSubmitState({ status: "error", error: "No active review session is available to submit." });
                      return;
                    }

                    setSubmitState({ status: "submitting" });
                    submitReviewSession({
                      sessionId: activeSessionId,
                      source: effectiveSelectedSource,
                      repo: reviewPlan.pr.repo,
                      pullRequest: String(reviewPlan.pr.number),
                      action: progress.queuedComments.length > 0 ? "comment" : "approve",
                      comments: progress.queuedComments,
                    })
                      .then((receipt) => {
                        setSubmitState({
                          status: "submitted",
                          receiptId:
                            typeof receipt.receiptId === "string"
                              ? receipt.receiptId
                              : typeof receipt.id === "string"
                                ? receipt.id
                                : undefined,
                        });
                        returnToLauncherAfterSubmit();
                      })
                      .catch((error: unknown) => {
                        setSubmitState({ status: "error", error: formatUnknownError(error) });
                      });
                  }}
                />
                {submitState.status === "error" ? (
                  <div className="whitespace-pre-wrap rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">
                    {submitState.error || "Review submission failed, but the provider did not return an error message."}
                  </div>
                ) : null}
                {submitState.receiptId ? (
                  <div className="justify-self-center rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                    Receipt: {submitState.receiptId}
                  </div>
                ) : null}
                <Button
                  type="button"
                  className="h-7 w-fit justify-self-center border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    progress.clearProgress();
                    setSubmitState({ status: "idle" });
                    setSelectedCommentId(undefined);
                    setActiveId(reviewPlan.slices[0]?.id);
                  }}
                >
                  Clear review
                </Button>
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 -mx-5 mb-4 flex items-start justify-between gap-4 border-b bg-background/95 px-5 pb-4 backdrop-blur">
                  <div className="min-w-0">
                    <div className="mb-1 text-xs text-muted-foreground">Slice {activeIndex + 1} of {progress.slices.length}</div>
                    <h2 className="max-w-3xl text-2xl font-semibold leading-tight">{active.title}</h2>
                  </div>
                </div>

                <div className="grid gap-4">
                  {activePending ? (
                    <PendingSlicePanel slice={active} event={prepareState.events[prepareState.events.length - 1]} />
                  ) : active.deferred ? (
                    <DeferredSlicePanel slice={active} />
                  ) : (
                    <>
                      {!currentComment ? <SliceReviewContext slice={active} /> : null}
                      {groupHunksByFile(active.hunks, commentsByHunk).map((fileGroup, fileIndex) => (
                        <FileDiffGroup
                          key={`${active.id}:${fileGroup.file}`}
                          group={fileGroup}
                          defaultOpen={fileGroup.commentCount > 0 || (openComments.length === 0 && fileIndex === 0)}
                          commentsByHunk={commentsByHunk}
                          selectedCommentId={currentComment?.id}
                          onSelectComment={setSelectedCommentId}
                        />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </ScrollArea>
      }
      rail={
        <ScrollArea className="border-l bg-background">
          <aside className="grid min-w-0 gap-3 p-3">
            {!reviewComplete && !activePending ? (
              <DecisionRail
                slice={active}
                comment={currentComment}
                openComments={openComments}
                selectedCommentId={currentComment?.id}
                onSelectComment={setSelectedCommentId}
                onMarkReviewed={markActiveReviewed}
                onSetCommentDraft={progress.setCommentDraft}
                onSetCommentDecision={handleCommentDecision}
              />
            ) : activePending ? (
              <PendingDecisionRail event={prepareState.events[prepareState.events.length - 1]} />
            ) : null}

            <QueuedCommentTray
              comments={progress.queuedComments}
              onEdit={(comment) => {
                setActiveId(comment.sliceId);
                setSelectedCommentId(comment.id);
                progress.setSliceReviewed(comment.sliceId, false);
                progress.setCommentDecision(comment.id, "open");
              }}
              onRemove={(comment) => {
                progress.resetCommentDecision(comment.id);
                progress.setSliceReviewed(comment.sliceId, false);
                setActiveId(comment.sliceId);
                setSelectedCommentId(comment.id);
              }}
            />

            <AgentHandoffPanel
              worktree={reviewWorktree}
              state={agentLaunchState}
              settings={appSettings}
              onOpenAgent={handleOpenAgent}
            />
          </aside>
        </ScrollArea>
      }
    />
  );
}

function AgentHandoffPanel({
  worktree,
  state,
  settings,
  onOpenAgent,
}: {
  worktree?: string;
  state: AgentLaunchState;
  settings: AppSettings;
  onOpenAgent: (agent: ReviewAgent) => void;
}) {
  const disabled = !worktree || state.status === "launching";
  const terminalApp = resolveTerminalApp(settings);
  const agents = settings.preferredAgent === "claude" ? ["claude", "codex"] as const : ["codex", "claude"] as const;
  const statusText =
    state.status === "launching"
      ? `Opening ${labelAgent(state.agent)}...`
    : state.status === "launched"
        ? `${labelAgent(state.agent)} opened in ${terminalApp}.`
        : state.status === "error"
          ? state.error
          : worktree
            ? `${terminalApp} · ${labelAgent(settings.preferredAgent)} preferred`
            : "Waiting for checkout...";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open with</div>
          <h3 className="truncate text-sm font-semibold">Agent terminal</h3>
        </div>
        <Terminal className="size-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent className="grid gap-2 p-3">
        <p className={cn("truncate text-xs text-muted-foreground", state.status === "error" && "text-destructive")}>
          {statusText}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {agents.map((agent) => (
            <Button
              key={agent}
              type="button"
              className={cn(
                "h-8 border-border px-2 text-xs hover:bg-accent",
                agent === settings.preferredAgent ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background",
              )}
              disabled={disabled}
              onClick={() => onOpenAgent(agent)}
            >
              {state.status === "launching" && state.agent === agent ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Terminal className="size-3.5" />
              )}
              {labelAgent(agent)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function labelAgent(agent?: ReviewAgent) {
  return agent === "claude" ? "Claude" : "Codex";
}

function reviewInboxRowToPullRequest(row: ReviewInboxRow): ReviewInboxPullRequest {
  const needsReview = Boolean(row.needsReview);
  const isCreatedByMe = Boolean(row.isCreatedByMe);
  const isAssignedToMe = Boolean(row.isAssignedToMe);

  return {
    id: reviewInboxRowKey(row),
    pullRequestId: row.id,
    number: row.number ?? row.id,
    title: row.title,
    repo: row.repoId,
    repoId: row.repoId,
    repoName: row.repoName,
    provider: row.provider,
    source: row.source,
    author: row.author,
    age: row.age,
    files: row.files,
    status: row.status,
    url: row.url,
    headRefName: row.headRefName,
    baseRefName: row.baseRefName,
    reviewStatus: needsReview
      ? "needsReview"
      : isCreatedByMe
        ? "createdByMe"
        : isAssignedToMe
          ? "assignedToMe"
          : undefined,
    needsReview,
    isCreatedByMe,
    isAssignedToMe,
  };
}

function reviewInboxRowKey(row: ReviewInboxRow): string {
  return [row.source, row.repoId, row.number ?? row.id].join(":");
}

function getReviewPullRequestNumber(row: ReviewInboxPullRequest | undefined): string | undefined {
  if (!row) return undefined;
  return String(row.number ?? row.pullRequestId ?? row.id);
}

function normalizeReviewSource(source: unknown): ReviewSourceId | undefined {
  const value = String(source ?? "").toLowerCase();
  if (value.includes("bitbucket")) return "bitbucket";
  if (value.includes("github")) return "github";
  return undefined;
}

function formatInboxErrors(errors: Array<{ provider?: string; message?: string }> | undefined): string | undefined {
  const messages = (errors ?? [])
    .map((error) => [error.provider, error.message].filter(Boolean).join(": "))
    .filter(Boolean);

  return messages.length > 0 ? messages.join(" ") : undefined;
}

function mergeReviewInboxRows(
  current: ReviewInboxPullRequest[],
  nextRows: ReviewInboxPullRequest[],
): ReviewInboxPullRequest[] {
  const rowsById = new Map<string, ReviewInboxPullRequest>();
  for (const row of [...current, ...nextRows]) {
    rowsById.set(row.id, row);
  }

  return Array.from(rowsById.values());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

function sourceLabel(provider: string): string {
  return provider === "bitbucket" ? "Bitbucket" : provider === "github" ? "GitHub" : provider;
}

function providerTimeoutMs(provider: string): number {
  return provider === "github" ? 25_000 : 15_000;
}

function PendingSlicePanel({ slice, event }: { slice: ReviewProgressSlice; event?: ReviewSessionEvent }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-4 animate-spin" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Analyzing this slice</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {event?.message ?? "The agent is reviewing the code for this slice."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {slice.files.map((file) => (
          <div key={file} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeferredSlicePanel({ slice }: { slice: ReviewProgressSlice }) {
  return (
    <div className="rounded-lg border border-anvil-attention/30 bg-anvil-attention/10 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-anvil-attention/15 text-anvil-attention">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Deferred for later review</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {slice.deferReason || "Low-value slice deferred while higher-risk code is reviewed first."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {slice.files.map((file) => (
          <div key={file} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingDecisionRail({ event }: { event?: ReviewSessionEvent }) {
  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      <CardHeader className="px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Current status
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-3">
        <div className="flex items-center gap-3 rounded-md border bg-background px-3 py-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-sm">Reviewing slice</span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {event?.message ?? "A focused reviewer is inspecting this slice. Decisions appear here when findings are ready."}
        </p>
      </CardContent>
    </Card>
  );
}

function createPrepareState(status: LoadingState): PrepareState {
  return {
    status,
    events: [],
    canceling: false,
  };
}

function createReviewSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `review-${crypto.randomUUID()}`;
  }

  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createReviewSessionEvent(
  type: string,
  message: string,
  data?: unknown,
): ReviewSessionEvent {
  return {
    type,
    message,
    at: new Date().toISOString(),
    data,
  };
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    // Fall through to the generic message.
  }

  return "The Tauri review runtime failed before returning an error message.";
}

function normalizeReviewPlan(input: ReviewPlan): ReviewPlan {
  return {
    ...input,
    slices: orderReviewSlices(input.slices.map(normalizeSlice)),
  };
}

function normalizeSlice(slice: Slice): Slice {
  return {
    ...slice,
    deferred: Boolean(slice.deferred),
    deferReason: typeof slice.deferReason === "string" ? slice.deferReason : "",
    remainingQuestions: filterActionableQuestions(slice.remainingQuestions),
  };
}

function getReadySlice(data: unknown): Slice | undefined {
  if (typeof data !== "object" || data === null || !("slice" in data)) {
    return undefined;
  }

  const slice = (data as { slice?: unknown }).slice;
  if (
    typeof slice === "object" &&
    slice !== null &&
    "id" in slice &&
    "hunks" in slice &&
    Array.isArray((slice as { hunks?: unknown }).hunks)
  ) {
    return slice as Slice;
  }

  return undefined;
}

function getTotalSlices(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null || !("totalSlices" in data)) {
    return undefined;
  }

  const totalSlices = (data as { totalSlices?: unknown }).totalSlices;
  return typeof totalSlices === "number" ? totalSlices : undefined;
}

type PlannedSlice = Pick<Slice, "id" | "title" | "risk" | "why" | "files">;

function getPlannedSlices(data: unknown): PlannedSlice[] {
  if (typeof data !== "object" || data === null || !("plannedSlices" in data)) {
    return [];
  }

  const plannedSlices = (data as { plannedSlices?: unknown }).plannedSlices;
  if (!Array.isArray(plannedSlices)) {
    return [];
  }

  return plannedSlices.filter((slice): slice is PlannedSlice => {
    return (
      typeof slice === "object" &&
      slice !== null &&
      typeof (slice as { id?: unknown }).id === "string" &&
      typeof (slice as { title?: unknown }).title === "string" &&
      ((slice as { risk?: unknown }).risk === "high" ||
        (slice as { risk?: unknown }).risk === "medium" ||
        (slice as { risk?: unknown }).risk === "low") &&
      typeof (slice as { why?: unknown }).why === "string" &&
      Array.isArray((slice as { files?: unknown }).files)
    );
  });
}

function createPlannedReviewPlan(
  current: ReviewPlan,
  plannedSlices: PlannedSlice[],
  request: PendingPrepareRequest,
): ReviewPlan {
  return {
    ...current,
    pr: {
      repo: request.repo ?? current.pr.repo,
      number: Number(request.pullRequest) || current.pr.number,
      title: request.title || current.pr.title,
    },
    completion: {
      status: "needs-human",
      reviewedFiles: 0,
      totalFiles: current.completion.totalFiles,
      reviewedHunks: 0,
      totalHunks: current.completion.totalHunks,
      blockingComments: 0,
      openQuestions: 0,
    },
    slices: plannedSlices.map((slice) => ({
      ...slice,
      status: "needs-human",
      deferred: false,
      deferReason: "",
      filesReviewed: [],
      hunks: [],
      inlineComments: [],
      remainingQuestions: [],
      evidence: [],
    })),
  };
}

function mergeStreamingSlice(
  current: ReviewPlan,
  slice: Slice,
  request: PendingPrepareRequest,
  totalSlices: number | undefined,
  replaceExisting: boolean,
): ReviewPlan {
  const existingSlices = replaceExisting ? [] : current.slices;
  const slices = [
    ...existingSlices.filter((candidate) => candidate.id !== slice.id),
    slice,
  ];
  const totalFiles = new Set(slices.flatMap((candidate) => candidate.files)).size;
  const reviewedFiles = new Set(slices.flatMap((candidate) => candidate.filesReviewed)).size;
  const reviewedHunks = slices.reduce((sum, candidate) => sum + candidate.hunks.length, 0);
  const blockingComments = slices.reduce(
    (sum, candidate) =>
      sum + candidate.inlineComments.filter((comment) => comment.severity === "blocking").length,
    0,
  );
  const openQuestions = slices.reduce(
    (sum, candidate) => sum + filterActionableQuestions(candidate.remainingQuestions).length,
    0,
  );

  return {
    ...current,
    pr: {
      repo: request.repo ?? current.pr.repo,
      number: Number(request.pullRequest) || current.pr.number,
      title: request.title || current.pr.title,
    },
    completion: {
      status: blockingComments > 0 ? "blocked" : openQuestions > 0 ? "needs-human" : "agent-reviewed",
      reviewedFiles,
      totalFiles: Math.max(totalFiles, current.completion.totalFiles),
      reviewedHunks,
      totalHunks: Math.max(reviewedHunks, current.completion.totalHunks),
      blockingComments,
      openQuestions,
    },
    slices: orderReviewSlices(slices),
  };
}

function orderReviewSlices(slices: Slice[]): Slice[] {
  return [...slices].sort((a, b) => {
    if (a.deferred !== b.deferred) return a.deferred ? 1 : -1;
    const riskDelta = riskRank(b.risk) - riskRank(a.risk);
    if (riskDelta !== 0) return riskDelta;
    return 0;
  });
}

function orderPlannedSlices(slices: PlannedSlice[]): PlannedSlice[] {
  return [...slices].sort((a, b) => {
    const riskDelta = riskRank(b.risk) - riskRank(a.risk);
    if (riskDelta !== 0) return riskDelta;
    return 0;
  });
}

function riskRank(risk: Slice["risk"]) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function isReviewSessionReadyData(data: unknown): data is ReviewSessionReadyData {
  return (
    typeof data === "object" &&
    data !== null &&
    "plan" in data &&
    typeof (data as { plan?: unknown }).plan === "object" &&
    (data as { plan?: unknown }).plan !== null
  );
}

function findLatestReviewWorktree(events: ReviewSessionEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const directWorktree = getWorktreeFromUnknown(event);
    if (directWorktree) return directWorktree;

    const dataWorktree = getWorktreeFromUnknown(event.data);
    if (dataWorktree) return dataWorktree;
  }

  return undefined;
}

function getWorktreeFromUnknown(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.worktree === "string") {
    return record.worktree;
  }

  if (typeof record.artifacts === "object" && record.artifacts !== null) {
    const artifacts = record.artifacts as Record<string, unknown>;
    if (typeof artifacts.worktree === "string") {
      return artifacts.worktree;
    }
  }

  return undefined;
}

type FileHunkGroup = {
  file: string;
  hunks: Hunk[];
  commentCount: number;
};

function FileDiffGroup({
  group,
  defaultOpen,
  commentsByHunk,
  selectedCommentId,
  onSelectComment,
}: {
  group: FileHunkGroup;
  defaultOpen: boolean;
  commentsByHunk: Map<string, ReviewProgressComment[]>;
  selectedCommentId: string | undefined;
  onSelectComment: (commentId: string) => void;
}) {
  const hasComments = group.commentCount > 0;

  return (
    <details
      className="group rounded-lg border bg-card text-card-foreground"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className={cn("size-4 shrink-0", hasComments ? "text-primary" : "text-muted-foreground")} />
          <span className="truncate font-mono text-xs">{group.file}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasComments ? (
            <Badge className="border-destructive/25 bg-destructive/10 text-destructive">
              {group.commentCount} {group.commentCount === 1 ? "comment" : "comments"}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">{group.hunks.length} {group.hunks.length === 1 ? "hunk" : "hunks"}</span>
          <span className="text-xs text-muted-foreground group-open:hidden">expand</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">collapse</span>
        </div>
      </summary>
      <div className="border-t">
        {group.hunks.map((hunk) => (
          <HunkView
            key={hunk.hunkId}
            hunk={hunk}
            comments={commentsByHunk.get(hunk.hunkId) ?? []}
            selectedCommentId={selectedCommentId}
            onSelectComment={onSelectComment}
          />
        ))}
      </div>
    </details>
  );
}

function HunkView({
  hunk,
  comments,
  selectedCommentId,
  onSelectComment,
}: {
  hunk: Hunk;
  comments: ReviewProgressComment[];
  selectedCommentId: string | undefined;
  onSelectComment: (commentId: string) => void;
}) {
  const commentsByLine = new Map(comments.map((comment) => [String(comment.line), comment]));
  const sourceLines = React.useMemo(() => hunk.lines.map((line) => line.text || " "), [hunk.lines]);
  const highlightedLines = useHighlightedLines(sourceLines);

  return (
    <div className="overflow-hidden border-b last:border-b-0">
      <div className="flex items-center justify-between bg-muted/25 px-3 py-1.5">
        <code className="text-xs text-muted-foreground">{hunk.hunkId.split("#").pop()}</code>
      </div>
      <div className="overflow-x-auto bg-card">
        {hunk.lines.map((line, index) => {
          const comment = commentsByLine.get(String(line.newNumber)) ?? commentsByLine.get(String(line.oldNumber)) ?? commentsByLine.get(line.text);
          return (
            <React.Fragment key={`${hunk.hunkId}-${index}`}>
              <div
                className={cn(
                  "grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] font-mono text-xs leading-6",
                  line.kind === "add" && "bg-primary/10",
                  line.kind === "remove" && "bg-destructive/10",
                )}
              >
                <span className="select-none pr-2 text-right text-muted-foreground">{line.oldNumber ?? ""}</span>
                <span className="select-none pr-2 text-right text-muted-foreground">{line.newNumber ?? ""}</span>
                <span className={cn("select-none text-center", line.kind === "add" && "text-primary", line.kind === "remove" && "text-destructive")}>
                  {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                </span>
                <code className="whitespace-pre text-anvil-code">
                  <HighlightedCode text={line.text || " "} tokens={highlightedLines[index]} />
                </code>
              </div>
              {comment ? (
                <InlineNote
                  comment={comment}
                  selected={comment.id === selectedCommentId}
                  onSelect={() => onSelectComment(comment.id)}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function groupHunksByFile(hunks: Hunk[], commentsByHunk: Map<string, ReviewProgressComment[]>): FileHunkGroup[] {
  const groups = new Map<string, FileHunkGroup>();
  for (const hunk of hunks) {
    const group = groups.get(hunk.file) ?? { file: hunk.file, hunks: [], commentCount: 0 };
    group.hunks.push(hunk);
    group.commentCount += commentsByHunk.get(hunk.hunkId)?.length ?? 0;
    groups.set(hunk.file, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.commentCount !== b.commentCount) return b.commentCount - a.commentCount;
    return a.file.localeCompare(b.file);
  });
}

function InlineNote({ comment, selected, onSelect }: { comment: ReviewProgressComment; selected: boolean; onSelect: () => void }) {
  const blocking = comment.severity === "blocking";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] py-1 text-left text-xs leading-5",
        blocking ? "bg-destructive/5" : "bg-anvil-attention/5",
      )}
    >
      <span />
      <span />
      <span />
      <span
        className={cn(
          "mr-3 rounded-md border border-l-4 p-2",
          blocking ? "border-destructive/25 border-l-destructive bg-destructive/10 text-destructive" : "border-anvil-attention/30 border-l-anvil-attention bg-anvil-attention/10 text-anvil-attention",
          selected && "ring-2 ring-primary/35",
        )}
      >
        <span className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase">
          {blocking ? <ShieldAlert className="size-4" /> : <MessageSquare className="size-4" />}
          <span>{comment.severity}</span>
        </span>
        <span className="block whitespace-normal break-words leading-5">{comment.body}</span>
      </span>
    </button>
  );
}

function DecisionRail({
  slice,
  comment,
  openComments,
  selectedCommentId,
  onSelectComment,
  onMarkReviewed,
  onSetCommentDraft,
  onSetCommentDecision,
}: {
  slice: ReviewProgressSlice;
  comment: ReviewProgressComment | undefined;
  openComments: ReviewProgressComment[];
  selectedCommentId: string | undefined;
  onSelectComment: (commentId: string) => void;
  onMarkReviewed: () => void;
  onSetCommentDraft: (commentId: string, draft: string) => void;
  onSetCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
}) {
  const actionableQuestions = filterActionableQuestions(slice.remainingQuestions);
  const currentQuestion = !comment && !slice.reviewed ? actionableQuestions[0] : undefined;
  const deferredQuestion = slice.deferred && !slice.reviewed;
  const isClean = !comment && !currentQuestion;
  const draft = comment ? comment.draft || comment.body : "";

  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      <CardHeader className="px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {comment ? "Action finding" : deferredQuestion ? "Acknowledge deferred" : "Review decision"}
        </div>
      </CardHeader>
      <CardContent className="grid w-full min-w-0 max-w-full gap-4 p-3">
        {comment ? (
          <>
            {openComments.length > 1 ? (
              <div className="grid gap-1">
                {openComments.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onSelectComment(candidate.id)}
                    className={cn(
                      "grid grid-cols-[1.25rem_1fr] items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs",
                      candidate.id === selectedCommentId ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-accent",
                    )}
                  >
                    <span className="grid size-5 place-items-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate font-mono text-muted-foreground">{candidate.file}:{candidate.line}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge className={cn(
                  comment.severity === "blocking" ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
                )}>
                  {comment.severity}
                </Badge>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {comment.file}:{comment.line}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PR comment draft</span>
                <textarea
                  value={draft}
                  onChange={(event) => onSetCommentDraft(comment.id, event.target.value)}
                  className="min-h-36 resize-y rounded-md border bg-background p-2 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <Button
                type="button"
                className="w-full min-w-0 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => onSetCommentDecision(comment, "converted")}
              >
                <Send className="size-4" />
                Queue PR comment
              </Button>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <Button type="button" className="w-full min-w-0 border-input bg-card" onClick={() => onSetCommentDecision(comment, "dismissed")}>
                  <XCircle className="size-4" />
                  Dismiss
                </Button>
                <Button type="button" className="w-full min-w-0 border-input bg-card" onClick={() => onSetCommentDecision(comment, "resolved")}>
                  <CheckCircle2 className="size-4" />
                  Fixed
                </Button>
              </div>
            </div>
          </>
        ) : deferredQuestion ? (
          <>
            <div className="grid gap-2">
              <Badge className="w-fit border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention">deferred</Badge>
              <p className="break-words text-sm leading-6">
                {slice.deferReason || currentQuestion || "Review this low-value slice later."}
              </p>
            </div>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={onMarkReviewed}>
              Acknowledge & next
            </Button>
          </>
        ) : currentQuestion ? (
          <>
            <div className="grid gap-2 rounded-md border border-anvil-attention/30 bg-anvil-attention/10 p-3">
              <Badge className="w-fit border-anvil-attention/30 bg-background text-anvil-attention">question</Badge>
              <p className="break-words text-sm leading-6 text-foreground">
                Resolve the open question in the brief before finishing this slice.
              </p>
            </div>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={onMarkReviewed}>
              Mark checked & next
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2 rounded-md border border-primary/25 bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Suggested outcome</span>
                <Badge className="border-primary/25 bg-background text-primary">No inline comments</Badge>
              </div>
              <p className="text-sm leading-6 text-foreground">
                {isClean ? "Approve or finish this slice with no comments once the brief checks pass." : "No open findings in this slice."}
              </p>
            </div>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={onMarkReviewed}>
              Finish slice: no comments
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SliceReviewContext({ slice }: { slice: ReviewProgressSlice }) {
  const actionableQuestions = filterActionableQuestions(slice.remainingQuestions);
  const brief = buildReviewerBrief(slice, actionableQuestions);
  const currentQuestion = !slice.reviewed ? actionableQuestions[0] : undefined;

  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <FileCode2 className="size-4" />
        Reviewer brief
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          {formatCount(slice.hunks.length, "hunk")} across {formatCount(slice.files.length, "file")}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <BriefRow label="Change to review" value={brief.whatChanged} />
        <BriefRow label="Review focus" value={brief.whyItMatters} />
      </div>
      {currentQuestion ? (
        <div className="grid gap-1 rounded-md border border-anvil-attention/30 bg-anvil-attention/10 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-anvil-attention">Open question</div>
          <p className="break-words text-sm leading-6 text-foreground">{currentQuestion}</p>
        </div>
      ) : null}
      <VerificationChecklist checks={brief.checks} />
    </section>
  );
}

type ReviewerBrief = {
  whatChanged: string;
  whyItMatters: string;
  checks: string[];
};

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="break-words text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function VerificationChecklist({ checks }: { checks: string[] }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CheckCircle2 className="size-4" />
        Verify before approval
      </div>
      <ul className="grid gap-2">
        {checks.map((check) => (
          <li key={check} className="flex gap-2 text-sm leading-6 text-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="break-words">{check}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function buildReviewerBrief(slice: ReviewProgressSlice, actionableQuestions: string[]): ReviewerBrief {
  const lineChange = getRepeatedLineChange(slice);
  const whatChanged = buildChangeSummary(slice, lineChange);
  const whyItMatters = buildReviewFocus(slice, actionableQuestions);

  return {
    whatChanged,
    whyItMatters,
    checks: buildVerificationChecks(slice, actionableQuestions, lineChange),
  };
}

function buildChangeSummary(slice: ReviewProgressSlice, lineChange: RepeatedLineChange | undefined) {
  if (lineChange) {
    return `Repeated edit from ${lineChange.removed} to ${lineChange.added}.`;
  }

  const usefulWhy = usefulBriefSentence(slice.why);
  if (usefulWhy) {
    return usefulWhy;
  }

  const usefulHunkReason = slice.hunks.map((hunk) => usefulBriefSentence(hunk.reason)).find(Boolean);
  if (usefulHunkReason) {
    return usefulHunkReason;
  }

  return slice.title.trim() || "Review the changed behavior in this slice.";
}

function buildReviewFocus(slice: ReviewProgressSlice, actionableQuestions: string[]) {
  const focusItems = [
    usefulBriefSentence(slice.decisionQuestion),
    usefulBriefSentence(slice.primaryRisk),
    firstUsefulCondition(slice.commentConditions),
    firstUsefulCondition(slice.acceptConditions),
    actionableQuestions[0],
  ].filter(Boolean);

  if (focusItems.length > 0) {
    return focusItems.slice(0, 2).join(" ");
  }

  return "Decide whether the changed behavior is complete, covered by evidence, and safe to approve.";
}

function firstUsefulCondition(conditions: string[] | undefined) {
  return conditions?.map(usefulBriefSentence).find(Boolean);
}

function usefulBriefSentence(value: string | undefined) {
  const sentence = normalizeSentence(value);
  if (!sentence || isLowSignalBriefText(sentence)) {
    return undefined;
  }

  return sentence;
}

function normalizeSentence(value: string | undefined) {
  const sentence = value?.trim().replace(/\s+/g, " ");
  if (!sentence) return undefined;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function isLowSignalBriefText(value: string) {
  const lower = value.toLowerCase();
  if (/^changes? \d+ hunks? across \d+ files?\./.test(lower)) return true;
  if (lower.includes("#h") && lower.includes(" adds ")) return true;
  if ((lower.match(/\bsrc\//g)?.length ?? 0) >= 2) return true;
  if ((lower.match(/\.(ts|tsx|js|jsx|json|md|example|env)\b/g)?.length ?? 0) >= 2) return true;
  if (lower === "planned by agentic rust review runtime.") return true;
  return false;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildVerificationChecks(
  slice: ReviewProgressSlice,
  actionableQuestions: string[],
  lineChange: RepeatedLineChange | undefined,
) {
  const checks = new Set<string>();
  const terraformLike = slice.files.some((file) => /(^|\/)(terragrunt|terraform)\b|\.tf$|\.tfvars$|\.ya?ml$/i.test(file));
  const moduleVersionChange = Boolean(lineChange && /\b(version|module)\b/i.test(`${lineChange.removed} ${lineChange.added}`));

  if (lineChange) {
    checks.add("Confirm every repeated entry that should receive this change is included, and no unrelated entry moved.");
  }

  if (moduleVersionChange) {
    checks.add("Check the module release notes or changelog for the behavior change and any breaking changes between the old and new versions.");
  }

  if (terraformLike) {
    checks.add("Confirm the Terraform or Terragrunt plan only contains expected infrastructure changes.");
  }

  for (const question of actionableQuestions) {
    checks.add(question);
  }

  if (checks.size === 0) {
    checks.add("Confirm the diff matches the pull request title and stated intent.");
    checks.add("Check nearby configuration or call sites for coupling that would make this change incomplete.");
    checks.add("Confirm tests, plans, or runtime evidence cover the changed behavior.");
  }

  return Array.from(checks).slice(0, 4);
}

type RepeatedLineChange = {
  removed: string;
  added: string;
};

function getRepeatedLineChange(slice: ReviewProgressSlice): RepeatedLineChange | undefined {
  const removed = new Set<string>();
  const added = new Set<string>();

  for (const hunk of slice.hunks) {
    const removedLines = hunk.lines
      .filter((line) => line.kind === "remove")
      .map((line) => line.text.trim())
      .filter(Boolean);
    const addedLines = hunk.lines
      .filter((line) => line.kind === "add")
      .map((line) => line.text.trim())
      .filter(Boolean);

    if (removedLines.length !== 1 || addedLines.length !== 1) {
      return undefined;
    }

    removed.add(removedLines[0]);
    added.add(addedLines[0]);
  }

  if (removed.size !== 1 || added.size !== 1) {
    return undefined;
  }

  return {
    removed: Array.from(removed)[0],
    added: Array.from(added)[0],
  };
}

function groupComments(comments: ReviewProgressComment[]) {
  const map = new Map<string, ReviewProgressComment[]>();
  for (const comment of comments) {
    const existing = map.get(comment.hunkId) ?? [];
    existing.push(comment);
    map.set(comment.hunkId, existing);
  }
  return map;
}

function countSliceWork(slice: ReviewProgressSlice) {
  const openComments = slice.comments.filter((comment) => comment.decision === "open").length;
  const openQuestions = slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length;
  return openComments + openQuestions;
}

function findNextReviewSlice(
  slices: ReviewProgressSlice[],
  currentId: string,
  reviewedIds: Set<string>,
) {
  const currentIndex = Math.max(0, slices.findIndex((slice) => slice.id === currentId));
  const orderedSlices = [
    ...slices.slice(currentIndex + 1),
    ...slices.slice(0, currentIndex),
  ];
  const unreviewedSlices = orderedSlices.filter((slice) => !reviewedIds.has(slice.id));

  return (
    unreviewedSlices.find((slice) => countSliceWork({ ...slice, reviewed: false }) > 0) ??
    unreviewedSlices[0]
  );
}

function countOpenQuestions(slices: ReviewProgressSlice[]) {
  return slices.reduce((total, slice) => total + (slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length), 0);
}

function useHighlightedLines(lines: string[]) {
  const [tokens, setTokens] = React.useState<HighlightToken[][]>([]);
  const code = React.useMemo(() => lines.join("\n"), [lines]);

  React.useEffect(() => {
    let cancelled = false;

    highlightTypeScriptLines(lines)
      .then((nextTokens) => {
        if (!cancelled) {
          setTokens(nextTokens);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokens([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, lines]);

  return tokens;
}

function HighlightedCode({ text, tokens }: { text: string; tokens: HighlightToken[] | undefined }) {
  if (!tokens?.length) {
    return <>{text}</>;
  }

  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={`${index}:${token.content}`}
          style={{
            color: token.color,
            fontStyle: token.fontStyle === 1 ? "italic" : undefined,
            fontWeight: token.fontStyle === 2 ? 600 : undefined,
          }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

type RootGlobal = typeof globalThis & {
  __reviewLabRoot?: ReturnType<typeof ReactDOM.createRoot>;
};

const rootGlobal = globalThis as RootGlobal;
rootGlobal.__reviewLabRoot ??= ReactDOM.createRoot(document.getElementById("root")!);
rootGlobal.__reviewLabRoot.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
