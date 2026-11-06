import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { ChatCharacterPanel } from '../../src/features/chat/ChatCharacterPanel';
import { ChatRoute } from '../../src/features/chat/ChatRoute';
import { ChatSearch } from '../../src/features/chat/ChatSearch';
import { ConversationList } from '../../src/features/chat/ConversationList';
import { MessageList } from '../../src/features/chat/MessageList';
import { VoiceBubble } from '../../src/features/chat/VoiceBubble';
import { ChatUiProvider, useChatUi } from '../../src/features/chat/useChatUi';
import { useComposer, type ComposerQuote } from '../../src/features/chat/useComposer';
import {
    resolveMessageActionTarget,
    useMessageActions,
} from '../../src/features/chat/useMessageActions';
import { toast } from '../../src/design/components/Toast';
import { queryKeys } from '../../src/data/queryKeys';
import {
    captureSessionContext,
    setStHeadersProvider,
} from '../../../extension/vc-model-settings/api.js';
import { createTestChatEnv } from './fixtures';

const chatFeatureDir = resolve(__dirname, '../../src/features/chat');

describe('MB2-4-chat shared extraction, route/shell injection, and stable message actions', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('removes shell and @tanstack/react-router imports from features/chat and keeps business hooks DOM-free', () => {
        const files = readdirSync(chatFeatureDir).filter(name => /\.(ts|tsx)$/.test(name));
        expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
            const source = readFileSync(join(chatFeatureDir, file), 'utf8');
            expect(source, `${file} should not import @tanstack/react-router`).not.toContain(
                '@tanstack/react-router',
            );
            expect(source, `${file} should not import ../../shell/`).not.toMatch(
                /from\s+['"]\.\.\/\.\.\/shell\//,
            );
        }

        for (const hookFile of ['useChatUi.tsx', 'useComposer.ts', 'useMessageActions.ts']) {
            const source = readFileSync(join(chatFeatureDir, hookFile), 'utf8');
            expect(
                source,
                `${hookFile} must not reference document/window/HTMLElement`,
            ).not.toMatch(/\b(document|window|HTMLElement|HTMLTextAreaElement|HTMLInputElement)\b/);
            expect(
                source,
                `${hookFile} must not import design layer components`,
            ).not.toMatch(/from\s+['"]\.\.\/\.\.\/design\//);
        }
    });

    it('injects navigation callbacks into ChatCharacterPanel and ConversationList and preserves relationshipId search in router', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Hello there',
                    updatedAt: 1,
                    relationshipId: '42',
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Hello from Alice', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        env.queryClient.setQueryData(queryKeys.relationships, [
            { relationshipId: '42', displayName: '小爱' },
        ]);

        const onClose = vi.fn();
        const onOpenVoice = vi.fn();
        const onOpenMemory = vi.fn();
        const onOpenCharacters = vi.fn();
        const onSelectConversation = vi.fn();
        const onOpenQuickSwitch = vi.fn();

        // 1) Standalone mount without RouterProvider or AppShell
        const standalone = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ConversationList
                    rows={[
                        {
                            key: keyA,
                            avatar: 'alice.png',
                            avatarUrl: '/characters/alice.png',
                            file: 'chat-a',
                            title: 'Alice',
                            instanceName: '',
                            preview: 'Hello there',
                            timeText: '刚刚',
                            updatedAt: 1,
                            relationshipId: '42',
                        },
                    ]}
                    activeKey={keyA}
                    onSelectConversation={onSelectConversation}
                    onOpenQuickSwitch={onOpenQuickSwitch}
                />
                <ChatCharacterPanel
                    onClose={onClose}
                    onOpenVoice={onOpenVoice}
                    onOpenMemory={onOpenMemory}
                    onOpenCharacters={onOpenCharacters}
                />
            </AppProviders>,
        );

        fireEvent.click(standalone.getByRole('button', { name: '搜索会话 (⌘K)' }));
        expect(onOpenQuickSwitch).toHaveBeenCalledTimes(1);

        const convRow = Array.from(
            standalone.container.querySelectorAll('[data-conversation-key]'),
        ).find(el => el.getAttribute('data-conversation-key') === keyA) as HTMLElement;
        expect(convRow).toBeTruthy();
        fireEvent.click(convRow);
        expect(onSelectConversation).toHaveBeenCalledWith(
            expect.objectContaining({ key: keyA, relationshipId: '42' }),
        );

        fireEvent.click(standalone.getByRole('button', { name: '关闭角色面板' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(standalone.getByRole('button', { name: '声音' }));
        expect(onOpenVoice).toHaveBeenCalledWith('42');

        fireEvent.click(standalone.getByRole('button', { name: '记忆' }));
        expect(onOpenMemory).toHaveBeenCalledTimes(1);

        fireEvent.click(standalone.getByRole('button', { name: '设置' }));
        expect(onOpenCharacters).toHaveBeenCalledTimes(1);

        standalone.unmount();

        // 2) Desktop router integration preserves /settings/voice?relationshipId=42 search param
        const router = createDesktopRouter(`/chat/${encodeURIComponent(keyA)}`);
        const routed = render(
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

        const voiceBtn = routed.container.querySelector(
            '#vc-desktop-character-panel button[aria-label="声音"]',
        ) as HTMLButtonElement;
        expect(voiceBtn).toBeTruthy();

        await act(async () => {
            fireEvent.click(voiceBtn);
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe('/settings/voice');
            expect(router.state.location.search).toEqual({ relationshipId: '42' });
        });

        env.bridge.destroy();
    });

    it('ChatRoute respects injected active prop without TanStack Router and cancels preflight open + clears messageJump when leaving', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Alice message', is_user: false }],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        let readBSignal: AbortSignal | undefined;
        let readBStarted = false;
        const origReadChat = env.client.readChat;
        (env.client.readChat as any).mockImplementationOnce(
            ({ avatar, file }: { avatar: string; file: string }, opts?: { signal?: AbortSignal }) => {
                if (avatar === 'bob.png' && file === 'chat-b') {
                    readBStarted = true;
                    readBSignal = opts?.signal;
                    return new Promise(() => {});
                }
                return origReadChat({ avatar, file }, opts);
            },
        );

        let latestUi: ReturnType<typeof useChatUi> = null;
        function UiProbe() {
            latestUi = useChatUi();
            return null;
        }

        const view = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ChatUiProvider>
                    <UiProbe />
                    <ChatRoute conversationKey={keyB} active={true} reducedMotion={true} />
                </ChatUiProvider>
            </AppProviders>,
        );

        await waitFor(() => {
            expect(readBStarted).toBe(true);
        });
        expect(readBSignal?.aborted).toBe(false);

        // Request a message jump on current snapshot keyA while active, then mark ChatRoute inactive (leaving route)
        act(() => {
            latestUi?.requestMessageJump(keyA, 0);
        });

        view.rerender(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ChatUiProvider>
                    <UiProbe />
                    <ChatRoute conversationKey={keyB} active={false} reducedMotion={true} />
                </ChatUiProvider>
            </AppProviders>,
        );

        expect(readBSignal?.aborted).toBe(true);
        expect(latestUi?.messageJump).toBeNull();
        expect(env.bridge.getSnapshot().key).toBe(keyA);

        // Reduced motion prop flows to ChatSearch and VoiceBubble without shell/useReducedMotion
        const voiceView = render(
            <VoiceBubble
                voice={{ clipId: 'c1', status: 'ready', durationMs: 2000, transcript: 'hi' }}
                reducedMotion={true}
            />,
        );
        expect(
            voiceView.container
                .querySelector('[data-vc-voice-bubble]')
                ?.getAttribute('data-reduced-motion'),
        ).toBe('true');

        const searchView = render(
            <ChatSearch
                open={true}
                onOpenChange={() => {}}
                activeKey={keyA}
                messageCount={1}
                reducedMotion={true}
            />,
        );
        expect(searchView.container.querySelector('.vc-chat-search')).toBeTruthy();

        env.bridge.destroy();
    });

    it('useComposer handles draft persistence, quote formatting, raw text submission, and continue_on_send without DOM elements', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: 'Character last reply', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        let composerApi!: ReturnType<typeof useComposer>;
        const onClearQuote = vi.fn();
        const onSent = vi.fn();

        function ComposerHarness({ quote }: { quote?: ComposerQuote | null }) {
            composerApi = useComposer({ quote, onClearQuote, onSent });
            return null;
        }

        const view = render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ComposerHarness quote={{ name: 'Alice', text: 'Character last reply' }} />
            </AppProviders>,
        );

        expect(composerApi.canContinue).toBe(true);
        expect(composerApi.canSubmit).toBe(false);

        // Blank draft with continue_on_send = false does not submit
        act(() => {
            composerApi.setDraft('   ');
        });
        expect(composerApi.canSubmit).toBe(false);
        expect(composerApi.submitComposer()).toBe(false);
        expect(env.sentInputs).toEqual([]);

        // Non-blank draft with quote prepends quote, clears quote, notifies sent, and sends raw text
        act(() => {
            composerApi.setDraft('  My reply  ');
        });
        await waitFor(() => {
            expect(composerApi.draft).toBe('  My reply  ');
            expect(composerApi.canSubmit).toBe(true);
        });

        await act(async () => {
            expect(composerApi.submitComposer()).toBe(true);
            await env.bridge.whenIdle();
        });
        expect(onClearQuote).toHaveBeenCalledTimes(1);
        expect(onSent).toHaveBeenCalledTimes(1);
        expect(env.sentInputs).toHaveLength(1);
        expect(env.sentInputs[0]).toContain('My reply');
        expect(env.bridge.draft.read(keyA)).toBe('');

        // Enable continue_on_send and verify blank submit triggers continue
        env.bridge.getContext().powerUserSettings.continue_on_send = true;
        await act(async () => {
            await env.bridge.applySettings([]);
        });

        view.rerender(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ComposerHarness quote={null} />
            </AppProviders>,
        );

        expect(composerApi.canContinue).toBe(true);
        expect(composerApi.canSubmit).toBe(true);

        const sendSpy = vi.spyOn(env.bridge, 'send');
        await act(async () => {
            expect(composerApi.submitComposer()).toBe(true);
            await env.bridge.whenIdle();
        });
        expect(sendSpy).toHaveBeenCalledWith('', { type: 'continue' });

        env.bridge.destroy();
    });

    it('useMessageActions and resolveMessageActionTarget resolve stable messageKey across index shifts and conversation switches', async () => {
        const keyA = '["alice.png","chat-a"]';
        const keyB = '["bob.png","chat-b"]';
        const env = createTestChatEnv({
            conversations: [
                { key: keyA, avatar: 'alice.png', file: 'chat-a', title: 'Alice', preview: '', updatedAt: 2 },
                { key: keyB, avatar: 'bob.png', file: 'chat-b', title: 'Bob', preview: '', updatedAt: 1 },
            ],
            chatsByKey: {
                [keyA]: [
                    { name: 'Alice', mes: 'First message', is_user: false },
                    { name: '你', mes: 'Second message (target)', is_user: true },
                    { name: 'Alice', mes: 'Third message', is_user: false },
                ],
                [keyB]: [{ name: 'Bob', mes: 'Bob message', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        let actionsApi!: ReturnType<typeof useMessageActions>;
        function ActionsHarness() {
            actionsApi = useMessageActions();
            return null;
        }

        render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <ActionsHarness />
            </AppProviders>,
        );

        const targetMessageKey = env.bridge.getSnapshot().messages[1].key;
        expect(targetMessageKey).toBeTruthy();

        // Open edit dialog for message at index 1 ("Second message (target)")
        act(() => {
            actionsApi.openEditDialog(1, 'Second message (target)');
            actionsApi.editForm.setValue('text', 'Edited second message');
        });
        expect(actionsApi.editing).toEqual({
            key: keyA,
            messageKey: targetMessageKey,
            text: 'Second message (target)',
        });

        // Before submitting edit, delete message at index 0 so the target message shifts from index 1 -> index 0
        await act(async () => {
            await env.bridge.remove(0);
        });
        expect(env.bridge.getSnapshot().messages[0].key).toBe(targetMessageKey);

        // Submitting edit resolves the shifted index (0) via stable messageKey
        const editSpy = vi.spyOn(env.bridge, 'edit');
        await act(async () => {
            await actionsApi.submitEdit();
        });
        expect(editSpy).toHaveBeenCalledWith(0, 'Edited second message');
        expect(env.bridge.getSnapshot().messages[0].mes).toBe('Edited second message');

        // Now open remove dialog for message 0 on keyA, then switch conversation to keyB before confirming
        act(() => {
            actionsApi.openRemoveDialog(0);
        });
        expect(actionsApi.removing?.messageKey).toBe(targetMessageKey);

        await act(async () => {
            await env.bridge.open(keyB);
        });
        expect(resolveMessageActionTarget(env.bridge.getSnapshot(), actionsApi.removing)).toBeNull();

        const removeSpy = vi.spyOn(env.bridge, 'remove');
        await act(async () => {
            await actionsApi.confirmRemove();
        });
        expect(removeSpy).not.toHaveBeenCalled();
        expect(env.bridge.getSnapshot().messages).toHaveLength(1);

        env.bridge.destroy();
    });

    it('delegates reminder success/error notification intent from useMessageActions to MessageList Toast without losing createReminder semantics', async () => {
        const keyA = '["alice.png","chat-a"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key: keyA,
                    avatar: 'alice.png',
                    file: 'chat-a',
                    title: 'Alice',
                    preview: 'Remind me',
                    updatedAt: 1,
                    relationshipId: '42',
                },
            ],
            chatsByKey: {
                [keyA]: [{ name: 'Alice', mes: '今晚八点一起看电影', is_user: false }],
            },
        });
        await env.bridge.open(keyA);

        let shouldFailReminder = true;
        const reminderPayloads: Array<{ url: string; body: any }> = [];

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
                if (method === 'POST' && url.endsWith('/api/v1/relationships/42/reminders')) {
                    reminderPayloads.push({
                        url,
                        body: init?.body ? JSON.parse(String(init.body)) : null,
                    });
                    if (shouldFailReminder) {
                        return new Response(
                            JSON.stringify({ code: 'INTERNAL_ERROR', message: 'failed' }),
                            { status: 500 },
                        );
                    }
                    return new Response(JSON.stringify({ reminderId: 'r-1' }), { status: 200 });
                }
                return new Response(JSON.stringify({}), { status: 200 });
            }),
        );

        setStHeadersProvider(() => ({ 'X-CSRF-Token': 'test-csrf' }));
        await captureSessionContext();

        const toastSpy = vi.spyOn(toast, 'show');

        render(
            <AppProviders
                client={env.client}
                queryClient={env.queryClient}
                sessionBridge={env.bridge}
            >
                <MessageList historyAll={false} onQuote={() => {}} />
            </AppProviders>,
        );

        const moreBtn = await screen.findByRole('button', { name: '消息操作' });
        fireEvent.click(moreBtn);

        const remindItem = await screen.findByRole('menuitem', { name: '稍后提醒' });
        fireEvent.click(remindItem);

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();

        const topicInput = screen.getByRole('textbox', { name: '提醒内容' });
        fireEvent.change(topicInput, { target: { value: '  看电影提醒  ' } });

        // 1) First attempt fails asynchronously: error toast is shown and dialog stays open
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(toastSpy).toHaveBeenCalledWith({
                title: '没有完成，请重试。',
                kind: 'error',
            });
        });
        expect(reminderPayloads).toHaveLength(1);
        expect(reminderPayloads[0].body).toEqual(
            expect.objectContaining({
                text: '看电影提醒',
                remindAt: expect.any(String),
            }),
        );
        expect(screen.queryByRole('dialog')).toBeTruthy();

        // 2) Retry succeeds: dialog closes and success toast is shown
        toastSpy.mockClear();
        shouldFailReminder = false;

        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(toastSpy).toHaveBeenCalledWith({
                title: '好，到时候提醒你',
                kind: 'success',
            });
        });
        expect(reminderPayloads).toHaveLength(2);
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });

        env.bridge.destroy();
    });
});
