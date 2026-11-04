import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, createAppClient } from '../../src/data/client';
import { queryKeys } from '../../src/data/queryKeys';
import { AppProviders, queryClient, useAppClient } from '../../src/app/providers';

function setIdentityMeta(accountId: string, sessionId: string) {
    document.head.innerHTML = `
        <meta name="vc-account-id" content="${accountId}">
        <meta name="vc-session-id" content="${sessionId}">
    `;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('desktop data client & providers', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        setIdentityMeta('9007199254740993', '17');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        document.head.innerHTML = '';
    });

    it('maps 409 to ConflictError with details', async () => {
        const seenCalls: Array<{ url: string; headers: Record<string, string> }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            seenCalls.push({
                url,
                headers: (init?.headers as Record<string, string>) ?? {},
            });
            if (url === '/csrf-token') {
                return jsonResponse({ token: 'csrf-token-1' }, 200);
            }
            if (url === '/api/plugins/virtual-companion/go/api/v1/auth/session') {
                return jsonResponse({
                    accountId: '9007199254740993',
                    sessionId: '17',
                    role: 'OWNER',
                }, 200);
            }
            if (url === '/api/chats/get') {
                return jsonResponse({
                    code: 'VC_REVISION_CONFLICT',
                    message: '聊天版本冲突',
                    details: { latestRevision: 9, currentRevision: 8 },
                }, 409);
            }
            if (url === '/api/plugins/virtual-companion/go/api/v1/admin/providers/openai-main') {
                return jsonResponse({
                    code: 'REVISION_CONFLICT',
                    message: '这段配置已在另一处更新。',
                    details: { expectedRevision: 2, actualRevision: 3, serverSnapshot: { displayName: 'OpenAI' } },
                }, 409);
            }
            return jsonResponse({}, 200);
        }) as typeof fetch;

        const client = createAppClient();
        await client.initialize();
        await client.go.captureSessionContext();

        await expect(
            client.readChat({ avatar: 'synthetic.png', file: 'chat-1' }),
        ).rejects.toSatisfy((err: unknown) => {
            expect(err).toBeInstanceOf(ConflictError);
            const conflict = err as ConflictError;
            expect(conflict.status).toBe(409);
            expect(conflict.code).toBe('VC_REVISION_CONFLICT');
            expect(conflict.details).toEqual({ latestRevision: 9, currentRevision: 8 });
            return true;
        });

        await expect(
            client.go.saveProvider('openai-main', { expectedRevision: 2 }),
        ).rejects.toSatisfy((err: unknown) => {
            expect(err).toBeInstanceOf(ConflictError);
            const conflict = err as ConflictError;
            expect(conflict.status).toBe(409);
            expect(conflict.code).toBe('REVISION_CONFLICT');
            expect(conflict.details).toEqual({
                expectedRevision: 2,
                actualRevision: 3,
                serverSnapshot: { displayName: 'OpenAI' },
            });
            return true;
        });

        const goWriteCall = seenCalls.find((c) => c.url.endsWith('/providers/openai-main'));
        expect(goWriteCall?.headers['X-VC-Expected-Account-ID']).toBe('9007199254740993');
        expect(goWriteCall?.headers['X-VC-Expected-Session-ID']).toBe('17');
        expect(goWriteCall?.headers['X-CSRF-Token']).toBe('csrf-token-1');
    });

    it('preserves distinct 409 details across interleaved settings-document saves', async () => {
        let releasePresetBody!: () => void;
        const presetBodyGate = new Promise<void>((resolve) => {
            releasePresetBody = resolve;
        });

        function createDelayed409Response(payload: unknown, waitBeforeJson?: Promise<void>): Response {
            const makeResp = (): Response =>
                ({
                    ok: false,
                    status: 409,
                    clone: () => makeResp(),
                    json: async () => {
                        if (waitBeforeJson) {
                            await waitBeforeJson;
                        }
                        return payload;
                    },
                }) as unknown as Response;
            return makeResp();
        }

        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === '/csrf-token') {
                return jsonResponse({ token: 'csrf-token-1' }, 200);
            }
            if (url === '/api/presets/save') {
                // 请求 A 先拿到 409 Response，但解析其错误体要等请求 B 的 409 已经返回之后才完成
                return createDelayed409Response(
                    {
                        code: 'VC_PRESET_CONFLICT',
                        details: { document: 'preset-a', serverTemp: 0.4 },
                    },
                    presetBodyGate,
                );
            }
            if (url === '/api/worldinfo/edit') {
                // 请求 B 后到达，立即返回其 409 详情，随后放行请求 A 的 body 解析
                queueMicrotask(() => releasePresetBody());
                return createDelayed409Response({
                    code: 'VC_WORLDBOOK_CONFLICT',
                    details: { document: 'world-b', serverEntries: 5 },
                });
            }
            return jsonResponse({}, 200);
        }) as typeof fetch;

        const client = createAppClient();
        await client.initialize();
        client.documents.capturePreset('openai', 'preset-a', { temp_openai: 0.7 });
        client.documents.captureWorldbook('world-b', { entries: {} });

        const saveA = client.savePreset('openai', 'preset-a', { temp_openai: 0.9 });
        const saveB = client.saveWorldbook('world-b', { entries: { '1': { content: 'lore' } } });

        await expect(saveA).rejects.toSatisfy((err: unknown) => {
            expect(err).toBeInstanceOf(ConflictError);
            const conflict = err as ConflictError;
            expect(conflict.status).toBe(409);
            expect(conflict.code).toBe('VC_PRESET_CONFLICT');
            expect(conflict.details).toEqual({ document: 'preset-a', serverTemp: 0.4 });
            return true;
        });

        await expect(saveB).rejects.toSatisfy((err: unknown) => {
            expect(err).toBeInstanceOf(ConflictError);
            const conflict = err as ConflictError;
            expect(conflict.status).toBe(409);
            expect(conflict.code).toBe('VC_WORLDBOOK_CONFLICT');
            expect(conflict.details).toEqual({ document: 'world-b', serverEntries: 5 });
            return true;
        });
    });

    it('drops response of superseded identity', async () => {
        let resolveInflightSt!: (res: Response) => void;
        let resolveInflightGo!: (res: Response) => void;

        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === '/csrf-token') {
                return jsonResponse({ token: 'csrf-token-1' }, 200);
            }
            if (url === '/api/plugins/virtual-companion/go/api/v1/auth/session') {
                return jsonResponse({
                    accountId: '9007199254740993',
                    sessionId: '17',
                }, 200);
            }
            if (url === '/api/characters/all') {
                return new Promise<Response>((resolve) => {
                    resolveInflightSt = resolve;
                });
            }
            if (url === '/api/plugins/virtual-companion/go/api/v1/admin/providers') {
                return new Promise<Response>((resolve) => {
                    resolveInflightGo = resolve;
                });
            }
            return jsonResponse([{ ok: true }], 200);
        }) as typeof fetch;

        const client = createAppClient();
        await client.initialize();
        await client.go.captureSessionContext();

        const pendingSt = client.characters();
        const pendingGo = client.go.fetchProviders();

        // 在途请求尚未返回时，页面身份 meta 发生切换（如账号或会话已被新身份替代）
        setIdentityMeta('9007199254740995', '18');

        resolveInflightSt(jsonResponse([{ name: 'StaleCharacter' }], 200));
        resolveInflightGo(jsonResponse([{ providerId: 'stale-provider' }], 200));

        await expect(pendingSt).rejects.toMatchObject({
            status: 409,
            code: 'ACCOUNT_CONTEXT_CHANGED',
        });
        await expect(pendingGo).rejects.toMatchObject({
            status: 409,
            code: 'ACCOUNT_CONTEXT_CHANGED',
        });

        // 身份过期后，后续新发起的 ST 与 Go 请求同样被拒绝
        await expect(client.recent()).rejects.toMatchObject({
            status: 409,
            code: 'ACCOUNT_CONTEXT_CHANGED',
        });
        await expect(client.go.fetchModelPurposes()).rejects.toMatchObject({
            status: 409,
            code: 'ACCOUNT_CONTEXT_CHANGED',
        });
    });

    it('configures QueryClient defaults, AppProviders, and queryKeys', () => {
        const defaults = queryClient.getDefaultOptions().queries;
        expect(defaults?.retry).toBe(1);
        expect(defaults?.staleTime).toBe(30_000);
        expect(defaults?.refetchOnWindowFocus).toBe(false);

        expect(queryKeys.relationships).toEqual(['relationships']);
        expect(queryKeys.characters).toEqual(['characters']);
        expect(queryKeys.recentChats).toEqual(['recentChats']);
        expect(queryKeys.memory('rel-1', { status: 'ACTIVE' })).toEqual(['memory', 'rel-1', { status: 'ACTIVE' }]);
        expect(queryKeys.inbox('unread')).toEqual(['inbox', 'unread']);
        expect(queryKeys.providers).toEqual(['providers']);
        expect(queryKeys.purposes).toEqual(['purposes']);
        expect(queryKeys.settingsDoc).toEqual(['settingsDoc']);
        expect(queryKeys.voiceSettings).toEqual(['voiceSettings']);
        expect(queryKeys.storyRuns).toEqual(['storyRuns']);

        function Probe() {
            const qc = useQueryClient();
            const c1 = useAppClient();
            const c2 = useAppClient();
            return createElement('span', { 'data-testid': 'qc-probe' }, String(qc === queryClient && c1 === c2));
        }

        render(createElement(AppProviders, null, createElement(Probe)));
        expect(screen.getByTestId('qc-probe').textContent).toBe('true');

        function OrphanProbe() {
            useAppClient();
            return null;
        }
        expect(() => render(createElement(OrphanProbe))).toThrow(/useAppClient must be used within AppProviders/);
    });
});
