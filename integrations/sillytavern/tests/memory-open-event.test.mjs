import { bootstrapDocument } from './react-dom-bootstrap.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../extension/vc-model-settings/api.js';
import { OPEN_MEMORY_EVENT, bindOpenMemory, mountMemoryPage, requestOpenMemory } from '../extension/vc-model-settings/memory-page.js';

test('聊天入口事件把焦点来源交给已挂载的记忆页', async () => {
    const opened = [];
    const release = bindOpenMemory((opener) => opened.push(opener));
    const button = { id: 'memory' };
    const detail = requestOpenMemory(button);
    assert.equal(detail.opener, button);
    assert.equal(opened[0], button);
    assert.equal(OPEN_MEMORY_EVENT, 'vc-open-memory');
    release();
});

test('挂载后的记忆页响应聊天入口，不改动关闭焦点约定', async () => {
    assert.equal(document, bootstrapDocument);
    const realFetch = globalThis.fetch;
    document.cookie = 'vc_csrf=go-token';
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('/auth/session')) {
            return new Response(JSON.stringify({ accountId: '7', sessionId: '8' }), { status: 200 });
        }
        if (String(url).endsWith('/relationships')) {
            return new Response(JSON.stringify([{ relationshipId: '11', personaRef: 'st-character', companionName: '澄夏' }]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
    };
    let handle;
    try {
        const opener = document.createElement('button');
        opener.textContent = '记忆';
        document.body.append(opener);
        opener.focus();
        handle = mountMemoryPage();
        requestOpenMemory(opener);
        const dialog = document.querySelector('.vc-memory-dialog');
        assert.equal(dialog.open, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        handle.close();
        assert.equal(dialog.open, false);
        assert.equal(document.activeElement, opener);
    } finally {
        handle?.destroy();
        globalThis.fetch = realFetch;
    }
});
