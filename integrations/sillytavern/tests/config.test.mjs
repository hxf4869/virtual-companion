// 生成配置的安全不变量（离线，不依赖 upstream/）。ST 重写后的真实 YAML 由 start.mjs 用 ST 锁定的 yaml 解析器在启动时校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig, checkInvariants, buildConfigObject, CONFIG_INVARIANTS } from '../scripts/lib/config.mjs';

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
