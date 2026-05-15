import * as React from "react";

import type {
  ReviewInboxFilter,
  ReviewInboxPullRequest,
  ReviewSourceId,
} from "@/app/LauncherScreen";
import type { LoadingState } from "@/app/review-preparation";
import { configureAppSettings, hydrateReviewInboxRow, listReviewInbox } from "@/lib/api";
import { formatUnknownError } from "@/lib/errors";
import {
  formatInboxErrors,
  getReviewPullRequestNumber,
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
  const [reviewInboxSearch, setReviewInboxSearch] = React.useState("");
  const [reviewInboxState, setReviewInboxState] = React.useState<LoadingState>("idle");
  const [reviewInboxRefreshId, setReviewInboxRefreshId] = React.useState(0);
  const [hydratingPullRequestId, setHydratingPullRequestId] = React.useState<string | undefined>();
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
    const useCacheFirst = reviewInboxRefreshId === 0;

    setReviewInboxState("loading");
    setLauncherError(undefined);
    if (!useCacheFirst) {
      setReviewInboxRows([]);
    }
    setSelectedPullRequest("");
    setHydratingPullRequestId(undefined);
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

        const applyRows = (
          provider: ReviewSourceId,
          rows: ReviewInboxPullRequest[],
          replaceProviderRows: boolean,
        ) => {
          setReviewInboxRows((current) => {
            const base = replaceProviderRows
              ? current.filter((row) => normalizeReviewSource(row.source) !== provider)
              : current;
            const next = mergeReviewInboxRows(base, rows);
            setSelectedPullRequest((selected) =>
              next.some((row) => row.id === selected) ? selected : "",
            );
            return next;
          });
        };

        for (const provider of providers) {
          const loadCachedRows = useCacheFirst
            ? withTimeout(
                listReviewInbox({
                  providers: [provider],
                  limit: 100,
                  cacheMode: "cacheFirst",
                }),
                1_500,
                `${sourceLabel(provider)} cached PR loading timed out.`,
              )
                .then((result) => {
                  if (cancelled) return;
                  const rows = result.rows.map(reviewInboxRowToPullRequest);
                  if (rows.length > 0) applyRows(provider, rows, false);
                })
                .catch(() => undefined)
            : Promise.resolve();

          loadCachedRows
            .then(() =>
              withTimeout(
                listReviewInbox({
                  providers: [provider],
                  limit: 100,
                  cacheMode: "refresh",
                }),
                providerTimeoutMs(provider),
                `${sourceLabel(provider)} PR loading timed out after ${providerTimeoutMs(provider) / 1000}s.`,
              ),
            )
            .then((result) => {
              if (cancelled) return;
              const rows = result.rows.map(reviewInboxRowToPullRequest);
              providerErrors.push(...result.errors);
              applyRows(provider, rows, true);
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

  const selectedInboxRow = reviewInboxRows.find((row) => row.id === selectedPullRequest);
  const selectedInboxHydrating = Boolean(
    selectedInboxRow?.id && hydratingPullRequestId === selectedInboxRow.id,
  );
  const launcherLoading = reviewInboxState === "loading" && reviewInboxRows.length === 0;
  const launcherRefreshing = reviewInboxState === "loading" && reviewInboxRows.length > 0;

  const selectInboxRow = React.useCallback(
    (pullRequest: ReviewInboxPullRequest) => {
      setSelectedPullRequest(pullRequest.id);
      setSelectedRepo(pullRequest.repo);
      setHydratingPullRequestId(pullRequest.id);
      const source = normalizeReviewSource(pullRequest.source) ?? selectedSource;
      const pullRequestNumber = getReviewPullRequestNumber(pullRequest);
      setSelectedSource(source);

      if (!pullRequest.repo || !pullRequestNumber) {
        setHydratingPullRequestId(undefined);
        return;
      }

      const applyHydratedRow = (row: ReviewInboxPullRequest) => {
        setReviewInboxRows((current) => mergeReviewInboxRows(current, [row]));
      };

      void hydrateReviewInboxRow({
        source,
        repo: pullRequest.repo,
        pullRequest: pullRequestNumber,
        cacheMode: "cacheFirst",
      })
        .then((result) => {
          if (result.row) {
            applyHydratedRow(reviewInboxRowToPullRequest(result.row));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          void hydrateReviewInboxRow({
            source,
            repo: pullRequest.repo,
            pullRequest: pullRequestNumber,
            cacheMode: "refresh",
          })
            .then((result) => {
              if (result.row) {
                applyHydratedRow(reviewInboxRowToPullRequest(result.row));
              }
            })
            .catch(() => undefined)
            .finally(() => {
              setHydratingPullRequestId((current) => (current === pullRequest.id ? undefined : current));
            });
        });
    },
    [selectedSource],
  );

  const changeActiveFilter = React.useCallback((filter: ReviewInboxFilter) => {
    setReviewInboxFilter(filter);
    setSelectedPullRequest("");
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
    selectedInboxRow,
    selectedInboxHydrating,
    selectedPullRequest,
    selectedRepo,
    selectedSource,
    setReviewInboxSearch,
    setSelectedPullRequest,
    setSelectedRepo,
    setSelectedSource,
    selectInboxRow,
    changeActiveFilter,
  };
}
