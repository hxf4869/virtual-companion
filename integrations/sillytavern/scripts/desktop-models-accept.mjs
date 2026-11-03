// DR-2：模型页生产控制器与真实 React 组件，使用既有合成宿主。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { startPreview, settle } from './lib/ux11-preview.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-2');
const VIEWPORTS = [1440, 1024, 864, 390];

async function bindingsInteraction(page) {
    const selects = page.locator('.vcms-bindings-table select');
    assert.equal(await selects.count(), 5, 'EMBEDDING 不显示聊天模型选择器');
    const first = selects.first();
    await first.focus();
    await page.evaluate(() => { window.DR_BINDING_NODE = document.querySelector('.vcms-bindings-table select'); });
    await first.selectOption('');
    assert.equal(await page.evaluate(() => window.DR_BINDING_NODE.isConnected && document.activeElement === window.DR_BINDING_NODE), true, '修改绑定不重建选择器或丢失焦点');
    assert.equal(await first.inputValue(), '');
    const second = selects.nth(1);
    await second.selectOption('');
    assert.equal(await first.inputValue(), '', '修改另一个用途保留先前选择');
    assert.equal(await page.locator('.vcms-bindings-save').textContent().then(text => text.includes('2 个用途待保存')), true);
    await page.locator('[data-action="discard-bindings"]').click();
    assert.equal(await selects.first().inputValue(), 'synthetic-primary::chat');
    assert.equal(await selects.nth(1).inputValue(), 'synthetic-primary::chat');

    await page.evaluate(() => {
        window.DR_BINDING_PUTS = [];
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (init.method === 'PUT' && String(url).includes('/admin/model-purposes/')) {
                window.DR_BINDING_PUTS.push({ purpose: String(url).split('/').pop(), body: JSON.parse(init.body) });
                return new Promise(resolve => { window.DR_BINDING_RESUME = () => resolve(fetch(url, init)); });
            }
            return fetch(url, init);
        };
    });
    await selects.first().selectOption('');
    await page.locator('[data-action="save-bindings"]').click();
    await page.waitForFunction(() => window.DR_BINDING_PUTS.length === 1);
    assert.equal(await selects.first().isDisabled(), true, '绑定保存等待时选择器禁用，防止回读覆盖新增选择');
    assert.equal(await page.locator('[data-action="discard-bindings"]').isDisabled(), true);
    await page.evaluate(() => window.DR_BINDING_RESUME());
    await page.waitForFunction(() => !window.VC_SETTINGS_PREVIEW.model._state.bindingsSaving);
    assert.equal(await selects.first().isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => window.DR_BINDING_PUTS[0]), {
        purpose: 'FOREGROUND_CHAT', body: { state: 'ENABLED', expectedRevision: 1 },
    }, '沿用既有绑定协议与版本，不重建业务模型');
    assert.equal(await page.locator('.vcms-bindings-save').count(), 0);
}

async function usageInteraction(page) {
    await page.getByRole('button', { name: '下个月', exact: true }).focus();
    await page.evaluate(() => { window.DR_USAGE_BUTTON = document.activeElement; });
    await page.evaluate(() => {
        window.DR_USAGE_PENDING = [];
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            const parsed = new URL(String(url), location.href);
            if (parsed.pathname.endsWith('/admin/usage')) return new Promise(resolve => {
                window.DR_USAGE_PENDING.push({ month: parsed.searchParams.get('month'), resolve });
            });
            return fetch(url, init);
        };
    });
    await page.getByRole('button', { name: '下个月', exact: true }).click();
    assert.equal(await page.evaluate(() => window.DR_USAGE_BUTTON.isConnected && document.activeElement === window.DR_USAGE_BUTTON), true, '切换月份不重建按钮或丢失键盘焦点');
    await page.getByRole('button', { name: '下个月', exact: true }).click();
    await page.waitForFunction(() => window.DR_USAGE_PENDING.length === 2);
    const month = await page.evaluate(() => window.DR_USAGE_PENDING[1].month);
    await page.evaluate(() => {
        const next = window.DR_USAGE_PENDING[1];
        next.resolve(new Response(JSON.stringify({ month: next.month, purposes: [] }), { headers: { 'Content-Type': 'application/json' } }));
    });
    await page.waitForFunction(() => !window.VC_SETTINGS_PREVIEW.model._state.usage.loading);
    assert.equal(await page.locator('[data-usage-month-label]').textContent(), month);
    await page.evaluate(async () => {
        const old = window.DR_USAGE_PENDING[0];
        old.resolve(new Response(JSON.stringify({ month: old.month, purposes: [] }), { headers: { 'Content-Type': 'application/json' } }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('[data-usage-month-label]').textContent(), month, '晚到的旧月份请求不能覆盖较新的月份');
}

async function providerInteraction(page, open) {
    const failures = [];
    for (const action of ['check-connection', 'discover']) {
        await open(1440, 'light', 'provider');
        const advanced = page.locator('details.vcms-advanced').filter({ has: page.locator(`[data-action="${action}"]`) });
        if (await advanced.count() && !await advanced.getAttribute('open').then(value => value !== null)) await advanced.locator('summary').click();
        await page.evaluate(() => {
            const fetch = window.fetch;
            window.fetch = (url, init = {}) => {
                if (String(url).endsWith('/models/discover')) return new Promise(resolve => { window.DR_PROVIDER_RESPONSE = resolve; });
                return fetch(url, init);
            };
        });
        await page.locator(`[data-action="${action}"]`).click();
        await page.waitForFunction(() => typeof window.DR_PROVIDER_RESPONSE === 'function');
        await page.locator('[data-action="vc-back"]').click();
        await page.locator('[data-action="select-provider"][data-id="synthetic-secondary"]').click();
        await page.waitForFunction(() => window.VC_SETTINGS_PREVIEW.model._state.selectedProviderId === 'synthetic-secondary');
        await page.evaluate(async () => {
            window.DR_PROVIDER_RESPONSE(new Response(JSON.stringify([{ modelId: 'old-provider-only', displayName: '旧供应商的返回' }]), { headers: { 'Content-Type': 'application/json' } }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const result = await page.evaluate(() => {
            const state = window.VC_SETTINGS_PREVIEW.model._state;
            return { id: state.draft.providerId, check: state.check.result, models: state.draft.models.map(row => row.modelId), busy: state.discoverBusy };
        });
        assert.equal(result.id, 'synthetic-secondary');
        if (result.check !== null) failures.push({ action, issue: '旧检查回写新供应商', check: result.check });
        if (result.models.length !== 1 || result.models[0] !== 'synthetic-backup') failures.push({ action, issue: '旧模型写入新草稿', models: result.models });
        if (result.busy !== false) failures.push({ action, issue: '旧请求忙状态残留' });
    }
    assert.deepEqual(failures, [], '旧供应商请求不得改变当前供应商的结果或草稿');
    await open(1440);
    await page.locator('[data-action="new-provider"]').click();
    assert.equal(await page.locator('.vcms-model-form').count(), 0, '新供应商不能继承之前供应商的活动模型');
}

async function modelInteraction(page, open) {
    await open(1440, 'light', 'provider');
    await page.locator('[data-action="add-model"]').click();
    const id = page.locator('#vcms-m-id');
    await id.pressSequentially('new-model-id');
    const draft = await page.evaluate(() => {
        const state = window.VC_SETTINGS_PREVIEW.model._state;
        return { selected: state.selectedProfileKey, models: state.draft.models.map(row => ({ id: row.modelId, key: row.profileKey })) };
    });
    assert.ok(draft.models.some(row => row.id === 'new-model-id' && row.key === 'new-model-id'), '连续输入新模型 ID 时，完整 ID 与自动配置标识均须进入当前草稿');
    assert.equal(draft.selected, 'new-model-id', '自动配置标识变化后仍选中正在编辑的模型');
    assert.equal(await page.locator('#vcms-m-profile').inputValue(), 'new-model-id', '可见配置标识与草稿同步');
    await page.locator('#vcms-m-profile').fill('custom-profile');
    await id.fill('second-model-id');
    await page.locator('#vcms-m-display').fill('手动配置标识的模型');
    const edited = await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.draft.models.find(row => row.profileKey === 'custom-profile'));
    assert.equal(edited?.modelId, 'second-model-id', '改动手动配置标识后，后续字段仍写入该模型');
    assert.equal(edited?.displayName, '手动配置标识的模型');
    await page.locator('#vcms-m-profile').fill('chat');
    await page.locator('#vcms-m-display').fill('临时标识冲突的新模型');
    const collision = await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.draft.models.map(row => ({ id: row.modelId, name: row.displayName })));
    assert.deepEqual(collision.find(row => row.id === 'synthetic-chat'), { id: 'synthetic-chat', name: '日常聊天' }, '编辑暂时冲突的配置标识也不能误写已有模型');
    assert.equal(collision.find(row => row.id === 'second-model-id')?.name, '临时标识冲突的新模型');
    await page.locator('[data-action="delete-model"]').click();
    await page.locator('[data-action="delete-model-confirm"]').click();
    assert.deepEqual(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.draft.models.map(row => row.modelId)), ['synthetic-chat'], '移除临时冲突的新模型不得连带移除已有模型');
    assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.isDirty()), false, '撤销新模型后原配置保持不变');
}

async function formsInteraction(page, open) {
    await open(1440, 'light', 'provider');
    await page.locator('[data-action="key-replace"]').click();
    await page.evaluate(() => { window.DR_KEY_NODE = document.querySelector('#vcms-f-key'); });
    await page.locator('#vcms-f-key').pressSequentially('synthetic-preview-key');
    assert.equal(await page.evaluate(() => window.DR_KEY_NODE.isConnected && document.activeElement === window.DR_KEY_NODE), true, '密钥计划状态变化不能重建正在输入的控件');
    assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.draft.credential.length), 21);
    await page.locator('[data-action="key-undo"]').click();
    await page.evaluate(() => {
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => String(url).endsWith('/models/discover')
            ? new Promise(resolve => { window.DR_EDIT_RESPONSE = resolve; }) : fetch(url, init);
    });
    await page.locator('[data-action="check-connection"]').click();
    await page.waitForFunction(() => typeof window.DR_EDIT_RESPONSE === 'function');
    await page.locator('#vcms-f-base').fill('https://new.example.test/v1');
    assert.equal(await page.locator('[data-action="check-connection"]').isDisabled(), false, '编辑连接目标后失效的检查不得留下不可操作的忙状态');
    await page.evaluate(async () => {
        window.DR_EDIT_RESPONSE(new Response(JSON.stringify([{ modelId: 'obsolete-target' }]), { headers: { 'Content-Type': 'application/json' } }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.check.result), null, '旧连接目标的结果不能显示为新目标的检查结果');

    await open(1440, 'light', 'profile');
    const advanced = page.locator('.vcms-model-form > details.vcms-advanced');
    if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click();
    await page.locator('#vcms-m-temp').fill('0.4');
    await page.evaluate(() => { window.DR_FORM_NODE = document.querySelector('#vcms-m-temp'); });
    await page.locator('[data-cap-key="imageInput"][data-cap-state="UNKNOWN"]').click();
    assert.equal(await page.evaluate(() => window.DR_FORM_NODE.isConnected), true, '操作能力控件不重建其他模型输入节点');
    assert.equal(await page.locator('#vcms-m-temp').inputValue(), '0.4');
    assert.notEqual(await advanced.getAttribute('open'), null, '更新能力后高级设置保持展开');
    await page.locator('[data-bind="model.reasoningLevels"][value="medium"]').uncheck();
    assert.equal(await page.locator('#vcms-m-effort').inputValue(), '', '取消默认推理等级后，同步清理失效选择');
    assert.equal(await page.locator('#vcms-m-effort option[value="medium"]').count(), 0);
}

async function localInteraction(page, open) {
    await open(1440);
    await page.evaluate(() => {
        window.DR_LOCAL_PUTS = 0;
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/admin/local-models/rerank') && init.method === 'PUT') {
                window.DR_LOCAL_PUTS += 1;
                return new Promise(resolve => { window.DR_LOCAL_RESUME = () => resolve(fetch(url, init)); });
            }
            return fetch(url, init);
        };
    });
    const toggle = page.getByRole('switch', { name: '重排', exact: true });
    await toggle.click();
    await page.waitForFunction(() => window.DR_LOCAL_PUTS === 1);
    assert.equal(await toggle.isDisabled(), true, '本地模型保存期间应使用组件禁用态阻止重复写入');
    await toggle.evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.DR_LOCAL_PUTS), 1);
    await page.locator('.vc-sidebar [data-nav="characters"]').click();
    assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'), 'page', '本机模型保存等待也必须拦截侧栏离开');
    await page.evaluate(() => window.DR_LOCAL_RESUME());
    await page.waitForFunction(() => !document.querySelector('[data-action="local-rerank"]').disabled);
    assert.equal(await toggle.getAttribute('aria-checked'), 'false', '保存和重载后保留新值');
}

async function saveInteraction(page, open) {
    await open(1440, 'light', 'profile');
    await page.locator('[data-action="clone-model"]').click();
    await page.locator('#vcms-clone-key').fill('desktop-copy');
    await page.locator('#vcms-clone-name').fill('桌面副本');
    await page.locator('[data-action="clone-confirm"]').click();
    assert.equal(await page.locator('#vcms-m-profile').inputValue(), 'desktop-copy');
    await page.evaluate(() => {
        window.DR_SAVE_PUTS = 0;
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/admin/providers/synthetic-primary') && init.method === 'PUT') {
                window.DR_SAVE_PUTS += 1;
                window.DR_CLONE_CAP = JSON.parse(init.body).models.find(row => row.profileKey === 'desktop-copy').capabilities.toolCalls;
                return new Promise(resolve => { window.DR_SAVE_RESUME = () => resolve(fetch(url, init)); });
            }
            return fetch(url, init);
        };
    });
    const save = page.locator('#vcms-save');
    assert.equal(await save.isDisabled(), false, '合法副本可以保存');
    const width = await save.evaluate(el => el.getBoundingClientRect().width);
    await save.click();
    await page.waitForFunction(() => window.DR_SAVE_PUTS === 1);
    assert.equal(await page.evaluate(() => window.DR_CLONE_CAP), 'DECLARED', '保存副本不声明后端 VERIFIED');
    const pendingWidth = await save.evaluate(el => el.getBoundingClientRect().width);
    assert.equal(await save.isDisabled(), true);
    assert.equal(await page.locator('#vcms-m-display').isDisabled(), true, '保存等待期间锁住表单，防止新输入被旧请求回读覆盖');
    await save.evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.DR_SAVE_PUTS), 1);
    assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.requestLeave()), false, '保存期间不能离开页面');
    await page.evaluate(() => window.DR_SAVE_RESUME());
    await page.waitForFunction(() => !window.VC_SETTINGS_PREVIEW.model._state.saving);
    assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.isDirty()), false);
    assert.equal(await page.locator('#vcms-m-display').isDisabled(), false, '保存完成后恢复表单');
    const failures = [];
    if (Math.abs(width - pendingWidth) > 1) failures.push('保存等待改变按钮宽度');
    if (await page.locator('#vcms-m-profile').inputValue() !== 'desktop-copy') failures.push('保存后丢失当前模型选择');
    assert.deepEqual(failures, [], '保存保留现有布局与编辑上下文');
}

async function prepareConflict(page) {
    await page.locator('#vcms-f-display').fill('我的供应商草稿');
    await page.evaluate(() => {
        const fetch = window.fetch;
        window.fetch = async (url, init = {}) => {
            if (String(url).endsWith('/admin/providers/synthetic-primary') && init.method === 'PUT') {
                return new Response(JSON.stringify({ code: 'REVISION_CONFLICT', details: { currentRevision: 2 } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
            }
            const response = await fetch(url, init);
            if (String(url).endsWith('/admin/providers')) {
                const rows = await response.json();
                const primary = rows.find(row => row.providerId === 'synthetic-primary');
                primary.displayName = '另一处的供应商名称'; primary.revision = 2;
                return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
            }
            return response;
        };
    });
    await page.locator('#vcms-save').click();
    await page.waitForFunction(() => window.VC_SETTINGS_PREVIEW.model._state.conflict);
    assert.equal(await page.locator('#vcms-f-display').inputValue(), '我的供应商草稿', '版本冲突保留输入');
}

async function conflictInteraction(page, open) {
    for (const decision of ['restore-stash', 'dismiss-stash-banner']) {
        await open(1440, 'light', 'provider');
        await prepareConflict(page);
        await page.locator('[data-action="conflict-view-latest"]').click();
        await page.waitForFunction(() => window.VC_SETTINGS_PREVIEW.model._state.stashBanner);
        assert.equal(await page.locator('#vcms-f-display').inputValue(), '另一处的供应商名称');
        await page.locator(`[data-action="${decision}"]`).click();
        if (decision === 'restore-stash') {
            assert.equal(await page.locator('#vcms-f-display').inputValue(), '我的供应商草稿');
            assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.draft.revision), 2, '恢复草稿沿用最新版本');
            assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.isDirty()), true);
        } else assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.isDirty()), false, '明确保留最新内容后不应残留旧草稿的脏状态');
    }
}

async function verificationInteraction(page, open) {
    const fixture = async route => {
        const response = await route.fetch();
        const original = await response.text();
        assert.ok(original.includes("toolCalls:'VERIFIED'"), '核验测试使用已知的合成能力数据');
        await route.fulfill({ response, body: original.replace("toolCalls:'VERIFIED'", "toolCalls:'UNKNOWN'") });
    };
    await page.route('**/fixtures.js', fixture);
    try {
        await open(1440, 'light', 'profile');
        await page.locator('.vcms-model-form > details.vcms-advanced > summary').click();
        await page.evaluate(() => {
            const fetch = window.fetch;
            window.fetch = (url, init = {}) => String(url).endsWith('/verify-tool-calls')
                ? new Promise(resolve => { window.DR_VERIFY_RESUME = resolve; }) : fetch(url, init);
        });
        await page.locator('[data-action="verify-tool-calls"]').click();
        await page.waitForFunction(() => typeof window.DR_VERIFY_RESUME === 'function');
        await page.locator('[data-action="vc-back"]').click();
        await page.locator('[data-action="vc-back"]').click();
        await page.locator('[data-id="synthetic-secondary"][data-action="select-provider"]').click();
        await page.waitForFunction(() => window.VC_SETTINGS_PREVIEW.model._state.selectedProviderId === 'synthetic-secondary');
        await page.evaluate(async () => {
            window.DR_VERIFY_RESUME(new Response(JSON.stringify({ verified: true }), { headers: { 'Content-Type': 'application/json' } }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        assert.deepEqual(await page.evaluate(() => ({ provider: window.VC_SETTINGS_PREVIEW.model._state.selectedProviderId, busy: window.VC_SETTINGS_PREVIEW.model._state.toolVerify.busy })), { provider: 'synthetic-secondary', busy: false }, '旧模型核验完成后不应切回旧供应商或留下忙状态');
    } finally { await page.unroute('**/fixtures.js', fixture); }
}

async function reauthInteraction(page, open) {
    for (const submit of [true, false]) {
        await open(1440, 'light', 'provider');
        await page.evaluate(() => {
            window.DR_AUTH_PUTS = [];
            const fetch = window.fetch;
            window.fetch = (url, init = {}) => {
                if (String(url).includes('/admin/providers/') && init.method === 'PUT') {
                    window.DR_AUTH_PUTS.push(String(url).split('/').at(-1));
                    if (window.DR_AUTH_PUTS.length === 1) return Promise.resolve(new Response(JSON.stringify({ code: 'FRESH_REAUTH_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
                }
                if (String(url).endsWith('/auth/reauth')) return new Promise(resolve => { window.DR_AUTH_RESUME = resolve; });
                return fetch(url, init);
            };
        });
        await page.locator('#vcms-f-display').fill('重认证待保存');
        await page.locator('#vcms-save').click();
        await page.waitForFunction(() => window.VC_SETTINGS_PREVIEW.model._state.reauth.open);
        await page.locator('#vcms-reauth-password').fill('synthetic-password');
        if (submit) {
            await page.locator('[data-action="reauth-submit"]').click();
            await page.waitForFunction(() => typeof window.DR_AUTH_RESUME === 'function');
            assert.equal(await page.locator('#vcms-f-display').isDisabled(), true, '重认证等待期锁住原操作草稿');
            assert.equal(await page.locator('#vcms-reauth-password').isDisabled(), true);
            await page.evaluate(async () => {
                void window.VC_SETTINGS_PREVIEW.model.requestLeave().then(value => { window.DR_AUTH_LEAVE = value; });
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            assert.equal(await page.evaluate(() => window.DR_AUTH_LEAVE), false, '重认证等待期间不允许切换操作上下文');
            assert.equal(await page.locator('.vc-alert').count(), 0);
            await page.evaluate(() => window.DR_AUTH_RESUME(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
            await page.waitForFunction(() => !window.VC_SETTINGS_PREVIEW.model._state.saving && window.DR_AUTH_PUTS.length === 2);
            assert.deepEqual(await page.evaluate(() => window.DR_AUTH_PUTS), ['synthetic-primary', 'synthetic-primary'], '重认证只继续原供应商写入');
            assert.equal(await page.locator('#vcms-f-display').inputValue(), '重认证待保存');
            assert.equal(await page.locator('#vcms-f-display').isDisabled(), false);
        } else {
            await page.locator('[data-action="vc-back"]').click();
            await page.locator('[data-vc-ok]').click();
            await page.locator('[data-action="select-provider"][data-id="synthetic-secondary"]').click();
            assert.equal(await page.locator('#vcms-reauth-password').count(), 0, '放弃原草稿并切换供应商后清除原重认证操作');
            assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model._state.reauth.password), '');
            assert.deepEqual(await page.evaluate(() => window.DR_AUTH_PUTS), ['synthetic-primary'], '切换上下文不会暗中保存新供应商');
        }
    }
}

async function resizeInteraction(page, open) {
    await open(1440, 'light', 'profile');
    await page.locator('#vcms-m-display').fill('窗口缩放中的模型草稿');
    await page.evaluate(() => { window.DR_RESIZE_NODE = document.querySelector('#vcms-m-display'); });
    for (const width of [1280, 1180, 1179, 1024, 1023, 864, 768, 744, 1440]) {
        await page.setViewportSize({ width, height: width === 864 ? 600 : 900 });
        await settle(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width} 窗口不得横向溢出`);
        assert.equal(await page.evaluate(() => window.DR_RESIZE_NODE.isConnected), true, '连续缩窗不重建表单');
        assert.equal(await page.locator('#vcms-m-display').inputValue(), '窗口缩放中的模型草稿');
        const save = await page.locator('#vcms-save').boundingBox();
        assert.ok(save && save.x >= 0 && save.y >= 0 && save.x + save.width <= width + 1 && save.y + save.height <= (width === 864 ? 600 : 900), `${width} 保存操作可达`);
        const category = page.locator('.vc-settings-category-toggle');
        if (await category.isVisible()) {
            const center = await category.evaluate(el => {
                const a = el.getBoundingClientRect(), b = el.querySelector('svg').getBoundingClientRect();
                return [Math.abs(a.x + a.width / 2 - b.x - b.width / 2), Math.abs(a.y + a.height / 2 - b.y - b.height / 2)];
            });
            assert.ok(center.every(delta => delta <= 1), `${width} 模型页分类图标保持居中`);
        }
    }
}

export async function runDesktopModels({ captureReference = false, compareReference = false, bindingsOnly = false, usageOnly = false, providerOnly = false, modelOnly = false, formsOnly = false, localOnly = false, saveOnly = false, conflictOnly = false, verificationOnly = false, reauthOnly = false } = {}) {
    const only = bindingsOnly ? 'bindings' : usageOnly ? 'usage' : providerOnly ? 'provider' : modelOnly ? 'model' : formsOnly ? 'forms' : localOnly ? 'local' : saveOnly ? 'save' : conflictOnly ? 'conflict' : verificationOnly ? 'verification' : reauthOnly ? 'reauth' : null;
    await mkdir(path.join(OUT, captureReference ? 'before' : 'after'), { recursive: true });
    const preview = await startPreview();
    let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : { channel: 'chrome' }), args: ['--disable-partial-raster', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'] });
        const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('vc-reduced-motion', 'true'); });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        if (captureReference) {
            const frozen = await readFile(path.join(OUT, 'reference/page.js'), 'utf8');
            await page.route('**/source/page.js', route => route.fulfill({ contentType: 'text/javascript', body: frozen }));
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        async function open(width, theme = 'light', screen = 'model', state = '') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            const view = width < 744 ? 'model' : 'settings';
            await page.goto(`${preview.url}frame.html?view=${view}&screen=${width < 744 && screen === 'model' ? 'home' : screen}&theme=${theme}${state ? `&state=${state}` : ''}`);
            await settle(page);
        }
        let shots = 0;
        async function snapshot(name) {
            const png = await page.screenshot({ animations: 'disabled' });
            const target = path.join(OUT, captureReference ? 'before' : 'after', name);
            if (captureReference) {
                try { await writeFile(target, png, { flag: 'wx' }); }
                catch (error) {
                    if (error.code !== 'EEXIST') throw error;
                    const a = PNG.sync.read(png), b = PNG.sync.read(await readFile(target));
                    assert.ok(a.width === b.width && a.height === b.height && a.data.equals(b.data), `${name} 独立旧实现不再匹配已冻结参照，禁止覆盖`);
                }
            } else await writeFile(target, png);
            if (compareReference) {
                const a = PNG.sync.read(png), b = PNG.sync.read(await readFile(path.join(OUT, 'before', name)));
                assert.ok(a.width === b.width && a.height === b.height && a.data.equals(b.data), `${name} 与迁移前状态不同`);
            }
            shots += 1;
        }
        if (!only) {
            for (const width of VIEWPORTS) for (const theme of ['light', 'dark']) for (const screen of width < 744 ? ['model'] : ['model', 'provider', 'profile']) {
                await open(width, theme, screen);
                await snapshot(`models-${width}-${theme}-${screen}.png`);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            }
            for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const state of ['empty', 'loading', 'error']) {
                await open(width, theme, 'model', state);
                await snapshot(`models-${width}-${theme}-${state}.png`);
            }
            for (const theme of ['light', 'dark']) {
                await open(1440, theme, 'profile');
                await page.locator('.vcms-model-form > details.vcms-advanced > summary').click();
                await settle(page);
                await snapshot(`models-1440-${theme}-advanced.png`);
                await open(1440, theme, 'provider');
                await page.locator('#vcms-f-display').fill('未保存的供应商');
                await page.locator('[data-action="vc-back"]').click();
                await page.locator('.vc-alert').waitFor();
                await settle(page);
                await snapshot(`models-1440-${theme}-discard.png`);
                await page.locator('[data-vc-cancel]').click();
                await open(1440, theme, 'provider');
                await prepareConflict(page);
                await settle(page);
                await snapshot(`models-1440-${theme}-conflict.png`);
            }
        }
        if (!captureReference) {
            await open(1440);
            if (!only || only === 'bindings') await bindingsInteraction(page);
            if (!only || only === 'usage') await usageInteraction(page);
            if (!only || only === 'provider') await providerInteraction(page, open);
            if (!only || only === 'model') await modelInteraction(page, open);
            if (!only || only === 'forms') await formsInteraction(page, open);
            if (!only || only === 'local') await localInteraction(page, open);
            if (!only || only === 'save') await saveInteraction(page, open);
            if (!only || only === 'conflict') await conflictInteraction(page, open);
            if (!only || only === 'verification') await verificationInteraction(page, open);
            if (!only || only === 'reauth') await reauthInteraction(page, open);
            if (!only) await resizeInteraction(page, open);
        }
        assert.deepEqual(errors, [], '模型页不得出现脚本错误');
        console.log(`[dr-models] ${captureReference ? 'REFERENCE CAPTURED' : 'PASS'}：${only ? `${only} 交互回归` : `${shots} 张${compareReference ? '逐像素对照通过' : '截图'}${captureReference ? '' : '，表单/保存/冲突/异步/缩窗回归'}`}`);
    } finally {
        await browser?.close();
        await preview.close();
    }
}

export const desktopModelsScene = { id: 'dr-models', title: 'DR-2 模型设置与既有视觉', needs: ['browser'], default: false, run: () => runDesktopModels() };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopModels({ captureReference: process.argv.includes('--capture-reference'), compareReference: process.argv.includes('--compare-reference'), bindingsOnly: process.argv.includes('--check-bindings'), usageOnly: process.argv.includes('--check-usage'), providerOnly: process.argv.includes('--check-provider'), modelOnly: process.argv.includes('--check-model'), formsOnly: process.argv.includes('--check-forms'), localOnly: process.argv.includes('--check-local'), saveOnly: process.argv.includes('--check-save'), conflictOnly: process.argv.includes('--check-conflict'), verificationOnly: process.argv.includes('--check-verification'), reauthOnly: process.argv.includes('--check-reauth') });
