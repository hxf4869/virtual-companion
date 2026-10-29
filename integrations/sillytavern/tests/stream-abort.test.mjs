import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { absorbStreamAbort } from '../server-plugin/virtual-companion/lib/stream-abort.js';
import { settleArmedResponse, uninstallUsageFetch } from '../server-plugin/virtual-companion/lib/model-usage.js';

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    error.type = 'aborted';
    return error;
}

test('pipe 在没有持久 error 监听时会把 AbortError 重新抛出', () => {
    const body = new PassThrough();
    const dest = new PassThrough();
    body.pipe(dest);
    assert.throws(() => body.emit('error', abortError()), (error) => error?.name === 'AbortError');
    dest.destroy();
});

test('absorbStreamAbort 让客户端中断在 pipe 之后安静结束', () => {
    const body = new PassThrough();
    const dest = new PassThrough();
    absorbStreamAbort(body);
    absorbStreamAbort(body);
    body.pipe(dest);
    assert.doesNotThrow(() => body.emit('error', abortError()));
    dest.destroy();
    body.destroy();
});

test('settleArmedResponse 在没有预留时也接住响应体中断', () => {
    uninstallUsageFetch();
    const body = new PassThrough();
    const dest = new PassThrough();
    settleArmedResponse({ body }, 'http://127.0.0.1/upstream', {});
    body.pipe(dest);
    assert.doesNotThrow(() => body.emit('error', abortError()));
    dest.destroy();
    body.destroy();
});

test('插件入口不再改写 AbortController 或替换 uncaughtException', () => {
    const src = fs.readFileSync(new URL('../server-plugin/virtual-companion/index.js', import.meta.url), 'utf8');
    assert.equal(src.includes('AbortController'), false);
    assert.equal(src.includes('uncaughtException'), false);
    assert.equal(src.includes('guardClientAbort'), false);
});
