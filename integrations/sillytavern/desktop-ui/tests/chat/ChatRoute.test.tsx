import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { RouterProvider, useNavigate } from '@tanstack/react-router';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { MessageItem } from '../../src/features/chat/MessageItem';
import { useChatUi } from '../../src/features/chat/ChatRoute';
import { VoiceBubble } from '../../src/features/chat/VoiceBubble';
import { SessionBridgeProvider } from '../../src/runtime/session-bridge';
import {
    captureSessionContext,
    setStHeadersProvider,
} from '../../../extension/vc-model-settings/api.js';
import {
    invalidateVoicePolicy,
    loadVoicePolicy,
    setVoiceIntegration,
    voicePlayer,
} from '../../../extension/vc-model-settings/voice-logic.js';
import { createTestChatEnv } from './fixtures';

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

describe('ChatRoute streaming isolation, B5 open lifecycle, and B13 VoiceBubble initial state', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setupMatchMedia(1440);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('loads history in pages of 80 while retaining the existing visible leaves', async () => {
        const key = '["alice.png","history"]';
        const env = createTestChatEnv({
            conversations: [{ key, avatar: 'alice.png', file: 'history', title: 'Alice', preview: '', updatedAt: 1 }],
            chatsByKey: { [key]: Array.from({ length: 180 }, (_, index) => ({ name: 'Alice', mes: `Synthetic history ${index}`, is_user: false })) },
        });
        await env.bridge.open(key);
        const router = createDesktopRouter('/chat');
        const { container } = render(<AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}><RouterProvider router={router} /></AppProviders>);
        await act(async () => { await router.load(); });
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(80));
        const existing = container.querySelector('#chat > .mes[mesid="100"] .mes_text');
        fireEvent.click(screen.getByRole('button', { name: '显示更早的消息', exact: true }));
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(160));
        expect(container.querySelector('#chat > .mes[mesid="100"] .mes_text')).toBe(existing);
        fireEvent.click(screen.getByRole('button', { name: '显示更早的消息', exact: true }));
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(180));
        expect(screen.queryByRole('button', { name: '显示更早的消息', exact: true })).toBeNull();
        env.bridge.destroy();
    });

    it('locates an older source only after the chat route is visible and history has committed', async () => {
        const key = '["alice.png","source"]';
        const previousKey = '["alice.png","previous"]';
        const env = createTestChatEnv({
            conversations: [
                { key, avatar: 'alice.png', file: 'source', title: 'Alice', preview: '', updatedAt: 1 },
                { key: previousKey, avatar: 'alice.png', file: 'previous', title: 'Alice', preview: '', updatedAt: 0 },
            ],
            chatsByKey: {
                [key]: Array.from({ length: 100 }, (_, index) => ({ name: 'Alice', mes: `Synthetic source ${index}`, is_user: false })),
                [previousKey]: Array.from({ length: 100 }, (_, index) => ({ name: 'Alice', mes: `Synthetic previous ${index}`, is_user: false })),
            },
        });
        await env.bridge.open(previousKey);
        function SourceAction() {
            const ui = useChatUi()!;
            const navigate = useNavigate();
            return <button onClick={async () => {
                await env.bridge.open(key);
                await navigate({ to: '/chat/$conversationKey', params: { conversationKey: key } });
                ui.requestMessageJump(key, 0);
            }}>Locate source</button>;
        }
        const router = createDesktopRouter({ initialEntry: '/memory', routeOverrides: { memory: SourceAction } });
        const { container } = render(<AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}><RouterProvider router={router} /></AppProviders>);
        await act(async () => { await router.load(); });
        expect(container.querySelector('#chat > .mes[mesid="0"]')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Locate source' }));
        await waitFor(() => {
            expect(container.querySelector('[data-chat-body]')?.hasAttribute('hidden')).toBe(false);
            expect(container.querySelector('#chat > .mes[mesid="0"]')?.hasAttribute('data-vc-flash')).toBe(true);
        });
        expect(container.querySelectorAll('#chat > .mes')).toHaveLength(100);
        env.bridge.destroy();
    });

    it('expands the opening window far enough to restore a saved reading position', async () => {
        const key = '["alice.png","restored-history"]';
        const env = createTestChatEnv({
            conversations: [{ key, avatar: 'alice.png', file: 'restored-history', title: 'Alice', preview: '', updatedAt: 1 }],
            chatsByKey: { [key]: Array.from({ length: 180 }, (_, index) => ({ name: 'Alice', mes: `Synthetic history ${index}`, is_user: false })) },
        });
        await env.bridge.open(key);
        const storageId = env.bridge.draft.storageId(key);
        localStorage.setItem(`vc-pos:${storageId}`, '0');
        localStorage.setItem(`vc-read:${storageId}`, '0');
        const router = createDesktopRouter('/chat');
        const { container } = render(<AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}><RouterProvider router={router} /></AppProviders>);
        await act(async () => { await router.load(); });
        await waitFor(() => expect(container.querySelectorAll('#chat > .mes')).toHaveLength(180));
        expect(container.querySelector('#chat > .mes[mesid="0"]')).not.toBeNull();
        env.bridge.destroy();
    });

    it('B5: bridge.open resolves to opened only after activation finishes, returns superseded when preempted, and deduplicates already-ready or in-flight open unless latest:true', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        let activateCalls = 0;
        let resolveActivate: (() => void) | null = null;

        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Loaded Alice', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Loaded Bob', is_user: false }],
            },
            onActivate: async () => {
                activateCalls += 1;
                await new Promise<void>(res => {
                    resolveActivate = res;
                });
            },
        });

        const p1 = env.bridge.open(keyA);
        const p2 = env.bridge.open(keyA);
        expect(env.bridge.getSnapshot().status).toBe('switching');

        await waitFor(() => {
            expect(activateCalls).toBe(1);
            expect(resolveActivate).toBeTypeOf('function');
        });

        resolveActivate?.();
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe('opened');
        expect(r2).toBe('opened');
        expect(env.bridge.getSnapshot().status).toBe('ready');
        expect(env.bridge.getSnapshot().key).toBe(keyA);
        expect(activateCalls).toBe(1);

        // Calling open again on already-ready key without latest:true is a no-op
        const rReady = await env.bridge.open(keyA);
        expect(rReady).toBe('opened');
        expect(activateCalls).toBe(1);

        // Calling open with latest:true explicitly re-activates
        const p3 = env.bridge.open(keyA, { latest: true });
        await waitFor(() => {
            expect(activateCalls).toBe(2);
        });
        resolveActivate?.();
        expect(await p3).toBe('opened');

        // Preempting an in-flight open returns 'superseded'
        const pStale = env.bridge.open(keyA, { latest: true });
        await waitFor(() => {
            expect(activateCalls).toBe(3);
        });
        const resolveStale = resolveActivate;
        const pNewer = env.bridge.open(keyB);
        resolveStale?.();
        await waitFor(() => {
            expect(activateCalls).toBe(4);
        });
        resolveActivate?.();
        expect(await pStale).toBe('superseded');
        expect(await pNewer).toBe('opened');
        expect(env.bridge.getSnapshot().key).toBe(keyB);
    });

    it('switching conversations while streaming isolates old conversation stream from new conversation DOM', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: 'Streaming...', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: 'Bob history', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice greeting', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob steady message', is_user: false }],
            },
            streamChunks: ['Alice streaming reply'],
            holdStream: true,
        });

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });

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

        // Start a streaming send on Alice's conversation
        let sendPromise!: Promise<boolean>;
        act(() => {
            sendPromise = env.bridge.send('Trigger stream');
        });

        await waitFor(() => {
            expect(env.bridge.getSnapshot().busy).toBe(true);
            expect(container.querySelector('#chat')?.textContent).toContain('Alice streaming reply');
            expect(container.querySelector('#mes_stop')).toBeTruthy();
        });

        // Switch to Bob while Alice is still streaming
        await act(async () => {
            expect(await env.bridge.open(keyB)).toBe('opened');
            await sendPromise.catch(() => false);
        });

        // After switching to Bob, Alice's streaming text must NOT appear in #chat
        const chatText = container.querySelector('#chat')?.textContent || '';
        expect(chatText).toContain('Bob steady message');
        expect(chatText).not.toContain('Alice streaming reply');
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().busy).toBe(false);
    });

    it('B13: VoiceBubble mounts WaveSurfer waveform, reads initial playing state, handles remount + ended, and cleans up subscriptions on unmount', () => {
        let currentClip: string | undefined = 'clip-active';
        let ended = false;
        const subscribers = new Set<() => void>();

        const fakePlayer = {
            isCurrent: (id: string | undefined) => id === currentClip && !ended,
            peek: (id: string | undefined) =>
                id === 'clip-active'
                    ? { currentTime: ended ? 4.0 : 1.2, duration: 4.0, ended }
                    : undefined,
            subscribe: (cb: () => void) => {
                subscribers.add(cb);
                return () => {
                    subscribers.delete(cb);
                };
            },
            toggle: vi.fn(),
        };

        const firstMount = render(
            <VoiceBubble
                voice={{
                    clipId: 'clip-active',
                    status: 'ready',
                    durationMs: 4000,
                    transcript: '测试语音',
                }}
                player={fakePlayer}
            />,
        );

        const bubble1 = firstMount.container.querySelector('[data-vc-voice-bubble]') as HTMLElement;
        expect(bubble1).toBeTruthy();
        expect(bubble1.getAttribute('data-playing')).toBe('true');
        const waveHost1 = firstMount.container.querySelector(
            '.vc-voice-wave[data-vc-wavesurfer]',
        ) as HTMLElement;
        expect(waveHost1).toBeTruthy();
        expect(waveHost1.children.length).toBeGreaterThanOrEqual(1);
        expect(subscribers.size).toBe(1);

        // Unmount while still playing, then remount (B13 remount scenario)
        firstMount.unmount();
        expect(subscribers.size).toBe(0);

        const remounted = render(
            <VoiceBubble
                voice={{
                    clipId: 'clip-active',
                    status: 'ready',
                    durationMs: 4000,
                    transcript: '测试语音',
                }}
                player={fakePlayer}
            />,
        );
        const bubble2 = remounted.container.querySelector('[data-vc-voice-bubble]') as HTMLElement;
        expect(bubble2.getAttribute('data-playing')).toBe('true');
        expect(subscribers.size).toBe(1);

        // Simulate playback ending after remount
        act(() => {
            ended = true;
            currentClip = undefined;
            for (const sub of subscribers) sub();
        });

        expect(bubble2.getAttribute('data-playing')).toBe('false');
        remounted.unmount();
        expect(subscribers.size).toBe(0);
    });

    it('SessionBridge domain commands delegate to the single prepared runtime and become no-ops after destroy', async () => {
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
                    characterRef: 'char-ref-alice',
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice greeting', is_user: false }],
            },
        });

        const invalidateSpy = vi.spyOn(env.queryClient, 'invalidateQueries');

        expect(await env.bridge.open(keyA)).toBe('opened');
        expect(env.prepareRuntimeCalls).toBe(1);

        const created = await env.bridge.createConversation({
            characterRef: 'char-ref-alice',
            displayName: 'New Alice Chat',
            chatIdentity: '11111111-2222-4333-8444-555555555555',
            mode: 'COMPANION',
        });
        expect(env.runtimeSpies.createConversation).toHaveBeenCalledTimes(1);
        expect(created?.avatar).toBe('alice.png');
        expect(created?.file).toBe('11111111-2222-4333-8444-555555555555');
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['relationships'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recentChats'] });

        const turn = {
            runId: '101',
            branchId: '202',
            conversationId: '303',
            worldVersion: 1,
        };
        await env.bridge.story.setRun(turn);
        await env.bridge.story.selectActor('innkeeper');
        await env.bridge.story.advance({ ...turn, worldVersion: 2 });
        await env.bridge.story.clear();
        expect(env.runtimeSpies.story.setRun).toHaveBeenCalledWith(turn);
        expect(env.runtimeSpies.story.selectActor).toHaveBeenCalledWith('innkeeper');
        expect(env.runtimeSpies.story.advance).toHaveBeenCalledWith({ ...turn, worldVersion: 2 });
        expect(env.runtimeSpies.story.clear).toHaveBeenCalledTimes(1);

        const projected = await env.bridge.projectStory({ conversationId: 'conv-chat-a' });
        expect(env.runtimeSpies.projectStory).toHaveBeenCalledWith({
            conversationId: 'conv-chat-a',
        });
        expect(projected).toEqual({
            status: 'projected',
            job: { conversationId: 'conv-chat-a' },
        });

        const settingsChanges = [
            {
                path: ['power_user', 'send_on_enter'],
                before: { exists: true, value: 1 },
                after: { exists: true, value: -1 },
            },
        ];
        await env.bridge.applySettings(settingsChanges);
        expect(env.runtimeSpies.applySettings).toHaveBeenCalledWith(settingsChanges);
        expect(env.bridge.getSnapshot().enterToSend).toBe(false);

        const presetChanges = [
            {
                path: ['temperature'],
                before: { exists: true, value: 1 },
                after: { exists: true, value: 0.8 },
            },
        ];
        await env.bridge.applyPreset('openai', 'Default', presetChanges, { temperature: 0.8 });
        expect(env.runtimeSpies.applyPreset).toHaveBeenCalledWith(
            'openai',
            'Default',
            presetChanges,
            { temperature: 0.8 },
        );

        await env.bridge.applyWorldbook('Lore', { entries: {} }, 'save');
        expect(env.runtimeSpies.applyWorldbook).toHaveBeenCalledWith(
            'Lore',
            { entries: {} },
            'save',
        );

        await env.bridge.reloadCharacter('alice.png');
        expect(env.runtimeSpies.reloadCharacter).toHaveBeenCalledWith('alice.png');

        const metaChanges = [
            {
                path: ['note_prompt'],
                before: { exists: false },
                after: { exists: true, value: 'Remember this' },
            },
        ];
        await env.bridge.commitMetadata(metaChanges, keyA);
        expect(env.runtimeSpies.commitMetadata).toHaveBeenCalledWith(metaChanges, keyA);
        expect(env.bridge.getContext().chatMetadata.note_prompt).toBe('Remember this');

        await env.bridge.refreshCatalog();
        expect(env.runtimeSpies.refreshCatalog).toHaveBeenCalledTimes(1);

        await env.bridge.setBudget({ insufficient: true });
        expect(env.runtimeSpies.setBudget).toHaveBeenCalledWith({ insufficient: true });
        expect(env.bridge.getSnapshot().settingsRequired).toBe(true);

        await env.bridge.deleteCharacter('alice.png', true);
        expect(env.runtimeSpies.deleteCharacter).toHaveBeenCalledWith('alice.png', true);
        expect(env.bridge.getSnapshot().status).toBe('empty');
        expect(env.bridge.getSnapshot().key).toBe('');
        expect(env.prepareRuntimeCalls).toBe(1);

        // Destroy the bridge and verify no further runtime calls happen
        env.bridge.destroy();
        expect(env.runtimeSpies.destroy).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        await env.bridge.createConversation({
            characterRef: 'char-ref-alice',
            displayName: 'After Destroy',
        });
        await env.bridge.projectStory({ conversationId: 'conv-chat-a' });
        await env.bridge.story.setRun(turn);
        await env.bridge.story.selectActor('innkeeper');
        await env.bridge.story.advance(turn);
        await env.bridge.story.clear();
        await env.bridge.applySettings(settingsChanges);
        await env.bridge.applyPreset('openai', 'Default', presetChanges, {});
        await env.bridge.applyWorldbook('Lore', {});
        await env.bridge.reloadCharacter('alice.png');
        await env.bridge.commitMetadata(metaChanges, keyA);
        await env.bridge.deleteCharacter('alice.png', false);
        await env.bridge.refreshCatalog();
        await env.bridge.setBudget({ insufficient: false });

        expect(env.runtimeSpies.createConversation).not.toHaveBeenCalled();
        expect(env.runtimeSpies.projectStory).not.toHaveBeenCalled();
        expect(env.runtimeSpies.story.setRun).not.toHaveBeenCalled();
        expect(env.runtimeSpies.story.selectActor).not.toHaveBeenCalled();
        expect(env.runtimeSpies.story.advance).not.toHaveBeenCalled();
        expect(env.runtimeSpies.story.clear).not.toHaveBeenCalled();
        expect(env.runtimeSpies.applySettings).not.toHaveBeenCalled();
        expect(env.runtimeSpies.applyPreset).not.toHaveBeenCalled();
        expect(env.runtimeSpies.applyWorldbook).not.toHaveBeenCalled();
        expect(env.runtimeSpies.reloadCharacter).not.toHaveBeenCalled();
        expect(env.runtimeSpies.commitMetadata).not.toHaveBeenCalled();
        expect(env.runtimeSpies.deleteCharacter).not.toHaveBeenCalled();
        expect(env.runtimeSpies.refreshCatalog).not.toHaveBeenCalled();
        expect(env.runtimeSpies.setBudget).not.toHaveBeenCalled();
        expect(env.prepareRuntimeCalls).toBe(1);
    });

    it('real runtime contract updates enterToSend via context.powerUserSettings without fictional runtime.settings and destroy releases SillyTavern rebound by cards for the same context only', async () => {
        const env = createTestChatEnv();
        await env.bridge.open('["alice.png","chat-1"]');
        const session = env.session as any;
        expect('settings' in session).toBe(false);
        expect(env.bridge.getContext().powerUserSettings).toBeTruthy();

        await env.bridge.applySettings([
            {
                path: ['power_user', 'send_on_enter'],
                before: { exists: true, value: 1 },
                after: { exists: true, value: -1 },
            },
        ]);
        expect(env.bridge.getSnapshot().enterToSend).toBe(false);

        const context = env.bridge.getContext();
        (globalThis as any).SillyTavern = { getContext: () => context };
        env.bridge.destroy();
        expect((globalThis as any).SillyTavern?.getContext?.() === context).toBe(false);

        // Verify destroying a bridge does not clobber another live instance's SillyTavern owner
        const env2 = createTestChatEnv();
        await env2.bridge.open('["alice.png","chat-1"]');
        const otherContext = { chat: [] };
        const otherOwner = { getContext: () => otherContext };
        (globalThis as any).SillyTavern = otherOwner;
        env2.bridge.destroy();
        expect((globalThis as any).SillyTavern).toBe(otherOwner);
        delete (globalThis as any).SillyTavern;
        env.queryClient.clear();
        env2.queryClient.clear();
    });

    it('MessageItem read-aloud retains aria-pressed="true" after busy settles, reuses clip to pause without re-requesting TTS, and isolates new state when text changes', async () => {
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
                    mode: 'COMPANION',
                },
            ],
            chatsByKey: {
                [keyA]: [
                    {
                        name: 'Alice',
                        mes: 'First reply text',
                        is_user: false,
                        is_system: false,
                        swipe_id: 0,
                        vc_message_id: 'm-1',
                        extra: { vc_source: { id: 'src-1' } },
                    },
                ],
            },
        });

        await env.bridge.open(keyA);
        const context = env.bridge.getContext();
        context.chatMetadata.vc_f2 = { id: 'f2-1', revision: 1 };
        context.chatMetadata.vc_binding = { mode: 'COMPANION', relationshipId: 'rel-1' };
        context.chat[0].vc_message_id = 'm-1';
        context.chat[0].extra = { vc_source: { id: 'src-1' } };

        let createClipCalls = 0;
        const staleCallbacks: Array<(playing: boolean) => void> = [];
        const playingClips = new Set<string>();

        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                const method = init?.method || 'GET';
                if (url.endsWith('/api/v1/auth/session')) {
                    return new Response(
                        JSON.stringify({ accountId: '1', sessionId: '1' }),
                        { status: 200 },
                    );
                }
                if (url.endsWith('/api/v1/voice/engines')) {
                    return new Response(
                        JSON.stringify({
                            tts: [
                                {
                                    engine: 'kokoro',
                                    configured: true,
                                    enabled: true,
                                    healthy: true,
                                },
                            ],
                        }),
                        { status: 200 },
                    );
                }
                if (url.endsWith('/api/v1/voice/settings')) {
                    return new Response(
                        JSON.stringify({ kokoroTimeoutSeconds: 5, voiceFrequency: 'STANDARD' }),
                        { status: 200 },
                    );
                }
                if (url.endsWith('/api/v1/relationships')) {
                    return new Response(
                        JSON.stringify([
                            { relationshipId: 'rel-1', voiceFrequency: 'STANDARD' },
                        ]),
                        { status: 200 },
                    );
                }
                if (url.endsWith('/api/v1/st/sources/reconcile')) {
                    return new Response(JSON.stringify({ ok: true }), { status: 200 });
                }
                if (method === 'POST' && url.endsWith('/api/v1/relationships/rel-1/voice-clips')) {
                    createClipCalls += 1;
                    return new Response(
                        JSON.stringify({ clipId: `clip-${createClipCalls}` }),
                        { status: 200 },
                    );
                }
                if (url.includes('/api/v1/voice-clips/clip-')) {
                    const clipId = url.split('/').pop()!;
                    return new Response(
                        JSON.stringify({ clipId, status: 'ready', durationMs: 2000 }),
                        { status: 200 },
                    );
                }
                return new Response(JSON.stringify({}), { status: 200 });
            }),
        );

        setStHeadersProvider(() => ({ 'X-CSRF-Token': 'test-csrf' }));
        await captureSessionContext();
        invalidateVoicePolicy();
        setVoiceIntegration({
            getContext: () => context,
            saveChat: async () => {},
        });
        await loadVoicePolicy(context);

        const toggleSpy = vi
            .spyOn(voicePlayer, 'toggle')
            .mockImplementation(async (clipId, callbacks) => {
                if (!clipId) return false;
                if ( callbacks?.onState ) {
                    staleCallbacks.push(callbacks.onState);
                }
                if (playingClips.has(clipId)) {
                    playingClips.delete(clipId);
                    callbacks?.onState?.(false);
                    return false;
                }
                playingClips.add(clipId);
                callbacks?.onState?.(true);
                return true;
            });

        const msg0 = env.bridge.getSnapshot().messages[0];
        const noop = () => {};
        const view = render(
            <SessionBridgeProvider bridge={env.bridge}>
                <MessageItem
                    message={msg0}
                    index={0}
                    totalCount={1}
                    onQuote={noop}
                    onEdit={noop}
                    onRemove={noop}
                    onRemind={noop}
                    onOpenReactionPicker={noop}
                    onOpenLightbox={noop}
                />
            </SessionBridgeProvider>,
        );

        const readBtn = view.container.querySelector(
            '[data-vc-act="read"]',
        ) as HTMLButtonElement;
        expect(readBtn).toBeTruthy();
        expect(readBtn.getAttribute('aria-pressed')).toBe('false');

        // 1st click: requests TTS clip and starts playback; after busy=false settles, aria-pressed stays true
        await act(async () => {
            readBtn.click();
        });
        await waitFor(() => {
            expect(createClipCalls).toBe(1);
            expect(toggleSpy).toHaveBeenCalledTimes(1);
            expect(readBtn.getAttribute('aria-pressed')).toBe('true');
            expect(readBtn.disabled).toBe(false);
        });

        // 2nd click: reuses the same clip to pause without requesting a new TTS clip
        await act(async () => {
            readBtn.click();
        });
        await waitFor(() => {
            expect(createClipCalls).toBe(1);
            expect(toggleSpy).toHaveBeenCalledTimes(2);
            expect(readBtn.getAttribute('aria-pressed')).toBe('false');
        });

        // Text change replaces read-aloud state and ignores stale callbacks from previous state
        context.chat[0].mes = 'Updated reply text';
        const updatedMsg = { ...msg0, mes: 'Updated reply text' };
        view.rerender(
            <SessionBridgeProvider bridge={env.bridge}>
                <MessageItem
                    message={updatedMsg}
                    index={0}
                    totalCount={1}
                    onQuote={noop}
                    onEdit={noop}
                    onRemove={noop}
                    onRemind={noop}
                    onOpenReactionPicker={noop}
                    onOpenLightbox={noop}
                />
            </SessionBridgeProvider>,
        );
        expect(readBtn.getAttribute('aria-pressed')).toBe('false');

        act(() => {
            for (const cb of staleCallbacks) {
                cb(true);
            }
        });
        expect(readBtn.getAttribute('aria-pressed')).toBe('false');

        setVoiceIntegration(null);
        invalidateVoicePolicy();
        env.bridge.destroy();
        env.queryClient.clear();
    });
});
