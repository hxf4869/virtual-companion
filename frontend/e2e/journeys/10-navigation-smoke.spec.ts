import { expect, test, type Page } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
} from "../helpers";

async function expectRouteAndFit(page: Page, path: string): Promise<void> {
  await page.waitForURL((url) =>
    url.hash.startsWith(`#${path}`)
      || (path === "/pages/index/index" && ["", "#", "#/"].includes(url.hash)), {
    timeout: 20_000,
  });
  await expect(page.locator(".vc-shell, .chat-page").first()).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(sizes.scrollWidth, `${path} must not overflow horizontally`).toBeLessThanOrEqual(
    sizes.viewportWidth,
  );
}

test("390x844 global navigation and every published non-destructive account entry work", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = await provisionUser(request, "navigation-smoke");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.page);

  await navigateToPage(page, "/pages/index/index");
  const tabs = [
    ["home", "/pages/index/index"],
    ["chats", "/pages/conversations/conversations"],
    ["memory", "/pages/memory/memory"],
    ["me", "/pages/account/account"],
  ] as const;
  for (const [testId, path] of tabs) {
    await page.getByTestId(`tab-${testId}`).click();
    await expectRouteAndFit(page, path);
  }

  await page.getByTestId("me-companion").click();
  await expectRouteAndFit(page, "/pages/companion/companion");
  const persona = page.getByTestId("persona-select");
  await expect(persona).toBeEnabled();
  await persona.selectOption("gentle-listener");
  await expect(page.getByTestId("create-relationship")).toBeEnabled();
  await page.getByTestId("create-relationship").click();
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  // The isolated stack may destructively reset its synthetic relationship.
  // Exercise both current Go KEEP endpoints through the actual danger UI and
  // verify reset retains the relationship/persona itself.
  const previewResponse = page.waitForResponse((response) =>
    response.request().method() === "GET"
      && /\/api\/v1\/relationships\/\d+\/clearance-preview$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByTestId("companion-reset-open").click();
  expect((await previewResponse).ok(), "relationship clearance preview failed").toBeTruthy();
  await expect(page.getByTestId("companion-clearance-preview")).toContainText(
    "重置后会保留这个角色及其设置",
  );

  const resetResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && /\/api\/v1\/relationships\/\d+\/reset$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByTestId("companion-reset-confirm").click();
  expect((await resetResponse).ok(), "relationship reset failed").toBeTruthy();
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  const accountEntries = [
    ["companion", "/pages/companion/companion"],
    ["incognito", "/pages/incognito/incognito"],
    ["age", "/pages/age/age"],
    ["consent", "/pages/consent/consent"],
    ["ai-notice", "/pages/ai-notice/ai-notice"],
    ["data", "/pages/data/data"],
    ["export", "/pages/export/export"],
    ["help", "/pages/help/help"],
    ["report", "/pages/report/report"],
  ] as const;
  for (const [testId, path] of accountEntries) {
    await navigateToPage(page, "/pages/account/account");
    await expect(page.getByTestId(`me-${testId}`)).toBeVisible();
    await page.getByTestId(`me-${testId}`).click();
    await expectRouteAndFit(page, path);
  }
});
