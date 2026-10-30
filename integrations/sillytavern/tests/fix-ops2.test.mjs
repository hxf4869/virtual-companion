// FIX-OPS 第二轮：场景注册、重排目录、额度重置、截图预算、组装戳、页面错误与浮层守卫。
// 不启动 docker / Go / 浏览器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SCENES, resolveSceneFilter } from '../scripts/managed-lib.mjs';

const script = (name) => fs.readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');

test('重排目录优先认 VC_RERANK_MODELS_DIR，旧名可用且只提示一次', async () => {
    const { rerankRuntime, resetRerankDirWarning } = await import('../scripts/lib/rerank-container.mjs');
    resetRerankDirWarning();
    const notes = [];
    const both = rerankRuntime({
        VC_RERANK_MODELS_DIR: '/models/new',
        VC_RERANK_MODEL_DIR: '/models/old',
        VC_RERANK_PORT: '11439',
        VC_RERANK_CONTAINER: 'vc-rerank',
    }, (line) => notes.push(line));
    assert.equal(both.modelDir, '/models/new');
    assert.equal(notes.length, 0);

    resetRerankDirWarning();
    const old = rerankRuntime({
        VC_RERANK_MODEL_DIR: '/models/old',
        VC_RERANK_PORT: '11439',
        VC_RERANK_CONTAINER: 'vc-rerank',
    }, (line) => notes.push(line));
    const again = rerankRuntime({
        VC_RERANK_MODEL_DIR: '/models/old',
        VC_RERANK_PORT: '11439',
        VC_RERANK_CONTAINER: 'vc-rerank',
    }, (line) => notes.push(line));
    assert.equal(old.modelDir, '/models/old');
    assert.equal(again.modelDir, '/models/old');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /VC_RERANK_MODELS_DIR/);
});

test('companiond 只编译一次，migrate、bootstrap 与服务复用同一二进制', async () => {
    const { companiondPlan } = await import('../scripts/lib/companiond-plan.mjs');
    const plan = companiondPlan('/tmp/companiond-accept');
    assert.equal(plan.build.filter((part) => part === 'build').length, 1);
    assert.deepEqual(plan.migrate, ['/tmp/companiond-accept', 'migrate']);
    assert.deepEqual(plan.bootstrap, ['/tmp/companiond-accept', 'bootstrap']);
    assert.deepEqual(plan.serve, ['/tmp/companiond-accept']);
    assert.equal(plan.build.includes('run'), false);
});

test('组装内容戳一致且产物还在时跳过，戳变了或产物缺失时不跳过', async () => {
    const { shouldSkipAssemble, hashTree } = await import('../scripts/lib/assemble-stamp.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-assemble-stamp-'));
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'one');
    const stamp = hashTree(src);
    const artifact = path.join(dir, 'st-run');
    const ok = path.join(dir, 'assemble-ok');
    const stampPath = path.join(dir, 'assemble-content.stamp');
    assert.equal(shouldSkipAssemble({ stamp, stampPath, okPath: ok, runPath: artifact }), false);
    fs.mkdirSync(artifact);
    fs.writeFileSync(ok, 'ok');
    fs.writeFileSync(stampPath, `${stamp}\n`);
    assert.equal(shouldSkipAssemble({ stamp, stampPath, okPath: ok, runPath: artifact }), true);
    fs.writeFileSync(path.join(src, 'a.txt'), 'two');
    assert.equal(shouldSkipAssemble({ stamp: hashTree(src), stampPath, okPath: ok, runPath: artifact }), false);
    fs.rmSync(artifact, { recursive: true });
    assert.equal(shouldSkipAssemble({ stamp, stampPath, okPath: ok, runPath: artifact }), false);
});

test('非走查截图每场景只保留 1440 与 390 各一张', async () => {
    const { createShotBudget } = await import('../scripts/lib/scene-shots.mjs');
    const budget = createShotBudget();
    assert.equal(budget.allow('f2-390-light-chat.png'), true);
    assert.equal(budget.allow('f2-390-dark-chat.png'), false);
    assert.equal(budget.allow('f2-1440-light-chat.png'), true);
    assert.equal(budget.allow('f2-1440-dark-chat.png'), false);
    assert.equal(budget.allow('f2-360-light-chat.png'), false);
    assert.deepEqual(budget.slots().sort(), ['1440', '390']);
});

test('页面错误收集后非空即失败，空集合通过', async () => {
    const { trackPageErrors } = await import('../scripts/lib/page-errors.mjs');
    const handlers = {};
    const page = { on(name, fn) { handlers[name] = fn; } };
    const tracked = trackPageErrors(page);
    assert.equal(tracked.errors.length, 0);
    tracked.assertNone();
    handlers.pageerror(new Error('boom'));
    assert.equal(tracked.errors.length, 1);
    assert.throws(() => tracked.assertNone(), /页面错误/);
});

test('走查截图前只允许当前步骤的浮层', async () => {
    const { unexpectedOverlays, allowedOverlays } = await import('../scripts/lib/overlay-guard.mjs');
    assert.deepEqual(allowedOverlays('chat-list'), []);
    assert.deepEqual(allowedOverlays('tavern-ai'), ['drawer']);
    assert.deepEqual(allowedOverlays('chat-press'), ['menu']);
    assert.deepEqual(allowedOverlays('settings'), ['sheet']);
    assert.deepEqual(unexpectedOverlays(['drawer', 'scrim'], []), ['drawer', 'scrim']);
    assert.deepEqual(unexpectedOverlays(['drawer'], ['drawer']), []);
    assert.deepEqual(unexpectedOverlays(['drawer', 'menu'], ['drawer']), ['menu']);
    const walk = fs.readFileSync(new URL('../scripts/vc-ui-walkthrough.mjs', import.meta.url), 'utf8');
    assert.match(walk, /allowDrawer && openDrawer && el\.querySelector\('\.vc-settings-form'\)/);
    assert.match(walk, /async function removeSheets/);
    const recordStart = walk.indexOf('const record = async');
    const record = walk.slice(recordStart, walk.indexOf('shots.push', recordStart));
    assert.match(record, /removeSheets\(page\)/);
    assert.doesNotMatch(record, /dismissSheet/);
});

test('写操作前的重新认证失败即中止，4 分钟内不重复打账号限额', async () => {
    const { reauthForWrite, resetReauthCache, setReauthClock, REAUTH_REFRESH_MS } = await import('../scripts/lib/reauth-write.mjs');
    assert.ok(REAUTH_REFRESH_MS >= 4 * 60 * 1000);
    assert.ok(REAUTH_REFRESH_MS < 15 * 60 * 1000);
    let calls = 0;
    let t = 1_000_000;
    setReauthClock(() => t);
    resetReauthCache();
    const ctx = { secrets: { password: 'secret' }, admin: { reauth: async () => { calls += 1; return { ok: true, status: 200 }; } } };
    await reauthForWrite(ctx);
    t += 1000;
    await reauthForWrite(ctx);
    assert.equal(calls, 1);
    t += REAUTH_REFRESH_MS;
    await reauthForWrite(ctx);
    assert.equal(calls, 2);
    resetReauthCache();
    setReauthClock();
    await assert.rejects(
        () => reauthForWrite({ secrets: { password: 'secret' }, admin: { reauth: async () => ({ ok: false, status: 403 }) } }),
        /重新认证失败 HTTP 403/,
    );
});

test('额度清零只减本轮 Owner 的预留与结算，不清整月全局行', async () => {
    const { ownerBudgetResetSql } = await import('../scripts/lib/owner-budget.mjs');
    const sql = ownerBudgetResetSql('424242');
    assert.match(sql, /owner_user_id = 424242/);
    assert.match(sql, /model_cost_reservation/);
    assert.doesNotMatch(sql, /SET settled_usd = 0/);
    assert.throws(() => ownerBudgetResetSql('0'), /owner/);
    assert.throws(() => ownerBudgetResetSql('42;drop'), /owner/);
    assert.notEqual(ownerBudgetResetSql('7'), ownerBudgetResetSql('8'));
});

test('Go 停住时 script.js 仍必须是 503，等待盖过已配置的 Go 超时', async () => {
    const { failClosedWaitMs } = await import('../scripts/lib/fail-closed-wait.mjs');
    assert.equal(failClosedWaitMs({ VC_ST_GO_TIMEOUT_MS: '30000' }) > 30000, true);
    assert.equal(failClosedWaitMs({ VC_ST_GO_TIMEOUT_MS: '2000' }) > 2000, true);
    assert.equal(failClosedWaitMs({ VC_ST_GO_TIMEOUT_MS: '2000' }) < 30000, true);
    const auth = script('w05-accept.mjs');
    const gate = auth.slice(auth.indexOf('SIGSTOP'), auth.indexOf('SIGCONT'));
    assert.match(gate, /failClosedWaitMs/);
    assert.match(gate, /status\(\), 503/);
    assert.doesNotMatch(gate, /timeout: 10000/);
});

test('场景模块组成有序列表，入口不再 push 或维护实现表', async () => {
    const { ACCEPT_SCENES } = await import('../scripts/managed-scenes.mjs');
    const ids = ACCEPT_SCENES.map((scene) => scene.id);
    assert.equal(new Set(ids).size, ids.length);
    const extra = [
        'story-view-browser', 'w11-tool-meter', 'w10-inbox-notify', 'story-outbound', 'story-play',
        'story-real', 'w15-ui', 'fe4a-ui', 'fe4b-ui', 'f3-settings', 'vc-ui-shell', 'vc-ui-walkthrough', 'f2-chat-ui',
    ];
    assert.deepEqual(new Set(ids), new Set([...SCENES.map((scene) => scene.id), ...extra]));
    for (const scene of ACCEPT_SCENES) {
        assert.equal(typeof scene.id, 'string');
        assert.equal(typeof scene.title, 'string');
        assert.equal(typeof scene.default, 'boolean');
        assert.ok(Array.isArray(scene.needs) && scene.needs.length > 0, scene.id);
        assert.equal(typeof scene.run, 'function', scene.id);
    }
    for (const id of extra) {
        assert.equal(SCENES.some((scene) => scene.id === id), false);
        assert.equal(ACCEPT_SCENES.find((scene) => scene.id === id).default, false);
    }
    assert.deepEqual(resolveSceneFilter(undefined, ACCEPT_SCENES), resolveSceneFilter());
    assert.deepEqual(resolveSceneFilter('story-outbound', ACCEPT_SCENES), ['catalog-admin', 'story-outbound']);
    assert.deepEqual(resolveSceneFilter('ui03-browser', ACCEPT_SCENES), ['catalog-admin', 'ui03-browser']);
    const outbound = ACCEPT_SCENES.find((scene) => scene.id === 'story-outbound');
    assert.deepEqual(outbound.needs, ['catalog', 'stack', 'browser']);
    const order = (id) => ids.indexOf(id);
    assert.ok(order('catalog-admin') < order('e2e-chat'));
    assert.ok(order('ui03-browser') < order('story-outbound'));
    assert.ok(order('story-outbound') < order('story-play'));
    assert.ok(order('story-play') < order('f2-chat-ui'));

    const entry = script('accept-managed.mjs');
    assert.doesNotMatch(entry, /SCENES\.push/);
    assert.doesNotMatch(entry, /SCENE_IMPLS/);
    assert.match(entry, /ACCEPT_SCENES/);
    assert.match(entry, /resolveSceneFilter\(FILTER, ACCEPT_SCENES\)/);
    assert.match(entry, /\.run\(ctx\)/);

    const story = script('story-outbound-accept.mjs');
    const armed = story.slice(story.indexOf('if (proxyArmed && spec.proxy)'));
    assert.notEqual(armed.indexOf('if (proxyArmed && spec.proxy)'), -1);
    assert.match(armed.slice(0, 700), /waitFor\(\{ timeout: 15000 \}\)/);
    assert.doesNotMatch(armed.slice(0, 500), /confirmProxy\(spec\.proxy\)/);
    assert.equal(entry.includes('async function sceneStoryOutbound'), false);
    assert.equal(entry.includes('async function sceneStoryPlay'), false);
    assert.equal(entry.includes('async function sceneUi03Browser'), false);
});

test('F2 停止保存必须 200，长按菜单关闭不再吞掉失败或空等', () => {
    const src = script('f2-chat-accept.mjs');
    const stop = src.slice(src.indexOf("const stoppedSave"), src.indexOf("console.log('[f2-chat-ui] 长按菜单')"));
    assert.match(stop, /停止后保存 HTTP/);
    assert.match(stop, /!== 200|=== 200/);
    assert.doesNotMatch(stop, /\.catch\(\(\) => null\)/);
    assert.doesNotMatch(stop, /void stopped/);
    assert.doesNotMatch(stop, /catch \{/);
    const menu = src.slice(src.indexOf("console.log('[f2-chat-ui] 长按菜单')"), src.indexOf("console.log('[f2-chat-ui] 气泡')"));
    assert.match(menu, /waitFor\(\{ state: 'hidden' \}\)/);
    assert.doesNotMatch(menu, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(menu, /waitForTimeout\(320\)/);
    assert.match(src, /reauthForWrite/);
    assert.match(src, /ownerBudgetResetSql/);
    assert.doesNotMatch(src, /SET settled_usd = 0, reserved_usd = 0, unsettled_usd = 0/);
    assert.doesNotMatch(src, /W15 会把当月额度记满/);
});

test('F3 与 ui03 收集页面错误并等待可观测就绪', () => {
    const f3 = script('f3-settings-accept.mjs');
    assert.match(f3, /trackPageErrors/);
    assert.match(f3, /assertNone\(/);
    assert.doesNotMatch(f3, /waitForTimeout\(4000\)/);
    assert.doesNotMatch(f3, /pageerror', \(\) => \{ \/\*/);
    assert.match(f3, /state: 'visible'/);
    const ui03 = script('ui03-browser-accept.mjs');
    assert.match(ui03, /trackPageErrors/);
    assert.match(ui03, /assertNone\(/);
    assert.doesNotMatch(ui03, /waitForTimeout\(4000\)/);
    assert.match(ui03, /state: 'visible'/);
});

test('记忆纠正与前台绑定在写入前重新认证', () => {
    const memory = script('w07-accept.mjs');
    const correction = memory.slice(memory.indexOf('第二客户端并发纠正') - 200, memory.indexOf('第二客户端并发纠正'));
    assert.match(correction, /reauthForWrite/);
    const forget = memory.slice(memory.indexOf("method() === 'DELETE'") - 400, memory.indexOf("method() === 'DELETE'"));
    assert.match(forget, /reauthForWrite/);
    const f2 = script('f2-chat-accept.mjs');
    const bind = f2.slice(f2.indexOf('async function bindForeground'), f2.indexOf('function importJson'));
    assert.match(bind, /reauthForWrite/);
    assert.ok(bind.indexOf('reauthForWrite') < bind.indexOf('savePurpose'));
});
