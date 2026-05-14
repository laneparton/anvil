import * as React from "react";

import type {
  ReviewInboxFilter,
  ReviewInboxPullRequest,
  ReviewInboxSourceFilter,
  ReviewSourceId,
} from "@/app/LauncherScreen";
import type { LoadingState } from "@/app/review-preparation";
import { configureAppSettings, listReviewInbox } from "@/lib/api";
import { formatUnknownError } from "@/lib/errors";
import {
  formatInboxErrors,
  mergeReviewInboxRows,
  normalizeReviewSource,
  providerTimeoutMs,
  reviewInboxRowToPullRequest,
  sourceLabel,
  withTimeout,
} from "@/lib/review-inbox";
import { settingsEnv, type AppSettings } from "@/lib/settings";

export function useReviewInbox({
  appSettings,
  settingsLoaded,
  resetPreparation,
}: {
  appSettings: AppSettings;
  settingsLoaded: boolean;
  resetPreparation: () => void;
}) {
  const [selectedSource, setSelectedSource] = React.useState<ReviewSourceId>("github");
  const [selectedRepo, setSelectedRepo] = React.useState("");
  const [selectedPullRequest, setSelectedPullRequest] = React.useState("");
  const [reviewInboxRows, setReviewInboxRows] = React.useState<ReviewInboxPullRequest[]>([]);
  const [reviewInboxFilter, setReviewInboxFilter] = React.useState<ReviewInboxFilter>("allOpen");
  const [reviewInboxSourceFilter, setReviewInboxSourceFilter] =
    React.useState<ReviewInboxSourceFilter>("all");
  const [reviewInboxSearch, setReviewInboxSearch] = React.useState("");
  const [reviewInboxState, setReviewInboxState] = React.useState<LoadingState>("idle");
  const [reviewInboxRefreshId, setReviewInboxRefreshId] = React.useState(0);
  const [launcherError, setLauncherError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const providers = (["github", "bitbucket"] as const).filter(
      (provider) => appSettings.enabledProviders[provider],
    );
    let pendingProviders = providers.length;
    const providerErrors: Array<{ provider?: string; message?: string }> = [];

    setReviewInboxState("loading");
    setLauncherError(undefined);
    setReviewInboxRows([]);
    setSelectedPullRequest("");
    resetPreparation();

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
  }, [appSettings, resetPreparation, reviewInboxRefreshId, settingsLoaded]);

  const selectedInboxRow =
    reviewInboxRows.find((row) => row.id === selectedPullRequest) ?? reviewInboxRows[0];
  const launcherLoading = reviewInboxState === "loading" && reviewInboxRows.length === 0;
  const launcherRefreshing = reviewInboxState === "loading" && reviewInboxRows.length > 0;

  const selectInboxRow = React.useCallback(
    (pullRequest: ReviewInboxPullRequest) => {
      setSelectedPullRequest(pullRequest.id);
      setSelectedRepo(pullRequest.repo);
      setSelectedSource(normalizeReviewSource(pullRequest.source) ?? selectedSource);
    },
    [selectedSource],
  );

  const changeActiveFilter = React.useCallback((filter: ReviewInboxFilter) => {
    setReviewInboxFilter(filter);
    setSelectedPullRequest("");
  }, []);

  const changeSourceFilter = React.useCallback((source: ReviewInboxSourceFilter) => {
    setReviewInboxSourceFilter(source);
    setSelectedPullRequest("");
    if (source !== "all") {
      setSelectedSource(source);
    }
  }, []);

  const refreshInbox = React.useCallback(() => {
    setReviewInboxRefreshId((id) => id + 1);
  }, []);

  return {
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
    setReviewInboxSearch,
    setSelectedPullRequest,
    setSelectedRepo,
    setSelectedSource,
    selectInboxRow,
    changeActiveFilter,
    changeSourceFilter,
  };
}
