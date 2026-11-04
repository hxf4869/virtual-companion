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

    it('accepted settings, preset, worldbook and character changes finish before runtime loading and replay in order before prepared', async () => {
        let releaseRuntime!: () => void;
        const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
        const env = createTestChatEnv({ beforePrepareRuntime: () => gate });
        const changes = [{ path: ['power_user', 'send_on_enter'], before: { exists: true, value: 1 }, after: { exists: true, value: -1 } }];
        let accepted = false;
        const writes = Promise.all([
            env.bridge.applySettings(changes),
            env.bridge.applyPreset('openai', 'Default', [], { temperature: 0.8 }),
            env.bridge.applyWorldbook('Lore', { entries: {} }, 'save'),
            env.bridge.reloadCharacter('alice.png'),
        ]).then(() => { accepted = true; });
        try {
            await waitFor(() => expect(accepted).toBe(true), { timeout: 300 });
            expect(env.bridge.getSnapshot().runtime).toBe('preparing');
            expect(env.runtimeSpies.applySettings).not.toHaveBeenCalled();
            releaseRuntime();
            await writes;
            await waitFor(() => expect(env.bridge.getSnapshot().runtime).toBe('prepared'));
            expect(env.runtimeSpies.applySettings).toHaveBeenCalledWith(changes);
            expect(env.runtimeSpies.applyPreset).toHaveBeenCalledWith('openai', 'Default', [], { temperature: 0.8 });
            expect(env.runtimeSpies.applyWorldbook).toHaveBeenCalledWith('Lore', { entries: {} }, 'save');
            expect(env.runtimeSpies.reloadCharacter).toHaveBeenCalledWith('alice.png');
            const order = ['applySettings', 'applyPreset', 'applyWorldbook', 'reloadCharacter'].map(name => (env.runtimeSpies as any)[name].mock.invocationCallOrder[0]);
            expect(order).toEqual([...order].sort((a, b) => a - b));
            expect(env.bridge.getSnapshot().enterToSend).toBe(false);
        } finally {
            releaseRuntime();
            await writes;
            env.bridge.destroy();
        }
    });

    it('destroy drops accepted changes queued before runtime and disposes the late runtime', async () => {
        let releaseRuntime!: () => void;
        const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
        const env = createTestChatEnv({ beforePrepareRuntime: () => gate });
        let accepted = false;
        const write = env.bridge.applySettings([]).then(() => { accepted = true; });
        try {
            await waitFor(() => expect(accepted).toBe(true), { timeout: 300 });
        } finally {
            env.bridge.destroy();
            releaseRuntime();
            await write;
        }
        await waitFor(() => expect(env.runtimeSpies.destroy).toHaveBeenCalledTimes(1));
        expect(env.runtimeSpies.applySettings).not.toHaveBeenCalled();
    });

    it('deleting the committed character before runtime uses its F2 baseline and cannot activate it after preparation', async () => {
        let releaseRuntime!: () => void;
        const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
        const env = createTestChatEnv({ beforePrepareRuntime: () => gate });
        const opening = env.bridge.open('["alice.png","chat-1"]');
        try {
            await waitFor(() => expect(env.bridge.getSnapshot().key).toBe('["alice.png","chat-1"]'));
            vi.mocked(env.client.request).mockResolvedValueOnce([{ file_name: 'chat-1.jsonl' }]);
            await env.bridge.deleteCharacter('alice.png', true);
            expect(env.client.post).toHaveBeenCalledWith('/api/characters/delete', {
                avatar_url: 'alice.png', delete_chats: true,
                vc_f2_chats: [{ path: 'chats/alice/chat-1.jsonl', expected: { id: 'f2-chat-1', revision: 1 } }],
            });
            expect(env.bridge.getSnapshot().key).toBe('');
            releaseRuntime();
            expect(await opening).toBe('superseded');
            expect(env.bridge.getSnapshot().status).toBe('empty');
            expect(env.runtimeSpies.reloadCharacter).toHaveBeenCalledWith('alice.png');
        } finally {
            releaseRuntime();
            await opening;
            env.bridge.destroy();
        }
    });

    it('a queued configuration failure disposes its runtime and preserves accepted settings for retry', async () => {
        let releaseRuntime!: () => void;
        const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
        const env = createTestChatEnv({ beforePrepareRuntime: () => gate });
        const states: string[] = [];
        const unsubscribe = env.bridge.subscribe(() => states.push(env.bridge.getSnapshot().runtime));
        try {
            env.runtimeSpies.reloadCharacter.mockRejectedValueOnce(new Error('合成角色读取失败'));
            const changes = [{ path: ['power_user', 'send_on_enter'], before: { exists: true, value: 1 }, after: { exists: true, value: -1 } }];
            await env.bridge.applySettings(changes);
            await env.bridge.reloadCharacter('alice.png');
            releaseRuntime();
            await waitFor(() => expect(env.bridge.getSnapshot().runtime).toBe('error'));
            expect(env.runtimeSpies.destroy).toHaveBeenCalledTimes(1);
            expect(states).not.toContain('prepared');
            expect(await env.bridge.open('["alice.png","chat-1"]')).toBe('opened');
            expect(env.runtimeSpies.applySettings).toHaveBeenCalledTimes(2);
            expect(env.runtimeSpies.reloadCharacter).toHaveBeenCalledTimes(2);
            expect(env.bridge.getSnapshot().enterToSend).toBe(false);
        } finally {
            releaseRuntime();
            unsubscribe();
            env.bridge.destroy();
        }
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

    it('guards late client.characters() refresh on newly imported character so preempted open A does not overwrite B or call stale activate', async () => {
        const keyNew = '["new-char.png","chat-new"]';
        const keyBob = '["bob.png","chat-b"]';
        const activatedKeys: string[] = [];

        const env = createTestChatEnv({
            conversations: [
                { key: keyBob, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyBob]: [{ name: 'Bob', mes: 'Bob steady', is_user: false }],
            },
            onActivate: async (row) => {
                activatedKeys.push(`${row.avatar}:${row.file}`);
            },
        });

        // Wait for initial charactersReady to settle with only Bob
        await act(async () => {
            expect(await env.bridge.open(keyBob)).toBe('opened');
        });
        activatedKeys.length = 0;

        // Now open newly imported character A whose avatar is not yet in context.characters;
        // hold the refresh client.characters() call while switching back to Bob
        let resolveFreshChars!: (chars: any[]) => void;
        (env.client.characters as any).mockImplementationOnce(
            () =>
                new Promise(res => {
                    resolveFreshChars = res;
                }),
        );

        const openAPromise = env.bridge.open(keyNew);
        await waitFor(() => {
            expect(typeof resolveFreshChars).toBe('function');
        });

        // Switch back to Bob while A's client.characters() is still in flight
        const openBPromise = env.bridge.open(keyBob, { latest: true });
        expect(await openBPromise).toBe('opened');
        expect(env.bridge.getSnapshot().key).toBe(keyBob);
        expect(env.bridge.getSnapshot().characterName).toBe('Bob');
        expect(activatedKeys).toEqual(['bob.png:chat-b']);

        // Now resolve late client.characters() for A -> A must return superseded without overwriting B or calling activate
        resolveFreshChars([
            { avatar: 'new-char.png', name: 'NewImported', data: { extensions: { vc_character_ref: 'ref-new' } } },
        ]);
        expect(await openAPromise).toBe('superseded');
        expect(env.bridge.getSnapshot().key).toBe(keyBob);
        expect(env.bridge.getSnapshot().characterName).toBe('Bob');
        expect(activatedKeys).toEqual(['bob.png:chat-b']);

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('C1: cancels in-flight conversation read when navigating from chat to settings and restores previous ready conversation and draft on both late success and late failure', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const activatedKeys: string[] = [];

        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: 'A', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: 'B', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice message', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
            },
            onActivate: async row => {
                activatedKeys.push(`${row.avatar}:${row.file}`);
            },
        });

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });
        env.bridge.draft.write(keyA, 'NF06 原会话草稿');
        activatedKeys.length = 0;

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

        for (const failed of [false, true]) {
            let resolveReadB!: (records: any[]) => void;
            let rejectReadB!: (err: Error) => void;
            let readBStarted = false;
            let readBSignal: AbortSignal | undefined;

            const origReadChat = env.client.readChat;
            (env.client.readChat as any).mockImplementationOnce(
                ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                    if (avatar === 'bob.png' && file === 'chat-b') {
                        readBStarted = true;
                        readBSignal = opts?.signal;
                        return new Promise((res, rej) => {
                            resolveReadB = res;
                            rejectReadB = rej;
                        });
                    }
                    return origReadChat({ avatar, file }, opts);
                },
            );

            await act(async () => {
                await router.navigate({
                    to: '/chat/$conversationKey',
                    params: { conversationKey: keyB },
                });
            });

            await waitFor(() => {
                expect(readBStarted).toBe(true);
            });

            // Leave chat route for settings while B's readChat is still in-flight
            await act(async () => {
                await router.navigate({
                    to: '/settings/$category',
                    params: { category: 'model' },
                });
            });

            expect(readBSignal?.aborted).toBe(true);
            expect(env.bridge.getSnapshot().status).toBe('ready');
            expect(env.bridge.getSnapshot().key).toBe(keyA);
            expect(env.bridge.getSnapshot().canSend).toBe(true);
            expect(env.bridge.draft.read()).toBe('NF06 原会话草稿');

            // Late readChat completion (success or failure) must not activate B or set error
            await act(async () => {
                if (failed) {
                    rejectReadB(new Error('500 synthetic read error'));
                } else {
                    resolveReadB([
                        {
                            chat_metadata: {
                                integrity: 'int-chat-b',
                                vc_f2: { id: 'f2-chat-b', revision: 1 },
                                vc_binding: {
                                    relationshipId: 'rel-1',
                                    conversationId: 'conv-chat-b',
                                    mode: 'COMPANION',
                                },
                            },
                        },
                        { name: 'Bob', mes: 'Bob message', is_user: false },
                    ]);
                }
            });

            expect(activatedKeys).toEqual([]);
            expect(env.bridge.getSnapshot().status).toBe('ready');
            expect(env.bridge.getSnapshot().key).toBe(keyA);
            expect(env.bridge.getSnapshot().error).toBe('');
            expect(env.bridge.getSnapshot().canSend).toBe(true);
            expect(env.bridge.draft.read()).toBe('NF06 原会话草稿');

            // Navigate back to /chat and verify A and its draft are intact
            await act(async () => {
                await router.navigate({ to: '/chat' });
            });
            const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
            const sendBtn = container.querySelector('#send_but') as HTMLButtonElement;
            expect(textarea?.value).toBe('NF06 原会话草稿');
            expect(sendBtn?.disabled).toBe(false);
        }

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('C1: post-commit activation of B survives route leave to settings, and cancelling preflight C while B is activating preserves B until B finishes ready', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const keyC = '["carol.png","chat-c"]';

        let holdActivateB = false;
        let activateBEntered = false;
        let activateBSignal: AbortSignal | undefined;
        let releaseActivateB!: () => void;

        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Alice msg',
                    updatedAt: 3,
                    relationshipId: 'rel-1',
                    mode: 'COMPANION',
                },
                {
                    key: keyB,
                    avatar: 'bob.png',
                    file: 'chat-b',
                    title: 'Bob',
                    preview: 'Bob msg',
                    updatedAt: 2,
                    relationshipId: 'rel-2',
                    mode: 'COMPANION',
                },
                {
                    key: keyC,
                    avatar: 'carol.png',
                    file: 'chat-c',
                    title: 'Carol',
                    preview: 'Carol msg',
                    updatedAt: 1,
                    relationshipId: 'rel-3',
                    mode: 'COMPANION',
                },
            ],
            characters: [
                {
                    name: 'Alice',
                    avatar: 'alice.png',
                    description: 'Alice',
                    data: { extensions: { vc_character_ref: 'char-ref-alice' } },
                },
                {
                    name: 'Bob',
                    avatar: 'bob.png',
                    description: 'Bob',
                    data: { extensions: { vc_character_ref: 'char-ref-bob' } },
                },
                {
                    name: 'Carol',
                    avatar: 'carol.png',
                    description: 'Carol',
                    data: { extensions: { vc_character_ref: 'char-ref-carol' } },
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice message', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
                [keyC]: [{ name: 'Carol', mes: 'Carol message', is_user: false }],
            },
            onActivate: async (row, _records, opts) => {
                if (row.avatar === 'bob.png' && row.file === 'chat-b' && holdActivateB) {
                    activateBEntered = true;
                    activateBSignal = opts?.signal;
                    await new Promise<void>(resolve => {
                        releaseActivateB = resolve;
                    });
                }
            },
        });

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });
        expect(env.bridge.getSnapshot().status).toBe('ready');
        expect(env.bridge.getSnapshot().key).toBe(keyA);

        const router = createDesktopRouter('/chat');
        render(
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

        // 1) A ready -> B commits readChat and enters onActivate -> navigate to settings -> release B -> B finishes ready
        holdActivateB = true;
        activateBEntered = false;
        await act(async () => {
            await router.navigate({
                to: '/chat/$conversationKey',
                params: { conversationKey: keyB },
            });
        });
        await waitFor(() => {
            expect(activateBEntered).toBe(true);
        });
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().status).toBe('switching');

        // Navigate to settings AFTER B has already committed and entered activate
        await act(async () => {
            await router.navigate({
                to: '/settings/$category',
                params: { category: 'model' },
            });
        });

        // Route leave after commit must NOT abort B's active signal or revert to A
        expect(activateBSignal?.aborted).toBe(false);
        expect(env.bridge.getSnapshot().key).toBe(keyB);

        // Now while B is still committed & inside onActivate, start preflight C and cancel C before C commits
        let readCStarted = false;
        let readCSignal: AbortSignal | undefined;
        let resolveReadC!: (records: any[]) => void;
        const origReadChat = env.client.readChat;
        (env.client.readChat as any).mockImplementationOnce(
            ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                if (avatar === 'carol.png' && file === 'chat-c') {
                    readCStarted = true;
                    readCSignal = opts?.signal;
                    return new Promise(res => {
                        resolveReadC = res;
                    });
                }
                return origReadChat({ avatar, file }, opts);
            },
        );

        const controllerC = new AbortController();
        const openCPromise = env.bridge.open(keyC, { signal: controllerC.signal });
        await waitFor(() => {
            expect(readCStarted).toBe(true);
        });
        // Starting C's preflight must NOT abort B's committed activation
        expect(activateBSignal?.aborted).toBe(false);

        // Cancel C's preflight before C commits -> must restore B's committed in-progress state (NOT revert to A or fake ready)
        await act(async () => {
            controllerC.abort();
        });
        expect(readCSignal?.aborted).toBe(true);
        expect(activateBSignal?.aborted).toBe(false);
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().status).toBe('switching');
        expect(env.bridge.getSnapshot().canSend).toBe(false);

        // Late resolution of C's readChat is ignored and resolves openCPromise as superseded
        await act(async () => {
            resolveReadC([
                {
                    chat_metadata: {
                        integrity: 'int-chat-c',
                        vc_f2: { id: 'f2-chat-c', revision: 1 },
                        vc_binding: {
                            relationshipId: 'rel-3',
                            conversationId: 'conv-chat-c',
                            mode: 'COMPANION',
                        },
                    },
                },
                { name: 'Carol', mes: 'Carol message', is_user: false },
            ]);
        });
        expect(await openCPromise).toBe('superseded');
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().status).toBe('switching');
        expect(env.bridge.getSnapshot().canSend).toBe(false);

        // Release B's activation -> B completes and becomes ready & canSend
        await act(async () => {
            releaseActivateB();
        });
        await waitFor(() => {
            expect(env.bridge.getSnapshot().status).toBe('ready');
        });
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().canSend).toBe(true);
        expect(env.bridge.getContext().chatId).toBe('chat-b');

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('C2: send catch interprets OVER_LIMIT budget signal to gate sending with BUDGET_COPY and setBudget(NO_BUDGET) restores sending', async () => {
        const key = '["alice.png","chat-budget"]';
        const env = createTestChatEnv({
            conversations: [
                { key, avatar: 'alice.png', file: 'chat-budget', title: 'Alice', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [key]: [{ name: 'Alice', mes: 'Hello', is_user: false }],
            },
        });
        await env.bridge.open(key);

        vi.spyOn(env.client, 'generate').mockRejectedValueOnce(
            Object.assign(new Error('429 OVER_LIMIT'), {
                status: 429,
                details: {
                    error: {
                        code: 'VC_USAGE_REFUSED',
                        message: '本月额度已用完，本次生成未发送',
                        reason: 'OVER_LIMIT',
                    },
                },
            }),
        );

        const router = createDesktopRouter(`/chat/${encodeURIComponent(key)}`);
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

        env.bridge.draft.write(key, 'NF06 原会话草稿');
        await act(async () => {
            const sent = await env.bridge.send('NF06 原会话草稿');
            expect(sent).toBe(false);
        });

        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getSnapshot().settingsRequired).toBe(true);
        expect(env.bridge.getSnapshot().notice).toContain('当月可用额度不足，测试与发送暂不可用。设置仍可保存。');
        expect(env.bridge.draft.read(key)).toBe('NF06 原会话草稿');
        expect((container.querySelector('#send_textarea') as HTMLTextAreaElement | null)?.value).toBe('NF06 原会话草稿');
        expect((container.querySelector('#send_but') as HTMLButtonElement | null)?.disabled).toBe(true);
        expect(container.querySelector('#vc-chat-gen button')?.textContent).toBe('去设置');

        await act(async () => {
            await env.bridge.setBudget({ known: false, insufficient: false });
        });

        expect(env.bridge.getSnapshot().canSend).toBe(true);
        expect(env.bridge.getSnapshot().settingsRequired).toBe(false);
        expect((container.querySelector('#send_but') as HTMLButtonElement | null)?.disabled).toBe(false);

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('Item 1: ordinary uncanceled readChat 500 publishes errorSnapshot with retry UI, and committed activate failure while newer preflight C is pending surfaces after C cancels', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const keyC = '["carol.png","chat-c"]';

        let rejectActivateB: ((err: Error) => void) | null = null;
        let activateBEntered = false;

        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 3 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 2 },
                { key: keyC, avatar: 'carol.png', file: 'chat-c', title: 'Carol', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice message', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
                [keyC]: [{ name: 'Carol', mes: 'Carol message', is_user: false }],
            },
            onActivate: async row => {
                if (row.avatar === 'bob.png' && row.file === 'chat-b' && rejectActivateB) {
                    activateBEntered = true;
                    await new Promise<void>((_res, rej) => {
                        rejectActivateB = rej;
                    });
                }
            },
        });

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
        await waitFor(() => {
            expect(env.bridge.getSnapshot().status).toBe('ready');
            expect(env.bridge.getSnapshot().key).toBe(keyA);
        });

        // 1) Ordinary uncanceled readChat 500 failure (no abort / no route leave)
        (env.client.readChat as any).mockRejectedValueOnce(
            Object.assign(new Error('500 readChat failed'), { status: 500 }),
        );
        let openCRetryResult: string | undefined;
        await act(async () => {
            openCRetryResult = await env.bridge.open(keyC);
        });
        expect(openCRetryResult).toBe('failed');
        expect(env.bridge.getSnapshot().status).toBe('error');
        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getSnapshot().error).toBe('聊天没有加载出来，请重试。');
        expect(container.querySelector('.vc-chat-error-state')?.textContent).toContain(
            '聊天没有加载出来，请重试。',
        );

        const retryBtn = container.querySelector('.vc-chat-error-state button') as HTMLButtonElement;
        expect(retryBtn).toBeTruthy();
        await act(async () => {
            retryBtn.click();
        });
        await waitFor(() => {
            expect(env.bridge.getSnapshot().key).toBe(keyC);
            expect(env.bridge.getSnapshot().status).toBe('ready');
            expect(env.bridge.getSnapshot().error).toBe('');
            expect(env.bridge.getSnapshot().canSend).toBe(true);
        });

        // 2) Committed B fails in activate while newer preflight C is still pending -> cancelling C exposes B's error
        rejectActivateB = () => {};
        const openBPromise = env.bridge.open(keyB);
        await waitFor(() => {
            expect(activateBEntered).toBe(true);
        });

        let readCStarted = false;
        const origReadChat = env.client.readChat;
        (env.client.readChat as any).mockImplementationOnce(
            ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                if (avatar === 'carol.png' && file === 'chat-c') {
                    readCStarted = true;
                    return new Promise(() => {});
                }
                return origReadChat({ avatar, file }, opts);
            },
        );
        const controllerC = new AbortController();
        const openCPromise = env.bridge.open(keyC, { signal: controllerC.signal });
        await waitFor(() => {
            expect(readCStarted).toBe(true);
        });

        // Fail B's committed activation while C is still in preflight
        const triggerFailB = rejectActivateB;
        rejectActivateB = null;
        await act(async () => {
            triggerFailB?.(new Error('activate B failed'));
        });
        expect(await openBPromise).toBe('failed');

        // Now cancel preflight C -> must expose B's committed error state and allow retry
        await act(async () => {
            controllerC.abort();
        });
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().status).toBe('error');
        expect(env.bridge.getSnapshot().error).toBe('聊天没有加载出来，请重试。');

        await act(async () => {
            expect(await env.bridge.retry()).toBe(true);
        });
        expect(env.bridge.getSnapshot().key).toBe(keyB);
        expect(env.bridge.getSnapshot().status).toBe('ready');
        expect(env.bridge.getSnapshot().canSend).toBe(true);
        void openCPromise;

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('Item 2: cancelling preflight B preserves live streaming busy/stop state on A and preserves real F2 conflict and rejected snapshot on A', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice greeting', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
            },
            streamChunks: ['Alice in-progress stream'],
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

        // 1) Start streaming on A, then start deferred preflight B and cancel B by navigating to settings
        let sendPromise!: Promise<boolean>;
        act(() => {
            sendPromise = env.bridge.send('Hello while streaming');
        });
        await waitFor(() => {
            expect(env.bridge.getSnapshot().busy).toBe(true);
            expect(env.bridge.getSnapshot().canSend).toBe(false);
            expect(container.querySelector('#mes_stop')).toBeTruthy();
        });

        let readBStarted = false;
        const origReadChat = env.client.readChat;
        (env.client.readChat as any).mockImplementationOnce(
            ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                if (avatar === 'bob.png' && file === 'chat-b') {
                    readBStarted = true;
                    return new Promise(() => {});
                }
                return origReadChat({ avatar, file }, opts);
            },
        );

        await act(async () => {
            await router.navigate({
                to: '/chat/$conversationKey',
                params: { conversationKey: keyB },
            });
        });
        await waitFor(() => {
            expect(readBStarted).toBe(true);
        });

        // Cancel preflight B by navigating to settings
        await act(async () => {
            await router.navigate({
                to: '/settings/$category',
                params: { category: 'model' },
            });
        });

        // Session A is still generating: busy must stay true, canSend must stay false, stop button must remain
        expect(env.bridge.getSnapshot().key).toBe(keyA);
        expect(env.bridge.getSnapshot().status).toBe('ready');
        expect(env.bridge.getSnapshot().busy).toBe(true);
        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getSnapshot().streamingKey).toBeTruthy();

        await act(async () => {
            await router.navigate({ to: '/chat' });
        });
        expect(container.querySelector('#mes_stop')).toBeTruthy();
        expect(container.querySelector('#send_but')).toBeNull();

        // Finish stream on A -> settles to idle ready
        await act(async () => {
            env.streamController?.finish();
            await sendPromise;
        });
        expect(env.bridge.getSnapshot().busy).toBe(false);
        expect(env.bridge.getSnapshot().canSend).toBe(true);

        // 2) Trigger a real F2 conflict on A via /api/chats/save returning 409, then cancel preflight B
        const origRaw = env.client.raw;
        (env.client.raw as any).mockImplementationOnce(async (url: string) => {
            if (url === '/api/chats/save') {
                return {
                    ok: false,
                    status: 409,
                    json: async () => ({ error: { code: 'VC_F2_CONFLICT' } }),
                };
            }
            return origRaw(url, '{}');
        });

        await act(async () => {
            const ok = await env.bridge.send('Unsaved F2 conflict input');
            expect(ok).toBe(false);
        });
        expect(env.bridge.getSnapshot().conflict).toBe(true);
        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getSnapshot().conflictSnapshot?.raw).toContain('Unsaved F2 conflict input');

        let readB2Started = false;
        (env.client.readChat as any).mockImplementationOnce(
            ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                if (avatar === 'bob.png' && file === 'chat-b') {
                    readB2Started = true;
                    return new Promise(() => {});
                }
                return origReadChat({ avatar, file }, opts);
            },
        );
        const controllerB2 = new AbortController();
        const openB2Promise = env.bridge.open(keyB, { signal: controllerB2.signal });
        await waitFor(() => {
            expect(readB2Started).toBe(true);
        });

        await act(async () => {
            controllerB2.abort();
        });
        expect(env.bridge.getSnapshot().key).toBe(keyA);
        expect(env.bridge.getSnapshot().conflict).toBe(true);
        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getSnapshot().conflictSnapshot?.raw).toContain('Unsaved F2 conflict input');
        expect(await env.bridge.copyRejected()).toBe('Unsaved F2 conflict input');
        void openB2Promise;

        env.bridge.destroy();
        env.queryClient.clear();
    });

    it('Item 3: deferred prepareRuntime on initial open renders plain-text history and keeps draft without mutating context early, then finishes ready after route leave and runtime release', async () => {
        const keyA = '["alice.png","chat-a"]';
        let releaseRuntime!: () => void;
        let prepareEntered = false;
        delete document.documentElement.dataset.vcRuntime;

        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: 'Hi', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [
                    { name: 'Alice', mes: 'Delayed runtime message 1', is_user: false },
                    { name: '你', mes: 'Delayed runtime message 2', is_user: true },
                ],
            },
            beforePrepareRuntime: async () => {
                prepareEntered = true;
                await new Promise<void>(resolve => {
                    releaseRuntime = resolve;
                });
            },
        });

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

        await waitFor(() => {
            expect(prepareEntered).toBe(true);
            expect(container.querySelectorAll('#chat > .mes')).toHaveLength(2);
        });

        // Plain-text history is visible, runtime is still not prepared, context is not mutated early, canSend is false
        expect(document.documentElement.dataset.vcRuntime).toBeUndefined();
        expect(container.querySelector('#chat')?.textContent).toContain('Delayed runtime message 1');
        expect(container.querySelector('#chat')?.textContent).toContain('Delayed runtime message 2');
        expect(env.bridge.getSnapshot().status).toBe('switching');
        expect(env.bridge.getSnapshot().canSend).toBe(false);
        expect(env.bridge.getContext().chat).toEqual([]);
        expect(env.bridge.getContext().chatId).toBe('');

        const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'NF06 保留草稿' } });
        expect(env.bridge.draft.read(keyA)).toBe('NF06 保留草稿');

        // Navigate to settings while runtime is still held, then release runtime -> committed session A still becomes ready
        await act(async () => {
            await router.navigate({
                to: '/settings/$category',
                params: { category: 'model' },
            });
        });
        await act(async () => {
            releaseRuntime();
        });
        await waitFor(() => {
            expect(document.documentElement.dataset.vcRuntime).toBe('prepared');
            expect(env.bridge.getSnapshot().status).toBe('ready');
        });
        expect(env.bridge.getSnapshot().key).toBe(keyA);
        expect(env.bridge.getSnapshot().canSend).toBe(true);
        expect(env.bridge.getContext().chatId).toBe('chat-a');
        expect(env.bridge.getContext().chat).toHaveLength(2);
        expect(env.bridge.draft.read(keyA)).toBe('NF06 保留草稿');

        env.bridge.destroy();
        env.queryClient.clear();
    });
});
