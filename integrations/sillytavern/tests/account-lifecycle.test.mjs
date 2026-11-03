import './react-dom-bootstrap.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installReactDom } from './react-dom.mjs';
import { mountDataRights } from '../extension/vc-model-settings/data-rights.js';
import { openAccountData } from '../extension/vc-model-settings/drawers.js';
import { setStHeadersProvider } from '../extension/vc-model-settings/api.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function mockFetch(t, download) {
    const previous = globalThis.fetch;
    globalThis.fetch = async url => String(url).includes('/download?') ? download() : response(String(url).endsWith('/auth/session') ? { accountId: '1', sessionId: '2', role: 'ADMIN', nextStep: 'ACTIVE' } : []);
    setStHeadersProvider(() => ({ 'X-CSRF-Token': 'synthetic' }));
    t.after(() => { globalThis.fetch = previous; setStHeadersProvider(null); });
}

test('销毁账户后，迟到下载finally不再渲染已卸载root', { timeout: 2000 }, async t => {
    const doc = installReactDom(t); let release;
    mockFetch(t, () => new Promise(resolve => { release = resolve; }));
    const account = mountDataRights(); t.after(() => account.destroy());
    account.open(); await tick();
    account.showExportState({ status: 'READY', exportId: '71', downloadUrl: '/api/v1/exports/71/download?token=synthetic' });
    doc.querySelector('[data-download]').click();
    assert.equal(typeof release, 'function', '实际下载请求已开始');
    account.destroy(); release(response({})); await tick();
    assert.equal(doc.querySelector('.vc-data-root'), null);
});

test('账户销毁释放自己的全局入口，保留其他活实例，旧controller不能重开', async t => {
    const doc = installReactDom(t); mockFetch(t);
    const first = mountDataRights(), firstRoot = doc.querySelector('.vc-data-root');
    const second = mountDataRights(), secondRoot = doc.querySelectorAll('.vc-data-root')[1];
    t.after(() => { first.destroy(); second.destroy(); });
    first.destroy(); assert.doesNotThrow(() => openAccountData());
    assert.equal(firstRoot.isConnected, false); assert.equal(secondRoot.querySelector('dialog').open, true);
    second.destroy(); assert.doesNotThrow(() => openAccountData());
    assert.doesNotThrow(() => first.open()); assert.doesNotThrow(() => second.open());
    assert.equal(doc.querySelector('.vc-data-root'), null);
    await tick();
});
