import * as React from "react";

import type { ReviewInboxPullRequest } from "@/app/LauncherScreen";
import {
  ExperiencePrototype,
  PreparingReviewPrototype,
  ReviewQueuePrototype,
  RuntimeReviewQueueWorkbench,
} from "@/app/ExperiencePrototype";
import { PreparingScreen } from "@/app/PreparingScreen";
import { ReviewScreen } from "@/app/ReviewScreen";
import { SettingsScreen } from "@/app/SettingsScreen";
import { useReviewPreparation } from "@/app/useReviewPreparation";
import { filterActionableQuestions } from "@/lib/review-questions";
import { openProviderPullRequestUrl, resolveProviderPullRequestLink } from "@/lib/provider-links";
import { type CommentDecision, type ReviewProgressComment, useReviewProgress } from "@/lib/review-progress";
import type { ReviewPlan } from "@/lib/review-types";
import { getReviewPullRequestNumber, normalizeReviewSource } from "@/lib/review-inbox";
import { findNextReviewSlice, groupComments } from "@/lib/review-workflow";

import { useAppSettings } from "./useAppSettings";
import { useReviewAgentLaunch } from "./useReviewAgentLaunch";
import { useReviewInbox } from "./useReviewInbox";
import { useReviewSubmit } from "./useReviewSubmit";
import type { AppStage } from "./types";

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

export function App() {
  if (typeof window !== "undefined") {
    const prototype = new URLSearchParams(window.location.search).get("prototype");
    if (prototype === "review-queue") return <ReviewQueuePrototype />;
    if (prototype === "preparing-review") return <PreparingReviewPrototype />;
    if (prototype === "decision-flow") return <ExperiencePrototype />;
  }

  return <RuntimeApp />;
}

function RuntimeApp() {
  const [stage, setStage] = React.useState<AppStage>("launcher");
  const [activeId, setActiveId] = React.useState<string | undefined>(emptyReviewPlan.slices[0]?.id);
  const [selectedCommentId, setSelectedCommentId] = React.useState<string | undefined>();
  const clearProgressRef = React.useRef<() => void>(() => undefined);
  const resetSubmitStateRef = React.useRef<() => void>(() => undefined);
  const clearReviewProgress = React.useCallback(() => clearProgressRef.current(), []);

  const {
    appSettings,
    closeSettings,
    handleResetSettings,
    handleSaveSettings,
    openSettings,
    settingsLoaded,
    settingsSavedAt,
  } = useAppSettings({ stage, setStage });

  const handleReviewOpened = React.useCallback(({ activeSliceId }: { activeSliceId?: string }) => {
    resetSubmitStateRef.current();
    setSelectedCommentId(undefined);
    setActiveId(activeSliceId);
    setStage("review");
  }, []);

  const handlePreparationCanceled = React.useCallback(() => {
    setStage("launcher");
  }, []);

  const {
    activeSessionId,
    cancelPreparation,
    pendingSliceIds,
    prepareRequest,
    prepareState,
    resetPreparation,
    reviewPlan,
    reviewWorktree,
    startPreparation,
  } = useReviewPreparation({
    initialReviewPlan: emptyReviewPlan,
    clearProgress: clearReviewProgress,
    onReviewOpened: handleReviewOpened,
    onPreparationCanceled: handlePreparationCanceled,
  });

  const {
    changeActiveFilter,
    changeSourceFilter,
    launcherError,
    launcherLoading,
    launcherRefreshing,
    refreshInbox,
    reviewInboxFilter,
    reviewInboxRows,
    reviewInboxSearch,
    reviewInboxSourceFilter,
    selectedInboxRow,
    selectedPullRequest,
    selectedRepo,
    selectedSource,
    selectInboxRow,
    setReviewInboxSearch,
    setSelectedPullRequest,
    setSelectedRepo,
    setSelectedSource,
  } = useReviewInbox({
    appSettings,
    settingsLoaded,
    resetPreparation,
  });

  const progress = useReviewProgress(reviewPlan, {
    storageKey: `review-progress:${reviewPlan.pr.repo}:${reviewPlan.pr.number}`,
  });
  clearProgressRef.current = progress.clearProgress;

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
  const reviewComplete =
    pendingSliceIds.size === 0 && progress.counts.openComments === 0 && progress.counts.unreviewedSlices === 0;
  const effectiveSelectedPullRequest =
    prepareRequest?.pullRequest ?? getReviewPullRequestNumber(selectedInboxRow) ?? "";
  const effectiveSelectedRepo = prepareRequest?.repo ?? selectedInboxRow?.repo ?? selectedRepo;
  const effectiveSelectedSource =
    normalizeReviewSource(prepareRequest?.source) ?? normalizeReviewSource(selectedInboxRow?.source) ?? selectedSource;
  const providerPullRequestLink = React.useMemo(
    () =>
      resolveProviderPullRequestLink({
        source: effectiveSelectedSource,
        repo: reviewPlan.pr.repo || effectiveSelectedRepo,
        pullRequest: reviewPlan.pr.number || effectiveSelectedPullRequest,
        preferredUrls: [reviewPlan.pr.url, prepareRequest?.url, selectedInboxRow?.url],
      }),
    [
      effectiveSelectedPullRequest,
      effectiveSelectedRepo,
      effectiveSelectedSource,
      prepareRequest?.url,
      reviewPlan.pr.number,
      reviewPlan.pr.repo,
      reviewPlan.pr.url,
      selectedInboxRow?.url,
    ],
  );

  const { agentLaunchState, handleOpenAgent } = useReviewAgentLaunch({
    active,
    appSettings,
    reviewPlan,
    reviewWorktree,
  });

  const { clearReview, setSubmitState, submitReview, submitState } = useReviewSubmit({
    activeSessionId,
    clearProgress: progress.clearProgress,
    effectiveSelectedSource,
    progressQueuedComments: progress.queuedComments,
    refreshInbox,
    resetPreparation,
    reviewPlan,
    setActiveId,
    setSelectedCommentId,
    setStage,
  });
  resetSubmitStateRef.current = () => setSubmitState({ status: "idle" });

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
      const finishedSlice =
        remainingOpenComments === 0 && filterActionableQuestions(active.remainingQuestions).length === 0;

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

  if (stage === "settings") {
    return (
      <SettingsScreen
        settings={appSettings}
        savedAt={settingsSavedAt}
        onBack={closeSettings}
        onSave={handleSaveSettings}
        onReset={handleResetSettings}
      />
    );
  }

  if (stage === "launcher") {
    return (
      <RuntimeReviewQueueWorkbench
        pullRequests={reviewInboxRows}
        selectedRowId={selectedPullRequest}
        activeFilter={reviewInboxFilter}
        sourceFilter={reviewInboxSourceFilter}
        searchQuery={reviewInboxSearch}
        loading={launcherLoading}
        refreshing={launcherRefreshing}
        error={launcherError}
        providersEnabled={
          settingsLoaded &&
          (appSettings.enabledProviders.github || appSettings.enabledProviders.bitbucket)
        }
        onSelectRow={selectInboxRow}
        onActiveFilterChange={changeActiveFilter}
        onSourceFilterChange={changeSourceFilter}
        onSearchQueryChange={setReviewInboxSearch}
        onRefresh={refreshInbox}
        onOpenSettings={openSettings}
        onOpenProvider={(pullRequest) => {
          const link = resolveProviderPullRequestLink({
            source: normalizeReviewSource(pullRequest.source) ?? selectedSource,
            repo: pullRequest.repo,
            pullRequest: getReviewPullRequestNumber(pullRequest) ?? "",
            preferredUrls: [pullRequest.url],
          });
          if (link) {
            void openProviderPullRequestUrl(link.url);
          }
        }}
        onPrepare={(pullRequest) => {
          const target = pullRequest ?? selectedInboxRow;
          preparePullRequest(target, {
            selectedSource,
            setSelectedPullRequest,
            setSelectedRepo,
            setSelectedSource,
            setStage,
            setSubmitState,
            startPreparation,
          });
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
        onCancel={cancelPreparation}
      />
    );
  }

  return (
    <ReviewScreen
      acknowledgedDeferredCount={acknowledgedDeferredCount}
      active={active}
      activeIndex={activeIndex}
      activePending={activePending}
      agentLaunchState={agentLaunchState}
      appSettings={appSettings}
      clearReview={clearReview}
      commentsByHunk={commentsByHunk}
      currentComment={currentComment}
      deferredSlices={deferredSlices}
      handleCommentDecision={handleCommentDecision}
      handleOpenAgent={handleOpenAgent}
      highRiskPendingCount={highRiskPendingCount}
      markActiveReviewed={markActiveReviewed}
      onExitReview={() => {
        resetPreparation();
        setStage("launcher");
      }}
      onOpenSettings={openSettings}
      onOpenProvider={
        providerPullRequestLink
          ? () => {
              void openProviderPullRequestUrl(providerPullRequestLink.url);
            }
          : undefined
      }
      openComments={openComments}
      pendingSliceIds={pendingSliceIds}
      providerPullRequestLink={providerPullRequestLink}
      prepareEvent={prepareState.events[prepareState.events.length - 1]}
      progress={progress}
      pullRequest={reviewPlan.pr.number}
      repo={reviewPlan.pr.repo}
      reviewComplete={reviewComplete}
      reviewTitle={reviewPlan.pr.title}
      reviewWorktree={reviewWorktree}
      selectedCommentId={selectedCommentId}
      setActiveId={setActiveId}
      setSelectedCommentId={setSelectedCommentId}
      submitReview={submitReview}
      submitState={submitState}
    />
  );
}

function preparePullRequest(
  target: ReviewInboxPullRequest | undefined,
  {
    selectedSource,
    setSelectedPullRequest,
    setSelectedRepo,
    setSelectedSource,
    setStage,
    setSubmitState,
    startPreparation,
  }: {
    selectedSource: "github" | "bitbucket";
    setSelectedPullRequest: (pullRequestId: string) => void;
    setSelectedRepo: (repo: string) => void;
    setSelectedSource: (source: "github" | "bitbucket") => void;
    setStage: React.Dispatch<React.SetStateAction<AppStage>>;
    setSubmitState: (state: { status: "idle" }) => void;
    startPreparation: (request: {
      source: "github" | "bitbucket";
      repo: string;
      pullRequest: string;
      title?: string;
      url?: string;
    }) => void;
  },
) {
  if (!target) return;
  const source = normalizeReviewSource(target.source) ?? selectedSource;
  const repo = target.repo;
  const pullRequestNumber = getReviewPullRequestNumber(target);
  if (!repo || !pullRequestNumber) return;

  setSelectedPullRequest(target.id);
  setSelectedRepo(repo);
  setSelectedSource(source);
  startPreparation({
    source,
    repo,
    pullRequest: pullRequestNumber,
    title: target.title,
    url: target.url,
  });
  setSubmitState({ status: "idle" });
  setStage("preparing");
}
