import * as React from "react";

import { openReviewAgent, type ReviewAgent } from "@/lib/api";
import type { ReviewProgressSlice } from "@/lib/review-progress";
import type { ReviewPlan } from "@/lib/review-types";
import { resolveTerminalApp, type AppSettings } from "@/lib/settings";

import type { AgentLaunchState } from "./types";

export function useReviewAgentLaunch({
  active,
  appSettings,
  reviewPlan,
  reviewWorktree,
}: {
  active: ReviewProgressSlice;
  appSettings: AppSettings;
  reviewPlan: ReviewPlan;
  reviewWorktree?: string;
}) {
  const [agentLaunchState, setAgentLaunchState] = React.useState<AgentLaunchState>({ status: "idle" });

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

  return {
    agentLaunchState,
    handleOpenAgent,
  };
}
