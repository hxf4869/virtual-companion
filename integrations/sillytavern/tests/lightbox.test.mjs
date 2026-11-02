import assert from 'node:assert/strict';
import test from 'node:test';
import { copyImage, imageFileName, pageLabel, stepIndex, zoomOrigin } from '../extension/vc-model-settings/lightbox.js';

test('页码、切换夹紧、缩放原点、文件名', () => {
    assert.equal(pageLabel(0, 3), '1 / 3');
    assert.equal(stepIndex(0, 3, -1), 0);
    assert.equal(stepIndex(2, 3, 1), 2);
    assert.equal(stepIndex(1, 3, 1), 2);
    assert.equal(zoomOrigin({ x: 150, y: 50 }, { left: 100, top: 0, width: 100, height: 100 }), '50.0% 50.0%');
    assert.equal(zoomOrigin({ x: 0, y: 500 }, { left: 100, top: 0, width: 100, height: 100 }), '0.0% 100.0%');
    assert.equal(imageFileName('/a/b/cat%20pic.png?x=1'), 'cat pic.png');
    assert.equal(imageFileName('/'), 'image');
});

test('复制图片失败时退回复制地址，全失败返回空', async () => {
    const written = [];
    const clip = { write: async () => { throw new Error('no'); }, writeText: async (t) => written.push(t) };
    const fetchImpl = async () => ({ blob: async () => ({ type: 'image/png' }) });
    globalThis.ClipboardItem = class { constructor(x) { this.x = x; } };
    assert.equal(await copyImage('http://h/a.png', { clipboard: clip, fetchImpl }), 'url');
    assert.deepEqual(written, ['http://h/a.png']);
    const ok = { write: async () => {}, writeText: async () => {} };
    assert.equal(await copyImage('http://h/a.png', { clipboard: ok, fetchImpl }), 'image');
    assert.equal(await copyImage('http://h/a.png', { clipboard: { write: async () => { throw 1; }, writeText: async () => { throw 1; } }, fetchImpl }), '');
});
