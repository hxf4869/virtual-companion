import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { toast } from '../../src/design/components/Toast';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import { bindCardHost, getCardHost } from '../../../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js';
import { bindEngineContext, getContext } from '../../../extension/vc-model-settings/desktop/standalone/engine/ports.js';
import { createTestChatEnv, type TestMessageRecord } from './fixtures';

function setupMatchMedia(initialWidth = 1440) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string): MediaQueryList => {
            const match = query.match(/\(min-width:\s*(\d+)px\)/);
            const matches = match ? initialWidth >= Number(match[1]) : false;
            return {
                media: query,
                matches,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
            } as unknown as MediaQueryList;
        }),
    );
}

function buildTestRecords(count: number): TestMessageRecord[] {
    return Array.from({ length: count }, (_, idx) => ({
        name: idx % 2 === 1 ? '你' : 'Alice',
        mes: `消息 #${idx}`,
        is_user: idx % 2 === 1,
        is_system: false,
        send_date: new Date(Date.UTC(2026, 10, 4, 10, 0, idx)).toISOString(),
    }));
}

describe('t14-window: MessageList / SessionBridge firstDisplayedMessageId real window supply', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setupMatchMedia(1440);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('updates context.firstDisplayedMessageId across 80-message window, load-earlier, delete, and conversation switch', async () => {
        const keyA = '["alice.png","chat-105"]';
        const keyB = '["bob.png","chat-90"]';
        const bobRecords = buildTestRecords(90);
        // Message #10 is the first row in Bob's 80-message window (indices 10..89); mark it is_system: true
        // to verify that prompt-hidden messages still render in DOM and are NOT skipped by firstDisplayedMessageId.
        bobRecords[10] = { ...bobRecords[10], is_system: true };

        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-105',
                    title: 'Alice',
                    preview: '消息 #104',
                    relationshipId: 'rel-alice',
                    characterRef: 'ref-alice',
                },
                {
                    key: keyB,
                    avatar: 'bob.png',
                    file: 'chat-90',
                    title: 'Bob',
                    preview: '消息 #89',
                    relationshipId: 'rel-bob',
                    characterRef: 'ref-bob',
                },
            ],
            chatsByKey: {
                [keyA]: buildTestRecords(105),
                [keyB]: bobRecords,
            },
        });

        await env.bridge.open(keyA);
        // Before MessageList mounts, firstDisplayedMessageId is null (never guesses chatLen - 80)
        expect(env.bridge.getContext().firstDisplayedMessageId).toBeNull();
        expect(env.bridge.getContext().readFirstDisplayedMessageId()).toBeNull();

        const router = createDesktopRouter('/chat');
        const { container, unmount } = render(
            <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => {
            await router.load();
        });
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(80));

        const readDomFirstMesId = () =>
            Number(container.querySelector('#chat > .mes[mesid]')?.getAttribute('mesid'));

        // 105 messages with PAGE_SIZE = 80 -> firstDisplayedMessageId = 25, matching real DOM first row
        expect(readDomFirstMesId()).toBe(25);
        expect(env.bridge.getContext().firstDisplayedMessageId).toBe(25);
        expect(env.bridge.getContext().readFirstDisplayedMessageId()).toBe(25);

        // Delete 1 message before the window (index 0) -> 104 messages, window still anchored at original firstKey -> firstDisplayedMessageId = 24
        await act(async () => {
            await env.bridge.remove(0);
        });
        expect(readDomFirstMesId()).toBe(24);
        expect(env.bridge.getContext().firstDisplayedMessageId).toBe(24);
        expect(env.bridge.getContext().readFirstDisplayedMessageId()).toBe(24);

        // Click "显示更早的消息" -> loads remaining 24 earlier messages -> firstDisplayedMessageId = 0
        fireEvent.click(screen.getByRole('button', { name: '显示更早的消息', exact: true }));
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(104));
        expect(readDomFirstMesId()).toBe(0);
        expect(env.bridge.getContext().firstDisplayedMessageId).toBe(0);
        expect(env.bridge.getContext().readFirstDisplayedMessageId()).toBe(0);

        // Switch to Bob's conversation (90 messages, where message #10 has is_system: true)
        const bobChat = env.bridge.getContext();
        await act(async () => {
            await env.bridge.open(keyB);
        });
        await waitFor(() => {
            expect(env.bridge.getSnapshot().key).toBe(keyB);
            expect(container.querySelectorAll('#chat > .mes')).toHaveLength(80);
        });
        // MessageItem renders is_system rows in the DOM; firstDisplayedMessageId matches DOM first row (10, not 11)
        expect(bobChat.chat[10].is_system).toBe(true);
        expect(readDomFirstMesId()).toBe(10);
        expect(bobChat.firstDisplayedMessageId).toBe(10);
        expect(bobChat.readFirstDisplayedMessageId()).toBe(10);

        // Stale cleanup for keyA must NOT clear keyB's firstDisplayedMessageId
        env.bridge.setFirstDisplayedMessageId(keyA, null);
        expect(bobChat.firstDisplayedMessageId).toBe(10);

        // Unmounting MessageList clears firstDisplayedMessageId to null
        unmount();
        expect(bobChat.firstDisplayedMessageId).toBeNull();
        expect(bobChat.readFirstDisplayedMessageId()).toBeNull();

        env.bridge.destroy();
    });

    it('aborts in-flight runtime preparation on Bridge A destroy so late A completion never hijacks or clears Bridge B globals, CardHost, or page state', async () => {
        const toastSpy = vi.spyOn(toast, 'show');
        const prevFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/model-purposes')) {
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/providers')) {
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        try {
            delete document.documentElement.dataset.vcRuntime;
            delete document.documentElement.dataset.vcCharacters;

            let resolveSettingsA!: (val: any) => void;
            const settingsGateA = new Promise(res => {
                resolveSettingsA = res;
            });
            let rejectCharsA!: (err: any) => void;
            const charsGateA = new Promise<any[]>((_, rej) => {
                rejectCharsA = rej;
            });
            let captureSettingsCountA = 0;

            // Bridge A uses the REAL default prepareChatRuntime (no injected prepareRuntime spy)
            const clientA: any = {
                headers: () => ({}),
                characters: () => charsGateA,
                settings: () => settingsGateA,
                documents: {
                    captureSettings() {
                        captureSettingsCountA += 1;
                    },
                    seedPresets() {},
                    projectSettings() {},
                },
            };

            const bridgeA = createSessionBridge(clientA);
            const eventsA: string[] = [];
            bridgeA.getContext().eventSource.on('app_ready', () => {
                eventsA.push('app_ready');
            });

            // Also start Bridge A2 with a controlled factory to verify synchronous signal abort and late onToast suppression
            let capturedSignalA2: AbortSignal | undefined;
            let capturedOnToastA2: ((msg: string, opts?: { type?: string }) => void) | undefined;
            let resolveGateA2!: () => void;
            const gateA2 = new Promise<void>(res => {
                resolveGateA2 = res;
            });
            const bridgeA2 = createSessionBridge({} as any, {
                prepareRuntime: (async (args: any) => {
                    capturedSignalA2 = args.signal;
                    capturedOnToastA2 = args.onToast;
                    await gateA2;
                    args.onToast?.('A2 迟到错误提示', { type: 'error' });
                    args.signal?.throwIfAborted();
                    return {};
                }) as any,
            });

            expect(capturedSignalA2).toBeDefined();
            expect(capturedSignalA2?.aborted).toBe(false);

            // Destroy A and A2 before their preparation promises settle
            bridgeA.destroy();
            bridgeA2.destroy();
            expect(capturedSignalA2?.aborted).toBe(true);

            // Bridge B starts and finishes runtime preparation, binding global SillyTavern, ports.js context, and CardHost
            const bridgeB = createSessionBridge({} as any, {
                prepareRuntime: (async (args: any) => {
                    args.signal?.throwIfAborted();
                    args.context.saveSettingsDebounced = () => {};
                    bindEngineContext(args.context, {}, { models: [] });
                    bindCardHost({
                        context: args.context,
                        settings: { accountStorage: { __migrated: 'true' } },
                        presets: {},
                        models: [],
                        packet: { world_names: [] },
                    });
                    return {
                        ready: true,
                        activate: async () => {},
                        whenIdle: async () => {},
                        destroy: () => {},
                    };
                }) as any,
            });

            await waitFor(() => {
                expect(bridgeB.getSnapshot().runtime).toBe('prepared');
            });
            expect(document.documentElement.dataset.vcRuntime).toBe('prepared');
            expect((globalThis as any).SillyTavern?.getContext()).toBe(bridgeB.getContext());
            expect(getContext().eventSource).toBe(bridgeB.getContext().eventSource);
            expect(getCardHost()?.context).toBe(bridgeB.getContext());

            // Now release Bridge A (real prepareChatRuntime) and Bridge A2
            resolveSettingsA({
                settings: JSON.stringify({
                    username: 'UserA',
                    user_avatar: 'a.png',
                    power_user: { send_on_enter: 1 },
                    oai_settings: { preset_settings_openai: 'Default' },
                }),
                openai_setting_names: ['Default'],
                openai_settings: ['{}'],
            });
            rejectCharsA(new Error('late char error'));
            resolveGateA2();
            capturedOnToastA2?.('A2 销毁后直接触发 toast', { type: 'error' });

            // Flush microtasks
            await new Promise(res => setTimeout(res, 20));

            // Real prepareChatRuntime in A must have thrown AbortError before captureSettings / createChatEngine
            expect(captureSettingsCountA).toBe(0);
            // Bridge B's globals and page state must remain completely intact
            expect((globalThis as any).SillyTavern?.getContext()).toBe(bridgeB.getContext());
            expect(getContext().eventSource).toBe(bridgeB.getContext().eventSource);
            expect(getCardHost()?.context).toBe(bridgeB.getContext());
            expect(document.documentElement.dataset.vcRuntime).toBe('prepared');
            expect(document.documentElement.dataset.vcCharacters).toBeUndefined();
            expect(bridgeB.getSnapshot().runtime).toBe('prepared');

            // Neither A nor A2 published ready, error, or toast
            expect(eventsA).toEqual([]);
            expect(bridgeA.getSnapshot().runtime).toBe('preparing');
            expect(bridgeA2.getSnapshot().runtime).toBe('preparing');
            expect(toastSpy).not.toHaveBeenCalled();

            bridgeB.destroy();
        } finally {
            globalThis.fetch = prevFetch;
        }
    });

    it('settles pending callPopup and choosePersona promises on destroy() idempotently and resolves calls on a dead bridge immediately', async () => {
        const env = createTestChatEnv({
            conversations: [{ key: '["alice.png","chat-1"]', avatar: 'alice.png', file: 'chat-1', title: 'Alice' }],
            chatsByKey: { '["alice.png","chat-1"]': buildTestRecords(1) },
        });
        await env.bridge.open('["alice.png","chat-1"]');

        const confirmPromise = env.bridge.getContext().callPopup('确认？', 2);
        const stalePopupSnap = env.bridge.getSnapshot().popupRequest;
        expect(stalePopupSnap?.type).toBe(2);

        // Superseding popup settles previous pending popup with its cancel value (0)
        const inputPromise = env.callGenericPopup('输入内容', 3, 'init');
        await expect(confirmPromise).resolves.toBe(0);

        const pendingPopupSnap = env.bridge.getSnapshot().popupRequest;
        expect(pendingPopupSnap?.type).toBe(3);

        const personaPromise = env.choosePersona([
            { avatar: 'p1.png', name: 'Persona 1', description: '' },
        ]);
        const pendingPersonaSnap = env.bridge.getSnapshot().personaChoice;
        expect(pendingPersonaSnap?.options).toHaveLength(1);

        env.bridge.destroy();
        env.bridge.destroy();

        await expect(inputPromise).resolves.toBeNull();
        await expect(personaPromise).resolves.toBe('');
        expect(env.bridge.getSnapshot().popupRequest).toBeNull();
        expect(env.bridge.getSnapshot().personaChoice).toBeNull();

        // Late resolution callbacks are no-ops
        stalePopupSnap?.resolve(1);
        pendingPopupSnap?.resolve('late');
        pendingPersonaSnap?.resolve('p1.png');

        // Calls on a dead bridge resolve immediately with cancel values
        await expect(env.callGenericPopup('dead confirm', 2)).resolves.toBe(0);
        await expect(env.bridge.getContext().callPopup('dead input', 3, 'x')).resolves.toBeNull();
        await expect(env.choosePersona([{ avatar: 'p2.png', name: 'P2', description: '' }])).resolves.toBe('');
    });
});
