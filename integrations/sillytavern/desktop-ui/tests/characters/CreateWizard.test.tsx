import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import { normalizeConversationKey } from '../../src/data/queries/chat';
import { CreateWizard } from '../../src/features/characters/CreateWizard';

describe('CreateWizard (7-step companion creation wizard)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState(null, '', '/');
        window.location.hash = '';
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('seven steps then creates instance and navigates to chat', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });

        const reloadCharacterSpy = vi.fn(async () => {});
        const createConversationSpy = vi.fn(async (input: any) => ({
            relationshipId: 'rel-xiaoxia',
            conversationId: 'conv-xiaoxia',
            mode: input.mode || 'COMPANION',
            avatar: 'xiaoxia.png',
            file: 'chat-xiaoxia-1',
            chatIdentity: input.chatIdentity || 'chat-xiaoxia-1',
            characterRef: input.characterRef,
            name: input.displayName,
        }));

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({ file_name: 'xiaoxia' }),
            })),
        );

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'X-CSRF-Token': 'test-token' }),
            post: vi.fn(async () => ({ ok: true })),
            characters: vi.fn(async () => [
                {
                    avatar: 'xiaoxia.png',
                    name: '林小夏',
                    description: '朋友介绍',
                    data: { extensions: { vc_character_ref: 'ref-xiaoxia' } },
                },
            ]),
            recent: vi.fn(async () => []),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async () => [
                {
                    chat_metadata: {
                        integrity: 'int-1',
                        vc_f2: { id: 'chat-xiaoxia-1', revision: 1 },
                        vc_binding: {
                            relationshipId: 'rel-xiaoxia',
                            conversationId: 'conv-xiaoxia',
                            mode: 'COMPANION',
                        },
                    },
                },
            ]),
            request: vi.fn(async () => ({})),
            go: {
                fetchRelationships: vi.fn(async () => []),
                fetchNotifications: vi.fn(async () => ({ items: [] })),
                fetchCompanionState: vi.fn(async () => ({})),
                fetchFollowUps: vi.fn(async () => []),
                fetchMemories: vi.fn(async () => ({ items: [] })),
                storyRequest: vi.fn(async () => ({})),
            },
        } as unknown as AppClient;

        const bridge = createSessionBridge(client, {
            queryClient,
            prepareRuntime: async ({ onChange }: any) =>
                ({
                    activate: async (row: any) => {
                        onChange?.({
                            key: JSON.stringify([row.avatar, row.file]),
                            messages: [],
                            messageKeys: [],
                            busy: false,
                            canSend: true,
                            notice: '',
                            conflict: false,
                            catalogBlocked: false,
                            settingsRequired: false,
                            enterToSend: true,
                        });
                        return true;
                    },
                    reloadCharacter: reloadCharacterSpy,
                    createConversation: createConversationSpy,
                    destroy() {},
                }) as any,
        });

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: () => <CreateWizard open={true} onOpenChange={() => {}} />,
            },
        });

        render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        // Step 1/7: 名字 / 性别
        expect(await screen.findByText(/1\s*\/\s*7/)).toBeTruthy();
        const nameInput = await screen.findByLabelText('她的名字');
        fireEvent.change(nameInput, { target: { value: '林小夏' } });
        fireEvent.click(screen.getByRole('button', { name: '女生' }));
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 2/7: 和你是
        expect(await screen.findByText(/2\s*\/\s*7/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '恋人' }));
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 3/7: 性格与说话方式
        expect(await screen.findByText(/3\s*\/\s*7/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '口语短句，偶尔表情' }));
        fireEvent.click(screen.getByRole('button', { name: '幽默会接梗' }));
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 4/7: 怎么称呼你
        expect(await screen.findByText(/4\s*\/\s*7/)).toBeTruthy();
        const addressInput = await screen.findByLabelText('怎么称呼你');
        fireEvent.change(addressInput, { target: { value: '阿泽' } });
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 5/7: 两个人的背景
        expect(await screen.findByText(/5\s*\/\s*7/)).toBeTruthy();
        const scenarioInput = await screen.findByLabelText(/两个人的背景/);
        fireEvent.change(scenarioInput, { target: { value: '每天下班后在微信上分享日常。' } });
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 6/7: 别提的话题
        expect(await screen.findByText(/6\s*\/\s*7/)).toBeTruthy();
        const avoidInput = await screen.findByLabelText(/别提的话题/);
        fireEvent.change(avoidInput, { target: { value: '工作KPI' } });
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));

        // Step 7/7: 第一句话
        expect(await screen.findByText(/7\s*\/\s*7/)).toBeTruthy();
        const firstMesInput = (await screen.findByLabelText('第一句话')) as HTMLTextAreaElement;
        expect(firstMesInput.value).toContain('今天想你好几次了');
        fireEvent.change(firstMesInput, {
            target: { value: '阿泽，你来啦！今天想你好几次了。' },
        });

        // Finish wizard -> imports card, reloads character, creates companion instance, navigates to chat
        fireEvent.click(screen.getByRole('button', { name: '开始聊天' }));

        const expectedKey = normalizeConversationKey('xiaoxia.png', 'chat-xiaoxia-1');
        await waitFor(() => {
            expect(reloadCharacterSpy).toHaveBeenCalledWith('xiaoxia.png');
            expect(createConversationSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    characterRef: 'ref-xiaoxia',
                    displayName: '林小夏',
                    mode: 'COMPANION',
                }),
            );
            expect(decodeURIComponent(router.state.location.pathname)).toBe(
                `/chat/${expectedKey}`,
            );
        });
    });

    it('does not open or navigate if wizard unmounts/leaves while submission is in-flight, and does not navigate when bridge.open returns superseded or failed', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        let resolveCreateConv: ((val: any) => void) | null = null;
        let holdCreateConv = true;
        let openResultMode: 'opened' | 'superseded' | 'failed' = 'opened';

        const createConversationSpy = vi.fn(
            (input: any) =>
                new Promise<any>((resolve) => {
                    const value = {
                        relationshipId: 'rel-xiaoxia',
                        conversationId: 'conv-xiaoxia',
                        mode: input.mode || 'COMPANION',
                        avatar: 'xiaoxia.png',
                        file: 'chat-xiaoxia-1',
                        chatIdentity: input.chatIdentity || 'chat-xiaoxia-1',
                        characterRef: input.characterRef,
                        name: input.displayName,
                    };
                    if (holdCreateConv) {
                        resolveCreateConv = () => resolve(value);
                    } else {
                        resolve(value);
                    }
                }),
        );

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({ file_name: 'xiaoxia' }),
            })),
        );

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'X-CSRF-Token': 'test-token' }),
            post: vi.fn(async () => ({ ok: true })),
            characters: vi.fn(async () => [
                {
                    avatar: 'xiaoxia.png',
                    name: '林小夏',
                    description: '朋友介绍',
                    data: { extensions: { vc_character_ref: 'ref-xiaoxia' } },
                },
            ]),
            recent: vi.fn(async () => []),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async () => []),
            request: vi.fn(async () => ({})),
            go: {
                fetchRelationships: vi.fn(async () => []),
                fetchNotifications: vi.fn(async () => ({ items: [] })),
                fetchCompanionState: vi.fn(async () => ({})),
                fetchFollowUps: vi.fn(async () => []),
                fetchMemories: vi.fn(async () => ({ items: [] })),
                storyRequest: vi.fn(async () => ({})),
            },
        } as unknown as AppClient;

        const bridge = createSessionBridge(client, {
            queryClient,
            prepareRuntime: async () =>
                ({
                    activate: async () => openResultMode === 'opened',
                    reloadCharacter: vi.fn(async () => {}),
                    createConversation: createConversationSpy,
                    destroy() {},
                }) as any,
        });

        const openSpy = vi.spyOn(bridge, 'open').mockImplementation(async () => openResultMode);

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: () => <CreateWizard open={true} onOpenChange={() => {}} />,
            },
        });

        render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        // Walk to step 7 and submit while createConversation is held in-flight
        fireEvent.change(await screen.findByLabelText('她的名字'), {
            target: { value: '林小夏' },
        });
        for (let i = 1; i < 7; i += 1) {
            fireEvent.click(screen.getByRole('button', { name: '下一步' }));
        }
        fireEvent.click(await screen.findByRole('button', { name: '开始聊天' }));

        await waitFor(() => {
            expect(resolveCreateConv).toBeTypeOf('function');
        });

        // User leaves /characters to /memory while submission is still in-flight
        await act(async () => {
            await router.navigate({ to: '/memory' });
        });
        expect(router.state.location.pathname).toBe('/memory');

        // Now resolve the in-flight createConversation late
        await act(async () => {
            resolveCreateConv?.({});
            await Promise.resolve();
        });

        // Queries for completed server work are still invalidated, but bridge.open and navigate are NOT called
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['characters'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['relationships'] });
        expect(openSpy).not.toHaveBeenCalled();
        expect(router.state.location.pathname).toBe('/memory');

        // Return to /characters and verify superseded / failed bridge.open does NOT navigate
        holdCreateConv = false;
        openResultMode = 'superseded';
        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        fireEvent.change(await screen.findByLabelText('她的名字'), {
            target: { value: '林小夏' },
        });
        for (let i = 1; i < 7; i += 1) {
            fireEvent.click(screen.getByRole('button', { name: '下一步' }));
        }
        fireEvent.click(await screen.findByRole('button', { name: '开始聊天' }));

        await waitFor(() => {
            expect(openSpy).toHaveBeenCalledTimes(1);
        });
        expect(router.state.location.pathname).toBe('/characters');

        // Now test 'failed' bridge.open -> also stays on /characters and shows error alert
        openResultMode = 'failed';
        fireEvent.click(screen.getByRole('button', { name: '开始聊天' }));
        await waitFor(() => {
            expect(openSpy).toHaveBeenCalledTimes(2);
        });
        expect(router.state.location.pathname).toBe('/characters');
        expect(await screen.findByRole('alert')).toBeTruthy();
    });
});
