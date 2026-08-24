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
// download secret issued by the create response.
test("an export becomes ready after manual refresh and can be downloaded", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "export-lifecycle");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);
  await navigateToPage(page, "/pages/export/export");

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/exports",
  );
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
