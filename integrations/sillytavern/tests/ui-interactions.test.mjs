import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { installMiniDom } from './mini-dom.mjs';
import { showToast } from '../extension/vc-model-settings/ui/toast.js';
import { installReactDom } from './react-dom.mjs';
const document = installReactDom({ after });
const { confirmAlert, confirmDiscard } = await import('../extension/vc-model-settings/ui/alert.js');

test('确认框与未保存确认默认聚焦安全动作，取消归还焦点且不执行危险动作', async () => {
    const doc = document;
    try {
        const opener = doc.createElement('button');
        doc.body.append(opener);
        opener.focus();
        for (const [open, label] of [[confirmAlert, '取消'], [confirmDiscard, '继续编辑']]) {
            const pending = open({ title: '删除这条记忆？', opener });
            for (let i = 0; i < 40 && !doc.activeElement.hasAttribute('data-vc-cancel'); i++) await new Promise(resolve => setTimeout(resolve, 0));
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
            for (let i = 0; i < 40 && doc.activeElement !== opener; i++) await new Promise(resolve => setTimeout(resolve, 0));
            assert.equal(doc.activeElement, opener);
        }
    } finally { document.querySelector('[data-vc-cancel]')?.click(); }
});

test('sheet 开始退出动画后 dismiss 仍同步卸载，迟到完成只通知一次', async () => {
    const { openSheet } = await import('../extension/vc-model-settings/ui/sheet.js');
    const originalMedia = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    let sheet, release, completed = 0;
    try {
        const opener = document.createElement('button'); document.body.append(opener); opener.focus();
        sheet = openSheet({ title: '合成退出回归', opener, onDone: () => completed++ });
        const finished = new Promise(resolve => { release = resolve; });
        sheet.el.animate = () => ({ finished, cancel() { release(); } });
        assert.equal(await sheet.close(), true);
        assert.equal(sheet.el.isConnected, true, '退出动画尚未完成');
        sheet.dismiss();
        assert.equal(sheet.el.isConnected, false, '销毁不能等待退出动画');
        assert.equal(sheet.scrim.isConnected, false);
        sheet.dismiss(); release(); await finished; await Promise.resolve();
        assert.equal(completed, 1);
    } finally { sheet?.dismiss(); globalThis.matchMedia = originalMedia; }
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
