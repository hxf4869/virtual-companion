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

// navigateToPage only waits for the uni hash and ConsumerShell renders
// role="main" while page data is still loading, so Axe would otherwise
// audit skeletons. Each page is audited only after its own success
// content (existing selectors; loading/error render different testids)
// has actually rendered.
async function expectContentLoaded(page: Page, label: string, email: string): Promise<void> {
  if (label === "home") {
    // Authenticated sessions render VcHomeHero; the anonymous hero branch
    // is unreachable inside the shared session.
    await expect(page.getByTestId("home-hero")).toBeVisible();
  } else if (label === "chat") {
    // VcChatComposer only renders in the ready page state.
    await expect(page.getByTestId("message-input")).toBeVisible();
  } else if (label === "conversations") {
    // The skeleton/error branches own different testids; list and empty
    // are the mutually exclusive success states.
    await expect(
      page.getByTestId("conversations-list").or(page.getByTestId("conversations-empty")),
    ).toBeVisible();
  } else if (label === "account") {
    await expect(page.getByTestId("account-email")).toHaveText(email);
    // Trusted devices load asynchronously: ready only once loading/error
    // are gone and either the real list or the explicit empty state shows.
    const devices = page.getByTestId("trusted-devices");
    await expect(devices).not.toContainText("正在加载设备…");
    await expect(page.getByTestId("trusted-devices-error")).toHaveCount(0);
    await expect(devices).toContainText(/暂无信任的设备。|最近使用/);
  }
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
  const session = await openSharedSession(page, "chat");

  const pages = [
    ["/pages/index/index", "home"],
    ["/pages/chat/chat", "chat"],
    ["/pages/conversations/conversations", "conversations"],
    ["/pages/account/account", "account"],
  ] as const;
  for (const [href, label] of pages) {
    await navigateToPage(page, href);
    await expect(page.locator('[role="main"]').first()).toBeVisible();
    await expectContentLoaded(page, label, session.email);
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
