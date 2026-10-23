import { expect, test } from "@playwright/test";

import { openSharedSession } from "../helpers";

// A fresh production document has a one-page uni stack. A browser history
// entry from before that document is not a parent page in the application.
test("secondary pages return after reload and keep in-app back navigation", async ({ page }) => {
  const session = await openSharedSession(page, "chat");
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()
        && request.resourceType() === "document") documentLoads += 1;
  });
  const routes = [
    { path: "/pages/companion/companion", title: "陪伴设置", parent: "/pages/account/account", ready: "account-email" },
    { path: "/pages/memory/memory", title: "记忆管理", parent: "/pages/account/account", ready: "account-email" },
    { path: "/pages/conversations/conversations", title: "全部会话", parent: "/pages/chat/chat", ready: "message-input" },
  ];
  for (const route of routes) {
    await test.step(route.title + " returns from a fresh document", async () => {
      const response = await page.goto("/#" + route.path);
      if (response === null) await page.reload();
      await expect(page.getByRole("heading", { name: route.title, exact: true })).toBeVisible();
      await expect(page.getByTestId("consumer-tabbar")).toHaveCount(0);
      const before = documentLoads;
      await page.getByTestId("page-back").click();
      await expect(page, route.title + " back must reach its owning tab").toHaveURL(new RegExp("#" + route.parent + "$"));
      await expect(page.getByTestId(route.ready)).toBeVisible();
      expect(documentLoads, route.title + " back must not reload the same document").toBe(before);
      if (route.ready === "account-email") await expect(page.getByTestId("account-email")).toHaveText(session.email);
    });
  }

  // Enter through the actual product action as well: a parent exists here,
  // so the same Back button must still return normally without reloading.
  await page.getByTestId("tab-me").click();
  await expect(page.getByTestId("account-email")).toHaveText(session.email);
  const before = documentLoads;
  await page.getByTestId("me-companion").click();
  await expect(page.getByRole("heading", { name: "陪伴设置", exact: true })).toBeVisible();
  await page.getByTestId("page-back").click();
  await expect(page).toHaveURL(/#\/pages\/account\/account$/);
  await expect(page.getByTestId("account-email")).toHaveText(session.email);
  expect(documentLoads, "in-app Back must keep the current document").toBe(before);
});
