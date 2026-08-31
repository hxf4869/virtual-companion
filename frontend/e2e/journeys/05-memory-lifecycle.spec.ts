import { expect, test } from "@playwright/test";

import {
  createMemoryCandidate,
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 5 — candidate review, source provenance and explicit two-step delete
// all go through the owner-scoped memory APIs.
test("a memory candidate can be confirmed, inspected and deleted", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "memory-lifecycle");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.page);
  const context = await createRelationshipAndConversation(session.page);
  const summary = "我喜欢在安静的晚上读纸质书";
  const evidence = "message:50005";
  const memoryId = await createMemoryCandidate(
    session.page,
    context.relationshipId,
    summary,
    evidence,
  );

  await navigateToPage(
    page,
    `/pages/memory/memory?relationshipId=${context.relationshipId}`,
  );
  const initialLoad = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname ===
        `/api/v1/relationships/${context.relationshipId}/memories`,
  );
  await page.getByTestId("reload").click();
  expect((await initialLoad).ok()).toBeTruthy();

  const pending = page.locator(".card.pending").filter({ hasText: summary });
  await expect(pending).toHaveCount(1);
  await pending.getByTestId("memory-confirm").click();

  let canonical = page.locator(".card.canonical").filter({ hasText: summary });
  await expect(canonical).toHaveCount(1);
  await canonical.getByTestId("memory-open-detail").click();

  await expect(page.getByTestId("memory-summary")).toHaveText(summary);
  await expect(page.getByTestId("memory-status")).toContainText("已保存");
  await expect(page.getByTestId("memory-source")).toContainText(evidence);

  await page.getByTestId("nav-memory").click();
  await expect(page).toHaveURL(
    new RegExp(`#\/pages\/memory\/memory\\?relationshipId=${context.relationshipId}`),
  );
  canonical = page.locator(".card.canonical").filter({ hasText: summary });
  await expect(canonical).toHaveCount(1);

  let deleteRequests = 0;
  page.on("request", (observed) => {
    if (
      observed.method() === "DELETE" &&
      new URL(observed.url()).pathname === `/api/v1/memories/${memoryId}`
    ) {
      deleteRequests += 1;
    }
  });
  const deleteButton = canonical.getByTestId("memory-delete");
  await deleteButton.click();
  await expect(deleteButton).toContainText("确认删除这条记忆");
  expect(deleteRequests).toBe(0);

  const deleteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/memories/${memoryId}`,
  );
  await deleteButton.click();
  expect((await deleteResponse).ok()).toBeTruthy();
  expect(deleteRequests).toBe(1);
  await expect(canonical).toHaveCount(0);

  const reloadDeleted = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname ===
        `/api/v1/relationships/${context.relationshipId}/memories` &&
      new URL(response.url()).searchParams.get("includeDeleted") === "true",
  );
  await page.getByTestId("reload").click();
  expect((await reloadDeleted).ok()).toBeTruthy();
  await expect(page.getByTestId("memory-group-deleted")).toContainText(summary);
});
