import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import { CharactersRoute } from '../../src/features/characters/CharactersRoute';

describe('CharactersRoute (B15 delete character, instance creation & rename)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState(null, '', '/');
        window.location.hash = '';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'image/png' }),
                arrayBuffer: async () => new ArrayBuffer(0),
                blob: async () => new Blob([]),
                text: async () => '',
                json: async () => ({}),
            })),
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('deleting character refreshes characters/relationships/recentChats, clears open conversation, and supersedes in-flight open (B15)', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });

        let currentCards = [
            {
                avatar: 'alice.png',
                name: 'Alice',
                description: 'Alice character description',
                data: {
                    description: 'Alice character description',
                    extensions: { vc_character_ref: 'ref-alice' },
                },
            },
            {
                avatar: 'bob.png',
                name: 'Bob',
                description: 'Bob character description',
                data: {
                    description: 'Bob character description',
                    extensions: { vc_character_ref: 'ref-bob' },
                },
            },
        ];

        let currentRelationships = [
            {
                relationshipId: '101',
                characterRef: 'ref-alice',
                personaRef: 'st-character',
                companionName: 'Alice 日常',
                lastChatAt: '2026-11-04T09:00:00Z',
                userAddressAs: '你',
                replyLength: 'MEDIUM',
                initiative: 'MEDIUM',
                humor: 'LIGHT',
                advicePref: 'ASK_FIRST',
                remindersAllowed: true,
                memoryShareScope: 'RELATIONSHIP',
                avoidTopics: [],
                gender: 'FEMALE',
                avatarRef: 'AVATAR_FEMALE_01',
            },
        ];

        let currentRecent = [
            {
                avatar: 'alice.png',
                file_name: 'chat-alice-1.jsonl',
                mes: 'Hello Alice',
                last_mes: 1700000000000,
            },
        ];

        let holdOpenResolve: (() => void) | null = null;
        let holdNextOpen = false;
        const deleteCharacterSpy = vi.fn(async (avatar: string, _deleteChats: boolean) => {
            currentCards = currentCards.filter((c) => c.avatar !== avatar);
            if (avatar === 'alice.png') {
                currentRelationships = [];
                currentRecent = [];
            }
        });
        const reloadCharacterSpy = vi.fn(async () => {});

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'Content-Type': 'application/json' }),
            characters: vi.fn(async () => structuredClone(currentCards)),
            recent: vi.fn(async () => structuredClone(currentRecent)),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async () => [
                {
                    chat_metadata: {
                        integrity: 'int-alice',
                        vc_f2: { id: 'chat-alice-1', revision: 1 },
                        vc_binding: {
                            relationshipId: '101',
                            conversationId: 'conv-101',
                            mode: 'COMPANION',
                        },
                    },
                },
            ]),
            post: vi.fn(async () => ({ ok: true })),
            request: vi.fn(async () => ({})),
            go: {
                fetchRelationships: vi.fn(async () => structuredClone(currentRelationships)),
                fetchNotifications: vi.fn(async () => ({ items: [] })),
                fetchCompanionState: vi.fn(async () => ({})),
                fetchFollowUps: vi.fn(async () => []),
                fetchMemories: vi.fn(async () => ({ items: [] })),
                storyRequest: vi.fn(async () => ({})),
            },
        } as unknown as AppClient;

        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const bridge = createSessionBridge(client, {
            queryClient,
            prepareRuntime: async ({ onChange }: any) =>
                ({
                    activate: async (row: any, _records: any[], opts: { signal?: AbortSignal }) => {
                        if (holdNextOpen) {
                            await new Promise<void>((res) => {
                                holdOpenResolve = res;
                            });
                        }
                        if (opts?.signal?.aborted) return false;
                        onChange?.({
                            key: JSON.stringify([row.avatar, row.file]),
                            messages: [{ name: 'Alice', mes: 'Hello Alice', is_user: false }],
                            messageKeys: ['m-1'],
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
                    deleteCharacter: deleteCharacterSpy,
                    reloadCharacter: reloadCharacterSpy,
                    destroy() {},
                }) as any,
        });

        // First open Alice conversation so it is active in SessionBridge
        const aliceKey = JSON.stringify(['alice.png', 'chat-alice-1']);
        expect(await bridge.open(aliceKey)).toBe('opened');
        expect(bridge.getSnapshot().key).toBe(aliceKey);
        expect(bridge.getSnapshot().status).toBe('ready');

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: CharactersRoute,
            },
        });

        const { container } = render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        // Wait for character cards to load in CharacterGrid
        await waitFor(() => {
            expect(container.querySelector('.vc-character-card[data-avatar="alice.png"]')).toBeTruthy();
            expect(container.querySelector('.vc-character-card[data-avatar="bob.png"]')).toBeTruthy();
        });

        // Click Alice card to open CharacterDetail
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="alice.png"]')!);
        await waitFor(() => {
            expect(container.querySelector('.vc-character-instance-name')?.textContent).toBe('Alice 日常');
        });

        // Start an in-flight re-open for Alice before deleting her character card
        holdNextOpen = true;
        const inFlightOpenPromise = bridge.open(aliceKey, { latest: true });
        await waitFor(() => {
            expect(holdOpenResolve).toBeTypeOf('function');
        });

        // Trigger Delete Character in CharacterDetail and confirm in AlertDialog
        fireEvent.click(screen.getByRole('button', { name: '删除角色' }));
        expect(await screen.findByText('删除角色？')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

        // Release the held in-flight open after delete starts/completes
        holdOpenResolve?.();

        const inFlightResult = await inFlightOpenPromise;
        expect(inFlightResult).toBe('superseded');

        await waitFor(() => {
            expect(deleteCharacterSpy).toHaveBeenCalledWith('alice.png', expect.any(Boolean));
            expect(bridge.getSnapshot().key).toBe('');
            expect(bridge.getSnapshot().status).toBe('empty');
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['characters'] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['relationships'] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recentChats'] });
        });

        // Alice card should be removed from the refreshed grid while Bob remains
        await waitFor(() => {
            expect(container.querySelector('.vc-character-card[data-avatar="alice.png"]')).toBeNull();
            expect(container.querySelector('.vc-character-card[data-avatar="bob.png"]')).toBeTruthy();
        });
    });

    it('validates instance name (1-32 chars, no control chars) and creates a new instance via bridge.createConversation', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });

        const createConversationSpy = vi.fn(async (input: any) => ({
            relationshipId: '202',
            conversationId: 'conv-202',
            mode: input.mode || 'COMPANION',
            avatar: 'alice.png',
            file: 'chat-alice-new',
            chatIdentity: input.chatIdentity || 'chat-alice-new',
            characterRef: input.characterRef,
            name: input.displayName,
        }));

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'Content-Type': 'application/json' }),
            characters: vi.fn(async () => [
                {
                    avatar: 'alice.png',
                    name: 'Alice',
                    description: 'Friend',
                    data: { extensions: { vc_character_ref: 'ref-alice' } },
                },
            ]),
            recent: vi.fn(async () => []),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async () => [
                {
                    chat_metadata: {
                        integrity: 'int-new',
                        vc_f2: { id: 'chat-alice-new', revision: 1 },
                        vc_binding: {
                            relationshipId: '202',
                            conversationId: 'conv-202',
                            mode: 'COMPANION',
                        },
                    },
                },
            ]),
            post: vi.fn(async () => ({ ok: true })),
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
                    activate: async () => true,
                    createConversation: createConversationSpy,
                    reloadCharacter: vi.fn(async () => {}),
                    destroy() {},
                }) as any,
        });

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: CharactersRoute,
            },
        });

        const { container } = render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        await waitFor(() => {
            expect(container.querySelector('.vc-character-card[data-avatar="alice.png"]')).toBeTruthy();
        });
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="alice.png"]')!);

        // Open new instance dialog
        const newInstanceBtn = await screen.findByRole('button', { name: '新建实例' });
        fireEvent.click(newInstanceBtn);

        const nameInput = await screen.findByLabelText('实例名称');

        // Control char should be rejected with sanitizeInstanceName error
        fireEvent.change(nameInput, { target: { value: 'Bad\u0007Name' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));
        expect(await screen.findByText('实例名称最多 32 个字。')).toBeTruthy();
        expect(createConversationSpy).not.toHaveBeenCalled();

        // Valid name -> calls bridge.createConversation
        fireEvent.change(nameInput, { target: { value: 'Alice 树洞' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(createConversationSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    characterRef: 'ref-alice',
                    displayName: 'Alice 树洞',
                    mode: 'COMPANION',
                }),
            );
        });
    });

    it('matches instances by recent.chat_metadata.vc_binding.relationshipId using file_id/file_name (not array index or F2 chatIdentity) and does not borrow another instance file when unbound', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });

        const activatedRows: Array<{ avatar: string; file: string }> = [];
        const createConversationSpy = vi.fn(async (input: any) => ({
            relationshipId: '103',
            conversationId: 'conv-103',
            mode: input.mode || 'COMPANION',
            avatar: 'alice.png',
            file: '2026-11-04@12h00m',
            chatIdentity: input.chatIdentity || 'f2-uuid-c',
            characterRef: input.characterRef,
            name: input.displayName,
        }));

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'Content-Type': 'application/json' }),
            characters: vi.fn(async () => [
                {
                    avatar: 'alice.png',
                    name: 'Alice',
                    description: 'Alice description',
                    data: { extensions: { vc_character_ref: 'ref-alice' } },
                },
            ]),
            // Recent chats are in reverse order (Instance B first, Instance A second, none for Instance C)
            recent: vi.fn(async () => [
                {
                    avatar: 'alice.png',
                    file_id: '2026-11-04@11h00m',
                    file_name: '2026-11-04@11h00m.jsonl',
                    mes: 'B latest message',
                    last_mes: 1762254000000,
                    chat_metadata: {
                        vc_binding: {
                            relationshipId: '102',
                            characterRef: 'ref-alice',
                            conversationId: 'conv-102',
                            mode: 'COMPANION',
                        },
                        vc_f2: { id: 'f2-uuid-b', revision: 2 },
                    },
                },
                {
                    avatar: 'alice.png',
                    file_name: '2026-11-04@09h00m.jsonl',
                    mes: 'A earlier message',
                    last_mes: 1762246800000,
                    chat_metadata: {
                        vc_binding: {
                            relationshipId: '101',
                            characterRef: 'ref-alice',
                            conversationId: 'conv-101',
                            mode: 'COMPANION',
                        },
                        vc_f2: { id: 'f2-uuid-a', revision: 1 },
                    },
                },
            ]),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async ({ file }: { avatar: string; file: string }) => [
                {
                    chat_metadata: {
                        integrity: `int-${file}`,
                        vc_f2: { id: `f2-for-${file}`, revision: 1 },
                        vc_binding: {
                            relationshipId: file.includes('09h00m') ? '101' : '102',
                            conversationId: 'conv-x',
                            mode: 'COMPANION',
                        },
                    },
                },
            ]),
            post: vi.fn(async () => ({ ok: true })),
            request: vi.fn(async () => ({})),
            go: {
                fetchRelationships: vi.fn(async () => [
                    {
                        relationshipId: '101',
                        characterRef: 'ref-alice',
                        personaRef: 'st-character',
                        companionName: 'Alice 实例A',
                        lastChatAt: '2026-11-04T09:00:00Z',
                    },
                    {
                        relationshipId: '102',
                        characterRef: 'ref-alice',
                        personaRef: 'st-character',
                        companionName: 'Alice 实例B',
                        lastChatAt: '2026-11-04T11:00:00Z',
                    },
                    {
                        relationshipId: '103',
                        characterRef: 'ref-alice',
                        personaRef: 'st-character',
                        companionName: 'Alice 无会话实例',
                    },
                ]),
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
                    activate: async (row: { avatar: string; file: string }) => {
                        activatedRows.push({ avatar: row.avatar, file: row.file });
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
                    createConversation: createConversationSpy,
                    reloadCharacter: vi.fn(async () => {}),
                    destroy() {},
                }) as any,
        });

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: CharactersRoute,
            },
        });

        const { container } = render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        await waitFor(() => {
            expect(container.querySelector('.vc-character-card[data-avatar="alice.png"]')).toBeTruthy();
        });
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="alice.png"]')!);

        // Click Instance A (index 0 in relationships, but index 1 in recent)
        await waitFor(() => {
            expect(
                container.querySelector(
                    '.vc-character-instance-row[data-relationship-id="101"] .vc-character-instance-open',
                ),
            ).toBeTruthy();
        });
        activatedRows.length = 0;
        fireEvent.click(
            container.querySelector(
                '.vc-character-instance-row[data-relationship-id="101"] .vc-character-instance-open',
            )!,
        );

        await waitFor(() => {
            expect(activatedRows).toEqual([{ avatar: 'alice.png', file: '2026-11-04@09h00m' }]);
            expect(decodeURIComponent(router.state.location.pathname)).toBe(
                '/chat/["alice.png","2026-11-04@09h00m"]',
            );
        });
        expect(createConversationSpy).not.toHaveBeenCalled();

        // Navigate back to Alice detail and click Instance C (no recent chat bound)
        await act(async () => {
            await router.navigate({
                to: '/characters/$avatar',
                params: { avatar: 'alice.png' },
            });
        });

        await waitFor(() => {
            expect(
                container.querySelector(
                    '.vc-character-instance-row[data-relationship-id="103"] .vc-character-instance-open',
                ),
            ).toBeTruthy();
        });
        fireEvent.click(
            container.querySelector(
                '.vc-character-instance-row[data-relationship-id="103"] .vc-character-instance-open',
            )!,
        );

        await waitFor(() => {
            expect(createConversationSpy).toHaveBeenCalledTimes(1);
            expect(activatedRows).toEqual([
                { avatar: 'alice.png', file: '2026-11-04@09h00m' },
                { avatar: 'alice.png', file: '2026-11-04@12h00m' },
            ]);
        });
    });

    it('blocks switching character card or closing detail when PersonaEditor is dirty, preserving draft on cancel and switching on confirm', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        });

        const client = {
            identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
            headers: () => ({ 'Content-Type': 'application/json' }),
            characters: vi.fn(async () => [
                {
                    avatar: 'alice.png',
                    name: 'Alice',
                    description: 'Alice 初始介绍',
                    data: {
                        description: 'Alice 初始介绍',
                        extensions: { vc_character_ref: 'ref-alice' },
                    },
                },
                {
                    avatar: 'bob.png',
                    name: 'Bob',
                    description: 'Bob 初始介绍',
                    data: {
                        description: 'Bob 初始介绍',
                        extensions: { vc_character_ref: 'ref-bob' },
                    },
                },
            ]),
            recent: vi.fn(async () => []),
            settings: vi.fn(async () => ({ settings: '{}' })),
            readChat: vi.fn(async () => []),
            post: vi.fn(async () => ({ ok: true })),
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
                    activate: async () => true,
                    reloadCharacter: vi.fn(async () => {}),
                    destroy() {},
                }) as any,
        });

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: CharactersRoute,
            },
        });

        const { container } = render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );

        await act(async () => {
            await router.navigate({ to: '/characters' });
        });

        await waitFor(() => {
            expect(container.querySelector('.vc-character-card[data-avatar="alice.png"]')).toBeTruthy();
            expect(container.querySelector('.vc-character-card[data-avatar="bob.png"]')).toBeTruthy();
        });

        // Select Alice card -> opens detail -> click "人设" -> edit description
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="alice.png"]')!);
        const personaBtn = await screen.findByRole('button', { name: '人设' });
        fireEvent.click(personaBtn);

        const descInput = (await screen.findByLabelText('介绍')) as HTMLTextAreaElement;
        expect(descInput.value).toBe('Alice 初始介绍');
        fireEvent.change(descInput, { target: { value: 'Alice 未保存的新人设草稿' } });
        expect(descInput.value).toBe('Alice 未保存的新人设草稿');

        // 1) Click Bob card in CharacterGrid while Alice PersonaEditor is dirty -> blocked by leave guard
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="bob.png"]')!);
        expect(await screen.findByText('放弃更改？')).toBeTruthy();

        // Cancel ("继续编辑") -> stays on Alice and preserves Alice's draft
        fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
        await waitFor(() => {
            expect(screen.queryByText('放弃更改？')).toBeNull();
        });
        expect((screen.getByLabelText('介绍') as HTMLTextAreaElement).value).toBe(
            'Alice 未保存的新人设草稿',
        );

        // 2) Click "关闭" in detail panel while Alice PersonaEditor is dirty -> blocked by leave guard
        fireEvent.click(screen.getByRole('button', { name: '关闭' }));
        expect(await screen.findByText('放弃更改？')).toBeTruthy();

        // Cancel ("继续编辑") -> stays on Alice and preserves Alice's draft
        fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
        await waitFor(() => {
            expect(screen.queryByText('放弃更改？')).toBeNull();
        });
        expect((screen.getByLabelText('介绍') as HTMLTextAreaElement).value).toBe(
            'Alice 未保存的新人设草稿',
        );

        // 3) Click Bob card again and confirm discard ("放弃") -> switches to Bob detail
        fireEvent.click(container.querySelector('.vc-character-card[data-avatar="bob.png"]')!);
        expect(await screen.findByText('放弃更改？')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '放弃' }));

        await waitFor(() => {
            expect(container.querySelector('.vc-character-poster h2')?.textContent).toBe('Bob');
        });
    });
});
