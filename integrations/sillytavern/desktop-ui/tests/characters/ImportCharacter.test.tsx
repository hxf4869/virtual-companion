import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../src/app/providers';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import { ImportCharacter } from '../../src/features/characters/ImportCharacter';
import {
    IMPORT_FAILED_COPY,
    DEFAULT_GLOBAL_RULES,
    STYLE_NOTE,
    buildCharacterCard,
    inspectCharacterFile,
    moodGuidance,
    pngHasChara,
    readGlobalRules,
    sanitizeInstanceName,
} from '../../../extension/vc-model-settings/instance-logic.js';

function createImportEnv() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const reloadCharacterSpy = vi.fn(async () => {});
    const postSpy = vi.fn(async () => ({ ok: true }));
    const charactersSpy = vi.fn(async () => [
        {
            avatar: 'imported.png',
            name: '星野',
            description: '新导入角色',
            data: { extensions: { vc_character_ref: 'ref-imported' } },
        },
    ]);

    const client = {
        identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
        headers: () => ({ 'X-CSRF-Token': 'test-token' }),
        post: postSpy,
        characters: charactersSpy,
        recent: vi.fn(async () => []),
        settings: vi.fn(async () => ({ settings: '{}' })),
        request: vi.fn(async () => ({})),
        go: {
            fetchRelationships: vi.fn(async () => []),
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

    return { client, queryClient, bridge, reloadCharacterSpy, postSpy, charactersSpy };
}

describe('ImportCharacter (PNG chara chunk inspection & import reload)', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('rejects png without chara chunk with IMPORT_FAILED_COPY and does not upload', async () => {
        const { client, queryClient, bridge, reloadCharacterSpy } = createImportEnv();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <ImportCharacter />
            </AppProviders>,
        );

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(input).toBeTruthy();

        // PNG signature + IEND chunk without tEXt/zTXt/iTXt chara chunk
        const pngWithoutChara = new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10,
            0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]);
        const invalidFile = new File([pngWithoutChara], 'no-chara.png', { type: 'image/png' });

        fireEvent.change(input, { target: { files: [invalidFile] } });

        const alertEl = await screen.findByRole('alert');
        expect(alertEl.textContent).toContain(IMPORT_FAILED_COPY);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(reloadCharacterSpy).not.toHaveBeenCalled();
    });

    it('imports valid JSON character file, calls bridge.reloadCharacter, and invalidates character queries', async () => {
        const { client, queryClient, bridge, reloadCharacterSpy } = createImportEnv();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const onImported = vi.fn();

        const fetchSpy = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ file_name: 'imported' }),
        }));
        vi.stubGlobal('fetch', fetchSpy);

        render(
            <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
                <ImportCharacter onImported={onImported} />
            </AppProviders>,
        );

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const jsonBytes = new TextEncoder().encode(
            JSON.stringify({
                spec: 'chara_card_v2',
                spec_version: '2.0',
                name: '星野',
                data: { name: '星野', description: '新导入角色' },
            }),
        );
        const validFile = new File([jsonBytes], 'hoshino.json', { type: 'application/json' });

        fireEvent.change(input, { target: { files: [validFile] } });

        await waitFor(() => {
            expect(reloadCharacterSpy).toHaveBeenCalledWith('imported.png');
        });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['characters'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['relationships'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recentChats'] });
        expect(onImported).toHaveBeenCalledWith(
            expect.objectContaining({
                avatar: 'imported.png',
                characterRef: 'ref-imported',
                name: '星野',
            }),
        );
    });

    it('instance-logic.js preserves T5 prompt exports and pure character/instance algorithms', () => {
        expect(STYLE_NOTE).toContain('语气参考');
        expect(readGlobalRules({})).toBe(DEFAULT_GLOBAL_RULES);
        expect(moodGuidance({ vibe: '轻松', line: '刚喝完咖啡' })).toContain('轻松——刚喝完咖啡');

        const pngWithoutChara = new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10,
            0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]);
        expect(pngHasChara(pngWithoutChara)).toBe(false);
        expect(inspectCharacterFile(pngWithoutChara, 'card.png')).toEqual({
            ok: false,
            format: 'png',
        });

        expect(sanitizeInstanceName('  林小夏  ')).toEqual({ ok: true, value: '林小夏' });
        expect(sanitizeInstanceName('')).toEqual({ ok: false, reason: '先填写实例名称。' });
        expect(sanitizeInstanceName('a'.repeat(33))).toEqual({
            ok: false,
            reason: '实例名称最多 32 个字。',
        });

        const built = buildCharacterCard({
            name: '林小夏',
            relation: '好朋友',
            gender: '女生',
            styles: ['口语短句，偶尔表情'],
        });
        expect(built.spec).toBe('chara_card_v2');
        expect(built.data.extensions.vc_persona).toEqual({
            relation: '好朋友',
            gender: '女生',
            styles: ['口语短句，偶尔表情'],
        });
    });
});
