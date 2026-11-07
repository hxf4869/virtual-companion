import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { Composer, useComposer } from '../../src/features/chat/Composer';
import { createTestChatEnv } from './fixtures';

describe('Composer keyboard, IME composition, and per-conversation draft persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('sends on Enter, inserts newline on Shift+Enter, and ignores Enter during IME composition', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [],
            },
        });

        await act(async () => {
            const openRes = await env.bridge.open(keyA);
            expect(openRes).toBe('opened');
        });

        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <Composer />
            </AppProviders>,
        );

        const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();

        fireEvent.change(textarea, { target: { value: 'Hello Alice' } });
        expect(env.bridge.draft.read(keyA)).toBe('Hello Alice');

        // IME composing Enter must NOT send
        fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true, keyCode: 229 });
        expect(env.sentInputs).toEqual([]);
        expect(textarea.value).toBe('Hello Alice');

        // Shift+Enter must NOT send
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
        expect(env.sentInputs).toEqual([]);
        expect(textarea.value).toBe('Hello Alice');

        // Plain Enter sends and clears draft
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, isComposing: false });
            await env.bridge.whenIdle();
        });
        expect(env.sentInputs).toEqual(['Hello Alice']);
        expect(textarea.value).toBe('');
        expect(env.bridge.draft.read(keyA)).toBe('');
    });

    it('preserves independent drafts per conversation key when switching conversations', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [],
                [keyB]: [],
            },
        });

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });

        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <Composer />
            </AppProviders>,
        );

        const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Draft for Alice' } });
        expect(textarea.value).toBe('Draft for Alice');
        expect(env.bridge.draft.read(keyA)).toBe('Draft for Alice');

        await act(async () => {
            expect(await env.bridge.open(keyB)).toBe('opened');
        });
        expect(textarea.value).toBe('');

        fireEvent.change(textarea, { target: { value: 'Draft for Bob' } });
        expect(textarea.value).toBe('Draft for Bob');
        expect(env.bridge.draft.read(keyB)).toBe('Draft for Bob');

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });
        expect(textarea.value).toBe('Draft for Alice');
    });

    it('validates non-blank input via RHF+Zod while submitting raw untrimmed user text, and mounts emoji-mart Picker host', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [],
            },
        });

        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });

        const { container } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <Composer />
            </AppProviders>,
        );

        const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        const sendBtn = container.querySelector('#send_but') as HTMLButtonElement;

        // Whitespace-only input fails zod non-blank refine and keeps send button disabled
        fireEvent.change(textarea, { target: { value: '   \n  ' } });
        expect(sendBtn.disabled).toBe(true);
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, isComposing: false });
        expect(env.sentInputs).toEqual([]);

        // Input with leading/trailing spaces passes validation and submits raw untrimmed string
        fireEvent.change(textarea, { target: { value: '  Raw untrimmed message  ' } });
        expect(sendBtn.disabled).toBe(false);
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, isComposing: false });
            await env.bridge.whenIdle();
        });
        expect(env.sentInputs).toEqual(['  Raw untrimmed message  ']);

        // Opening EmojiPicker mounts emoji-mart custom element inside .vc-emoji-mart-host
        const emojiBtn = container.querySelector('#vc-emoji-btn') as HTMLButtonElement;
        expect(emojiBtn).toBeTruthy();
        await act(async () => {
            fireEvent.click(emojiBtn);
        });
        const emojiMartHost = document.querySelector('#vc-emoji-panel .vc-emoji-mart-host');
        expect(emojiMartHost).toBeTruthy();
        expect(emojiMartHost?.querySelector('em-emoji-picker')).toBeTruthy();
    });

    it('reads target conversation draft and disables sending in useComposer({ conversationKey }) until that conversation is live', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [],
            },
        });
        env.bridge.draft.write(keyA, 'Cached draft before open');

        function Probe() {
            const { draft, canSend, canSubmit, setDraft, submitComposer } = useComposer({
                conversationKey: keyA,
            });
            return (
                <div>
                    <textarea
                        data-testid="probe-input"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                    />
                    <button
                        type="button"
                        data-testid="probe-send"
                        disabled={!canSubmit}
                        data-can-send={String(canSend)}
                        onClick={() => submitComposer()}
                    >
                        Send
                    </button>
                </div>
            );
        }

        const { getByTestId } = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <Probe />
            </AppProviders>,
        );

        const input = getByTestId('probe-input') as HTMLTextAreaElement;
        const sendBtn = getByTestId('probe-send') as HTMLButtonElement;

        // Before bridge.open(keyA) finishes, draft for keyA is visible, but sending is disabled
        expect(input.value).toBe('Cached draft before open');
        expect(sendBtn.disabled).toBe(true);
        expect(sendBtn.getAttribute('data-can-send')).toBe('false');

        // Once bridge.open(keyA) becomes ready, sending becomes enabled for the same draft
        await act(async () => {
            expect(await env.bridge.open(keyA)).toBe('opened');
        });
        expect(input.value).toBe('Cached draft before open');
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.getAttribute('data-can-send')).toBe('true');
    });
});
