import { clearCapturedInvokes, getCapturedInvokes } from "@srsholmes/tauri-playwright";
import { expect, test } from "../fixtures";

test("review inbox renders and filters mocked provider rows", async ({ tauriPage }) => {
  test.skip(test.info().project.name === "tauri", "This test uses browser-mode IPC mocks; native app startup is covered by smoke:tauri.");

  await expect(tauriPage.getByTestId("review-inbox")).toBeVisible();
  await expect(tauriPage.getByTestId("review-inbox-status")).toContainText(/31 visible|Loading/);
  await expect(tauriPage.getByText("Tighten review inbox behavior")).toBeVisible();
  const firstBitbucketRow = tauriPage.locator('button:has-text("Bitbucket workspace smoke 1")').first();
  await expect(firstBitbucketRow).toBeVisible();
  await expect(firstBitbucketRow).not.toContainText("? files");

  await tauriPage.getByTestId("open-manual-pr").click();
  await expect(tauriPage.getByRole("dialog", { name: "Open PR manually" })).toBeVisible();
  await expect(tauriPage.getByTestId("manual-pr-url")).toBeVisible();
  await expect(tauriPage.getByTestId("manual-pr-repo")).toHaveCount(0);
  await expect(tauriPage.getByTestId("manual-pr-number")).toHaveCount(0);
  await tauriPage.getByRole("button", { name: "Close" }).click();

  const listCanScroll = await tauriPage.getByTestId("pull-request-list").evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(listCanScroll).toBe(true);

  await tauriPage.getByTestId("inbox-filter-needsReview").click();
  await expect(tauriPage.getByText("Tighten review inbox behavior")).toBeVisible();
  await expect(firstBitbucketRow).toBeHidden();

  await tauriPage.getByTestId("inbox-filter-createdByMe").click();
  await expect(firstBitbucketRow).toBeVisible();
  await expect(tauriPage.getByText("Tighten review inbox behavior")).toBeHidden();

  await tauriPage.getByTestId("inbox-filter-allOpen").click();
  await expect(tauriPage.getByTestId("pull-request-row")).toHaveCount(31);

  await clearCapturedInvokes(tauriPage);
  await tauriPage.getByRole("button", { name: "Bitbucket 30" }).click();
  await expect(firstBitbucketRow).toBeVisible();
  await expect(tauriPage.getByText("Tighten review inbox behavior")).toBeHidden();
  const calls = await getCapturedInvokes(tauriPage);
  expect(calls.filter((call) => call.cmd === "list_review_inbox")).toHaveLength(0);
});

test("manual PR prepare uses the pasted URL target", async ({ tauriPage }) => {
  test.skip(test.info().project.name === "tauri", "This test uses browser-mode IPC mocks; native app startup is covered by smoke:tauri.");

  await clearCapturedInvokes(tauriPage);
  await tauriPage.getByTestId("open-manual-pr").click();
  await tauriPage.getByTestId("manual-pr-url").fill("github.com/octo-org/manual-repo/pull/42");
  await tauriPage.getByTestId("manual-pr-prepare").click();

  await expect(tauriPage.getByText("octo-org/manual-repo #42")).toBeVisible();
  let request: unknown;
  await expect.poll(async () => {
    const calls = await getCapturedInvokes(tauriPage);
    request = calls.find((call) => call.cmd === "start_review_session")?.args.request;
    return request;
  }).toMatchObject({
    source: "github",
    repo: "octo-org/manual-repo",
    pullRequest: "42",
  });

  const sessionId = typeof request === "object" && request !== null
    ? (request as { sessionId?: unknown }).sessionId
    : undefined;
  expect(typeof sessionId).toBe("string");
  await tauriPage.evaluate(`window.__TAURI_EMIT_MOCK_EVENT__("review-session-event", ${JSON.stringify({
    sessionId,
    type: "planner.ready",
    message: "Planner ready.",
    data: {
      plannedSlices: [
        {
          id: "manual-slice",
          title: "Manual streamed slice",
          risk: "low",
          why: "Exercise streamed placeholder review metadata.",
          files: ["src/manual.ts"],
        },
      ],
    },
  })})`);
  await expect(tauriPage.getByRole("heading", { name: "Manual PR #42" })).toBeVisible();
  await expect(tauriPage.getByRole("heading", { name: "No review loaded" })).toHaveCount(0);
});

test("settings screen saves handoff and provider configuration", async ({ tauriPage }) => {
  test.skip(test.info().project.name === "tauri", "This test uses browser-mode IPC mocks; native app startup is covered by smoke:tauri.");

  await tauriPage.getByTestId("open-settings").click();
  await expect(tauriPage.getByTestId("settings-screen")).toBeVisible();

  await expect(tauriPage.getByTestId("provider-bitbucket").getByRole("button", { name: "Enabled", exact: true })).toBeVisible();
  await tauriPage.getByTestId("bitbucket-pinned-repos").fill("workspace/example-service");
  await tauriPage.getByRole("button", { name: "Custom", exact: true }).click();
  await tauriPage.getByTestId("custom-terminal-app").fill("iTerm");
  await tauriPage.getByRole("button", { name: "Claude", exact: true }).click();
  await tauriPage.getByTestId("advanced-settings-toggle").click();
  await tauriPage.getByTestId("env-BITBUCKET_WORKSPACE").fill("workspace");
  await tauriPage.getByTestId("save-settings").click();

  await expect(tauriPage.getByText("Saved")).toBeVisible();
  const saved = await tauriPage.evaluate(() => window.localStorage.getItem("anvil:app-settings:v1"));
  expect(saved).not.toContain("GH_TOKEN");
  expect(saved).toContain("workspace");
  expect(saved).toContain("BITBUCKET_PINNED_REPOS");
  expect(saved).toContain("BITBUCKET_INBOX_REPO_LIMIT");
});
