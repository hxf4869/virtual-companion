// DR-5：真实生产页面、冻结源码和合成 API；不访问运行实例或真实用户数据。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { startPreview, settle } from './lib/ux11-preview.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-5');
const REFERENCES = [
    'instance-page.js',
    'persona.js',
    'ui/nav.js',
    'instance.css',
    'desktop/characters.css',
    'memory-page.js',
    'diary-page.js',
    'favorites-page.js',
    'memory.css',
    'desktop/memory.css',
    'inbox-page.js',
    'inbox.css',
    'desktop/inbox.css',
    'desktop/presentation.js',
];

async function charactersInteraction(page, open) {
    await open(1440, 'light', 'detail=1');
    const input = page.locator('.vc-character-detail [name="displayName"]');
    await input.focus();
    await page.evaluate(() => {
        window.DR_ROLE_INPUT = document.activeElement;
    });
    await input.pressSequentially('合成连续输入');
    assert.equal(
        await page.evaluate(() => window.DR_ROLE_INPUT.isConnected && document.activeElement === window.DR_ROLE_INPUT),
        true,
        '连续输入不能重建实例名称输入框',
    );
    const draft = await input.inputValue();
    await page.locator('.vc-sidebar [data-nav="chat"]').click();
    await page.locator('.vc-sidebar [data-nav="characters"]').click();
    await page.waitForFunction(() => !document.querySelector('.vc-characters [aria-busy="true"]'));
    assert.equal(await input.inputValue(), draft, '离开后返回缓存角色页保留未保存名称');
    await page.locator('.vc-character-detail [data-action="back"]').click();
    await page.locator('.vc-alert').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-vc-cancel]') === document.activeElement);
    assert.equal(await page.locator('[data-vc-cancel]').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await page.locator('.vc-alert').waitFor({ state: 'detached' });
    assert.equal(await input.inputValue(), draft, 'Esc取消保留原草稿');
    await page.evaluate(() => {
        window.DR_ROLE_WRITES = [];
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (init.method === 'PATCH' && /\/relationships\/\d+$/.test(String(url))) {
                window.DR_ROLE_WRITES.push(JSON.parse(init.body));
                return new Promise((resolve) => {
                    window.DR_ROLE_RESUME = () => resolve(fetch(url, init));
                });
            }
            return fetch(url, init);
        };
    });
    await page.locator('.vc-character-detail [type="submit"]').click();
    await page.waitForFunction(() => window.DR_ROLE_WRITES.length === 1);
    assert.equal(await input.isDisabled(), true, '保存等待时锁定名称，防止晚到回写覆盖新输入');
    assert.equal(
        await page.locator('.vc-character-detail [data-action="back"]').isDisabled(),
        true,
        '等待时拒绝详情离开',
    );
    await page.evaluate(() => {
        document
            .querySelector('.vc-character-detail form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(await page.evaluate(() => window.DR_ROLE_WRITES.length), 1, '重复提交只产生一次原 PATCH');
    await page.evaluate(() => window.DR_ROLE_RESUME());
    await page.waitForFunction(() => !document.querySelector('.vc-character-detail [name="displayName"]').disabled);
    assert.deepEqual(await page.evaluate(() => window.DR_ROLE_WRITES[0]), {
        companionName: draft,
        userAddressAs: null,
        replyLength: 'MEDIUM',
        initiative: 'LOW',
        humor: 'LIGHT',
        advicePref: 'ASK_FIRST',
        remindersAllowed: true,
        memoryShareScope: 'RELATIONSHIP',
        avoidTopics: [],
        gender: 'FEMALE',
        avatarRef: 'AVATAR_FEMALE_01',
    });
    await input.focus();
    await page.evaluate(() => {
        window.DR_ROLE_INPUT = document.activeElement;
    });
    for (const width of [1280, 1024, 1023, 864, 768, 744, 390, 864, 1440]) {
        await page.setViewportSize({ width, height: width === 864 ? 390 : 900 });
        await settle(page);
        assert.equal(await page.evaluate(() => window.DR_ROLE_INPUT.isConnected), true, `缩窗保留原字段 ${width}`);
        await page.locator('.vc-character-detail [type="submit"]').click({ trial: true });
    }
    await page.evaluate(() => {
        window.DR_ROLE_RETIRED_SAVE = document.querySelector('.vc-character-detail [type="submit"]');
        window.VC_CHARACTERS_PREVIEW.handle.destroy();
        window.DR_ROLE_RETIRED_SAVE.click();
    });
    assert.equal(await page.locator('.vc-characters').count(), 0);
    assert.equal(await page.evaluate(() => window.DR_ROLE_WRITES.length), 1, '卸载的旧保存不再写入');
}

async function memoryInteraction(page, open) {
    await open();
    const search = page.getByRole('searchbox', { name: '搜索记忆', exact: true });
    await search.fill('桂花');
    await page.evaluate(() => {
        window.DR_MEMORY_SEARCH = document.activeElement;
    });
    await search.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.vc-memory-results[aria-busy="true"]'));
    assert.equal(
        await page.evaluate(
            () => window.DR_MEMORY_SEARCH.isConnected && document.activeElement === window.DR_MEMORY_SEARCH,
        ),
        true,
        '提交检索保留同一输入框与焦点',
    );
    assert.equal(await page.locator('.vc-memory-row').count(), 1);
    await search.fill('');
    await search.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.vc-memory-row').length === 6);
    await page.evaluate(() =>
        window.VC_PREVIEW.modules.memory.check({ params: new URLSearchParams('section=timeline') }),
    );
    for (const [action, tabs] of [
        ['cancel-inline', 1],
        ['save-inline', 2],
    ]) {
        await open();
        await page.locator('.vc-mem-card').first().hover();
        await page.locator('[data-action="edit-inline"]').first().click();
        await page.locator('.vc-mem-card.is-editing textarea').focus();
        for (let i = 0; i < tabs; i++) await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.action), action);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.vc-mem-card.is-editing').count(), 0, `行内${action}按钮焦点下Esc仍能取消`);
    }
    await open(1440, 'light', '');
    await page.evaluate(() => window.VC_PREVIEW.modules.memory.check({ params: new URLSearchParams() }));
    await open(1440, 'light', 'screen=edit');
    const area = page.locator('.vc-memory-detail-screen textarea[name="summary"]');
    await area.fill('合成跨窗口纠正草稿');
    await page.evaluate(() => {
        window.DR_MEMORY_DRAFT_NODE = document.activeElement;
    });
    for (const width of [1280, 1024, 864, 768, 744, 390, 864, 1440]) {
        await page.setViewportSize({ width, height: width === 864 ? 390 : width < 744 ? 844 : 900 });
        await settle(page);
        assert.equal(
            await page.evaluate(() => window.DR_MEMORY_DRAFT_NODE.isConnected),
            true,
            `记忆详情缩窗保留字段 ${width}`,
        );
        assert.equal(
            await page.evaluate(() => window.DR_MEMORY_DRAFT_NODE === document.activeElement),
            true,
            `记忆详情缩窗保留焦点 ${width}`,
        );
        assert.equal(await area.inputValue(), '合成跨窗口纠正草稿');
        await page.locator('.vc-memory-detail-screen [data-form="edit"] [type="submit"]').click({ trial: true });
        await area.focus();
    }
    await page.keyboard.press('Escape');
    await page.locator('.vc-alert').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-vc-cancel]') === document.activeElement);
    await page.keyboard.press('Escape');
    await page.locator('.vc-alert').waitFor({ state: 'detached' });
    assert.equal(await area.inputValue(), '合成跨窗口纠正草稿');
    await page.locator('.vc-memory-detail-screen [data-action="cancel-edit"]').click();
    await page.locator('.vc-memory-detail-screen [data-action="confirm-forget"]').click();
    await page.locator('.vc-alert .vc-alert-copy p').waitFor();
    assert.equal(
        await page.locator('.vc-alert .vc-alert-copy p').textContent(),
        '聊天原文仍保留，可能继续用于当前对话。',
    );
    await page.evaluate(() => window.VC_MEMORY_PREVIEW.handle.destroy());
    assert.equal(await page.locator('.vc-memory-detail-screen').count(), 0);
    assert.equal(await page.locator('.vc-memory-editor-scrim,.vc-alert').count(), 0, '父页销毁释放详情与子弹层');
    await open();
    await page.locator('.vc-mem-card').first().hover();
    await page.locator('[data-action="forget-inline"]').first().click();
    await page.locator('.vc-alert').waitFor();
    await page.evaluate(() => window.VC_MEMORY_PREVIEW.handle.destroy());
    assert.equal(await page.locator('.vc-alert').count(), 0, '普通页面销毁也释放其未完成确认');
    assert.equal(await page.evaluate(() => window.__previewRequests.filter((r) => r.method === 'DELETE').length), 0);
    for (const section of ['diary', 'favorites']) {
        await open(1440, 'light', `section=${section}`);
        await page.evaluate(
            (section) => window.VC_PREVIEW.modules.memory.check({ params: new URLSearchParams(`section=${section}`) }),
            section,
        );
    }
}

async function inboxInteraction(page, open) {
    const field = page.locator('[data-field="quietHoursStart"]');
    const save = page.locator('[data-action="save-policy"]');
    const sidebar = (nav) => page.locator(`.vc-sidebar [data-nav="${nav}"]`);
    async function record({ reject = '', status = 409, hold = false } = {}) {
        await page.evaluate(
            ({ reject, status, hold }) => {
                window.DR_INBOX_WRITES = [];
                const fetch = window.fetch;
                window.fetch = (url, init = {}) => {
                    if (init.method === 'PUT') {
                        window.DR_INBOX_WRITES.push({ url: String(url), body: JSON.parse(init.body) });
                        const response = () =>
                            reject
                                ? new Response(JSON.stringify({ code: reject }), {
                                      status,
                                      headers: { 'Content-Type': 'application/json' },
                                  })
                                : fetch(url, init);
                        if (hold)
                            return new Promise((resolve) => {
                                window.DR_INBOX_RESUME = () => resolve(response());
                            });
                        return Promise.resolve(response());
                    }
                    return fetch(url, init);
                };
            },
            { reject, status, hold },
        );
    }
    async function unlock() {
        await page.waitForFunction(() => !document.querySelector('[data-field="quietHoursStart"]').disabled);
    }
    await open();
    await field.fill('22:30');
    await field.focus();
    await page.evaluate(() => {
        window.DR_INBOX_FIELD = document.activeElement;
    });
    const offline = page.getByRole('switch', { name: '离线生成', exact: true });
    const checked = await offline.getAttribute('aria-checked');
    await offline.focus();
    await page.keyboard.press('Space');
    assert.notEqual(await offline.getAttribute('aria-checked'), checked, '库开关支持原生 Space');
    assert.equal(await field.inputValue(), '22:30');
    assert.equal(
        await page.evaluate(() => window.DR_INBOX_FIELD === document.querySelector('[data-field="quietHoursStart"]')),
        true,
    );
    const mode = page.getByRole('radiogroup', { name: '模式', exact: true });
    await mode.getByRole('radio', { name: '日常', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
        await mode.getByRole('radio', { name: '亲近', exact: true }).getAttribute('aria-checked'),
        'true',
        '模式方向键由Base UI处理',
    );
    await record({ hold: true });
    await save.click();
    assert.equal(await field.isDisabled(), true, '保存等待时锁住原草稿');
    await page.evaluate(() => {
        document.querySelector('[data-action="save-policy"]').click();
        document.querySelector('.vc-sidebar [data-nav="characters"]').click();
    });
    assert.equal(await page.locator('.vc-alert').count(), 0);
    assert.equal(await page.locator('.vc-inbox-workspace').isVisible(), true, '写入等待拒绝导航');
    assert.equal(await page.evaluate(() => window.DR_INBOX_WRITES.length), 1, '保存不可重入');
    await page.evaluate(() => window.DR_INBOX_RESUME());
    await unlock();
    assert.equal(await field.inputValue(), '22:30');
    for (const width of [1280, 1024, 1023, 864, 768, 744, 743, 390, 864, 1440]) {
        await page.setViewportSize({ width, height: width === 864 ? 390 : 900 });
        await settle(page);
        assert.equal(
            await page.evaluate(
                () => window.DR_INBOX_FIELD === document.querySelector('[data-field="quietHoursStart"]'),
            ),
            true,
            `陪伴字段缩窗不重建 ${width}`,
        );
        await field.fill('22:31');
        await save.click({ trial: true });
    }
    await open();
    await page.evaluate(() => window.VC_PREVIEW.modules.inbox.check({ params: new URLSearchParams() }));

    // 切角色沿用未保存确认；取消留在原作用域，丢弃后才请求新作用域。
    await open();
    await field.fill('22:30');
    await page.locator('[data-action="pick-character"]').click();
    await page.getByRole('menuitem', { name: '林舟 · 散步', exact: true }).click();
    await page.locator('.vc-alert [data-vc-cancel]').click();
    assert.equal(await field.inputValue(), '22:30');
    await page.locator('[data-action="pick-character"]').click();
    await page.getByRole('menuitem', { name: '林舟 · 散步', exact: true }).click();
    await page.locator('.vc-alert [data-vc-ok]').click();
    await unlock();
    await page.waitForFunction(() =>
        document.querySelector('[data-action="pick-character"]').textContent.includes('林舟'),
    );
    assert.equal(await field.inputValue(), '23:00', '丢弃后读取新角色自己的策略');

    // 渠道的可见 button 处理键盘，隐藏代理仍在 DOM；草稿不回流成明文 props。
    await open(1440, 'light', 'channel=EMAIL');
    await record({ hold: true });
    const target = page.locator('[data-channel-card] [data-field="configuredTarget"]');
    const secret = page.locator('[data-channel-card] [data-field="credential"]');
    await target.fill('synthetic@example.test');
    await secret.fill('synthetic-credential');
    await secret.focus();
    await page.evaluate(() => {
        window.DR_INBOX_SECRET = document.activeElement;
    });
    const channelSwitch = page.locator('[data-action="toggle-channel"]');
    await channelSwitch.focus();
    await page.keyboard.press('Space');
    assert.equal(await channelSwitch.getAttribute('aria-checked'), 'true');
    assert.equal(await secret.inputValue(), 'synthetic-credential');
    assert.equal(
        await page.evaluate(
            () => window.DR_INBOX_SECRET === document.querySelector('[data-channel-card] [data-field="credential"]'),
        ),
        true,
    );
    assert.equal(await secret.getAttribute('value'), null);
    assert.equal(await page.locator('[data-channel-card] input[type="checkbox"][aria-hidden="true"]').count(), 4);
    await page.locator('[data-action="save-channel"]').click();
    assert.equal(await secret.isDisabled(), true);
    await page.evaluate(() => window.DR_INBOX_RESUME());
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-action="save-policy"]').disabled ||
            !document.querySelector('[data-channel-card]'),
    );
    const sent = await page.evaluate(() => window.DR_INBOX_WRITES[0].body);
    assert.deepEqual(sent, {
        channel: 'EMAIL',
        enabled: true,
        configuredTarget: 'synthetic@example.test',
        previewBody: false,
        relationshipIds: ['11'],
        credential: 'synthetic-credential',
    });
    await page.locator('[data-action="open-channel"][data-channel="EMAIL"]').click();
    await secret.waitFor();
    assert.equal(await secret.inputValue(), '', '保存后清除凭据 DOM');
    assert.equal(await target.inputValue(), 'synthetic@example.test');
    await secret.fill('synthetic-draft');
    await sidebar('chat').click();
    await sidebar('inbox').click();
    assert.equal(await secret.inputValue(), 'synthetic-draft', '缓存页面返回不刷新掉渠道草稿');
    await page.locator('[data-action="clear-credential"]').click();
    assert.equal(await secret.inputValue(), '', '清除动作立即清空实际密码字段');
    await page.evaluate(() => {
        window.DR_INBOX_RETIRED = document.querySelector('[data-action="save-channel"]');
        window.VC_INBOX_PREVIEW.handle.destroy();
        window.DR_INBOX_RETIRED.click();
    });
    assert.equal(await page.evaluate(() => window.DR_INBOX_WRITES.length), 1, '卸载旧按钮不能写入');
    assert.equal(await secret.count(), 0);

    // 冲突层的两种选择及关闭动画期间销毁；迟到回调不能重建父页面。
    for (const action of ['keep-policy-draft', 'view-latest-policy']) {
        await open();
        await record({ reject: 'REVISION_CONFLICT' });
        await field.fill('22:30');
        await save.click();
        const sheet = page.locator('.vc-sheet[aria-label="保存冲突"]');
        await sheet.waitFor();
        await sheet.locator(`[data-action="${action}"]`).click();
        await sheet.waitFor({ state: 'detached' });
        assert.equal(await field.inputValue(), action === 'keep-policy-draft' ? '22:30' : '23:00');
    }
    await open();
    await record({ reject: 'REVISION_CONFLICT', hold: true });
    await field.fill('22:30');
    await save.click();
    await page.evaluate(() => {
        const external = document.createElement('button'); external.textContent = '合成外部宿主控件'; document.body.append(external); external.focus();
        window.DR_INBOX_RESUME();
    });
    await page.locator('.vc-sheet[aria-label="保存冲突"]').waitFor();
    await page.evaluate(() => {
        document.querySelector('[data-action="view-latest-policy"]').click();
        window.VC_INBOX_PREVIEW.handle.destroy();
    });
    assert.equal(await page.locator('.vc-sheet,.vc-scrim').count(), 0, '外部宿主焦点下的独立冲突层也须同步销毁');
    await settle(page);
    await page.waitForTimeout(250);
    assert.equal(
        await page.locator('.vc-sheet,.vc-scrim,.vc-inbox-workspace').count(),
        0,
        '关闭动画中父页销毁释放全部层',
    );

    // 重新验证失败不重放写入，成功才提交；敏感值只经原接口传输。
    await open();
    await record({ reject: 'ACCESS_DENIED', status: 403 });
    await field.fill('22:30');
    await save.click();
    const auth = page.locator('dialog.vc-reauth-dialog[open]');
    await auth.waitFor();
    await page.evaluate(() => {
        const fetch = window.fetch;
        let authAttempts = 0;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/auth/reauth')) {
                authAttempts++;
                if (authAttempts === 1)
                    return Promise.resolve(
                        new Response(JSON.stringify({ code: 'NOT_FOUND_OR_FORBIDDEN' }), {
                            status: 404,
                            headers: { 'Content-Type': 'application/json' },
                        }),
                    );
            }
            // 原策略重放改回原合成fixture，由真实控制器再发一次。
            if (authAttempts > 1 && init.method === 'PUT') {
                window.DR_INBOX_WRITES.push({ url: String(url), body: JSON.parse(init.body) });
                return Promise.resolve(
                    new Response(JSON.stringify({ ...JSON.parse(init.body), relationshipId: '11' }), {
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
            }
            return fetch(url, init);
        };
    });
    const password = auth.locator('[data-field="reauth-password"]');
    await password.fill('synthetic-password');
    await auth.locator('[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-reauth-error]').textContent.includes('密码不正确'));
    assert.equal(await password.inputValue(), '');
    assert.equal(await page.evaluate(() => window.DR_INBOX_WRITES.length), 1);
    await password.fill('synthetic-password');
    await auth.locator('[type="submit"]').click();
    await auth.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.DR_INBOX_WRITES.length), 2);
    assert.equal(await field.inputValue(), '22:30');

    await open(); await field.fill('22:30'); await sidebar('characters').click();
    await page.locator('.vc-alert').waitFor();
    await page.evaluate(() => window.VC_INBOX_PREVIEW.handle.destroy());
    assert.equal(await page.locator('.vc-alert,.vc-scrim').count(), 0, '外部侧栏触发的未保存确认随页面同步销毁');

    await open(1440, 'light', 'messages=1');
    await page.locator('[data-action="open-conversation"]').first().click();
    await page.waitForFunction(() => window.VC_INBOX_PREVIEW.opened.length === 1);
    assert.deepEqual(await page.evaluate(() => window.VC_INBOX_PREVIEW.opened[0]), {
        eventId: 'synthetic-greeting',
        conversationId: '21',
        relationshipId: '11',
    });
    assert.match(await page.locator('.vc-inbox-msg').first().textContent(), /已读/);
}

export async function runDesktopPages({
    captureReference = false,
    compareReference = false,
    checkOnly = false,
    feature = 'characters',
} = {}) {
    assert.ok(['characters', 'memory', 'inbox', 'rich', 'all'].includes(feature), 'feature须为characters/memory/inbox/rich/all');
    const out = feature === 'rich' ? path.join(ROOT, '.review-queue/DR-7') : OUT;
    const references = feature === 'rich' ? ['story-page.js', 'story.css', 'desktop/story.css', 'desktop/presentation.js', 'lightbox.js', 'stickers.js', 'stickers.css', 'voice.js', 'voice.css', 'desktop/rich.css'] : REFERENCES;
    const preview = await startPreview();
    let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: ['--disable-partial-raster', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'],
        });
        const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => {
            localStorage.clear();
            localStorage.setItem('vc-reduced-motion', String(new URLSearchParams(location.search).get('motion') !== 'standard'));
        });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        if (captureReference) {
            const refs = new Map(
                await Promise.all(
                    references.map(async (file) => [file, await readFile(path.join(out, 'reference', file), 'utf8')]),
                ),
            );
            await page.route('**/source/**', (route) => {
                const file = new URL(route.request().url()).pathname.split('/source/')[1];
                return refs.has(file)
                    ? route.fulfill({
                          contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
                          body: refs.get(file),
                      })
                    : route.continue();
            });
        }
        async function open(width = 1440, theme = 'light', extra = '') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=characters&theme=${theme}&${extra}`);
            await settle(page);
        }
        let shots = 0;
        async function snapshot(name) {
            await settle(page);
            const data = await page.screenshot({ animations: 'disabled' });
            const target = path.join(out, captureReference ? 'before' : 'after', `${name}.png`);
            await mkdir(path.dirname(target), { recursive: true });
            if (captureReference) {
                try {
                    await writeFile(target, data, { flag: 'wx' });
                } catch (error) {
                    if (error.code !== 'EEXIST') throw error;
                    assert.ok(
                        PNG.sync.read(data).data.equals(PNG.sync.read(await readFile(target)).data),
                        `${name} 参照不能覆盖`,
                    );
                }
            } else await writeFile(target, data);
            if (compareReference) {
                const before = PNG.sync.read(await readFile(path.join(out, 'before', `${name}.png`))),
                    after = PNG.sync.read(data);
                assert.ok(
                    before.width === after.width && before.height === after.height && before.data.equals(after.data),
                    `${name} 正常视觉发生差异`,
                );
            }
            shots++;
        }
        if (!checkOnly && ['characters', 'all'].includes(feature)) {
            for (const width of [1440, 864, 390])
                for (const theme of ['light', 'dark']) {
                    await open(width, theme);
                    await snapshot(`characters-${width}-${theme}`);
                    await page.locator('.vc-role[data-ref]').first().click();
                    await snapshot(`characters-detail-${width}-${theme}`);
                    await page.locator('.vc-character-detail [data-action="create"]').click();
                    await snapshot(`characters-create-${width}-${theme}`);
                    await page.locator('.vc-character-detail [data-action="edit-persona"]').click();
                    await snapshot(`characters-persona-${width}-${theme}`);
                }
            for (const theme of ['light', 'dark'])
                for (const state of ['empty', 'loading', 'error', 'long']) {
                    await open(1440, theme, `state=${state}`);
                    await snapshot(`characters-${state}-${theme}`);
                }
            for (const width of [1440, 390])
                for (const theme of ['light', 'dark']) {
                    await open(width, theme);
                    await page.evaluate(async () => {
                        const { mountInstancePage } = await import('/source/instance-page.js');
                        window.DR_INSTANCE = mountInstancePage({
                            getCards: () => [{ characterRef: 'synthetic-xiaoman', name: '小满' }],
                        });
                        await window.DR_INSTANCE.open();
                    });
                    await snapshot(`instances-${width}-${theme}`);
                    await page.locator('.vc-instance-dialog [name="displayName"]').fill('合成草稿');
                    await page.locator('.vc-instance-dialog [data-action="close"]').click();
                    await page.locator('.vc-instance-unsaved').waitFor();
                    await snapshot(`instances-unsaved-${width}-${theme}`);
                }
        }
        async function openMemory(width = 1440, theme = 'light', extra = 'section=timeline') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=memory&theme=${theme}&${extra}`);
            await settle(page);
        }
        if (!checkOnly && ['memory', 'all'].includes(feature)) {
            for (const width of [1440, 864, 390])
                for (const theme of ['light', 'dark']) {
                    await openMemory(width, theme);
                    await snapshot(`memory-${width}-${theme}`);
                    await page.locator('.vc-memory-row .vc-memory-summary').first().click();
                    await page.locator('.vc-memory-detail-screen .vc-memory-title').waitFor();
                    await snapshot(`memory-detail-${width}-${theme}`);
                    await page.locator('.vc-memory-detail-screen [data-action="edit"]').click();
                    await snapshot(`memory-edit-${width}-${theme}`);
                    if (width < 744) continue;
                    await openMemory(width, theme);
                    await page.locator('.vc-mem-card').first().hover();
                    await page.locator('[data-action="edit-inline"]').first().click();
                    await page.locator('.vc-mem-card.is-editing textarea').waitFor();
                    await snapshot(`memory-inline-${width}-${theme}`);
                    await openMemory(width, theme, 'section=diary');
                    await snapshot(`memory-diary-${width}-${theme}`);
                    await page.locator('[data-action="diary-month"][data-delta="1"]').click();
                    await page.locator('.vc-diary .vc-memory-empty').waitFor();
                    await snapshot(`memory-diary-empty-${width}-${theme}`);
                    await openMemory(width, theme, 'section=favorites');
                    await snapshot(`memory-favorites-${width}-${theme}`);
                    await page.locator('[data-action="fav-segment"][data-segment="reminders"]').click();
                    await snapshot(`memory-reminders-${width}-${theme}`);
                }
            for (const theme of ['light', 'dark'])
                for (const state of ['empty', 'loading', 'error', 'long']) {
                    await openMemory(1440, theme, `state=${state}${state === 'long' ? '&screen=detail' : ''}`);
                    await snapshot(`memory-${state}-${theme}`);
                }
            for (const width of [1440, 390])
                for (const theme of ['light', 'dark']) {
                    await openMemory(width, theme);
                    await page.evaluate(async () => {
                        const { mountMemoryPage } = await import('/source/memory-page.js');
                        window.DR_MEMORY_DIALOG = mountMemoryPage({ getRelationshipId: () => '11' });
                        await window.DR_MEMORY_DIALOG.open();
                    });
                    await snapshot(`memory-dialog-${width}-${theme}`);
                    await page.locator('.vc-memory-dialog .vc-memory-row').first().click();
                    await page.locator('.vc-memory-dialog .vc-memory-detail-body').waitFor();
                    await snapshot(`memory-dialog-detail-${width}-${theme}`);
                    await page.locator('.vc-memory-dialog [data-action="edit"]').click();
                    await snapshot(`memory-dialog-edit-${width}-${theme}`);
                }
        }
        async function openInbox(width = 1440, theme = 'light', extra = '') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=inbox&theme=${theme}&${extra}`);
            await settle(page);
        }
        async function rejectPolicy(code, status) {
            await page.evaluate(
                ({ code, status }) => {
                    const fetch = window.fetch;
                    window.fetch = (url, init = {}) =>
                        init.method === 'PUT' && String(url).endsWith('/proactive-policy')
                            ? Promise.resolve(
                                  new Response(JSON.stringify({ code }), {
                                      status,
                                      headers: { 'Content-Type': 'application/json' },
                                  }),
                              )
                            : fetch(url, init);
                },
                { code, status },
            );
        }
        if (!checkOnly && ['inbox', 'all'].includes(feature)) {
            for (const width of [1440, 864, 390])
                for (const theme of ['light', 'dark']) {
                    for (const [state, extra] of [
                        ['default', ''],
                        ['messages', 'messages=1'],
                        ['voice', 'messages=1&voice=1'],
                    ]) {
                        await openInbox(width, theme, extra);
                        await snapshot(`inbox-${state}-${width}-${theme}`);
                    }
                    for (const channel of ['EMAIL', 'FEISHU']) {
                        await openInbox(width, theme, `channel=${channel}`);
                        await snapshot(`inbox-channel-${channel}-${width}-${theme}`);
                    }
                    await openInbox(width, theme);
                    await page.locator('[data-field="quietHoursStart"]').fill('22:30');
                    await snapshot(`inbox-dirty-${width}-${theme}`);
                    for (const [state, code, status] of [
                        ['conflict', 'REVISION_CONFLICT', 409],
                        ['reauth', 'ACCESS_DENIED', 403],
                    ]) {
                        await openInbox(width, theme);
                        await rejectPolicy(code, status);
                        await page.locator('[data-field="quietHoursStart"]').fill('22:30');
                        await page.locator('[data-action="save-policy"]').click();
                        await page
                            .locator(
                                state === 'conflict'
                                    ? '.vc-sheet[aria-label="保存冲突"]'
                                    : 'dialog.vc-reauth-dialog[open]',
                            )
                            .waitFor();
                        await snapshot(`inbox-${state}-${width}-${theme}`);
                    }
                }
            for (const theme of ['light', 'dark'])
                for (const state of ['empty', 'loading', 'error', 'long']) {
                    await openInbox(1440, theme, `state=${state}${state === 'long' ? '&messages=1' : ''}`);
                    await snapshot(`inbox-${state}-${theme}`);
                }
            for (const width of [1440, 390])
                for (const theme of ['light', 'dark']) {
                    await openInbox(width, theme);
                    await page.evaluate(async () => {
                        const { mountInboxPage } = await import('/source/inbox-page.js');
                        window.DR_INBOX_CLASSIC = mountInboxPage();
                        window.DR_INBOX_CLASSIC.open();
                    });
                    await page.waitForFunction(
                        () => window.DR_INBOX_CLASSIC.page.state.open && !window.DR_INBOX_CLASSIC.page.state.loading,
                    );
                    await snapshot(`inbox-dialog-${width}-${theme}`);
                    await page.locator('.vc-inbox-dialog [data-field="credential"]').first().scrollIntoViewIfNeeded();
                    await snapshot(`inbox-dialog-channel-${width}-${theme}`);
                }
        }
        async function openRich(width = 1440, theme = 'light', extra = '', view = 'story') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=${view}&theme=${theme}&${extra}`); await settle(page);
        }
        async function openStickerFixture(width = 1440, theme = 'light') {
            await openRich(width, theme, 'screen=appearance', 'settings');
            await page.evaluate(async () => {
                const { installStickers } = await import('/source/stickers.js');
                const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="pink"/></svg>');
                window.DR_STICKER_CTX = { extensionSettings: { vc_stickers: { enabled: true, frequency: 'normal', uploads: [{ id: 'synthetic-upload', tag: '开心', path: src }] } }, chat: [], chatMetadata: {}, eventSource: { on() {} }, eventTypes: {}, saveSettingsDebounced() {} };
                const fetch = window.fetch;
                window.fetch = (url, init = {}) => String(url).endsWith('/api/images/delete') ? Promise.resolve(new Response('{}', {status:200})) : fetch(url, init);
                await installStickers({ document, getContext: () => window.DR_STICKER_CTX });
            });
            await page.locator('[data-vc-sticker-entry]').click();
            await page.locator('.vc-sticker-page').waitFor();
            await page.locator('.vc-sticker-page').evaluate(async root => { await Promise.all([...root.querySelectorAll('img')].map(img => img.decode().catch(() => {}))); });
        }
        if (!checkOnly && feature === 'rich') {
            for (const width of [1440, 864, 390]) for (const theme of ['light', 'dark']) {
                await openRich(width, theme); await snapshot(`story-gate-${width}-${theme}`);
                await page.locator('.vc-story-tab [data-action="start"]').click();
                await page.waitForFunction(() => document.querySelector('.vc-story-tab')?.dataset.view === 'stage' && !document.querySelector('.vc-letterbox'));
                await snapshot(`story-stage-${width}-${theme}`);
                await page.locator('.vc-story-tab [data-field="say"]').fill('合成对白草稿'); await snapshot(`story-draft-${width}-${theme}`);
                await page.locator('.vc-story-tab [data-action="ask-rewind"]').first().click(); await page.locator('.vc-alert').waitFor(); await snapshot(`story-rewind-${width}-${theme}`);
                await openRich(width, theme, 'screen=continue'); await snapshot(`story-continue-${width}-${theme}`);
                if (width >= 744) {
                    await openRich(width, theme, '', 'chat'); await page.locator('#chat .mes_text img').click();
                    await page.locator('.vc-lightbox').waitFor(); await snapshot(`lightbox-${width}-${theme}`);
                    await page.locator('.vc-lb-img').dblclick(); await snapshot(`lightbox-zoom-${width}-${theme}`);
                    await openRich(width, theme, '', 'chat');
                    await page.evaluate(async () => {
                        const { renderMessageVoice } = await import('/source/voice.js'), ctx = window.VC_CHAT_PREVIEW.context;
                        ctx.chat[6].extra = {vc_voice:{clipId:'701',status:'ready',durationMs:4200,played:false}};
                        renderMessageVoice(document.querySelector('#chat > .mes[mesid="6"]'), ctx.chat[6]);
                    }); await snapshot(`voice-${width}-${theme}`);
                    await page.locator('.vc-voice-transcribe').click(); await snapshot(`voice-text-${width}-${theme}`);
                    await page.evaluate(async () => {
                        const { renderMessageVoice } = await import('/source/voice.js'), ctx = window.VC_CHAT_PREVIEW.context, mes = document.querySelector('#chat > .mes[mesid="6"]');
                        ctx.chat[6].is_user = true; ctx.chat[6].extra = {vc_voice_input:{durationMs:3200}}; mes.setAttribute('is_user','true');
                        renderMessageVoice(mes, ctx.chat[6]);
                    }); await snapshot(`voice-input-${width}-${theme}`);
                }
                await openStickerFixture(width, theme); await snapshot(`stickers-${width}-${theme}`);
            }
            for (const theme of ['light', 'dark']) for (const state of ['empty', 'loading', 'error', 'long']) {
                await openRich(1440, theme, `state=${state}${state === 'long' ? '&screen=stage' : ''}`); await snapshot(`story-${state}-${theme}`);
            }
        }
        if (!captureReference && feature === 'rich') {
            await openRich(1440, 'light', '', 'chat');
            const voiceFrames = await page.evaluate(async () => {
                const { createVoiceBubble } = await import('/source/voice.js'); let peeks = 0;
                const player = { async toggle(_id, events) { events.onState(true); events.onPlayed(); }, peek() { peeks++; return {currentTime:1,duration:4}; }, setRate() {} };
                const bubble = createVoiceBubble({document,text:'合成语音',voice:{clipId:'701',status:'ready',durationMs:4000},player}); document.body.append(bubble);
                bubble.querySelector('.vc-voice-bar').click();
                await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
                const active = peeks; bubble.remove(); await Promise.resolve(); peeks = 0;
                await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
                return {active,after:peeks};
            });
            assert.ok(voiceFrames.active > 0, '合成播放器确实驱动波形'); assert.equal(voiceFrames.after, 0, '语音节点移除后释放波形帧循环');
            await openRich(1440, 'light', '', 'chat');
            await page.evaluate(async () => {
                const voice = await import('/source/voice.js'), ctx = window.VC_CHAT_PREVIEW.context; let playing = false, events;
                window.DR_VOICE_MEDIA = {currentTime:1,duration:4,rate:1};
                voice.voicePlayer.toggle = async (_id, callbacks) => { events = callbacks; playing = !playing; callbacks.onState(playing); if (playing) callbacks.onPlayed(); };
                voice.voicePlayer.peek = () => events ? window.DR_VOICE_MEDIA : null; voice.voicePlayer.isCurrent = () => Boolean(events);
                voice.voicePlayer.seek = (_id, time) => { window.DR_VOICE_MEDIA.currentTime = Math.min(4,Math.max(0,time)); return true; };
                voice.voicePlayer.setRate = rate => window.DR_VOICE_MEDIA.rate = rate;
                voice.voicePlayer.stop = () => { playing = false; events?.onState(false); };
                ctx.chat[6].extra = {vc_voice:{clipId:'701',status:'ready',durationMs:4000,played:false}};
                const mes = document.querySelector('#chat > .mes[mesid="6"]'); voice.renderMessageVoice(mes,ctx.chat[6]);
                window.DR_VOICE_NODES = [mes,mes.querySelector('.mes_text'),mes.querySelector('.vc-voice')];
            });
            await page.locator('#chat .vc-voice-bar').click();
            await page.waitForFunction(() => document.querySelector('#chat .vc-voice-bar').getAttribute('aria-pressed') === 'true');
            assert.equal(await page.locator('#chat .vc-voice-unread').count(), 0);
            await page.locator('#chat .vc-voice-speed').click();
            assert.equal(await page.evaluate(() => window.DR_VOICE_MEDIA.rate), 1.5);
            await page.locator('#chat .vc-voice-bar').press('ArrowRight');
            assert.equal(await page.evaluate(() => window.DR_VOICE_MEDIA.currentTime), 2);
            await page.waitForFunction(() => document.querySelectorAll('#chat .vc-voice-wave i.on').length === 12);
            await page.locator('#chat .vc-voice-transcribe').click(); await page.locator('#chat .vc-voice-text').waitFor({state:'visible'});
            for (const width of [1024,768,1440]) { await page.setViewportSize({width,height:768}); await settle(page); }
            assert.equal(await page.evaluate(() => { const [mes,text,voice] = window.DR_VOICE_NODES; return mes === document.querySelector('#chat > .mes[mesid="6"]') && text === mes.querySelector('.mes_text') && voice === mes.querySelector('.vc-voice'); }), true, '语音适配保留原生消息/原文与叶组件');
            await page.emulateMedia({reducedMotion:'no-preference'});
            await page.goto(`${preview.url}frame.html?view=chat&theme=light&motion=standard`);
            await settle(page);
            await page.evaluate(async () => {
                const {renderMessageVoice} = await import('/source/voice.js'), ctx = window.VC_CHAT_PREVIEW.context;
                ctx.chat[6].extra = {vc_voice:{clipId:'701',status:'ready',durationMs:4200,played:false}};
                renderMessageVoice(document.querySelector('#chat > .mes[mesid="6"]'), ctx.chat[6]);
            });
            const transcriptMotion = await page.evaluate(async () => {
                const trigger = document.querySelector('#chat .vc-voice-transcribe');
                trigger.click();
                let measured, panel;
                for (let frame = 0; frame < 50; frame++) {
                    await new Promise(requestAnimationFrame);
                    panel = document.getElementById(trigger.getAttribute('aria-controls'));
                    if (!panel) continue;
                    const size = panel.style.getPropertyValue('--collapsible-panel-height');
                    if (size.endsWith('px')) measured ??= parseFloat(size);
                }
                return {measured, height: panel.getBoundingClientRect().height};
            });
            assert.ok(Number.isFinite(transcriptMotion.measured), '实际执行组件库高度过渡');
            assert.ok(Math.abs(transcriptMotion.measured - transcriptMotion.height) <= 1,
                `展开目标须包含内容与内边距，结束时不能跳高：${JSON.stringify(transcriptMotion)}`);
            await page.emulateMedia({reducedMotion:'reduce'});
            await page.evaluate(() => { document.documentElement.dataset.vcReducedMotion = 'true'; });
            await page.evaluate(() => window.VC_CHAT_PREVIEW.context.eventSource.emit('CHAT_CHANGED'));
            await openRich(1440, 'light', '', 'chat');
            await page.locator('#chat .mes_text img').click(); await page.locator('.vc-lightbox').waitFor();
            await page.waitForFunction(() => document.activeElement.matches('.vc-lb-close'), {timeout:2000});
            assert.equal(await page.locator('.vc-lb-close').evaluate(el => el === document.activeElement), true);
            await page.keyboard.press('Tab'); await page.waitForFunction(() => document.activeElement.matches('.vc-lb-download'), {timeout:2000}); assert.equal(await page.locator('.vc-lb-download').evaluate(el => el === document.activeElement), true, `Dialog托管灯箱Tab循环：${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 600))}`);
            await page.locator('.vc-lb-img').dblclick(); await page.keyboard.press('ArrowLeft');
            assert.equal(await page.locator('.vc-lb-img').evaluate(el => el.style.transform), 'scale(2)', '首张的方向键边界保留缩放');
            await page.evaluate(() => window.VC_CHAT_PREVIEW.context.eventSource.emit('CHAT_CHANGED'));
            await page.locator('.vc-lightbox').waitFor({state:'detached'});
            await page.locator('#chat .mes_text img').click(); await page.locator('.vc-lightbox').waitFor();
            await page.evaluate(() => window.VC_CHAT_PREVIEW.lightbox.destroy()); assert.equal(await page.locator('.vc-lightbox').count(), 0);
            await openStickerFixture();
            const tag = page.locator('[data-vc-sticker-id="synthetic-upload"] input');
            await tag.fill('抱抱'); await tag.press('Tab');
            assert.equal(await page.evaluate(() => window.DR_STICKER_CTX.extensionSettings.vc_stickers.uploads[0].tag), '抱抱');
            await page.getByRole('radio', {name:'多',exact:true}).click();
            assert.equal(await page.evaluate(() => window.DR_STICKER_CTX.extensionSettings.vc_stickers.frequency), 'high');
            await page.locator('[data-vc-sticker-enabled]').click();
            assert.equal(await page.evaluate(() => window.DR_STICKER_CTX.extensionSettings.vc_stickers.enabled), false);
            await page.locator('[data-vc-sticker-delete]').click(); await page.locator('.vc-alert').waitFor();
            await page.evaluate(() => window.VC_SETTINGS_PREVIEW.destroy());
            assert.equal(await page.locator('.vc-sticker-page,.vc-alert').count(), 0, '设置销毁释放贴纸页和删除确认');
            await openRich(1440, 'light', 'screen=stage');
            await page.evaluate(() => window.DR_STORY_INPUT = document.querySelector('.vc-story-tab [data-field="say"]'));
            await page.locator('.vc-story-tab [data-field="say"]').fill('尚未提交的合成草稿');
            await page.locator('.vc-npc').first().click();
            assert.equal(await page.evaluate(() => window.DR_STORY_INPUT === document.querySelector('.vc-story-tab [data-field="say"]')), true, '切角色不能重建剧情输入节点');
            assert.equal(await page.locator('.vc-story-tab [data-field="say"]').inputValue(), '尚未提交的合成草稿');
            await page.locator('.vc-story-tab [data-action="ask-rewind"]').first().click(); await page.locator('.vc-alert').waitFor();
            await page.evaluate(() => window.VC_STORY_PREVIEW.handle.destroy());
            assert.equal(await page.locator('.vc-alert').count(), 0, '剧情回档确认随页面同步销毁');
        }
        if (!captureReference && ['characters', 'all'].includes(feature)) await charactersInteraction(page, open);
        if (!captureReference && ['memory', 'all'].includes(feature)) await memoryInteraction(page, openMemory);
        if (!captureReference && ['inbox', 'all'].includes(feature)) await inboxInteraction(page, openInbox);
        assert.deepEqual(errors, [], '生产页面样板不得出现脚本错误');
        console.log(
            `[dr-pages] ${captureReference ? 'REFERENCE CAPTURED' : 'PASS'}：生产页面 ${feature} ${shots} 图、草稿/保存/缩窗/生命周期${compareReference ? '、正常视觉严格一致' : ''}`,
        );
    } finally {
        await browser?.close();
        await preview.close();
    }
}
export const desktopPagesScene = {
    id: 'dr-pages',
    title: 'DR-5 角色、记忆与陪伴生产页面',
    needs: ['browser'],
    default: false,
    run: () => runDesktopPages({ feature: 'all' }),
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await runDesktopPages({
        captureReference: process.argv.includes('--capture-reference'),
        compareReference: process.argv.includes('--compare-reference'),
        checkOnly: process.argv.includes('--check-only'),
        feature: process.argv.includes('--feature')
            ? process.argv[process.argv.indexOf('--feature') + 1]
            : 'characters',
    });
