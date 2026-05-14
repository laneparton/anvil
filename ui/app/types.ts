import type { ReviewAgent } from "@/lib/api";

export type AppStage = "launcher" | "preparing" | "review" | "settings";

export type SubmitState = {
  status: "idle" | "submitting" | "submitted" | "error";
  error?: string;
  receiptId?: string;
};

export type AgentLaunchState = {
  status: "idle" | "launching" | "launched" | "error";
  agent?: ReviewAgent;
  error?: string;
  worktree?: string;
};
