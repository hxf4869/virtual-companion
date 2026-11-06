// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { installChatMemoryProbe } from '../../../scripts/lib/chat-memory-browser.mjs';

function harness(options = {}) {
    const window = new Window();
    const { document } = window;
    let now = 0;
    let focused = true;
    let nextId = 0;
    const frames = new Map();
    const timers = new Map();
    const observers = new Set();
    document.hasFocus = () => focused;
    document.createRange = () => {
        let node;
        return {
            selectNodeContents: current => { node = current; },
            getClientRects: () => [node.parentElement.hasAttribute('data-offscreen')
                ? { left: 2000, right: 2020, top: 10, bottom: 20 }
                : { left: 10, right: 20, top: 10, bottom: 20 }],
        };
    };

    const probe = runInNewContext(`(${installChatMemoryProbe})(options); globalThis.__vcChatMemoryProbe`, {
        options, document, window, NodeFilter: window.NodeFilter,
        performance: { now: () => now },
        getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' }),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; }
            observe() { observers.add(this.callback); }
            disconnect() { observers.delete(this.callback); }
        },
        requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: (callback, ms) => { timers.set(++nextId, { callback, end: now + ms }); return nextId; },
        clearTimeout: id => timers.delete(id),
    });
    function advance(ms) {
        now += ms;
        for (const [id, timer] of timers) {
            if (timer.end <= now) {
                timers.delete(id);
                timer.callback();
            }
        }
    }
    return {
        probe, advance, document,
        frame: () => {
            advance(16);
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(now);
        },
        focus: value => {
            focused = value;
            document.dispatchEvent(new window.Event('visibilitychange'));
        },
        changed: () => observers.forEach(callback => callback()),
        body: html => {
            const root = document.createElement('article');
            root.innerHTML = html;
            document.body.append(root);
            return root;
        },
    };
}

test('CM-1 uses only foreground visible message body across adjacent frames', async () => {
    const h = harness();
    const p = h.probe;
    h.body('<p class="mes_text">旧消息</p>');
    const done = p.beginSend(8, 600);
    const user = h.body('<p class="mes_text">合成发送</p>');
    const assistant = h.body('<p class="mes_text"><span data-reasoning>推理</span><span aria-hidden="true">隐文</span>'
        + '<span data-offscreen>屏外</span>\u200b</p>');
    p.watchEcho(user);
    p.watchReply(assistant);
    h.advance(2);
    p.markAck();
    h.frame();
    h.frame();

    h.focus(false);
    h.advance(2);
    p.markBodyDelta();
    assistant.querySelector('.mes_text').append('第一段');
    h.changed();
    h.frame();
    h.frame();
    h.focus(true);
    h.frame();
    h.frame();

    h.advance(2);
    p.markBodyDelta();
    assistant.querySelector('.mes_text').append('第二段');
    p.generationEnd(assistant);
    p.markDurable();
    p.finish();
    h.frame();
    assert.equal(p.drain().length, 0);
    h.frame();
    assert.equal(await done, 'ok');

    const rows = p.drain();
    const metric = name => rows.find(row => row.metric === name);
    assert.equal(metric('send_echo_ms').value, 18);
    assert.equal(metric('send_ack_ms').value, 2);
    assert.equal(metric('ttft_visible_ms').value, 84);
    assert.equal(metric('reply_complete_ms').value, 118);
    assert.equal(metric('reply_durable_ms').value, 102);
    assert.equal(metric('last_delta_paint_ms').value, 16);
    assert.equal(metric('last_delta_durable_ms').value, 0);
    assert.ok(rows.every(row => row.sample === 8 && row.outcome === 'ok'));
    assert.doesNotMatch(JSON.stringify(rows), /旧消息|合成发送|推理|隐文|第一段|第二段/);
});

test('CM-1 timeout retains pending bounds and measured stages, cancellation stays separate', async () => {
    const h = harness();
    const p = h.probe;
    const timedOut = p.beginOpen(0, 80);
    p.watchOpen(h.body('<p class="mes_text"><span hidden>骨架</span></p>'));
    h.advance(10);
    p.markReady();
    p.finish();
    h.frame();
    h.frame();
    h.advance(48);
    assert.equal(await timedOut, 'timeout');
    const rows = p.drain();
    assert.equal(rows.find(row => row.metric === 'open_ready_ms').outcome, 'ok');
    const paint = rows.find(row => row.metric === 'open_paint_ms');
    assert.equal(paint.value, 90);
    assert.equal(paint.outcome, 'timeout');
    assert.equal(paint.lowerBound, true);

    const cancelled = p.beginSend(1);
    p.finish('cancelled');
    assert.equal(await cancelled, 'cancelled');
    const ttft = p.drain().find(row => row.metric === 'ttft_visible_ms');
    assert.equal(ttft.value, null);
    assert.equal(ttft.outcome, 'cancelled');
    assert.equal(ttft.lowerBound, false);
});

test('CM-1 collector buffer is bounded and only accepts closed outcomes and numeric samples', async () => {
    const { probe } = harness({ capacity: 2 });
    assert.throws(() => probe.beginSend('stable-id'), /PROBE_ACTION_INVALID/);
    const done = probe.beginSend(0);
    assert.throws(() => probe.finish('arbitrary-error'), /PROBE_OUTCOME_INVALID/);
    probe.finish('http_error');
    assert.equal(await done, 'http_error');
    const rows = probe.drain();
    assert.equal(rows.length, 2);
    assert.equal(probe.stats().droppedRows, 4);
    assert.equal(probe.stats().pending, 0);
    assert.equal(rows.at(-1).metric, 'send_outcome');
    assert.equal(probe.drain().length, 0);
});
