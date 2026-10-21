import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

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

// DESIGN §11 consumer H5 acceptance: every core page must hold at
// 320×568, 390×844 and 430×932. The dual-engine device projects only
// provide ~390/393 wide viewports, so this case sets each tier explicitly.
// UA/touch emulation from the projects is kept, but these remain emulated
// viewports, not real devices.
const DESIGN_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

// BottomNav item test ids in render order (首页 / 聊天 / 我的, DESIGN §6.2).
const NAV_ITEM_TEST_IDS = ["tab-home", "tab-chats", "tab-me"] as const;

interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function visibleBox(locator: Locator, label: string): Promise<ElementBox> {
  const box = await locator.boundingBox();
  expect(box, `${label} must be rendered with a bounding box`).toBeTruthy();
  if (!box) throw new Error(`${label} has no bounding box`);
  return box;
}

// ConsumerShell clips horizontal overflow (overflow-x: clip) and VcChatShell
// hides it (overflow: hidden), so scrollWidth can stay inside the viewport
// while content is actually cut off. The geometry checks therefore read
// element boxes instead of trusting scrollWidth alone.
function expectBoxWithinCanvas(
  box: ElementBox,
  canvasWidth: number,
  label: string,
): void {
  expect(box.x, `${label} must start inside the canvas`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${label} must end inside the canvas`)
    .toBeLessThanOrEqual(canvasWidth + 0.5);
}

function expectBoxWithinCell(inner: ElementBox, outer: ElementBox, label: string): void {
  expect(inner.x, `${label} must start inside its cell`).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y, `${label} must start inside its cell`).toBeGreaterThanOrEqual(outer.y);
  expect(inner.x + inner.width, `${label} must end inside its cell`)
    .toBeLessThanOrEqual(outer.x + outer.width);
  expect(inner.y + inner.height, `${label} must end inside its cell`)
    .toBeLessThanOrEqual(outer.y + outer.height);
}

async function applyDesignViewport(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  // Confirm the CSS viewport really reached the requested tier instead of
  // trusting the call on mobile-emulated contexts.
  await page.waitForFunction(
    (tier) => window.innerWidth === tier.width && window.innerHeight === tier.height,
    viewport,
  );
}

async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const fit = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(fit.document, `${label} must not scroll horizontally`)
    .toBeLessThanOrEqual(fit.viewport);
}

async function expectVisibleMainWithinCanvas(
  page: Page,
  label: string,
  canvasWidth: number,
): Promise<void> {
  // uni-app KeepAlive can keep hidden page instances mounted; require the one
  // visible main instead of .first() over duplicate role="main" nodes.
  const main = page.locator('[role="main"]:visible');
  await expect(main, `${label} must expose exactly one visible main`).toHaveCount(1);
  expectBoxWithinCanvas(
    await visibleBox(main, `${label} main`),
    canvasWidth,
    `${label} main`,
  );
}

async function expectBottomNavFits(
  page: Page,
  label: string,
  canvas: { width: number; height: number },
): Promise<void> {
  const nav = page.getByTestId("consumer-tabbar");
  await expect(nav, `${label} bottom nav must be visible`).toBeVisible();
  // uni-h5 renders template <button> as <uni-button>, so a CSS "button"
  // selector matches nothing; count entries by their item class instead.
  await expect(
    nav.locator(".vc-bottom-nav__item"),
    `${label} bottom nav must keep exactly three entries`,
  ).toHaveCount(3);

  const navBox = await visibleBox(nav, `${label} bottom nav`);
  expectBoxWithinCanvas(navBox, canvas.width, `${label} bottom nav`);
  expect(navBox.y + navBox.height, `${label} bottom nav must sit on the viewport bottom`)
    .toBeGreaterThanOrEqual(canvas.height - 1);
  expect(navBox.y + navBox.height, `${label} bottom nav must not drop below the viewport`)
    .toBeLessThanOrEqual(canvas.height + 0.5);

  const itemBoxes: ElementBox[] = [];
  for (const testId of NAV_ITEM_TEST_IDS) {
    const item = nav.getByTestId(testId);
    await expect(item, `${label} ${testId} must be visible`).toBeVisible();
    const itemBox = await visibleBox(item, `${label} ${testId}`);
    itemBoxes.push(itemBox);
    expectBoxWithinCanvas(itemBox, canvas.width, `${label} ${testId}`);
    const icon = await visibleBox(
      item.locator(".vc-bottom-nav__icon"),
      `${label} ${testId} icon`,
    );
    const text = await visibleBox(
      item.locator(".vc-bottom-nav__label"),
      `${label} ${testId} label`,
    );
    expectBoxWithinCell(icon, itemBox, `${label} ${testId} icon`);
    expectBoxWithinCell(text, itemBox, `${label} ${testId} label`);
  }
  const widths = itemBoxes.map((box) => box.width);
  expect(
    Math.max(...widths) - Math.min(...widths),
    `${label} bottom nav entries must be equal width`,
  ).toBeLessThanOrEqual(1);
}

async function expectChatComposerFits(
  page: Page,
  label: string,
  canvasWidth: number,
): Promise<void> {
  const composer = page.locator(".vc-chat-composer");
  await expect(composer, `${label} composer must be visible`).toBeVisible();
  const composerBox = await visibleBox(composer, `${label} composer`);
  expectBoxWithinCanvas(composerBox, canvasWidth, `${label} composer`);

  const input = page.getByTestId("message-input");
  await expect(input, `${label} message input must be visible`).toBeVisible();
  expectBoxWithinCanvas(
    await visibleBox(input, `${label} message input`),
    canvasWidth,
    `${label} message input`,
  );

  const send = page.getByTestId("send");
  await expect(send, `${label} send action must be visible`).toBeVisible();
  expectBoxWithinCanvas(
    await visibleBox(send, `${label} send action`),
    canvasWidth,
    `${label} send action`,
  );

  const navBox = await visibleBox(
    page.getByTestId("consumer-tabbar"),
    `${label} bottom nav`,
  );
  expect(composerBox.y + composerBox.height, `${label} composer must not cover the bottom nav`)
    .toBeLessThanOrEqual(navBox.y + 1);
}

async function captureFitEvidence(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const { width, height } = await canvasSize(page);
  // Synthetic pages only. outputPath keeps the files inside this run's
  // output directory, so --output can collect them outside the repository;
  // the installed Playwright (1.62.1) defaults preserveOutput to "always",
  // so passing tests keep their screenshots too.
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${label}-${width}x${height}.png`),
  });
}

test("current product fits required viewports", async ({ page }, testInfo) => {
  // Anonymous cookieless context: the login page is the only core page that
  // renders before authentication; auditing it after openSharedSession would
  // only capture the authenticated redirect away from the real login layout.
  await page.goto("/#/pages/login/login");
  const loginHeading = page.getByRole("heading", { name: "登录", level: 1 });
  await expect(loginHeading).toBeVisible();
  for (const viewport of DESIGN_VIEWPORTS) {
    await applyDesignViewport(page, viewport);
    await expect(loginHeading).toBeVisible();
    // Capture first: the same screenshot doubles as the diagnostic when a
    // geometry assertion below fails.
    await captureFitEvidence(page, testInfo, "login");
    await expectNoHorizontalScroll(page, `login@${viewport.width}`);
    const canvas = await canvasSize(page);
    await expectVisibleMainWithinCanvas(page, `login@${viewport.width}`, canvas.width);
  }

  // One shared cookie session covers every authenticated page at every tier:
  // no per-tier accounts and no extra real logins against the runtime's
  // shared authenticator budget.
  const session = await openSharedSession(page, "chat");

  // conversations is a consumer-sub page (navigation.ts) and renders no
  // bottom nav; the other three are tab roots that must keep it.
  const pages = [
    ["/pages/index/index", "home", true],
    ["/pages/chat/chat", "chat", true],
    ["/pages/conversations/conversations", "conversations", false],
    ["/pages/account/account", "account", true],
  ] as const;
  for (const [href, label, hasBottomNav] of pages) {
    await navigateToPage(page, href);
    for (const viewport of DESIGN_VIEWPORTS) {
      await applyDesignViewport(page, viewport);
      // role="main" alone does not mean ready: reuse the per-page success
      // content gate from the a11y case.
      await expectContentLoaded(page, label, session.email);
      await captureFitEvidence(page, testInfo, label);
      await expectNoHorizontalScroll(page, `${label}@${viewport.width}`);
      const canvas = await canvasSize(page);
      await expectVisibleMainWithinCanvas(page, `${label}@${viewport.width}`, canvas.width);
      if (hasBottomNav) {
        await expectBottomNavFits(page, `${label}@${viewport.width}`, canvas);
      } else {
        await expect(
          page.getByTestId("consumer-tabbar"),
          `${label} is a secondary page and must not repeat the bottom nav`,
        ).toBeHidden();
      }
      if (label === "chat") {
        await expectChatComposerFits(page, `${label}@${viewport.width}`, canvas.width);
      }
    }
  }
});
