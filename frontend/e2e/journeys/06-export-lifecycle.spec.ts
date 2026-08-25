import { expect, test } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
} from "../helpers";

interface ExportWireBody {
  exportId?: string | number;
  status?: string;
  downloadToken?: string;
  downloadUrl?: string;
}

// Journey 6 — enqueue, user-driven status refresh and one-time download use
// the real asynchronous export worker. Status reads must never repeat the
// download secret issued by the create response. ADR-0006 §7.7 (DOGFOOD-08):
// the export creation must re-enter the current password (server-side
// fail-closed verification), and a wrong password must NOT enqueue anything.
test("an export becomes ready after manual refresh and can be downloaded", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "export-lifecycle");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);
  await navigateToPage(page, "/pages/export/export");

  // ADR-0006 §7.7: a wrong current password is rejected fail-closed — no
  // export is created (the create POST returns the non-disclosing 404).
  const wrongResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/exports",
  );
  // uni h5 renders <uni-input data-testid="export-password"> wrapping the
  // native input (same pattern as the login page).
  await page.locator('[data-testid="export-password"] input').fill("Wrong-Pass-1!");
  await page.getByTestId("export-create").click();
  const rejected = await wrongResponse;
  expect(rejected.status(), "wrong password must not create an export").toBe(404);
  await expect(page.getByTestId("export-action-failed")).toBeVisible();
  expect(page.getByTestId("export-status-card")).toHaveCount(0);

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/exports",
  );
  await page.locator('[data-testid="export-password"] input').fill(user.password);
  await page.getByTestId("export-create").click();
  const created = await createResponse;
  expect(created.ok(), `export create failed: ${created.status()}`).toBeTruthy();
  expect(created.headers()["x-request-id"]).toBeTruthy();
  const createBody = (await created.json()) as ExportWireBody;
  const exportId = String(createBody.exportId ?? "");
  expect(exportId).not.toBe("");
  expect(createBody.downloadToken).toBeTruthy();
  expect(createBody.downloadUrl).toContain(
    `/api/v1/exports/${exportId}/download?token=`,
  );

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const statusResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/v1/exports/${exportId}`,
    );
    await page.getByTestId("export-refresh").click();
    const polled = await statusResponse;
    expect(polled.ok(), `export status failed: ${polled.status()}`).toBeTruthy();
    const statusBody = (await polled.json()) as ExportWireBody;
    expect(statusBody).not.toHaveProperty("downloadToken");
    expect(statusBody).not.toHaveProperty("downloadUrl");
    if (statusBody.status === "READY") {
      ready = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  expect(ready, "export worker did not reach READY after manual refreshes").toBeTruthy();
  await expect(page.getByTestId("export-status")).toHaveText("已就绪，可下载");

  const downloadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname ===
        `/api/v1/exports/${exportId}/download`,
  );
  await page.getByTestId("export-download").click();
  expect((await downloadResponse).ok()).toBeTruthy();

  const preview = page.getByTestId("export-download-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("本导出包含 AI 生成内容");
  await expect(preview).toContainText("会话");
});
