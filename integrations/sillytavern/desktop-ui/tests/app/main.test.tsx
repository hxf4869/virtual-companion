import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/app/main';
import { MobileApp } from '../../src/mobile/app/MobileApp';
import { MobileBootstrapApp } from '../../src/mobile/app/main';
import { useSessionBridge } from '../../src/runtime/session-bridge';
import {
    captureSessionContext,
    setStHeadersProvider,
} from '../../../extension/vc-model-settings/api.js';
import {
    openaiDefaults,
    powerUserDefaults,
} from '../../../extension/vc-model-settings/desktop/standalone/engine/defaults.js';
import * as stLib from '../../../extension/vc-model-settings/desktop/locked-source/st/lib.js';
import type { AppClient } from '../../src/data/client';

describe('desktop and mobile app entries', () => {
    beforeEach(() => {
        delete document.documentElement.dataset.vcApp;
        delete document.documentElement.dataset.vcDevice;
        delete document.documentElement.dataset.vcRuntime;
    });

    it('renders startup status then app root', () => {
        render(<App />);
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('正在打开聊天…');
        expect(document.documentElement.dataset.vcApp).toBe('booting');
    });

    it('mounts mobile entry with shared AppProviders without eagerly preparing chat runtime, and prepares runtime on conversation open', async () => {
        const baseOai = {
            ...structuredClone(openaiDefaults),
            preset_settings_openai: 'Default',
        };
        const settingsSpy = vi.fn(async () => ({
            settings: JSON.stringify({
                username: '你',
                user_avatar: 'user.png',
                world_info: { globalSelect: [] },
                power_user: {
                    ...structuredClone(powerUserDefaults),
                    send_on_enter: 1,
                },
                oai_settings: baseOai,
                extension_settings: {
                    disabledExtensions: [],
                    variables: { global: {} },
                    regex: [],
                    tavern_helper: {
                        script: {
                            enabled: { global: true, presets: [], characters: [] },
                            scripts: [],
                        },
                    },
                },
            }),
            openai_setting_names: ['Default'],
            openai_settings: [JSON.stringify(baseOai)],
            world_names: [],
        }));
        const charactersSpy = vi.fn(async () => [
            {
                avatar: 'alice.png',
                name: 'Alice',
                data: { extensions: { vc_character_ref: 'ref-alice' } },
            },
        ]);
        const readChatSpy = vi.fn(async () => [
            {
                user_name: '你',
                character_name: 'Alice',
                chat_metadata: {
                    vc_f2: { id: 'f2-1', revision: 1 },
                    vc_binding: {
                        relationshipId: 'rel-alice',
                        conversationId: 'conv-alice',
                        mode: 'COMPANION',
                    },
                },
            },
            {
                name: 'Alice',
                mes: '你好，我在手机端等你。',
                is_user: false,
                is_system: false,
                send_date: '2026-11-06T10:00:00.000Z',
            },
        ]);

        const client = {
            identity: { accountId: '1', sessionId: '1' },
            initialize: vi.fn(async () => {}),
            headers: () => ({}),
            settings: settingsSpy,
            characters: charactersSpy,
            readChat: readChatSpy,
            recent: vi.fn(async () => []),
            raw: vi.fn(async (_url: string, serialized?: string) => {
                const body = serialized ? JSON.parse(serialized) : null;
                const prevF2 = body?.chat?.[0]?.chat_metadata?.vc_f2 || { id: 'f2-1', revision: 1 };
                return new Response(
                    JSON.stringify({
                        vc_f2: {
                            ...prevF2,
                            revision: (prevF2.revision || 1) + 1,
                        },
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    },
                );
            }),
            request: vi.fn(async (url: string) => {
                if (url === '/api/avatars/get') return ['user.png'];
                if (url === '/api/characters/get') {
                    return {
                        avatar: 'alice.png',
                        name: 'Alice',
                        data: { extensions: { vc_character_ref: 'ref-alice' } },
                    };
                }
                return { token_count: 5, entries: {} };
            }),
            post: vi.fn(async () => ({ ok: true })),
            settingsChanged: vi.fn(() => false),
            saveSettings: vi.fn(async () => new Response('{}', { status: 200 })),
            documents: {
                captureSettings: vi.fn(),
                seedPresets: vi.fn(),
                projectSettings: vi.fn(),
                captureWorldbook: vi.fn(),
            },
            go: {
                captureSessionContext: vi.fn(() => ({ accountId: '1', sessionId: '1' })),
            },
        } as unknown as AppClient;

        let capturedBridge: ReturnType<typeof useSessionBridge> | null = null;
        function Probe() {
            capturedBridge = useSessionBridge();
            return <span data-testid="mobile-probe">{capturedBridge.getSnapshot().runtime}</span>;
        }

        const { unmount } = render(
            <MobileApp client={client}>
                <Probe />
            </MobileApp>,
        );

        expect(screen.getByTestId('mobile-probe').textContent).toBe('idle');
        expect(capturedBridge).toBeTruthy();
        expect(capturedBridge!.getSnapshot().runtime).toBe('idle');
        expect(settingsSpy).not.toHaveBeenCalled();
        expect(charactersSpy).not.toHaveBeenCalled();
        expect(document.documentElement.dataset.vcRuntime).toBeUndefined();

        const prevFetch = globalThis.fetch;
        const prevJQuery = (globalThis as any).jQuery;
        const prevDollar = (globalThis as any).$;
        const prevToastr = (globalThis as any).toastr;
        const jQueryStub = Object.assign(
            () => ({ triggerHandler: async () => {}, on: () => jQueryStub, off: () => jQueryStub }),
            { ui: {} },
        );
        Object.assign(globalThis, {
            _: (stLib as any).lodash,
            lodash: (stLib as any).lodash,
            DOMPurify: (stLib as any).DOMPurify,
            showdown: (stLib as any).showdown,
            hljs: (stLib as any).hljs,
            Handlebars: (stLib as any).Handlebars,
            moment: (stLib as any).moment,
            jQuery: jQueryStub,
            $: jQueryStub,
            toastr: { info() {}, warning() {}, error() {}, success() {}, clear() {} },
        });
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/model-purposes')) {
                return new Response(JSON.stringify([]), {
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
            if (url.endsWith('/version')) {
                return new Response(JSON.stringify({ pkgVersion: '1.14.0' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/api/v1/auth/session')) {
                return new Response(JSON.stringify({ accountId: '1', sessionId: '1' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('/api/v1/')) {
                return new Response(
                    JSON.stringify({
                        id: 'conv-alice',
                        relationshipId: 'rel-alice',
                        conversationId: 'conv-alice',
                        mode: 'COMPANION',
                        items: [],
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    },
                );
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        try {
            setStHeadersProvider(() => ({}), {
                identity: { accountId: '1', sessionId: '1' },
            });
            await captureSessionContext();
            const key = '["alice.png","chat-1"]';
            const [res1, res2] = await Promise.all([
                capturedBridge!.open(key),
                capturedBridge!.open(key),
            ]);
            expect(res1).toBe('opened');
            expect(res2).toBe('opened');
            expect(settingsSpy).toHaveBeenCalledTimes(2); // bridge + prepareChatRuntime share client.settings()
            expect(capturedBridge!.getSnapshot().runtime).toBe('prepared');
            expect(capturedBridge!.getSnapshot().status).toBe('ready');
            expect(capturedBridge!.getSnapshot().messages).toHaveLength(1);
            expect(document.documentElement.dataset.vcRuntime).toBe('prepared');
        } finally {
            unmount();
            globalThis.fetch = prevFetch;
            (globalThis as any).jQuery = prevJQuery;
            (globalThis as any).$ = prevDollar;
            (globalThis as any).toastr = prevToastr;
        }
    });

    it('bootstraps MobileBootstrapApp and marks data-vc-device="mobile" and data-vc-app="ready"', async () => {
        const client = {
            initialize: vi.fn(async () => {}),
            go: {
                captureSessionContext: vi.fn(() => ({ accountId: '1', sessionId: '1' })),
            },
        } as unknown as AppClient;

        const { container } = render(<MobileBootstrapApp client={client} />);
        await waitFor(() => {
            expect(document.documentElement.dataset.vcApp).toBe('ready');
        });
        expect(document.documentElement.dataset.vcDevice).toBe('mobile');
        expect(container.querySelector('[data-vc-mobile-app]')).toBeTruthy();
    });
});
