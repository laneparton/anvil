import { expect, test } from "../fixtures";

test("native app starts manual review preparation and cancels back to inbox", async ({ tauriPage }) => {
  test.skip(test.info().project.name !== "tauri", "Native workflow coverage runs only against the Tauri project.");
  test.setTimeout(120_000);

  tauriPage.setDefaultTimeout(10_000);

  await expect(tauriPage.getByTestId("review-inbox")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("review-inbox-status")).toContainText(/Loading|\d+ visible/);

  await tauriPage.getByTestId("open-manual-pr").click();
  await expect(tauriPage.locator('[role="dialog"]')).toBeVisible();
  await expect(tauriPage.getByTestId("manual-pr-url")).toBeVisible();

  await tauriPage.getByTestId("manual-pr-url").fill("https://github.com/octo-org/manual-repo/pull/42");
  await tauriPage.getByTestId("manual-pr-prepare").click();

  await expect(tauriPage.getByText("Preparing review")).toBeVisible();
  await expect(tauriPage.getByText("octo-org/manual-repo #42")).toBeVisible();
  await expect(tauriPage.getByText("tauri runtime")).toBeVisible();

  // This covers the real native Tauri prepare/cancel IPC path. Completing a
  // prepared review or submission still requires provider credentials and a
  // fetched review worktree, so that remains outside this non-brittle native
  // happy path until the app exposes a native provider fixture.
  await tauriPage.locator("button").filter({ hasText: "Cancel" }).click();
  await expect(tauriPage.getByTestId("review-inbox")).toBeVisible();
});
