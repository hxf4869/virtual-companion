import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, openSharedSession, provisionUser } from "../helpers";

type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

function summarize(violations: AxeViolations): string {
  return violations.map((violation) => (
    `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`
  )).join("\n");
}

async function expectAccessibleAndFit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `[${label}]\n${summarize(results.violations)}`).toEqual([]);
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document, `${label} must not scroll horizontally`).toBeLessThanOrEqual(width.viewport);
}

test("login and the current mobile product pages remain accessible", async ({ page, request }) => {
  await page.goto("/#/pages/index/index");
  await page.waitForURL((url) => url.hash.startsWith("#/pages/login/login"));
  // The uni hash redirect can win the race against the Vue page mount (seen on
  // webkit); audit only after the login screen content actually rendered.
  await expect(page.getByRole("heading", { name: "登录", level: 1 })).toBeVisible();
  await expectAccessibleAndFit(page, "login-disabled-submit");

  const user = await provisionUser(request, "accessibility");
  await page.locator('[data-testid="account"] input').fill(user.email);
  await page.locator('[data-testid="password"] input').fill(user.password);
  await expectAccessibleAndFit(page, "login-ready-submit");
  // The a11y journey audits pages, not the login flow (01/02 own that); the
  // product pages are entered through the shared session so the full run
  // stays inside the backend's real authenticator rate-limit budget.
  await openSharedSession(page, "chat");

  const pages = [
    ["/pages/index/index", "home"],
    ["/pages/chat/chat", "chat"],
    ["/pages/conversations/conversations", "conversations"],
    ["/pages/account/account", "account"],
  ] as const;
  for (const [href, label] of pages) {
    await navigateToPage(page, href);
    await expect(page.locator('[role="main"]').first()).toBeVisible();
    await expectAccessibleAndFit(page, label);
  }

  await navigateToPage(page, "/pages/index/index");
  const nav = page.getByTestId("consumer-tabbar");
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(52);
  expect(box?.height ?? 999).toBeLessThanOrEqual(54);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
});
