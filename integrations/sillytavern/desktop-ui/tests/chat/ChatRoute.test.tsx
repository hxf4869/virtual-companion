import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { VoiceBubble } from '../../src/features/chat/VoiceBubble';
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
});
