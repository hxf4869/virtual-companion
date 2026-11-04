import './react-dom-bootstrap.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { installReactDom } from './react-dom.mjs';
import { mountShell } from '../extension/vc-model-settings/shell.js';

test('native host stays mobile layout at 1024px', async (t) => {
    const doc = installReactDom(t);
    globalThis.window.happyDOM.setURL('http://127.0.0.1/native/');
    const previousWidth = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
    Object.defineProperty(globalThis, 'innerWidth', { value: 1024, configurable: true, writable: true });
    t.after(() => {
        if (previousWidth) Object.defineProperty(globalThis, 'innerWidth', previousWidth);
        else delete globalThis.innerWidth;
    });

    doc.body.classList.add('vc-ui');
    const shell = mountShell({
        document: doc,
        storage: { getItem() { return null; }, setItem() {} },
        getContext: () => ({ name1: '合成用户', eventSource: { on() {} }, eventTypes: {} }),
        loadRelationships: async () => [],
        loadInbox: async () => [],
    });

    assert.ok(shell, '#vc-shell should mount');
    assert.equal(doc.documentElement.dataset.vcLayout, 'mobile');
    assert.equal(shell.dataset.chrome, 'tabbar');
    assert.equal(shell.dataset.wide, '0');
    assert.equal(shell.classList.contains('vc-desktop-shell'), false);
    assert.equal(doc.documentElement.style.getPropertyValue('--vc-sidebar'), '0px');
    assert.equal(doc.querySelector('.vc-desktop-aurora'), null);

    const settingsBtn = shell.querySelector('[data-settings]');
    assert.ok(settingsBtn, 'settings trigger should exist');
    settingsBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.notEqual(shell.dataset.settings, 'page');
    assert.ok(doc.querySelector('.vc-sheet'), 'native host settings should open mobile sheet');

    globalThis.innerWidth = 1440;
    globalThis.dispatchEvent(new Event('resize'));
    assert.equal(doc.documentElement.dataset.vcLayout, 'mobile');
    assert.equal(shell.dataset.chrome, 'tabbar');
    assert.equal(shell.classList.contains('vc-desktop-shell'), false);
});
