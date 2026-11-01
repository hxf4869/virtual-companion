// 新的合成账号第一次进 ST 会弹首次引导；手机界面会把它当宿主弹窗交给 ST 视图。
// 受管场景先在顶层页面完成引导，再测手机界面（与 f2 等场景的 nativeReady 相同做法）。
export async function completeStOnboarding(context, stBase) {
    const page = await context.newPage();
    try {
        await page.goto(stBase);
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'), null, { timeout: 180000 });
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('合成验收用户');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady, null, { timeout: 120000 });
        await page.waitForTimeout(1500);
    } finally {
        await page.close();
    }
}
