import test from 'node:test';
import assert from 'node:assert/strict';
import { installMiniDom } from './mini-dom.mjs';
import { showToast } from '../extension/vc-model-settings/ui/toast.js';
import { confirmAlert, confirmDiscard } from '../extension/vc-model-settings/ui/alert.js';

test('确认框与未保存确认默认聚焦安全动作，取消归还焦点且不执行危险动作', async () => {
    const doc = installMiniDom();
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    try {
        const opener = doc.createElement('button');
        doc.body.append(opener);
        opener.focus();
        for (const [open, label] of [[confirmAlert, '取消'], [confirmDiscard, '继续编辑']]) {
            const pending = open({ title: '删除这条记忆？', opener });
            assert.equal(doc.activeElement.textContent, label);
            assert.ok(doc.activeElement.hasAttribute('data-vc-cancel'));
            if (open === confirmDiscard) {
                assert.equal(doc.querySelector('h4').textContent, '放弃更改？');
                assert.equal(doc.querySelector('p').textContent, '关闭后本次输入将丢失。');
                assert.equal(doc.querySelector('[data-vc-ok]').textContent, '放弃');
            }
            doc.activeElement.click();
            assert.equal(await pending, false);
            assert.equal(doc.querySelector('.vc-alert'), null);
            assert.equal(doc.activeElement, opener);
        }
    } finally { globalThis.requestAnimationFrame = previousRaf; }
});

test('提示条跨 root 保持全局单实例，失败提示可关闭', () => {
    const doc = installMiniDom();
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    try {
        const firstHost = doc.createElement('section');
        const secondHost = doc.createElement('section');
        doc.body.append(firstHost, secondHost);
        const first = showToast('没有完成，请重试。', { type: 'error', root: firstHost });
        const second = showToast('没有完成，请重试。', { type: 'error', root: secondHost });
        assert.equal(first, second);
        assert.equal(firstHost.querySelector('.vc-toast'), null);
        assert.equal(secondHost.querySelectorAll('.vc-toast').length, 1);
        assert.equal(second.getAttribute('role'), 'alert');
        second.querySelector('button').click();
        assert.equal(secondHost.querySelector('.vc-toast'), null);
    } finally { globalThis.requestAnimationFrame = previousRaf; }
});
