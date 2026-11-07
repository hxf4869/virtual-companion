import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { createSessionBridge, type SessionBridge } from '../../src/runtime/session-bridge';
import { createTestChatEnv } from './fixtures';

const rowA = { avatar: 'alice.png', file: '18d16c96-107f-42db-9b60-12973b02baf8', title: 'Alice' };
const rowB = { avatar: 'bob.png', file: 'a04d984a-27c4-4be8-a9e4-85f888fd4766', title: 'Bob' };
const keyOf = ({ avatar, file }: typeof rowA) => JSON.stringify([avatar, file]);

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function storedChat(row: typeof rowA, count: number) {
    return {
        chat: {
            chatId: row.file,
            header: {},
            metadata: {},
            chatRevision: '1',
            branchRoot: row.file,
            characterRef: row.avatar,
            relationshipId: '1',
            conversationId: '2',
            messageCount: count,
        },
        messages: Array.from({ length: count }, (_, index) => ({
            messageId: `message-${index}`,
            data: { name: row.title, mes: `${row.title} message ${index}` },
        })),
    };
}

function storedChatPort(row: typeof rowA, count: number) {
    const history = storedChat(row, count);
    const gate = deferred<typeof history>();
    return {
        history,
        gate,
        readDisplay: vi.fn(async ({ limit }: { limit: number; signal: AbortSignal }) => ({
            ...history,
            messages: history.messages.slice(-limit),
        })),
        loadFull: vi.fn(({ signal: _signal }: { signal: AbortSignal }) => gate.promise),
        close: vi.fn(),
    };
}

const bridges = new Set<SessionBridge>();

function goBridge(a = storedChatPort(rowA, 92), b = storedChatPort(rowB, 1)) {
    const env = createTestChatEnv({ conversations: [rowA, rowB] });
    bridges.add(env.bridge);
    let mode = 'GO';
    const client = Object.assign(env.client, {
        getChatStorage: () => {
            if (!mode) throw new Error('temporarily unavailable');
            return { mode, authorityEpoch: '7' };
        },
        createChatStore: vi.fn(({ file }: { file: string }) => file === rowA.file ? a : b),
    });
    const edit = vi.fn(() => true);
    const send = vi.fn(() => true);
    const renderMessage = vi.fn((host: HTMLElement, _index: number, message: { mes: string }) => {
        const child = host.querySelector('.mes_text') ?? document.createElement('div');
        child.className = 'mes_text';
        child.textContent = message.mes;
        if (!child.parentNode) host.append(child);
        return () => child.remove();
    });
    const mountCardActions = vi.fn((host: HTMLElement) => {
        const button = document.createElement('button');
        button.textContent = 'Synthetic card action';
        host.append(button);
        return () => button.remove();
    });
    const activate = vi.fn();
    const prepareRuntime = vi.fn(async ({ context, onChange }: any) => ({
        async activate(row: typeof rowA, records: any[], options: { signal: AbortSignal }) {
            context.chat = records.slice(1);
            context.chatId = row.file;
            context.chatMetadata = records[0].chat_metadata;
            onChange({ key: keyOf(row), messages: context.chat, canSend: true });
            await activate(row, records, options);
        },
        edit, send, renderMessage, mountCardActions,
    }));
    const bridge = createSessionBridge(client as any, {
        eagerRuntime: true,
        prepareRuntime: prepareRuntime as any,
    });
    bridges.add(bridge);
    return { ...env, client, bridge, a, b, prepareRuntime, activate, edit, send, renderMessage,
        mountCardActions, setMode: (value: string) => { mode = value; } };
}

afterEach(() => {
    cleanup();
    for (const bridge of bridges) bridge.destroy();
    bridges.clear();
    document.querySelectorAll('[data-test-leaf]').forEach(node => node.remove());
    window.localStorage.clear();
});

describe('SX6 Go history display and script barrier', () => {
    it('paints the tail without runtime, then retains the 80 leaves and exposes earlier full history', async () => {
        const env = goBridge();
        const activation = deferred<void>();
        env.activate.mockImplementation(() => activation.promise);
        const router = createDesktopRouter('/chat');
        const view = render(
            <AppProviders client={env.client as any} queryClient={env.queryClient} sessionBridge={env.bridge}>
                <RouterProvider router={router} />
            </AppProviders>,
        );
        await act(async () => { await router.load(); });

        let opening!: Promise<string>;
        await act(async () => { opening = env.bridge.open(rowA); });
        await waitFor(() => expect(view.container.querySelectorAll('#chat > .mes')).toHaveLength(80));
        const firstLeaf = screen.getByText('Alice message 12').closest('.vc-desktop-message-content');
        const tailKeys = env.bridge.getSnapshot().messages.map(message => message.key);
        expect(env.a.readDisplay).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), limit: 80 });
        expect(env.client.readChat).not.toHaveBeenCalled();
        expect(env.client.settings).not.toHaveBeenCalled();
        expect(env.prepareRuntime).not.toHaveBeenCalled();
        expect(env.mountCardActions).not.toHaveBeenCalled();
        expect(env.bridge.getContext().chat).toEqual([]);
        expect(env.bridge.getContext().firstDisplayedMessageId).toBeNull();
        expect(env.bridge.getSnapshot()).toMatchObject({ status: 'loading', canSend: false });
        expect(await env.bridge.send('draft text')).toBe(false);

        await act(async () => { env.a.gate.resolve(env.a.history); });
        await waitFor(() => expect(env.activate).toHaveBeenCalledTimes(1));
        expect(env.activate).toHaveBeenCalledWith({ avatar: rowA.avatar, file: rowA.file },
            expect.any(Array), expect.objectContaining({ chatStore: env.a }));
        expect(env.bridge.getContext().chat).toHaveLength(92);
        expect(env.bridge.getContext().firstDisplayedMessageId).toBe(12);
        expect(env.bridge.getSnapshot()).toMatchObject({ status: 'loading', canSend: false });
        expect(env.mountCardActions).not.toHaveBeenCalled();
        expect(await env.bridge.edit(0, 'edit before activation')).toBe(false);

        await act(async () => { activation.resolve(); expect(await opening).toBe('opened'); });
        expect(env.bridge.getSnapshot()).toMatchObject({ status: 'ready', canSend: true });
        expect(env.bridge.getSnapshot().messages.slice(-80).map(message => message.key)).toEqual(tailKeys);
        expect(screen.getByText('Alice message 12').closest('.vc-desktop-message-content')).toBe(firstLeaf);
        expect(screen.getByRole('button', { name: 'Synthetic card action' })).toBeTruthy();
        await env.bridge.edit(12, 'edit after activation');
        expect(env.edit).toHaveBeenCalledWith(12, 'edit after activation', expect.objectContaining({ vc_message_id: 'message-12' }));
        fireEvent.click(screen.getByRole('button', { name: '显示更早的消息', exact: true }));
        await waitFor(() => expect(view.container.querySelectorAll('#chat > .mes')).toHaveLength(92));
        expect(env.bridge.getContext().firstDisplayedMessageId).toBe(0);
    });

    it('detaches the caller after display and fences an old full result and leaf when switching', async () => {
        const env = goBridge();
        const caller = new AbortController();
        const openingA = env.bridge.open(rowA, { signal: caller.signal });
        await waitFor(() => expect(env.a.loadFull).toHaveBeenCalledOnce());
        const activeSignal = env.a.loadFull.mock.calls[0][0].signal;
        caller.abort();
        expect(activeSignal.aborted).toBe(false);
        const oldLeaf = document.createElement('div');
        oldLeaf.dataset.testLeaf = '';
        document.body.append(oldLeaf);
        const dispose = env.bridge.mountLeaf(0, oldLeaf);
        expect(oldLeaf.textContent).toBe('Alice message 12');

        const openingB = env.bridge.open(rowB);
        expect(activeSignal.aborted).toBe(true);
        await waitFor(() => expect(env.b.loadFull).toHaveBeenCalledOnce());
        const newLeaf = document.createElement('div');
        newLeaf.dataset.testLeaf = '';
        document.body.append(newLeaf);
        env.bridge.mountLeaf(0, newLeaf);
        expect(newLeaf.textContent).toBe('Bob message 0');
        expect(oldLeaf.textContent).toBe('');
        expect(await env.bridge.edit(0, 'stale edit')).toBe(false);
        expect(env.edit).not.toHaveBeenCalled();

        env.b.gate.resolve(env.b.history);
        expect(await openingB).toBe('opened');
        env.a.gate.resolve(env.a.history);
        expect(await openingA).toBe('superseded');
        expect(env.activate).toHaveBeenCalledTimes(1);
        expect(env.a.close).toHaveBeenCalledTimes(1);
        expect(env.bridge.getSnapshot().key).toBe(keyOf(rowB));
        expect(env.bridge.getContext().chat[0].mes).toBe('Bob message 0');
        expect(oldLeaf.textContent).toBe('');
        dispose();
        expect(newLeaf.textContent).toBe('Bob message 0');
    });

    it.each([500, 404, 401])('keeps the tail only for recoverable full read failure %s', async status => {
        const env = goBridge();
        const pending = env.bridge.open(rowA);
        await waitFor(() => expect(env.a.loadFull).toHaveBeenCalledOnce());
        env.a.gate.reject(Object.assign(new Error('synthetic read failure'), { status }));
        expect(await pending).toBe('failed');
        expect(env.bridge.getSnapshot()).toMatchObject({ status: 'error', canSend: false });
        expect(env.bridge.getSnapshot().messages).toHaveLength(status === 500 ? 80 : 0);
        expect(env.bridge.getContext().chat).toEqual([]);
        expect(env.prepareRuntime).not.toHaveBeenCalled();
    });

    it('keeps the rejected write snapshot when a ready session changes to FROZEN', async () => {
        const env = goBridge();
        env.a.gate.resolve(env.a.history);
        expect(await env.bridge.open(rowA)).toBe('opened');
        env.bridge.draft.write(keyOf(rowA), 'draft retained');
        env.setMode('FROZEN');
        const { onConflict } = env.prepareRuntime.mock.calls[0][0];
        const rejected = JSON.stringify({ chat: [{ mes: 'Unacknowledged synthetic reply' }] });
        onConflict(rejected, { code: 'CHAT_AUTHORITY_CHANGED', status: 409 });

        expect(env.bridge.getSnapshot()).toMatchObject({
            status: 'error',
            canSend: false,
            notice: '正在迁移',
            conflict: true,
            conflictSnapshot: { raw: rejected, input: 'draft retained', code: 'CHAT_AUTHORITY_CHANGED' },
        });
        expect(env.bridge.getContext().chat).toEqual([]);
        expect(await env.bridge.send('draft retained')).toBe(false);
        expect(await env.bridge.edit(0, 'unacknowledged edit')).toBe(false);
        expect(env.bridge.draft.read()).toBe('draft retained');
        expect(env.a.readDisplay).toHaveBeenCalledTimes(1);
        expect(env.a.loadFull).toHaveBeenCalledTimes(1);
        expect(env.send).not.toHaveBeenCalled();
        expect(env.edit).not.toHaveBeenCalled();
    });

    it('keeps drafts in FROZEN and on unknown authority without reaching either chat transport', async () => {
        const env = goBridge();
        env.setMode('FROZEN');
        env.bridge.draft.write(keyOf(rowA), 'draft retained');
        expect(await env.bridge.open(rowA)).toBe('opened');
        expect(env.bridge.getSnapshot()).toMatchObject({ canSend: false, notice: '正在迁移' });
        expect(await env.bridge.send('draft retained')).toBe(false);
        expect(env.bridge.draft.read()).toBe('draft retained');
        env.setMode('');
        expect(await env.bridge.open(rowA)).toBe('failed');
        expect(env.bridge.getSnapshot().error).toBe('暂时不可用，请稍后重试。');
        expect(env.bridge.draft.read()).toBe('draft retained');
        expect(env.client.createChatStore).not.toHaveBeenCalled();
        expect(env.client.readChat).not.toHaveBeenCalled();
        expect(env.prepareRuntime).not.toHaveBeenCalled();
    });
});
