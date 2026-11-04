import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { usePreferences } from '../../src/shell/usePreferences';
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

describe('MessageLeaf stability & B12 regressions', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setupMatchMedia(1440);
        usePreferences.getState().resetForTest?.();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('B12: deleting an earlier message keeps later message DOM node and iframe contentWindow without remounting, rebinds iframe id to TH-message--0, and saves payload without vc_message_id', async () => {
        const key = '["alice.png","chat-1"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key,
                    avatar: 'alice.png',
                    file: 'chat-1',
                    title: 'Alice',
                    preview: 'Card Frame',
                    updatedAt: 1000,
                    relationshipId: 'rel-1',
                    mode: 'COMPANION',
                },
            ],
            chatsByKey: {
                [key]: [
                    { name: 'User', mes: 'First message', is_user: true, is_system: false },
                    {
                        name: 'Alice',
                        mes: '<pre><html><body>Card Frame</body></html></pre>',
                        is_user: false,
                        is_system: false,
                    },
                ],
            },
            mountWithIframe: true,
        });

        await act(async () => {
            const openRes = await env.bridge.open(key);
            expect(openRes).toBe('opened');
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

        await waitFor(() => {
            expect(container.querySelectorAll('#chat > .mes').length).toBe(2);
        });

        const mesNodesBefore = container.querySelectorAll('#chat > .mes');
        const secondMesBefore = mesNodesBefore[1] as HTMLElement;
        expect(secondMesBefore.getAttribute('mesid')).toBe('1');

        const hostBefore = secondMesBefore.querySelector(
            '.vc-desktop-message-content',
        ) as HTMLElement;
        const leafBefore = secondMesBefore.querySelector('.mes_text') as HTMLElement;
        const iframeBefore = secondMesBefore.querySelector('iframe') as HTMLIFrameElement;
        expect(hostBefore).toBeTruthy();
        expect(leafBefore).toBeTruthy();
        expect(iframeBefore).toBeTruthy();
        expect(iframeBefore.id).toBe('TH-message--1');
        const contentWindowBefore = iframeBefore.contentWindow;
        expect(env.mountCountForHost(hostBefore)).toBe(1);

        await act(async () => {
            const removed = await env.bridge.remove(0);
            expect(removed).toBe(true);
        });

        const mesNodesAfter = container.querySelectorAll('#chat > .mes');
        expect(mesNodesAfter.length).toBe(1);
        const remainingMes = mesNodesAfter[0] as HTMLElement;
        expect(remainingMes.getAttribute('mesid')).toBe('0');

        const hostAfter = remainingMes.querySelector(
            '.vc-desktop-message-content',
        ) as HTMLElement;
        const leafAfter = remainingMes.querySelector('.mes_text') as HTMLElement;
        const iframeAfter = remainingMes.querySelector('iframe') as HTMLIFrameElement;
        expect(remainingMes).toBe(secondMesBefore);
        expect(hostAfter).toBe(hostBefore);
        expect(leafAfter).toBe(leafBefore);
        expect(iframeAfter).toBe(iframeBefore);
        expect(iframeAfter.id).toBe('TH-message--0');
        expect(iframeAfter.contentWindow).toBe(contentWindowBefore);
        expect(env.mountCountForHost(hostAfter)).toBe(1);
        expect(env.renderCountForHost(hostAfter)).toBeGreaterThanOrEqual(2);

        // Verify saved JSONL payload does not persist UI-only vc_message_id field
        expect(env.savedPayloads.length).toBeGreaterThanOrEqual(1);
        const lastSaved = env.savedPayloads.at(-1);
        for (const record of lastSaved.chat.slice(1)) {
            expect('vc_message_id' in record).toBe(false);
        }
    });

    it('B12: theme toggle, sidebar collapse, and route roundtrip (/chat -> /settings/account -> /chat) do not remount MessageLeaf or lose draft', async () => {
        const key = '["alice.png","chat-1"]';
        const env = createTestChatEnv({
            conversations: [
                {
                    key,
                    avatar: 'alice.png',
                    file: 'chat-1',
                    title: 'Alice',
                    preview: 'Hello there',
                    updatedAt: 1000,
                    relationshipId: 'rel-1',
                    mode: 'COMPANION',
                },
            ],
            chatsByKey: {
                [key]: [
                    { name: 'Alice', mes: 'Hello there', is_user: false, is_system: false },
                ],
            },
            mountWithIframe: true,
        });

        await act(async () => {
            const openRes = await env.bridge.open(key);
            expect(openRes).toBe('opened');
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

        await waitFor(() => {
            expect(container.querySelector('#chat > .mes .mes_text')).toBeTruthy();
        });

        const hostBefore = container.querySelector(
            '#chat > .mes .vc-desktop-message-content',
        ) as HTMLElement;
        const leafBefore = container.querySelector('#chat > .mes .mes_text') as HTMLElement;
        const iframeBefore = container.querySelector('#chat > .mes iframe') as HTMLIFrameElement;
        expect(hostBefore).toBeTruthy();
        expect(leafBefore).toBeTruthy();
        expect(iframeBefore).toBeTruthy();
        expect(env.mountCountForHost(hostBefore)).toBe(1);

        const textarea = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        fireEvent.change(textarea, { target: { value: 'Unsent draft across route' } });
        expect(textarea.value).toBe('Unsent draft across route');
        expect(env.bridge.draft.read(key)).toBe('Unsent draft across route');

        // Toggle theme and sidebar collapse
        act(() => {
            usePreferences.getState().setThemeMode('dark');
            usePreferences.getState().setSidebarCollapsed(true);
        });
        expect(container.querySelector('#chat > .mes .mes_text')).toBe(leafBefore);
        expect(env.mountCountForHost(hostBefore)).toBe(1);

        // Navigate away to /settings/account and back to /chat
        await act(async () => {
            await router.navigate({ to: '/settings/$category', params: { category: 'account' } });
        });
        expect(env.mountCountForHost(hostBefore)).toBe(1);

        await act(async () => {
            await router.navigate({ to: '/chat' });
        });
        const leafAfter = container.querySelector('#chat > .mes .mes_text') as HTMLElement;
        const iframeAfter = container.querySelector('#chat > .mes iframe') as HTMLIFrameElement;
        expect(leafAfter).toBe(leafBefore);
        expect(iframeAfter).toBe(iframeBefore);
        expect(env.mountCountForHost(hostBefore)).toBe(1);

        const textareaAfter = container.querySelector('#send_textarea') as HTMLTextAreaElement;
        expect(textareaAfter.value).toBe('Unsent draft across route');
    });
});
