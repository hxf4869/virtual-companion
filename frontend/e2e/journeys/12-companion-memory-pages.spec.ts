import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, openSharedSession } from "../helpers";

/**
 * DOGFOOD-xx companion + memory settings journeys: the two pages added with
 * the audit-remediation round. They drive only visible product UI against the
 * isolated synthetic stack — no provider calls are involved.
 */

/** uni-app renders <input> as a wrapper custom element; fill whichever level
 * holds the real <input>. */
async function fillUniInput(page: Page, testid: string, value: string): Promise<void> {
  const host = page.getByTestId(testid);
  const native = host.locator("input");
  if ((await native.count()) > 0) {
    await native.fill(value);
  } else {
    await host.fill(value);
  }
}

async function readUniInputValue(page: Page, testid: string): Promise<string> {
  return page.getByTestId(testid).evaluate((element) => {
    const input = element.matches("input")
      ? (element as HTMLInputElement)
      : element.querySelector("input");
    return input ? input.value : element.textContent ?? "";
  });
}

test("companion settings save survives a full re-read", async ({ page }) => {
  await openSharedSession(page, "memory");
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();

  await fillUniInput(page, "pref-companion-name", "小白");
  await page.getByTestId("pref-reply-length-SHORT").click();
  await page.getByTestId("pref-initiative-MEDIUM").click();
  await expect(page.getByTestId("companion-dirty")).toBeVisible();

  await page.getByTestId("companion-save").click();
  await expect(page.getByTestId("companion-saved")).toBeVisible();

  // Leave and come back: the form baseline must come from the server, not
  // from in-page state.
  await navigateToPage(page, "/pages/account/account");
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe("小白");
  await expect(page.getByTestId("pref-reply-length-SHORT")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("pref-initiative-MEDIUM")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("memory page autosave toggle round-trips through the server", async ({ page }) => {
  await openSharedSession(page, "memory");
  await navigateToPage(page, "/pages/memory/memory");

  // The toggle stays disabled while loading; the ready note is the sync point.
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  const toggle = page.getByTestId("autosave-toggle");
  // V66 default: auto memory starts enabled.
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveText("已开启");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveText("已关闭");

  await navigateToPage(page, "/pages/account/account");
  await navigateToPage(page, "/pages/memory/memory");
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "false");

  // A fresh user has no memories yet: the empty state renders.
  await expect(page.getByTestId("memory-empty")).toBeVisible();

  // Restore the default so the shared seeded user keeps its baseline state.
  await page.getByTestId("autosave-toggle").click();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
});
