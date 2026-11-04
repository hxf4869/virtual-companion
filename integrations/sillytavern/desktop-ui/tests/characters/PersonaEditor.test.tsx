import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import { PersonaEditor } from '../../src/features/characters/PersonaEditor';

function createFakeEnv() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const postSpy = vi.fn(async () => ({ ok: true }));
    const reloadCharacterSpy = vi.fn(async () => {});
    const client = {
        identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
        headers: () => ({ 'Content-Type': 'application/json' }),
        post: postSpy,
        characters: vi.fn(async () => []),
        recent: vi.fn(async () => []),
        settings: vi.fn(async () => ({ settings: '{}' })),
        request: vi.fn(async () => ({})),
        go: {
            fetchRelationships: vi.fn(async () => []),
            fetchNotifications: vi.fn(async () => ({ items: [] })),
            fetchCompanionState: vi.fn(async () => ({})),
            fetchFollowUps: vi.fn(async () => []),
            fetchMemories: vi.fn(async () => ({ items: [] })),
        },
    } as unknown as AppClient;

    const bridge = createSessionBridge(client, {
        queryClient,
        prepareRuntime: async () =>
            ({
                reloadCharacter: reloadCharacterSpy,
                destroy() {},
            }) as any,
    });

    return { client, queryClient, bridge, postSpy, reloadCharacterSpy };
}

describe('PersonaEditor (B9 dirty leave guard & atomic 5-field merge save)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState(null, '', '/');
        window.location.hash = '';
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('dirty edit blocks back navigation and route change until confirmed', async () => {
        const { client, queryClient, bridge } = createFakeEnv();
        const onBack = vi.fn();

        const initialFields = {
            description: '初始介绍',
            personality: '温和真诚',
            scenario: '周末午后',
            first_mes: '嗨，好久不见',
            mes_example: '<START>\n{{user}}: 你好\n{{char}}: 嗨',
        };

        function HostRoute() {
            return (
                <PersonaEditor
                    avatar="alice.png"
                    characterRef="ref-alice"
                    characterName="Alice"
                    fields={initialFields}
                    onBack={onBack}
                />
            );
        }

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: HostRoute,
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

        const descInput = (await screen.findByLabelText('介绍')) as HTMLTextAreaElement;
        expect(descInput.value).toBe('初始介绍');

        // Edit field to make form dirty
        fireEvent.change(descInput, { target: { value: '修改后的介绍内容' } });
        expect(descInput.value).toBe('修改后的介绍内容');

        // 1) Click local back button -> blocked by AlertDialog, onBack not called
        fireEvent.click(screen.getByRole('button', { name: '返回' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(await screen.findByText('放弃更改？')).toBeTruthy();

        // Click "继续编辑" -> stays in editor and keeps draft
        fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
        await waitFor(() => {
            expect(screen.queryByText('放弃更改？')).toBeNull();
        });
        expect(onBack).not.toHaveBeenCalled();
        expect((screen.getByLabelText('介绍') as HTMLTextAreaElement).value).toBe('修改后的介绍内容');

        // 2) Attempt router navigation while dirty -> blocked by useLeaveGuard AlertDialog
        act(() => {
            void router.navigate({ to: '/memory' });
        });
        expect(await screen.findByText('放弃更改？')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/characters');

        fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
        await waitFor(() => {
            expect(screen.queryByText('放弃更改？')).toBeNull();
        });
        expect(router.state.location.pathname).toBe('/characters');

        // 3) Click local back button again and confirm discard -> calls onBack
        fireEvent.click(screen.getByRole('button', { name: '返回' }));
        expect(await screen.findByText('放弃更改？')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '放弃' }));
        await waitFor(() => {
            expect(onBack).toHaveBeenCalledTimes(1);
        });
    });

    it('saves 5 persona fields via merge-attributes, reloads character in bridge, and invalidates characters query', async () => {
        const { client, queryClient, bridge, postSpy, reloadCharacterSpy } = createFakeEnv();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const onBack = vi.fn();
        const onSaved = vi.fn();

        const initialFields = {
            description: '旧介绍',
            personality: '旧性格',
            scenario: '旧情景',
            first_mes: '旧开场',
            mes_example: '旧例句',
        };

        const router = createDesktopRouter({
            initialEntry: '/characters',
            routeOverrides: {
                characters: () => (
                    <PersonaEditor
                        avatar="alice.png"
                        characterRef="ref-alice"
                        characterName="Alice"
                        fields={initialFields}
                        onBack={onBack}
                        onSaved={onSaved}
                    />
                ),
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

        const descInput = await screen.findByLabelText('介绍');
        fireEvent.change(descInput, { target: { value: '新介绍' } });

        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(postSpy).toHaveBeenCalledWith('/api/characters/merge-attributes', {
                avatar: 'alice.png',
                description: '新介绍',
                personality: '旧性格',
                scenario: '旧情景',
                first_mes: '旧开场',
                mes_example: '旧例句',
                data: {
                    description: '新介绍',
                    personality: '旧性格',
                    scenario: '旧情景',
                    first_mes: '旧开场',
                    mes_example: '旧例句',
                },
            });
        });

        expect(reloadCharacterSpy).toHaveBeenCalledWith('alice.png');
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['characters'] });
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
});
