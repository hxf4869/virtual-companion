import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from '../src/app/providers';
import { createDesktopRouter } from '../src/app/router';
import { renderReplyBubbles } from '../../extension/vc-model-settings/desktop/standalone/cards/reply-bubbles.js';
import { createTestChatEnv } from './chat/fixtures';

const chatCssPath = resolve(__dirname, '../src/features/chat/chat.css');

function setupMatchMedia(initialWidth = 1440) {
    let width = initialWidth;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string): MediaQueryList => {
            const evalQuery = () => {
                if (query.includes('prefers-reduced-motion')) return false;
                const match = query.match(/\(min-width:\s*(\d+)px\)/);
                return match ? width >= Number(match[1]) : false;
            };
            return {
                media: query,
                get matches() {
                    return evalQuery();
                },
                onchange: null,
                addEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
                    if (type === 'change' && typeof cb === 'function') {
                        listeners.add(cb as () => void);
                    }
                }),
                removeEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
                    if (type === 'change' && typeof cb === 'function') {
                        listeners.delete(cb as () => void);
                    }
                }),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
            } as unknown as MediaQueryList;
        }),
    );
    return {
        setWidth(nextWidth: number) {
            width = nextWidth;
            for (const fn of listeners) fn();
        },
    };
}

describe('DR2-12-R2 regressions: chat appearance, reply-bubbles segmentation, and reading position', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setupMatchMedia(1440);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('1) F1 & F17 (chat): styles .vc-chat-header__title-btn without native button chrome, shrinks title in narrow header, and styles real visible chat consumer classes without !important', async () => {
        setupMatchMedia(390);
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'DR2 超长会话标题在窄屏下应优雅截断不与搜索和角色档案按钮重叠',
                    preview: '你好',
                    updatedAt: 1,
                    relationshipId: 'rel-1',
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: '你好呀', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        const router = createDesktopRouter(`/chat/${encodeURIComponent(keyA)}`);
        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => {
            await router.load();
        });

        const titleBtn = container.querySelector('.vc-chat-header__title-btn') as HTMLButtonElement;
        const headerLead = container.querySelector('.vc-chat-header__lead') as HTMLElement;
        const headerActions = container.querySelector('.vc-chat-header__actions') as HTMLElement;
        expect(titleBtn).toBeTruthy();
        expect(headerLead).toBeTruthy();
        expect(headerActions).toBeTruthy();

        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).not.toContain('!important');
        expect(css).toMatch(/@layer\s+features/);

        // Header title button must reset native button chrome and allow flex shrinking
        expect(css).toMatch(/\.vc-chat-header__lead\s*\{[^}]*min-width:\s*0/);
        expect(css).toMatch(
            /\.vc-chat-header__title-btn\s*\{[^}]*appearance:\s*none[^}]*min-width:\s*0[^}]*background:\s*transparent/,
        );
        expect(css).toMatch(/\.vc-chat-header__actions\s*\{[^}]*flex-shrink:\s*0/);

        // Real visible consumer classes in ChatCharacterPanel, ChatStatusCard, and ChatSearch
        expect(css).toMatch(/\.vc-desk-character-identity\s*\{/);
        expect(css).toMatch(/\.vc-desk-character-actions\s*\{/);
        expect(css).toMatch(/\.vc-desk-character-section\s*\{/);
        expect(css).toMatch(/\.vc-desk-recalled\s*\{/);
        expect(css).toMatch(/#vc-status-card\.vc-status-card\s*\{/);
        expect(css).toMatch(/\.vc-sc-head\s*\{/);
        expect(css).toMatch(/\.vc-sc-bars\s*\{/);
        expect(css).toMatch(/\.vc-sc-bar\s*\{/);
        expect(css).toMatch(/\.vc-sc-actions\s*\{/);
        expect(css).toMatch(/\.vc-chat-search-field\s*\{/);
        expect(css).toMatch(/\.vc-chat-search-count\s*\{/);
        expect(css).toMatch(/\.vc-chat-search-done\s*\{/);

        env.bridge.destroy();
    });

    it('2) F4: ChatCharacterPanel close button and action buttons use IconButton skin, right-aligned 36x36 constraint, and close callback without child-side auto-open hooks', async () => {
        setupMatchMedia(1920);
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Hello',
                    updatedAt: 1,
                    relationshipId: 'rel-1',
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Hello from Alice', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        const router = createDesktopRouter(`/chat/${encodeURIComponent(keyA)}`);
        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => {
            await router.load();
        });

        const shell = container.querySelector('#vc-shell') as HTMLElement;
        const charPanelAside = container.querySelector('[data-char-panel]') as HTMLElement;
        expect(shell.dataset.chrome).toBe('wide');

        const closeBtn = container.querySelector(
            '#vc-desktop-character-panel .vc-desk-character-close',
        ) as HTMLButtonElement;
        expect(closeBtn).toBeTruthy();
        expect(closeBtn.classList.contains('vc-icon-btn')).toBe(true);

        const actionBtns = container.querySelectorAll(
            '#vc-desktop-character-panel .vc-desk-character-actions button.vc-icon-btn',
        );
        expect(actionBtns).toHaveLength(3);

        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).toMatch(
            /\.vc-desk-character-close\s*\{[^}]*align-self:\s*flex-end[^}]*width:\s*36px[^}]*height:\s*36px/,
        );

        // Clicking close button collapses the panel via setCharacterPanelOpen(false)
        fireEvent.click(closeBtn);
        expect(shell.dataset.panelOpen).toBe('false');
        expect(charPanelAside.hidden).toBe(true);

        env.bridge.destroy();
    });

    it('3) F5: reply-bubbles vc-segmented hides .mes_text[aria-hidden="true"] in @layer features while keeping DOM contract and preserving leaf ownership across plain, segmented, card HTML, and stream -> final', async () => {
        document.documentElement.dataset.vcApp = 'ready';
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Segmented test',
                    updatedAt: 1,
                    relationshipId: 'rel-1',
                },
            ],
            chatsByKey: {
                [keyA]: [
                    { name: 'Alice', mes: '单段普通回复保持单气泡。', is_user: false },
                    {
                        name: 'Alice',
                        mes: '第一段问候。\n\n（轻轻翻开书页）\n\n第二段正文回复。',
                        is_user: false,
                    },
                    {
                        name: 'Alice',
                        mes: '<div class="TH-render" data-vc-rich="true">Rich card</div>',
                        is_user: false,
                    },
                ],
            },
            streamChunks: ['流式第一段。\n\n（微笑着点头）\n\n流式第二段。'],
            holdStream: true,
        });

        await env.bridge.open(keyA);
        const router = createDesktopRouter('/chat');
        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => {
            await router.load();
        });

        await waitFor(() => {
            expect(container.querySelectorAll('#chat > .mes')).toHaveLength(3);
        });

        const hosts = container.querySelectorAll<HTMLElement>(
            '#chat > .mes .vc-desktop-message-content',
        );
        // Apply real reply-bubbles runtime to the initial messages (matching cards/index.js:121-125)
        renderReplyBubbles(hosts[0], '单段普通回复保持单气泡。', { reducedMotion: true });
        renderReplyBubbles(
            hosts[1],
            '第一段问候。\n\n（轻轻翻开书页）\n\n第二段正文回复。',
            { reducedMotion: true },
        );

        // Message 0: single-segment plain reply -> not segmented
        expect(hosts[0].classList.contains('vc-segmented')).toBe(false);
        expect(hosts[0].querySelector('.mes_text')?.getAttribute('aria-hidden')).toBeNull();
        expect(hosts[0].querySelector('.vc-segs')).toBeNull();

        // Message 1: multi-segment reply -> host gets .vc-segmented, .mes_text stays in DOM with aria-hidden="true", .vc-segs has 3 segments
        expect(hosts[1].classList.contains('vc-segmented')).toBe(true);
        const mes1Text = hosts[1].querySelector('.mes_text') as HTMLElement;
        expect(mes1Text).toBeTruthy();
        expect(mes1Text.getAttribute('aria-hidden')).toBe('true');
        expect(mes1Text.textContent).toContain('第一段问候');
        const segs1 = hosts[1].querySelectorAll('.vc-segs > .vc-seg');
        expect(segs1).toHaveLength(3);
        expect(segs1[1].classList.contains('vc-seg-action')).toBe(true);

        // Trigger a React re-render on MessageItem/MessageLeaf and verify .vc-segmented is NOT stripped by React
        await act(async () => {
            await env.bridge.react(1, '❤️');
        });
        expect(hosts[1].classList.contains('vc-segmented')).toBe(true);
        expect(hosts[1].querySelector('.mes_text')?.getAttribute('aria-hidden')).toBe('true');
        expect(hosts[1].querySelectorAll('.vc-segs > .vc-seg')).toHaveLength(3);

        // Message 2: card HTML (.TH-render) -> cards/index.js skips segmentation when .TH-render / iframe is present
        const cardText = hosts[2].querySelector('.mes_text') as HTMLElement;
        cardText.innerHTML =
            '<div class="TH-render" data-vc-rich="true"><div class="vc-card-host">Card</div></div>';
        expect(hosts[2].classList.contains('vc-segmented')).toBe(false);
        expect(cardText.getAttribute('aria-hidden')).toBeNull();
        expect(hosts[2].querySelector('.TH-render')).toBeTruthy();

        // Stream -> final transition on new reply
        let sendPromise!: Promise<boolean>;
        act(() => {
            sendPromise = env.bridge.send('触发分段流式');
        });

        await waitFor(() => {
            expect(env.bridge.getSnapshot().busy).toBe(true);
            expect(container.querySelectorAll('#chat > .mes')).toHaveLength(5);
        });

        const streamHost = container.querySelector(
            '#chat > .mes[mesid="4"] .vc-desktop-message-content',
        ) as HTMLElement;
        expect(streamHost).toBeTruthy();
        // While streaming, cards/index.js only runs format() and does not segment
        expect(streamHost.classList.contains('vc-segmented')).toBe(false);
        expect(streamHost.querySelector('.vc-segs')).toBeNull();

        await act(async () => {
            env.streamController?.finish();
            await sendPromise;
        });

        // After stream finishes -> final renderReplyBubbles segments the same host node without remounting
        const finalHost = container.querySelector(
            '#chat > .mes[mesid="4"] .vc-desktop-message-content',
        ) as HTMLElement;
        expect(finalHost).toBe(streamHost);
        renderReplyBubbles(
            finalHost,
            '流式第一段。\n\n（微笑着点头）\n\n流式第二段。',
            { reducedMotion: true },
        );
        expect(finalHost.classList.contains('vc-segmented')).toBe(true);
        expect(finalHost.querySelector('.mes_text')?.getAttribute('aria-hidden')).toBe('true');
        expect(finalHost.querySelectorAll('.vc-segs > .vc-seg')).toHaveLength(3);

        // Verify CSS rules in @layer features hide segmented .mes_text (via .vc-segmented and :has(> .vc-segs)) and style .vc-segs / .vc-seg
        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).toMatch(
            /:is\(\.mes\.vc-segmented,\s*\.vc-desktop-message-content\.vc-segmented,\s*\.vc-desktop-message-content:has\(>\s*\.vc-segs\)\)\s*\.mes_text\s*\{[\s\S]*?position:\s*absolute[\s\S]*?width:\s*1px[\s\S]*?height:\s*1px[\s\S]*?overflow:\s*hidden/,
        );
        expect(css).toMatch(
            /:is\(\.mes\.vc-segmented,\s*\.vc-desktop-message-content\.vc-segmented,\s*\.vc-desktop-message-content:has\(>\s*\.vc-segs\)\)\s*\.vc-segs\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/,
        );
        expect(css).toMatch(
            /:is\(\.mes\.vc-segmented,\s*\.vc-desktop-message-content\.vc-segmented,\s*\.vc-desktop-message-content:has\(>\s*\.vc-segs\)\)\s*\.vc-seg\s*\{[\s\S]*?border-radius:/,
        );

        env.bridge.destroy();
    });

    it('4) F6 & F7: #vc-chat-gen uses pill capsule tokens, #vc-date-chip is at top and immediately hides when scrolled to bottom, and useReadingPosition preserves anchor restoration', async () => {
        const keyA = '["alice.png","chat-a"]';
        const now = Date.now();
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Scroll test',
                    updatedAt: 1,
                    relationshipId: 'rel-1',
                },
            ],
            chatsByKey: {
                [keyA]: Array.from({ length: 20 }, (_, i) => ({
                    name: i % 2 === 0 ? 'Alice' : '你',
                    mes: `Message row ${i}`,
                    is_user: i % 2 === 1,
                    send_date: new Date(now - (20 - i) * 60_000).toISOString(),
                })),
            },
        });

        await env.bridge.open(keyA);
        const router = createDesktopRouter('/chat');
        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => {
            await router.load();
        });

        const chatEl = container.querySelector('#chat') as HTMLElement;
        expect(chatEl).toBeTruthy();

        // Provide mock scroll geometry on #chat and message rows
        let scrollTop = 600;
        const scrollHeight = 1000;
        const clientHeight = 400;
        Object.defineProperty(chatEl, 'scrollHeight', {
            get: () => scrollHeight,
            configurable: true,
        });
        Object.defineProperty(chatEl, 'clientHeight', {
            get: () => clientHeight,
            configurable: true,
        });
        Object.defineProperty(chatEl, 'scrollTop', {
            get: () => scrollTop,
            set: (v: number) => {
                scrollTop = v;
            },
            configurable: true,
        });
        vi.spyOn(chatEl, 'getBoundingClientRect').mockReturnValue({
            top: 100,
            bottom: 500,
            left: 0,
            right: 800,
            width: 800,
            height: 400,
            x: 0,
            y: 100,
            toJSON: () => ({}),
        });

        const rows = Array.from(chatEl.querySelectorAll<HTMLElement>(':scope > .mes'));
        rows.forEach((row, idx) => {
            vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
                const rowTop = 100 + idx * 50 - scrollTop;
                return {
                    top: rowTop,
                    bottom: rowTop + 44,
                    left: 0,
                    right: 720,
                    width: 720,
                    height: 44,
                    x: 0,
                    y: rowTop,
                    toJSON: () => ({}),
                };
            });
        });

        const dateChip = container.querySelector('#vc-date-chip') as HTMLElement;
        expect(dateChip).toBeTruthy();
        expect(dateChip.getAttribute('aria-hidden')).toBe('true');

        // 1. User scrolls up into history (gap = 1000 - 200 - 400 = 400 > ATTACH_PX) -> date chip appears
        await act(async () => {
            fireEvent.wheel(chatEl);
            scrollTop = 200;
            fireEvent.scroll(chatEl);
            await new Promise(r => requestAnimationFrame(r));
        });
        expect(dateChip.getAttribute('aria-hidden')).toBe('false');
        expect(dateChip.classList.contains('vc-visible')).toBe(true);
        expect(dateChip.classList.contains('is-on')).toBe(false);

        // 2. User scrolls back to bottom (gap = 1000 - 600 - 400 = 0 <= ATTACH_PX) -> date chip IMMEDIATELY hides without waiting for 1200ms timer
        await act(async () => {
            fireEvent.wheel(chatEl);
            scrollTop = 600;
            fireEvent.scroll(chatEl);
            await new Promise(r => requestAnimationFrame(r));
        });
        expect(dateChip.getAttribute('aria-hidden')).toBe('true');
        expect(dateChip.classList.contains('vc-visible')).toBe(false);

        // Verify CSS for #vc-chat-gen and #vc-date-chip in @layer features
        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).toMatch(
            /#vc-chat-gen\s*\{[^}]*border-radius:\s*var\(--vc-radius-pill\)[^}]*background-color:\s*var\(--vc-raised\)/,
        );
        expect(css).toMatch(/#vc-date-chip\s*\{[^}]*top:\s*var\(--vc-space-sm\)/);

        env.bridge.destroy();
    });

    it('5) F9 & F22: single-copy html[data-vc-app] #toast-container vendor adapter positioned below chat header without !important, and -webkit-backdrop-filter precedes backdrop-filter', () => {
        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).toMatch(
            /html\[data-vc-app\]\s*#toast-container[\s\S]*?position:\s*fixed[\s\S]*?top:\s*calc\(48px\s*\+\s*var\(--vc-space-sm\)\)[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translateX\(-50%\)/,
        );
        expect(css).toMatch(
            /html\[data-vc-app\]\s*#toast-container\s*>\s*\.toast[\s\S]*?border-radius:\s*var\(--vc-radius-pill\)[\s\S]*?background-color:\s*var\(--vc-glass\)/,
        );
        expect(css).toMatch(/\.toast-success\s*\{[\s\S]*?--toast-icon:\s*var\(--vc-success\)/);
        expect(css).toMatch(/\.toast-error\s*\{[\s\S]*?--toast-icon:\s*var\(--vc-danger\)/);

        // F9: only one #toast-container position block (not duplicated inside @layer features)
        const positionMatches = css.match(/#toast-container\.toast-top-right/g) ?? [];
        expect(positionMatches).toHaveLength(1);

        // F22: every backdrop-filter rule in chat.css places -webkit-backdrop-filter BEFORE standard backdrop-filter
        const blocksWithBackdrop = css
            .split('}')
            .filter(block => block.includes('backdrop-filter'));
        expect(blocksWithBackdrop.length).toBeGreaterThanOrEqual(3);
        for (const block of blocksWithBackdrop) {
            const webkitIdx = block.indexOf('-webkit-backdrop-filter:');
            const stdIdx = block.search(/(?<!-webkit-)backdrop-filter:/);
            expect(webkitIdx).toBeGreaterThanOrEqual(0);
            expect(stdIdx).toBeGreaterThan(webkitIdx);
        }
    });

    it('6) F10: aligns .vc-desktop-card-actions and .vc-card-actions with reading column (--vc-read), adds spacing before composer, and collapses when empty', () => {
        const css = readFileSync(chatCssPath, 'utf8');
        expect(css).toMatch(
            /\.vc-desktop-card-actions:empty[\s\S]*?display:\s*none/,
        );
        expect(css).toMatch(
            /\.vc-card-actions\s*\{[\s\S]*?max-width:\s*min\(var\(--vc-read\),\s*100%\)[\s\S]*?margin:\s*0\s+auto/,
        );
        expect(css).toMatch(
            /\.vc-card-actions\s+\.vc-btn\s*\{[\s\S]*?border-radius:\s*var\(--vc-radius-pill\)/,
        );
    });
});
