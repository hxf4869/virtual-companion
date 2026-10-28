// 生成配置的安全不变量（离线，不依赖 upstream/）。ST 重写后的真实 YAML 由 start.mjs 用 ST 锁定的 yaml 解析器在启动时校验。
// 受管（managed）差异：enableServerPlugins=true 与 Go 桥接环境硬校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig, checkInvariants, buildConfigObject, CONFIG_INVARIANTS, MANAGED_CONFIG_INVARIANTS } from '../scripts/lib/config.mjs';
import { requireManagedGoEnv } from '../scripts/lib/managed.mjs';

const opts = { dataRoot: '/tmp/x/dev/data', port: 8742 };

test('renderConfig 输出合法 JSON（即合法 YAML），且与 buildConfigObject 等价', () => {
    const text = renderConfig(opts);
    const parsed = JSON.parse(text);
    assert.deepEqual(parsed, buildConfigObject(opts));
    assert.equal(parsed.dataRoot, opts.dataRoot);
    assert.equal(parsed.port, 8742);
    assert.deepEqual(checkInvariants(parsed), []);
});

test('不变量：listen=false、whitelist 仅 loopback、CSRF 保留、扩展/插件自动更新关闭、浏览器不自启、自动聊天备份开启', () => {
    const o = buildConfigObject(opts);
    assert.equal(o.listen, false);
    assert.deepEqual(o.whitelist, ['127.0.0.1', '::1']);
    assert.equal(o.disableCsrfProtection, false);
    assert.equal(o.securityOverride, false);
    assert.equal(o.allowKeysExposure, false);
    assert.equal(o.extensions.autoUpdate, false);
    assert.equal(o.extensions.models.autoDownload, false);
    assert.equal(o.enableServerPlugins, false);
    assert.equal(o.browserLaunch.enabled, false);
    assert.equal(o.backups.chat.enabled, true, 'ST 自动聊天备份保持开启并纳入 C1 清单');
    // 每条不变量都必须在生成对象中有对应键（防止不变量表与配置脱节）
    for (const k of Object.keys(CONFIG_INVARIANTS)) {
        const v = k.split('.').reduce((a, b) => a?.[b], o);
        assert.notEqual(v, undefined, `配置缺少不变量键 ${k}`);
    }
});

test('被削弱的配置必须被检出（坏输入）', () => {
    const weak = buildConfigObject(opts);
    weak.listen = true;
    weak.disableCsrfProtection = true;
    weak.extensions.autoUpdate = true;
    weak.whitelist = ['0.0.0.0/0'];
    const bad = checkInvariants(weak);
    assert.ok(bad.some((b) => b.startsWith('listen=')));
    assert.ok(bad.some((b) => b.startsWith('disableCsrfProtection=')));
    assert.ok(bad.some((b) => b.startsWith('extensions.autoUpdate=')));
    assert.ok(bad.some((b) => b.startsWith('whitelist=')));
    assert.ok(checkInvariants({ ...buildConfigObject(opts), whitelist: [] }).some((b) => b.startsWith('whitelist=')));
});

// ---------- 受管（managed）差异 ----------

const managedOpts = { dataRoot: '/tmp/x/dev-managed/data', port: 8752, enableServerPlugins: true };

test('受管配置：enableServerPlugins=true 是与原生的唯一差异，受管不变量全部合规', () => {
    const o = buildConfigObject(managedOpts);
    assert.equal(o.enableServerPlugins, true);
    assert.equal(o.port, 8752);
    assert.deepEqual(checkInvariants(o, MANAGED_CONFIG_INVARIANTS), []);
    // 受管差异显式参数化：同一对象在原生不变量下必须报 enableServerPlugins，证明两张表确实不同
    assert.ok(checkInvariants(o).every((b) => b.startsWith('enableServerPlugins=')));
    // 每条受管不变量都必须在受管配置对象中有对应键
    for (const k of Object.keys(MANAGED_CONFIG_INVARIANTS)) {
        const v = k.split('.').reduce((a, b) => a?.[b], o);
        assert.notEqual(v, undefined, `受管配置缺少不变量键 ${k}`);
    }
});

test('受管配置被削弱必须被检出（插件自动更新/关闭插件装载/换端口不改监听面）', () => {
    const weak = buildConfigObject(managedOpts);
    weak.enableServerPluginsAutoUpdate = true;
    weak.extensions.autoUpdate = true;
    weak.enableServerPlugins = false; // 受管宿主策略要求插件装载，关掉即破坏受管链路
    const bad = checkInvariants(weak, MANAGED_CONFIG_INVARIANTS);
    assert.ok(bad.some((b) => b.startsWith('enableServerPluginsAutoUpdate=')));
    assert.ok(bad.some((b) => b.startsWith('extensions.autoUpdate=')));
    assert.ok(bad.some((b) => b.startsWith('enableServerPlugins=')));
});

test('Go 桥接环境硬校验：缺失/为空/短 TOKEN 必须硬失败，完整环境通过', () => {
    const token32 = 't'.repeat(32);
    assert.deepEqual(requireManagedGoEnv({ VC_ST_GO_BASE_URL: 'http://127.0.0.1:8095', VC_ST_PLUGIN_SERVICE_TOKEN: token32 }), { ok: true, problems: [], baseUrl: 'http://127.0.0.1:8095' });
    assert.equal(requireManagedGoEnv({ VC_ST_PLUGIN_SERVICE_TOKEN: token32 }).ok, false, '缺 VC_ST_GO_BASE_URL 必须失败');
    assert.equal(requireManagedGoEnv({ VC_ST_GO_BASE_URL: 'http://127.0.0.1:8095' }).ok, false, '缺 VC_ST_PLUGIN_SERVICE_TOKEN 必须失败');
    assert.equal(requireManagedGoEnv({ VC_ST_GO_BASE_URL: '   ', VC_ST_PLUGIN_SERVICE_TOKEN: token32 }).ok, false, 'BASE_URL 空白必须失败');
    assert.equal(requireManagedGoEnv({ VC_ST_GO_BASE_URL: 'http://127.0.0.1:8095', VC_ST_PLUGIN_SERVICE_TOKEN: 't'.repeat(31) }).ok, false, 'TOKEN 31 字节必须失败');
    assert.equal(requireManagedGoEnv({ VC_ST_GO_BASE_URL: 'http://127.0.0.1:8095', VC_ST_PLUGIN_SERVICE_TOKEN: token32 }).problems.length, 0);
});
