// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const integrationRequire = createRequire(new URL('../../integrations/sillytavern/package.json', import.meta.url));
const HISTORY_SIZES = [0, 20, 200, 2000, 20000];
const CACHE_STATES = ['cold-browser', 'first-open', 'warm', 'search'];

// This function runs in the browser, including when passed directly to addInitScript.
// Each action supplies the mounted element for its own message or reading anchor.
export function installChatMemoryProbe({
    bodySelector = '.mes_text, .vc-segs .vc-seg',
    excludedSelector = '[aria-hidden="true"], [hidden], [data-reasoning], [data-typing]',
    capacity = 128,
} = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('PROBE_CAPACITY_INVALID');
    const stages = {
        send: ['send_echo_ms', 'send_ack_ms', 'ttft_visible_ms', 'reply_complete_ms', 'reply_durable_ms'],
        open: ['open_paint_ms', 'open_ready_ms'],
    };
    const outcomes = new Set([
        'ok', 'http_error', 'provider_error', 'stream_error', 'empty_reply', 'save_error',
        'memory_degraded', 'timeout', 'cancelled', 'auth_denied', 'budget_stop', 'invalid_input', 'silence', 'not_run',
    ]);
    const rows = [];
    let droppedRows = 0;
    let active;

    function retain(row) {
        if (rows.length === capacity) { rows.shift(); droppedRows++; }
        rows.push(row);
    }

    function close(action, outcome) {
        if (active !== action) return;
        active = undefined;
        clearTimeout(action.timer);
        for (const stop of action.paintWatches.values()) stop();
        const elapsed = performance.now() - action.started;
        for (const metric of stages[action.kind]) {
            const time = action.times.get(metric);
            const lowerBound = time === undefined && outcome === 'timeout';
            retain({ sample: action.sample, metric,
                value: time === undefined ? (lowerBound ? elapsed : null) : time - action.started,
                outcome: time === undefined ? outcome : 'ok', lowerBound });
        }
        if (action.lastDelta !== undefined) {
            for (const [metric, stage] of [['last_delta_paint_ms', 'reply_complete_ms'], ['last_delta_durable_ms', 'reply_durable_ms']]) {
                const time = action.times.get(stage);
                const lowerBound = time === undefined && outcome === 'timeout';
                retain({ sample: action.sample, metric,
                    value: time === undefined ? (lowerBound ? performance.now() - action.lastDelta : null) : time - action.lastDelta,
                    outcome: time === undefined ? outcome : 'ok', lowerBound });
            }
        }
        retain({ sample: action.sample, metric: `${action.kind}_outcome`, value: elapsed,
            outcome, lowerBound: outcome === 'timeout' });
        action.resolve(outcome);
    }

    function begin(kind, sample, timeoutMs = 10000) {
        if (active) throw new Error('PROBE_ACTION_IN_PROGRESS');
        if (!Number.isSafeInteger(sample) || sample < 0 || !Number.isFinite(timeoutMs)
            || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('PROBE_ACTION_INVALID');
        return new Promise(resolve => {
            const action = { kind, sample, resolve, started: performance.now(), times: new Map(), paintWatches: new Map() };
            action.timer = setTimeout(() => close(action, 'timeout'), timeoutMs);
            active = action;
        });
    }

    function maybeClose(action) {
        if (action.finishing && stages[action.kind].every(metric => action.times.has(metric))) close(action, 'ok');
    }

    function mark(action, metric, time = performance.now()) {
        if (!action || active !== action || !stages[action.kind].includes(metric) || action.times.has(metric)) return;
        action.times.set(metric, time);
        maybeClose(action);
    }

    function inFront() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    function visibleText(root) {
        if (!root?.isConnected || !inFront()) return false;
        const bodies = root.matches(bodySelector) ? [root] : root.querySelectorAll(bodySelector);
        const range = document.createRange();
        for (const body of bodies) {
            const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const parent = node.parentElement;
                if (!/[^\s\u200B-\u200D\uFEFF]/u.test(node.data) || parent.closest(excludedSelector)
                    || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) continue;
                const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
                for (let ancestor = parent.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    const { overflowX, overflowY } = getComputedStyle(ancestor);
                    if (overflowX === 'visible' && overflowY === 'visible') continue;
                    const bounds = ancestor.getBoundingClientRect();
                    if (overflowX !== 'visible') {
                        clip.left = Math.max(clip.left, bounds.left + ancestor.clientLeft);
                        clip.right = Math.min(clip.right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
                    }
                    if (overflowY !== 'visible') {
                        clip.top = Math.max(clip.top, bounds.top + ancestor.clientTop);
                        clip.bottom = Math.min(clip.bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
                    }
                }
                range.selectNodeContents(node);
                if ([...range.getClientRects()].some(rect => Math.max(rect.left, clip.left) < Math.min(rect.right, clip.right)
                    && Math.max(rect.top, clip.top) < Math.min(rect.bottom, clip.bottom))) return true;
            }
        }
        return false;
    }

    function watchPaint(action, metric, root) {
        if (!action || !root || !stages[action.kind].includes(metric) || action.times.has(metric)) return;
        action.paintWatches.get(metric)?.();
        let frame = null;
        const schedule = () => {
            if (frame !== null || active !== action || !inFront()) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                if (!visibleText(root)) return;
                const paint = performance.now();
                // The next frame confirms the preceding render had a paint opportunity.
                frame = requestAnimationFrame(() => {
                    frame = null;
                    if (!visibleText(root)) return;
                    stop();
                    action.paintWatches.delete(metric);
                    mark(action, metric, paint);
                });
            });
        };
        const observer = new MutationObserver(schedule);
        observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('focus', schedule);
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        function stop() {
            observer.disconnect();
            if (frame !== null) cancelAnimationFrame(frame);
            document.removeEventListener('visibilitychange', schedule);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
        }
        action.paintWatches.set(metric, stop);
        schedule();
    }

    // Adapters bind only their current action's DOM roots and report authoritative ACKs.
    // generationEnd is called after committing the final reply render, including split bubbles.
    globalThis.__vcChatMemoryProbe = Object.freeze({
        beginOpen: (sample, timeoutMs) => begin('open', sample, timeoutMs),
        beginSend: (sample, timeoutMs) => begin('send', sample, timeoutMs),
        watchOpen: root => watchPaint(active, 'open_paint_ms', root),
        watchEcho: root => watchPaint(active, 'send_echo_ms', root),
        watchReply: root => watchPaint(active, 'ttft_visible_ms', root),
        markAck: () => mark(active, 'send_ack_ms'),
        markReady: () => mark(active, 'open_ready_ms'),
        markBodyDelta: () => {
            if (active?.kind === 'send' && !active.paintWatches.has('reply_complete_ms')
                && !active.times.has('reply_complete_ms') && !active.times.has('reply_durable_ms')) {
                active.lastDelta = performance.now();
            }
        },
        generationEnd: root => watchPaint(active, 'reply_complete_ms', root),
        markDurable: () => mark(active, 'reply_durable_ms'),
        finish: (outcome = 'ok') => {
            if (!outcomes.has(outcome)) throw new Error('PROBE_OUTCOME_INVALID');
            if (!active) return;
            if (outcome !== 'ok') return close(active, outcome);
            active.finishing = true;
            maybeClose(active);
        },
        drain: () => rows.splice(0),
        stats: () => ({ droppedRows, pending: active ? 1 : 0 }),
    });
}

async function createFixture(histories, directory) {
    const page = await readFile(new URL('../fixtures/chat-memory-browser.html', import.meta.url));
    const metadata = new Map();
    for (const size of histories) {
        const records = Array.from({ length: size }, (_, index) => ({ text: `第${index + 1}条合成聊天消息` }));
        const data = JSON.stringify(records);
        await writeFile(join(directory, `history-${size}.json`), data, { mode: 0o600 });
        metadata.set(size, { historyMessages: size, historyBytes: Buffer.byteLength(data),
            // The fixture uses one token per Unicode code point, independent of any model.
            historyTokens: records.reduce((count, record) => count + record.text.length, 0) });
    }

    const saveFile = join(directory, 'turn.json');
    let revision = 0;
    const server = createServer(async (req, res) => {
        const responseClosed = new AbortController();
        res.once('close', () => responseClosed.abort());
        const send = (status, contentType, data) => {
            res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
            res.end(data);
        };
        const json = (status, data) => send(status, 'application/json', JSON.stringify(data));
        try {
            const parts = req.url.split('/');
            if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', page);
            const size = Number(parts[2]);
            if (req.method === 'GET' && parts[1] === 'history' && metadata.has(size)) {
                return send(200, 'application/json', await readFile(join(directory, `history-${size}.json`)));
            }
            if (req.method === 'POST' && parts[1] === 'save' && size === revision && revision < 2) {
                await writeFile(saveFile, JSON.stringify({ revision: size + 1, messages: ['合成发送', '合成回复。'].slice(0, size + 1) }),
                    { flush: true, mode: 0o600 });
                revision++;
                return json(200, { revision });
            }
            if (req.method !== 'GET' || parts[1] !== 'stream') return json(404, {});
            if (parts[2] === 'http_error') return json(503, {});

            res.socket.setNoDelay(true);
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
            res.flushHeaders();
            const wait = ms => delay(ms, undefined, { signal: responseClosed.signal });
            res.write('data: {"role":"assistant"}\n\n');
            await wait(8);
            res.write(': heartbeat\n\n');
            await wait(8);
            res.write('data: {"reasoning":"合成推理","hidden":"合成隐藏文本"}\n\n');
            if (parts[2] === 'timeout') {
                await wait(10000);
                return res.end();
            }
            await wait(60);
            res.write('data: {"body":"合');
            await wait(4);
            res.write('成回复"}\n\n');
            await wait(25);
            res.end('data: {"body":"。"}\n\ndata: {"done":true}\n\n');
        } catch {
            if (!res.headersSent) json(500, {});
            else res.destroy();
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        metadata,
        resetTurn: () => { revision = 0; },
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
    };
}

export async function runBrowserCalibration({
    histories = HISTORY_SIZES, caches = CACHE_STATES, coldSamples = 30, warmSamples = 50,
    variant = 'candidate', executablePath, signal,
} = {}) {
    if (!histories.length || new Set(histories).size !== histories.length || histories.some(n => !HISTORY_SIZES.includes(n))
        || !caches.length || new Set(caches).size !== caches.length || caches.some(state => !CACHE_STATES.includes(state))
        || ![coldSamples, warmSamples].every(n => Number.isSafeInteger(n) && n > 0)
        || !['baseline', 'candidate'].includes(variant)) throw new Error('BROWSER_CALIBRATION_OPTIONS_INVALID');

    const { chromium } = integrationRequire('playwright-core');
    const directory = await mkdtemp(join(tmpdir(), 'vc-cm1-browser-'));
    let fixture;
    let browser;
    const onAbort = () => { void browser?.close().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const samples = [];
    const checks = {
        status: 'PASS', clock: 'browser-performance-now', historyTokenUnit: 'synthetic-codepoint',
        measured: 0, paintViolations: 0, maxFirstPaintLagMs: 0, maxLastPaintLagMs: 0, maxAllowedLagMs: 0,
        historyCountMismatches: 0, expectedFaults: {},
    };
    let sample = 0;
    const launch = () => chromium.launch({ headless: true,
        ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    });
    async function newPage() {
        signal?.throwIfAborted();
        const page = await browser.newPage();
        await page.addInitScript(installChatMemoryProbe);
        await page.goto(fixture.url);
        await page.bringToFront();
        return page;
    }
    async function measure(page, historyMessages, cache, fault) {
        signal?.throwIfAborted();
        const index = sample++;
        fixture.resetTurn();
        await page.evaluate(args => window.fixtureSetup(args), { index, historyMessages, cache, fault });
        await page.locator('#open').click();
        const opened = await page.evaluate(() => window.fixtureDone) === 'ok';
        if (opened) await page.locator('#send').click();
        else await page.evaluate(() => window.fixtureUnavailable());
        const result = await page.evaluate(() => window.fixtureDone);
        const row = metric => result.rows.find(item => item.metric === metric);
        if (fault) {
            const expected = row('send_outcome');
            const ttft = row('ttft_visible_ms');
            checks.expectedFaults[fault] = expected?.outcome === fault && ttft?.outcome === fault
                && row('send_ack_ms')?.outcome === 'ok' && result.receivedBodyDeltas === 0
                && (fault === 'timeout' ? ttft.lowerBound && ttft.value >= 300 : ttft.value === null) ? 'PASS' : 'FAIL';
            return;
        }
        const bound = result.frameMs + 10;
        const first = row('ttft_visible_ms')?.value - result.firstBodyMs;
        const last = row('reply_complete_ms')?.value - result.lastBodyMs;
        checks.measured++;
        checks.maxAllowedLagMs = Math.max(checks.maxAllowedLagMs, bound);
        if (Number.isFinite(first)) checks.maxFirstPaintLagMs = Math.max(checks.maxFirstPaintLagMs, first);
        if (Number.isFinite(last)) checks.maxLastPaintLagMs = Math.max(checks.maxLastPaintLagMs, last);
        if (result.rows.length !== 11 || result.receivedBodyDeltas !== 2 || !(result.lastBodyMs > result.firstBodyMs)
            || !(first >= 0 && first <= bound && last >= 0 && last <= bound)
            || result.rows.some(item => item.outcome !== 'ok')) checks.paintViolations++;
        if (result.historyCount !== historyMessages) checks.historyCountMismatches++;
        const dimensions = { ...fixture.metadata.get(historyMessages), variant, cache,
            modelCache: 'not_applicable', network: 'controlled', surface: 'collector-fixture',
            content: 'text', attempts: 1, warmup: false };
        samples.push(...result.rows.map(item => ({ ...item, ...dimensions })));
    }

    try {
        fixture = await createFixture(histories, directory);
        for (const cache of caches) {
            if (cache !== 'cold-browser') browser = await launch();
            for (const historyMessages of histories) {
                const reuse = cache === 'warm' || cache === 'search';
                const page = reuse ? await newPage() : null;
                const count = reuse ? warmSamples : coldSamples;
                for (let i = 0; i < count; i++) {
                    signal?.throwIfAborted();
                    if (cache === 'cold-browser') browser = await launch();
                    const current = page ?? await newPage();
                    await measure(current, historyMessages, cache);
                    if (!reuse) await current.close();
                    if (cache === 'cold-browser') await browser.close();
                }
                await page?.close();
            }
            if (cache !== 'cold-browser') await browser.close();
        }
        browser = await launch();
        const faultPage = await newPage();
        for (const fault of ['http_error', 'cancelled', 'timeout']) await measure(faultPage, histories[0], 'first-open', fault);
        if (checks.paintViolations || checks.historyCountMismatches
            || Object.values(checks.expectedFaults).includes('FAIL')) checks.status = 'FAIL';
        return { samples, checks };
    } finally {
        signal?.removeEventListener('abort', onAbort);
        try {
            await browser?.close();
        } finally {
            try {
                await fixture?.close();
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        }
    }
}
