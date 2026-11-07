import React, { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { storedChatRecords } from '../../../extension/vc-model-settings/desktop/standalone/chat-store.js';
import { resolveDesktopConversation } from '../../../extension/vc-model-settings/desktop/standalone/business.js';
import { EventEmitter } from '../../../extension/vc-model-settings/desktop/standalone/engine/events.js';
import { event_types } from '../../../extension/vc-model-settings/desktop/standalone/engine/st/events.js';
import {
    avatarUrl,
    readDraft,
    writeDraft,
} from '../../../extension/vc-model-settings/chat-logic.js';
import { mergeInput, createF2Client, createNativeF2IO, characterChatPath } from '../../../extension/vc-model-settings/f2-logic.js';
import { toast } from '../design/components/Toast';
import type { AppClient } from '../data/client';
import { queryKeys } from '../data/queryKeys';
import {
    normalizeConversationKey,
    parseConversationKey,
    type ConversationRow,
} from '../data/queries/chat';

type PrepareChatRuntime =
    typeof import('../../../extension/vc-model-settings/desktop/standalone/runtime.js').prepareChatRuntime;

const defaultPrepareRuntime: PrepareChatRuntime = async options => {
    options.signal?.throwIfAborted?.();
    const mod = await import(
        '../../../extension/vc-model-settings/desktop/standalone/runtime.js'
    );
    options.signal?.throwIfAborted?.();
    return mod.prepareChatRuntime(options);
};

export type { ConversationRow };

export interface ChatMessage {
    key: string;
    index: number;
    name?: string;
    mes: string;
    send_date?: string;
    gen_started?: number;
    gen_finished?: number;
    is_user: boolean;
    is_system: boolean;
    swipe_id?: number;
    swipes?: readonly string[];
    extra?: Readonly<Record<string, any>>;
}

export interface PopupRequest {
    id: number;
    type: 1 | 2 | 3;
    content: string;
    initial: string;
    resolve: (result: number | string | null) => void;
}

export interface PersonaChoiceOption {
    avatar: string;
    name: string;
    description?: string;
}

export interface PersonaChoiceRequest {
    id: number;
    options: readonly PersonaChoiceOption[];
    resolve: (avatar: string) => void;
}

export interface ConflictSnapshot {
    raw: string;
    input?: string;
    code?: string;
}

export interface ChatSnapshot {
    key: string;
    messages: readonly ChatMessage[];
    busy: boolean;
    canSend: boolean;
    notice: string;
    conflict: boolean;
    catalogBlocked: boolean;
    settingsRequired: boolean;
    enterToSend: boolean;
    runtime: 'idle' | 'preparing' | 'prepared' | 'error';
    status: 'empty' | 'switching' | 'loading' | 'ready' | 'error';
    phase: string;
    streamingKey: string | null;
    error: string;
    avatar: string;
    avatarUrl: string;
    characterName: string;
    characterRef?: string;
    relationshipId?: string;
    conversationId?: string;
    mode?: string;
    conflictSnapshot: ConflictSnapshot | null;
    popupRequest: PopupRequest | null;
    personaChoice: PersonaChoiceRequest | null;
    preferences: Readonly<Record<string, any>>;
    recalledPrompt: string;
}

export type OpenResult = 'opened' | 'superseded' | 'failed';

export interface CreateConversationInput {
    characterRef: string;
    displayName: string;
    chatIdentity?: string;
    mode?: string;
}

export interface CreatedConversation {
    relationshipId?: string;
    conversationId?: string;
    mode?: string;
    avatar: string;
    file: string;
    chatIdentity: string;
    characterRef: string;
    name: string;
    [key: string]: any;
}

export interface StoryTurn {
    runId: string;
    branchId: string;
    conversationId: string;
    worldVersion: number;
}

export interface StoryBridge {
    setRun(turn: StoryTurn | null): Promise<void>;
    selectActor(actor: string): Promise<void>;
    advance(turn: StoryTurn): Promise<void>;
    clear(): Promise<void>;
}

export interface DocumentValueSnapshot {
    exists: boolean;
    value?: any;
}

export interface DocumentChange {
    path: readonly string[];
    before: DocumentValueSnapshot;
    after: DocumentValueSnapshot;
}

export interface SessionBridge {
    subscribe(listener: () => void): () => void;
    getSnapshot(): ChatSnapshot;
    open(
        row: Partial<ConversationRow> | string,
        opts?: { latest?: boolean; signal?: AbortSignal },
    ): Promise<OpenResult>;
    send(
        text: string,
        opts?: {
            type?: 'normal' | 'continue';
            retry?: boolean;
            voiceInput?: any;
            draftInput?: string | null;
        },
    ): Promise<boolean>;
    stop(): Promise<void>;
    retry(): Promise<boolean>;
    continue(): Promise<boolean>;
    regenerate(): Promise<boolean>;
    edit(index: number, text: string): Promise<boolean>;
    remove(index: number): Promise<boolean>;
    swipe(index: number, delta: -1 | 1): Promise<boolean>;
    react(index: number, emoji: string): Promise<boolean>;
    pat(): Promise<boolean>;
    whenIdle(): Promise<void>;
    createConversation(input: CreateConversationInput): Promise<CreatedConversation | undefined>;
    projectStory(job: any): Promise<any>;
    story: StoryBridge;
    applySettings(changes: readonly DocumentChange[]): Promise<void>;
    applyPreset(
        apiId: string,
        name: string,
        changes: readonly DocumentChange[],
        value: any,
    ): Promise<void>;
    applyWorldbook(name: string, value: any, action?: string): Promise<void>;
    reloadCharacter(avatar: string): Promise<void>;
    commitMetadata(changes: readonly DocumentChange[], expectedKey?: string): Promise<void>;
    deleteCharacter(avatar: string, deleteChats: boolean): Promise<void>;
    refreshCatalog(): Promise<void>;
    setBudget(value: any): Promise<void>;
    mountLeaf(index: number, host: HTMLElement): () => void;
    draft: {
        read(key?: string): string;
        write(key: string, value: string): void;
        storageId(key?: string): string;
    };
    mountCardActions(node: HTMLElement): (() => void) | void;
    resolvePopup(result: number | string | null): void;
    resolvePersonaChoice(avatar: string): void;
    copyRejected(): Promise<string>;
    resolveConflictLatest(): Promise<OpenResult>;
    dismissConflict(): void;
    markVoicePlayed(index: number): void;
    cancelForCharacterDelete(avatar: string): Promise<void>;
    setFirstDisplayedMessageId(key: string, id: number | null): void;
    getContext(): any;
    destroy(): void;
}

export interface SessionBridgeDeps {
    queryClient?: QueryClient;
    prepareRuntime?: PrepareChatRuntime;
    eagerRuntime?: boolean;
}

interface LeafEntry {
    conversationKey: string;
    key: string;
    index: number;
    renderedText: string;
    renderedSwipe: number | undefined;
    renderedStreaming: boolean;
    renderedWithCards: boolean;
    renderedEpoch: number;
    cardCleanup?: (() => void) | void;
}

interface CardActionsEntry {
    key: string;
    mountedEpoch: number;
    cleanup?: (() => void) | void;
}

const MIGRATING_NOTICE = '正在迁移';
const HISTORY_RETRY_NOTICE = '聊天没有加载出来，请重试。';

export function createSessionBridge(
    client: AppClient,
    deps: SessionBridgeDeps = {},
): SessionBridge {
    const queryClient = deps.queryClient;
    const prepareRuntimeFn = deps.prepareRuntime ?? defaultPrepareRuntime;
    const listeners = new Set<() => void>();
    const drafts = new Map<string, string>();
    const mountedLeaves = new Map<HTMLElement, LeafEntry>();
    const cardActions = new Map<HTMLElement, CardActionsEntry>();

    function chatStorage() {
        if (typeof client?.getChatStorage !== 'function') {
            return { mode: 'ST', authorityEpoch: '' };
        }
        try {
            return client.getChatStorage();
        } catch {
            return null;
        }
    }

    let popupSeq = 0;
    let personaSeq = 0;
    let openEpoch = 0;
    let commitEpoch = 0;
    let inFlightKey = '';
    let inFlightOpen: Promise<OpenResult> | null = null;
    let inFlightCommitted = false;
    let readAbort: AbortController | null = null;
    let activeAbort: AbortController | null = null;
    interface NormalizedRow {
        key: string;
        avatar: string;
        file: string;
        title?: string;
        relationshipId?: string;
        characterRef?: string;
        mode?: string;
    }

    let activeRow: NormalizedRow | null = null;
    let activeStorage: ReturnType<typeof chatStorage> = null;
    let activatingEpoch = -1;
    let activatedEpoch = -1;

    let committedRow: NormalizedRow | null = null;
    let committedMetadata: Record<string, any> | null = null;
    let committedSnapshot: ChatSnapshot | null = null;
    let sessionPublishedKey = '';
    let retryRow: NormalizedRow | null = null;
    let attachCallerSignal: ((signal: AbortSignal) => void) | null = null;
    let runtimeAbort: AbortController | null = null;
    let runtimeInstance: any = null;
    let runtimePromise: Promise<any> | null = null;
    let charactersReady: Promise<any> = Promise.resolve([]);
    let dead = false;
    const pendingConfiguration: Array<(runtime: any) => unknown> = [];

    function isCurrentStorage(storage: ReturnType<typeof chatStorage>): boolean {
        const current = chatStorage();
        return Boolean(storage && current?.mode === storage.mode &&
            current?.authorityEpoch === storage.authorityEpoch);
    }

    async function applyConfiguration(apply: (runtime: any) => unknown): Promise<void> {
        const mode = chatStorage()?.mode;
        if (dead || !mode || mode === 'FROZEN') return;
        if (mode === 'GO' && runtimeInstance && !hasActivatedChat()) return;
        if (!runtimeInstance) {
            pendingConfiguration.push(apply);
            void ensureRuntime().catch(() => {});
            return;
        }
        await apply(runtimeInstance);
    }

    const eventSource = new EventEmitter([event_types.APP_INITIALIZED, event_types.APP_READY]);
    let firstDisplayedState: { key: string; id: number | null; messageKey?: string } = { key: '', id: null };

    function readFirstDisplayedMessageId(): number | null {
        const currentKey = snapshot.key || committedRow?.key || activeRow?.key || '';
        if (!currentKey || firstDisplayedState.key !== currentKey) {
            return null;
        }
        if (activeStorage?.mode === 'FROZEN') return null;
        if (activeStorage?.mode === 'GO') {
            if (!firstDisplayedState.messageKey || activatingEpoch !== commitEpoch ||
                committedRow?.key !== currentKey) return null;
            return findFullIndex(firstDisplayedState.messageKey, firstDisplayedState.id);
        }
        return firstDisplayedState.id;
    }

    const context: any = {
        characters: [],
        chat: [],
        chatMetadata: {},
        characterId: undefined,
        chatId: '',
        name1: '',
        name2: '',
        extensionPrompts: {},
        eventSource,
        eventTypes: event_types,
        readFirstDisplayedMessageId: () => readFirstDisplayedMessageId(),
    };
    Object.defineProperty(context, 'firstDisplayedMessageId', {
        configurable: true,
        enumerable: true,
        get() {
            return readFirstDisplayedMessageId();
        },
    });

    const stOwner = { getContext: () => context };
    if (typeof globalThis !== 'undefined') {
        (globalThis as any).SillyTavern = stOwner;
    }

    function draftStorageId(key = snapshot.key): string {
        if (!key) return '';
        const parsed = parseConversationKey(key);
        const accountId = (client as any)?.identity?.accountId || '';
        if (parsed && accountId) {
            return JSON.stringify([accountId, parsed.avatar, parsed.file]);
        }
        return key;
    }

    function readScopedDraft(key = snapshot.key, migrate = false): string {
        if (!key) return '';
        if (drafts.has(key) && !migrate) return drafts.get(key) ?? '';
        const scopedId = draftStorageId(key);
        const current = drafts.has(key) ? (drafts.get(key) ?? '') : readDraft(scopedId);
        const parsed = parseConversationKey(key);
        const legacy = migrate && parsed?.file ? readDraft(parsed.file) : '';
        if (legacy) {
            const migrated = mergeInput(current, legacy);
            writeDraft(scopedId, migrated);
            writeDraft(parsed!.file, '');
            drafts.set(key, migrated);
            return migrated;
        }
        drafts.set(key, current);
        return current;
    }

    function writeScopedDraft(key: string, value: string): void {
        if (!key) return;
        const prev = drafts.get(key);
        drafts.set(key, value);
        writeDraft(draftStorageId(key), value);
        if (prev !== value) {
            emit();
        }
    }

    const fallbackMessageKeys = new WeakMap<object, string>();
    let fallbackMessageSeq = 0;

    function goMessageKey(raw: any): string | undefined {
        return activeStorage?.mode === 'GO' && raw?.vc_message_id
            ? `${committedRow?.key}:${raw.vc_message_id}`
            : undefined;
    }

    function messageKeyFromSession(raw: any, index: number): string {
        const stableKey = goMessageKey(raw);
        if (stableKey) return stableKey;
        if (runtimeInstance && typeof runtimeInstance.messageKey === 'function') {
            const k = runtimeInstance.messageKey(raw, index);
            if (k) return k;
        }
        if (raw && typeof raw === 'object') {
            let k = fallbackMessageKeys.get(raw);
            if (!k) {
                k = `${snapshot.key}:${String(raw?.send_date ?? '')}:${index}:${++fallbackMessageSeq}`;
                fallbackMessageKeys.set(raw, k);
            }
            return k;
        }
        return `${snapshot.key}:${String(raw?.send_date ?? '')}:${index}`;
    }

    function cloneExtra(extra: any): Readonly<Record<string, any>> | undefined {
        if (!extra || typeof extra !== 'object') return undefined;
        return {
            ...extra,
            ...(Array.isArray(extra.vc_reactions)
                ? { vc_reactions: [...extra.vc_reactions] }
                : {}),
            ...(extra.vc_voice && typeof extra.vc_voice === 'object'
                ? { vc_voice: { ...extra.vc_voice } }
                : {}),
            ...(extra.vc_voice_input && typeof extra.vc_voice_input === 'object'
                ? { vc_voice_input: { ...extra.vc_voice_input } }
                : {}),
            ...(extra.vc_sticker && typeof extra.vc_sticker === 'object'
                ? { vc_sticker: { ...extra.vc_sticker } }
                : {}),
            ...(Array.isArray(extra.media)
                ? { media: extra.media.map((m: any) => (m && typeof m === 'object' ? { ...m } : m)) }
                : {}),
        };
    }

    function mapMessages(rawList: any[], keys?: string[]): readonly ChatMessage[] {
        return (Array.isArray(rawList) ? rawList : []).map((raw, index) => ({
            key: goMessageKey(raw) || keys?.[index] || messageKeyFromSession(raw, index),
            index,
            name: raw?.name,
            mes: String(raw?.mes ?? ''),
            send_date: raw?.send_date,
            gen_started: raw?.gen_started,
            gen_finished: raw?.gen_finished,
            is_user: Boolean(raw?.is_user),
            is_system: Boolean(raw?.is_system),
            swipe_id: raw?.swipe_id,
            swipes: Array.isArray(raw?.swipes) ? [...raw.swipes] : undefined,
            extra: cloneExtra(raw?.extra),
        }));
    }

    let snapshot: ChatSnapshot = {
        key: '',
        messages: [],
        busy: false,
        canSend: false,
        notice: '',
        conflict: false,
        catalogBlocked: false,
        settingsRequired: false,
        enterToSend: true,
        runtime: 'idle',
        status: 'empty',
        phase: '',
        streamingKey: null,
        error: '',
        avatar: '',
        avatarUrl: '',
        characterName: '',
        characterRef: undefined,
        relationshipId: undefined,
        conversationId: undefined,
        mode: undefined,
        conflictSnapshot: null,
        popupRequest: null,
        personaChoice: null,
        preferences: {},
        recalledPrompt: '',
    };

    function syncGeneratingAttr(busy: boolean) {
        if (dead) return;
        if (typeof document !== 'undefined' && document.body) {
            document.body.dataset.generating = String(Boolean(busy));
        }
    }

    function hasActivatedChat(): boolean {
        return !dead && !readAbort && !activeAbort?.signal.aborted && snapshot.status === 'ready' &&
            committedRow?.key === snapshot.key && activatedEpoch === commitEpoch &&
            isCurrentStorage(activeStorage);
    }

    function chatRuntimeAvailable(): boolean {
        const mode = chatStorage()?.mode;
        return mode === 'ST' || (mode === 'GO' && hasActivatedChat());
    }

    function findFullIndex(key: string, hint: number | null): number | null {
        if (hint !== null && context.chat[hint] && messageKeyFromSession(context.chat[hint], hint) === key) {
            return hint;
        }
        const index = context.chat.findIndex((raw: any, i: number) => messageKeyFromSession(raw, i) === key);
        return index < 0 ? null : index;
    }

    function fullMessage(message: ChatMessage | undefined): { index: number; raw: any } | null {
        if (!message || !hasActivatedChat()) return null;
        const index = findFullIndex(message.key, message.index);
        return index === null ? null : { index, raw: context.chat[index] };
    }

    function clearChatContext() {
        context.chat = [];
        context.chatMetadata = {};
        context.chatId = '';
        context.characterId = undefined;
    }

    function renderLeaf(host: HTMLElement, entry: LeafEntry, message: ChatMessage) {
        const full = fullMessage(message);
        const raw = full?.raw ?? message;
        const streaming = snapshot.streamingKey === message.key;
        if (full && runtimeInstance?.renderMessage) {
            entry.cardCleanup = runtimeInstance.renderMessage(host, full.index, raw, streaming);
            entry.renderedWithCards = true;
        } else {
            entry.cardCleanup?.();
            entry.cardCleanup = undefined;
            let textEl = host.querySelector<HTMLElement>(':scope > .mes_text');
            if (!textEl) {
                textEl = host.ownerDocument.createElement('div');
                textEl.className = 'mes_text';
                host.replaceChildren(textEl);
            }
            textEl.textContent = String(raw.mes ?? '');
            entry.renderedWithCards = false;
        }

        entry.index = message.index;
        entry.renderedText = String(raw.mes ?? '');
        entry.renderedSwipe = raw.swipe_id;
        entry.renderedStreaming = streaming;
        entry.renderedEpoch = commitEpoch;
    }

    function syncMountedLeaves() {
        const hasCards = Boolean(hasActivatedChat() && runtimeInstance?.renderMessage);
        for (const [host, entry] of mountedLeaves) {
            if (!host.isConnected) continue;
            const atIndex = snapshot.messages[entry.index];
            const message = entry.conversationKey !== snapshot.key
                ? undefined
                : atIndex?.key === entry.key
                    ? atIndex
                    : snapshot.messages.find(item => item.key === entry.key);
            if (!message) {
                entry.cardCleanup?.();
                entry.cardCleanup = undefined;
                entry.renderedWithCards = false;
                entry.renderedEpoch = -1;
                host.replaceChildren();
                continue;
            }
            if (
                message.index !== entry.index ||
                message.mes !== entry.renderedText ||
                message.swipe_id !== entry.renderedSwipe ||
                (snapshot.streamingKey === message.key) !== entry.renderedStreaming ||
                hasCards !== entry.renderedWithCards ||
                entry.renderedEpoch !== commitEpoch
            ) {
                renderLeaf(host, entry, message);
            }
        }
    }

    function syncCardActions() {
        const ready = hasActivatedChat();
        for (const [node, entry] of cardActions) {
            const canMount = ready && node.isConnected && entry.key === snapshot.key;
            if (!canMount || entry.mountedEpoch !== commitEpoch) {
                entry.cleanup?.();
                entry.cleanup = undefined;
                entry.mountedEpoch = -1;
            }
            if (canMount && entry.mountedEpoch === -1 && runtimeInstance?.mountCardActions) {
                entry.cleanup = runtimeInstance.mountCardActions(node);
                entry.mountedEpoch = commitEpoch;
            }
        }
    }

    function emit() {
        if (dead) return;
        if (committedRow && snapshot.key === committedRow.key && snapshot.status === 'ready') {
            committedSnapshot = snapshot;
        }
        syncGeneratingAttr(snapshot.busy);
        syncMountedLeaves();
        syncCardActions();
        for (const listener of listeners) {
            listener();
        }
    }

    function invalidateChatQueries(relId = snapshot.relationshipId) {
        if (!queryClient) return;
        void queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
        if (relId) {
            void queryClient.invalidateQueries({ queryKey: ['companionState', relId] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.memory(relId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.followUps(relId) });
        }
    }

    function callGenericPopup(
        content: any,
        type = 1,
        initial = '',
    ): Promise<number | string | null> {
        const popupType = (type === 2 || type === 3 ? type : 1) as 1 | 2 | 3;
        const cancelValue = popupType === 3 ? null : 0;
        if (dead) {
            return Promise.resolve(cancelValue);
        }
        return new Promise(resolve => {
            const id = ++popupSeq;
            const textContent =
                typeof content === 'string'
                    ? content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
                    : String(content?.textContent ?? content ?? '').trim();
            let settled = false;
            const finish = (result: number | string | null) => {
                if (settled) return;
                settled = true;
                if (snapshot.popupRequest?.id === id) {
                    snapshot = { ...snapshot, popupRequest: null };
                    emit();
                }
                resolve(result);
            };
            if (snapshot.popupRequest) {
                const prev = snapshot.popupRequest;
                prev.resolve(prev.type === 3 ? null : 0);
            }
            snapshot = {
                ...snapshot,
                popupRequest: {
                    id,
                    type: popupType,
                    content: textContent,
                    initial: String(initial ?? ''),
                    resolve: finish,
                },
            };
            emit();
        });
    }

    function choosePersona(
        personaOptions: PersonaChoiceOption[],
        { signal }: { signal?: AbortSignal } = {},
    ): Promise<string> {
        if (dead || signal?.aborted) {
            return Promise.resolve('');
        }
        return new Promise(resolve => {
            const id = ++personaSeq;
            let settled = false;
            const finish = (avatar: string) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                if (snapshot.personaChoice?.id === id) {
                    snapshot = { ...snapshot, personaChoice: null };
                    emit();
                }
                resolve(avatar);
            };
            const onAbort = () => finish('');
            signal?.addEventListener('abort', onAbort, { once: true });
            if (snapshot.personaChoice) {
                snapshot.personaChoice.resolve('');
            }
            snapshot = {
                ...snapshot,
                personaChoice: {
                    id,
                    options: Array.isArray(personaOptions) ? [...personaOptions] : [],
                    resolve: finish,
                },
            };
            emit();
        });
    }

    context.callGenericPopup = callGenericPopup;
    context.callPopup = callGenericPopup;

    function ensureRuntime(historyEpoch?: number): Promise<any> {
        const mode = chatStorage()?.mode;
        if (dead) return Promise.resolve(null);
        if (mode !== 'ST') {
            const fullReady = historyEpoch === commitEpoch && isCurrentStorage(activeStorage);
            if (mode !== 'GO' || (!fullReady && !hasActivatedChat())) return Promise.resolve(null);
        }
        if (runtimePromise) return runtimePromise;
        if (!deps.prepareRuntime && (!client || typeof (client as any).settings !== 'function')) {
            return Promise.resolve(null);
        }

        runtimeAbort?.abort();
        const runtimeController = new AbortController();
        runtimeAbort = runtimeController;
        const runtimeSignal = runtimeController.signal;
        const isDeadOrAborted = () => dead || runtimeSignal.aborted;

        snapshot = { ...snapshot, runtime: 'preparing' };
        emit();

        charactersReady =
            typeof client?.characters === 'function'
                ? client
                      .characters()
                      .then((chars: any[]) => {
                          if (isDeadOrAborted()) return [];
                          if (Array.isArray(chars)) context.characters = chars;
                          return chars;
                      })
                      .catch(() => {
                          if (
                              !isDeadOrAborted() &&
                              typeof document !== 'undefined' &&
                              document.documentElement
                          ) {
                              document.documentElement.dataset.vcCharacters = 'error';
                          }
                          return [];
                      })
                : Promise.resolve([]);

        if (client && typeof (client as any).settings === 'function') {
            void client
                .settings()
                .then((packet: any) => {
                    if (isDeadOrAborted() || !packet?.settings) return;
                    const parsed = JSON.parse(packet.settings);
                    const power = parsed?.power_user || {};
                    const sendOnEnter = power.send_on_enter;
                    const nextEnterToSend = sendOnEnter === undefined ? true : Number(sendOnEnter) !== -1;
                    const nextPreferences = { ...power };
                    if (committedSnapshot) {
                        committedSnapshot = {
                            ...committedSnapshot,
                            enterToSend: nextEnterToSend,
                            preferences: nextPreferences,
                        };
                    }
                    snapshot = {
                        ...snapshot,
                        enterToSend: nextEnterToSend,
                        preferences: nextPreferences,
                    };
                    if (!context.chatId) {
                        context.name1 = parsed.username || '';
                        context.userAvatar = parsed.user_avatar || '';
                    }
                    emit();
                })
                .catch(() => {});
        }

        runtimePromise = prepareRuntimeFn({
            client,
            context,
            signal: runtimeSignal,
            choosePersona,
            callGenericPopup,
            readInput: () => readScopedDraft(snapshot.key, false),
            readFirstDisplayedMessageId: () => readFirstDisplayedMessageId(),
            onToast: (message: string, opts?: { type?: string }) => {
                if (isDeadOrAborted()) return;
                toast.show({
                    title: String(message || ''),
                    kind:
                        opts?.type === 'failure' || opts?.type === 'error'
                            ? 'error'
                            : 'success',
                });
            },
            onConflict: (serialized: string, error: any) => {
                if (isDeadOrAborted()) return;
                const activeKey = committedSnapshot?.key || snapshot.key;
                const nextConflictSnapshot = {
                    raw: serialized,
                    input: readScopedDraft(activeKey, false),
                    code: error?.code || 'VC_REVISION_CONFLICT',
                };
                if (error?.code === 'CHAT_AUTHORITY_CHANGED' && committedSnapshot?.status === 'ready') {
                    activeAbort?.abort();
                    activatingEpoch = -1;
                    activatedEpoch = -1;
                    clearChatContext();
                    pendingConfiguration.length = 0;
                    committedSnapshot = {
                        ...committedSnapshot,
                        status: 'error',
                        canSend: false,
                        busy: false,
                        streamingKey: null,
                        notice: chatStorage()?.mode === 'FROZEN'
                            ? MIGRATING_NOTICE
                            : '登录状态或聊天已变化，请重新打开页面。',
                        conflict: true,
                        conflictSnapshot: nextConflictSnapshot,
                    };
                    if (!readAbort) {
                        snapshot = committedSnapshot;
                        emit();
                    }
                    return;
                }
                if (committedSnapshot) {
                    committedSnapshot = {
                        ...committedSnapshot,
                        conflict: true,
                        conflictSnapshot: nextConflictSnapshot,
                    };
                }
                if (!readAbort) {
                    snapshot = {
                        ...snapshot,
                        conflict: true,
                        conflictSnapshot: nextConflictSnapshot,
                    };
                    emit();
                }
            },
            onChange: (state: any) => {
                if (isDeadOrAborted()) return;
                if (activeStorage?.mode === 'FROZEN' || (activeStorage && !isCurrentStorage(activeStorage))) return;
                const matchesCommitted = Boolean(
                    committedSnapshot && state.key === committedSnapshot.key,
                );
                const storedActivation = activeStorage?.mode === 'GO';
                if (storedActivation && activatingEpoch !== commitEpoch) return;
                const matchesVisible = !readAbort && state.key === snapshot.key &&
                    (!storedActivation || activatedEpoch === commitEpoch);
                if (!matchesCommitted && !matchesVisible) return;

                const base = matchesVisible ? snapshot : committedSnapshot!;
                const mapped = storedActivation && activatedEpoch !== commitEpoch
                    ? base.messages
                    : mapMessages(state.messages || context.chat, state.messageKeys);
                const lastMsg = mapped.at(-1);
                const streamingKey =
                    state.busy && lastMsg && !lastMsg.is_user && !lastMsg.is_system
                        ? lastMsg.key
                        : null;
                const power = context.powerUserSettings;
                const sendOnEnter = power?.send_on_enter;
                const binding = context.chatMetadata?.vc_binding;
                const nextRelId = binding?.relationshipId
                    ? String(binding.relationshipId)
                    : base.relationshipId;
                const wasBusy = base.busy;
                const nextBusy = Boolean(state.busy);

                const nextState: ChatSnapshot = {
                    ...base,
                    messages: mapped,
                    canSend: Boolean(state.canSend),
                    busy: nextBusy,
                    phase: state.phase || '',
                    streamingKey,
                    notice: state.notice || '',
                    conflict: Boolean(state.conflict),
                    conflictSnapshot: state.conflict
                        ? (base.conflictSnapshot ?? committedSnapshot?.conflictSnapshot ?? null)
                        : null,
                    settingsRequired: Boolean(state.settingsRequired),
                    catalogBlocked: Boolean(state.catalogBlocked),
                    relationshipId: nextRelId,
                    conversationId: binding?.conversationId
                        ? String(binding.conversationId)
                        : base.conversationId,
                    mode: binding?.mode || base.mode,
                    enterToSend:
                        state.enterToSend !== undefined
                            ? Boolean(state.enterToSend)
                            : sendOnEnter === undefined
                              ? base.enterToSend
                              : Number(sendOnEnter) !== -1,
                    preferences: power ? { ...power } : base.preferences,
                    recalledPrompt: String(
                        context.extensionPrompts?.vc_long_term_memory?.value ?? '',
                    ),
                };

                if (matchesCommitted && committedSnapshot) {
                    sessionPublishedKey = state.key;
                    committedSnapshot = {
                        ...nextState,
                        status: committedSnapshot.status,
                    };
                }
                if (matchesVisible) {
                    snapshot = nextState;
                    emit();
                }
                if (wasBusy && !nextBusy) {
                    invalidateChatQueries(nextRelId);
                }
            },
            onTakeDraft: (key: string, input: string) => {
                if (isDeadOrAborted()) return;
                if (readScopedDraft(key, false) === input) {
                    writeScopedDraft(key, '');
                }
            },
            onRestoreDraft: (key: string, input: string) => {
                if (isDeadOrAborted()) return;
                if (input) {
                    const merged = mergeInput(readScopedDraft(key, false), input);
                    writeScopedDraft(key, merged);
                }
            },
            paint: () => {
                if (
                    isDeadOrAborted() ||
                    readAbort ||
                    !snapshot.key ||
                    snapshot.status !== 'ready' ||
                    sessionPublishedKey !== snapshot.key
                ) {
                    return;
                }
                snapshot = {
                    ...snapshot,
                    messages: mapMessages(context.chat),
                    recalledPrompt: String(
                        context.extensionPrompts?.vc_long_term_memory?.value ?? '',
                    ),
                };
                emit();
            },
        })
            .then(async (rt: any) => {
                if (isDeadOrAborted()) {
                    rt?.destroy?.();
                    return rt;
                }
                const attemptedConfiguration: Array<(runtime: any) => unknown> = [];
                try {
                    while (!isDeadOrAborted() && pendingConfiguration.length) {
                        const apply = pendingConfiguration.shift()!;
                        attemptedConfiguration.push(apply);
                        await apply(rt);
                    }
                } catch (error) {
                    if (!isDeadOrAborted()) pendingConfiguration.unshift(...attemptedConfiguration);
                    rt?.destroy?.();
                    throw error;
                }
                if (isDeadOrAborted()) {
                    rt?.destroy?.();
                    return rt;
                }
                runtimeInstance = rt;
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.dataset.vcRuntime = 'prepared';
                }
                if (committedSnapshot) {
                    committedSnapshot = { ...committedSnapshot, runtime: 'prepared' };
                }
                snapshot = { ...snapshot, runtime: 'prepared' };
                await eventSource.emit(event_types.APP_INITIALIZED);
                await eventSource.emit(event_types.APP_READY);
                if (!isDeadOrAborted()) {
                    emit();
                }
                return rt;
            })
            .catch((err: any) => {
                if (runtimeAbort === runtimeController) {
                    runtimePromise = null;
                }
                if (isDeadOrAborted()) throw err;
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.dataset.vcRuntime = 'error';
                }
                if (committedSnapshot) {
                    committedSnapshot = {
                        ...committedSnapshot,
                        runtime: 'error',
                        notice: '聊天没有加载出来，请重试。',
                    };
                }
                snapshot = {
                    ...snapshot,
                    runtime: 'error',
                    notice: '聊天没有加载出来，请重试。',
                };
                emit();
                throw err;
            });

        return runtimePromise;
    }

    if (
        deps.eagerRuntime &&
        (deps.prepareRuntime || (client && typeof (client as any).settings === 'function'))
    ) {
        void ensureRuntime().catch(() => {});
    }

    function normalizeRowInput(
        rowOrKey: Partial<ConversationRow> | string,
    ): {
        key: string;
        avatar: string;
        file: string;
        title?: string;
        relationshipId?: string;
        characterRef?: string;
        mode?: string;
    } | null {
        if (typeof rowOrKey === 'string') {
            const parsed = parseConversationKey(rowOrKey);
            if (parsed) {
                return {
                    key: normalizeConversationKey(parsed.avatar, parsed.file),
                    avatar: parsed.avatar,
                    file: parsed.file,
                };
            }
            return null;
        }
        if (rowOrKey && typeof rowOrKey === 'object') {
            const parsedFromKey = rowOrKey.key ? parseConversationKey(rowOrKey.key) : null;
            const rawAvatar = parsedFromKey?.avatar || String(rowOrKey.avatar || '');
            const rawFile = (parsedFromKey?.file || String(rowOrKey.file || '')).replace(
                /\.jsonl$/i,
                '',
            );
            const key =
                rawAvatar && rawFile
                    ? normalizeConversationKey(rawAvatar, rawFile)
                    : rowOrKey.key || '';
            return {
                key,
                avatar: rawAvatar,
                file: rawFile,
                title: rowOrKey.title,
                relationshipId: rowOrKey.relationshipId,
                characterRef: rowOrKey.characterRef,
                mode: rowOrKey.mode,
            };
        }
        return null;
    }

    async function open(
        rowOrKey: Partial<ConversationRow> | string,
        openOpts: { latest?: boolean; signal?: AbortSignal } = {},
    ): Promise<OpenResult> {
        if (dead || openOpts.signal?.aborted) return 'superseded';
        const latest = Boolean(openOpts.latest);
        let target = normalizeRowInput(rowOrKey);
        if (!target && typeof rowOrKey !== 'object') return 'failed';

        const provisionalKey = target?.key || '';
        if (!latest && provisionalKey) {
            if (inFlightOpen && inFlightKey === provisionalKey) {
                if (openOpts.signal && !inFlightCommitted && attachCallerSignal) {
                    attachCallerSignal(openOpts.signal);
                }
                return inFlightOpen;
            }
            if (snapshot.status === 'ready' && snapshot.key === provisionalKey && isCurrentStorage(activeStorage)) {
                return 'opened';
            }
        }

        readAbort?.abort();
        if (activeStorage?.mode === 'GO' && activeAbort && activatedEpoch !== commitEpoch) {
            activeAbort.abort();
            activeAbort = null;
            activatingEpoch = -1;
            clearChatContext();
            if (committedSnapshot?.status === 'loading') {
                committedSnapshot = { ...committedSnapshot, status: 'error', notice: HISTORY_RETRY_NOTICE };
            }
        }
        const readController = new AbortController();
        readAbort = readController;
        const ticket = ++openEpoch;
        inFlightKey = provisionalKey;
        inFlightCommitted = false;
        let preflightCancelled = false;
        let committed = false;
        let commitTicket = 0;
        let activeController: AbortController | null = null;
        let runOpen: Promise<OpenResult> | null = null;
        let displayMessages: readonly ChatMessage[] = [];
        let chatStore: ReturnType<AppClient['createChatStore']> | null = null;
        let storeActivated = false;
        const callerSignals = new Set<AbortSignal>();

        const detachCallerSignals = () => {
            for (const sig of callerSignals) {
                sig.removeEventListener('abort', onCallerAbort);
            }
            callerSignals.clear();
            if (attachCallerSignal === addCallerSignal) {
                attachCallerSignal = null;
            }
        };

        const callerAborted = () => {
            for (const sig of callerSignals) {
                if (sig.aborted) return true;
            }
            return false;
        };

        const onCallerAbort = () => {
            if (dead || committed || preflightCancelled || ticket !== openEpoch) return;
            preflightCancelled = true;
            openEpoch += 1;
            detachCallerSignals();
            readController.abort();
            if (readAbort === readController) {
                readAbort = null;
            }
            if (inFlightOpen === runOpen) {
                inFlightOpen = null;
                inFlightKey = '';
                inFlightCommitted = false;
            }
            if (committedSnapshot && committedRow) {
                activeRow = committedRow;
                if (committedSnapshot.status === 'error') {
                    retryRow = committedRow;
                }
                readScopedDraft(committedSnapshot.key, true);
                snapshot = {
                    ...committedSnapshot,
                };
                if (committedSnapshot.status === 'ready') {
                    runtimeInstance?.refreshView?.();
                }
            } else {
                activeRow = null;
                snapshot = {
                    ...snapshot,
                    key: '',
                    messages: [],
                    status: 'empty',
                    busy: false,
                    streamingKey: null,
                    notice: '',
                    error: '',
                    conflict: false,
                    conflictSnapshot: null,
                    canSend: false,
                };
            }
            emit();
        };

        const addCallerSignal = (sig: AbortSignal) => {
            if (committed || preflightCancelled) return;
            if (sig.aborted) {
                onCallerAbort();
                return;
            }
            callerSignals.add(sig);
            sig.addEventListener('abort', onCallerAbort, { once: true });
        };

        attachCallerSignal = addCallerSignal;
        if (openOpts.signal) {
            addCallerSignal(openOpts.signal);
        }

        if (provisionalKey) {
            readScopedDraft(provisionalKey, true);
        }

        snapshot = {
            ...snapshot,
            status: 'switching',
            key: provisionalKey || snapshot.key,
            messages:
                provisionalKey && provisionalKey === snapshot.key
                    ? snapshot.messages
                    : [],
            busy: false,
            streamingKey: null,
            notice: '',
            error: '',
            conflict: false,
            conflictSnapshot: null,
            canSend: false,
        };
        emit();

        runOpen = (async (): Promise<OpenResult> => {
            // Register the opening before branches that can finish without an I/O await.
            await Promise.resolve();
            try {
                if (dead || preflightCancelled || ticket !== openEpoch) return 'superseded';
                const storage = chatStorage();
                if (!storage) throw new Error('chat-storage-unavailable');
                const go = storage.mode === 'GO';
                const frozen = storage.mode === 'FROZEN';
                if (
                    !frozen && (!target?.avatar || !target?.file) &&
                    client &&
                    typeof client.recent === 'function'
                ) {
                    const resolved = resolveDesktopConversation(
                        await client.recent(),
                        rowOrKey as any,
                    );
                    if (
                        dead ||
                        preflightCancelled ||
                        ticket !== openEpoch ||
                        readController.signal.aborted ||
                        callerAborted()
                    ) {
                        return 'superseded';
                    }
                    if (!resolved) throw new Error('source-unavailable');
                    const cleanFile = String(resolved.file || '').replace(/\.jsonl$/i, '');
                    target = {
                        key: normalizeConversationKey(resolved.avatar, cleanFile),
                        avatar: resolved.avatar,
                        file: cleanFile,
                        title: target?.title,
                        relationshipId: target?.relationshipId,
                        characterRef: target?.characterRef,
                        mode: target?.mode,
                    };
                    inFlightKey = target.key;
                }
                if (!target?.avatar || !target?.file) {
                    throw new Error('聊天没有加载出来');
                }

                const key = target.key;
                readScopedDraft(key, true);

                chatStore = go ? client.createChatStore(target) : null;
                let runtimeTask = storage.mode === 'ST' ? ensureRuntime() : null;
                void runtimeTask?.catch(() => {});
                const display = chatStore ? await chatStore.readDisplay({ signal: readController.signal, limit: 80 }) : null;
                let records = storage.mode === 'ST'
                    ? await client.readChat(
                        { avatar: target.avatar, file: target.file },
                        { signal: readController.signal },
                    )
                    : display ? storedChatRecords(display) : [];

                if (
                    dead ||
                    preflightCancelled ||
                    ticket !== openEpoch ||
                    readController.signal.aborted ||
                    callerAborted()
                ) {
                    return 'superseded';
                }
                if (!isCurrentStorage(storage)) throw new Error('chat-storage-unavailable');
                if (!frozen && (!Array.isArray(records) || !records[0]?.chat_metadata)) {
                    throw new Error('聊天没有加载出来');
                }

                // Commit boundary: the display read succeeded, detach caller route-leave signals
                // and promote this session to the committed active session.
                committed = true;
                inFlightCommitted = true;
                detachCallerSignals();
                if (readAbort === readController) {
                    readAbort = null;
                }
                activeAbort?.abort();
                activeController = new AbortController();
                activeAbort = activeController;
                commitTicket = ++commitEpoch;

                if (go || frozen || activeStorage?.mode === 'GO') clearChatContext();
                activeStorage = storage;
                committedRow = target;
                committedMetadata = records[0]?.chat_metadata ?? null;
                activeRow = target;
                retryRow = null;
                sessionPublishedKey = '';
                readScopedDraft(key, true);
                let binding = committedMetadata?.vc_binding;
                const initialCard = context.characters.find((c: any) => c.avatar === target!.avatar);
                const initialTitle =
                    initialCard?.name || target.title || target.avatar.replace(/\.png$/i, '');

                committedSnapshot = {
                    ...snapshot,
                    status: frozen ? 'ready' : go ? 'loading' : 'switching',
                    key,
                    messages: go || (!frozen && !runtimeInstance)
                        ? mapMessages(records.slice(1))
                        : snapshot.messages,
                    avatar: target.avatar,
                    avatarUrl: avatarUrl(target.avatar),
                    characterName: initialTitle,
                    characterRef:
                        initialCard?.data?.extensions?.vc_character_ref ||
                        target.characterRef ||
                        target.avatar,
                    relationshipId: binding?.relationshipId
                        ? String(binding.relationshipId)
                        : target.relationshipId,
                    conversationId: binding?.conversationId
                        ? String(binding.conversationId)
                        : undefined,
                    mode: binding?.mode || target.mode || 'COMPANION',
                    busy: false,
                    streamingKey: null,
                    notice: frozen ? MIGRATING_NOTICE : '',
                    error: '',
                    conflict: false,
                    conflictSnapshot: null,
                    canSend: false,
                };
                displayMessages = committedSnapshot.messages;
                if (!readAbort) {
                    snapshot = committedSnapshot;
                    emit();
                }

                if (frozen) {
                    pendingConfiguration.length = 0;
                    return 'opened';
                }

                if (chatStore) {
                    const full = await chatStore.loadFull({ signal: activeController.signal });
                    if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                        return 'superseded';
                    }
                    if (!isCurrentStorage(storage)) throw new Error('chat-storage-unavailable');
                    records = storedChatRecords(full);
                    committedMetadata = records[0].chat_metadata;
                    binding = committedMetadata?.vc_binding;
                    runtimeTask = ensureRuntime(commitTicket);
                }

                const [rt] = await Promise.all([runtimeTask, charactersReady]);

                if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                    return 'superseded';
                }
                if (go && !rt) throw new Error('聊天没有加载出来');

                let card = context.characters.find((c: any) => c.avatar === target!.avatar);
                if (!card && typeof client.characters === 'function') {
                    const freshChars = await client.characters().catch(() => null);
                    if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                        return 'superseded';
                    }
                    if (Array.isArray(freshChars)) {
                        context.characters = freshChars;
                        card = context.characters.find((c: any) => c.avatar === target!.avatar);
                    }
                }
                const title =
                    card?.name || target.title || target.avatar.replace(/\.png$/i, '');

                committedSnapshot = {
                    ...(committedSnapshot ?? snapshot),
                    key,
                    avatar: target.avatar,
                    avatarUrl: avatarUrl(target.avatar),
                    characterName: title,
                    characterRef:
                        card?.data?.extensions?.vc_character_ref ||
                        target.characterRef ||
                        target.avatar,
                    relationshipId: binding?.relationshipId
                        ? String(binding.relationshipId)
                        : target.relationshipId,
                    conversationId: binding?.conversationId
                        ? String(binding.conversationId)
                        : undefined,
                    mode: binding?.mode || target.mode || 'COMPANION',
                };
                if (!readAbort) {
                    snapshot = committedSnapshot;
                }

                if (!isCurrentStorage(storage)) throw new Error('chat-storage-unavailable');
                activatingEpoch = commitTicket;
                if (rt) {
                    const activated = await rt.activate(
                        { avatar: target.avatar, file: target.file },
                        records,
                        {
                            signal: activeController.signal,
                            latest,
                            ...(chatStore ? { chatStore } : {}),
                        },
                    );
                    if (go && activated === false) throw new Error('聊天没有加载出来');
                } else {
                    context.chat = records.slice(1);
                    context.chatMetadata = records[0].chat_metadata;
                    context.chatId = target.file;
                }

                if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                    return 'superseded';
                }

                if (!isCurrentStorage(storage)) throw new Error('chat-storage-unavailable');
                storeActivated = Boolean(rt);
                activatedEpoch = commitTicket;
                const finalMessages = context.chat;
                const baseReady = committedSnapshot ?? snapshot;
                const readySnapshot: ChatSnapshot = {
                    ...baseReady,
                    status: 'ready',
                    key,
                    canSend: rt
                        ? sessionPublishedKey === key
                            ? Boolean(baseReady.canSend)
                            : Boolean(rt.ready ?? true)
                        : true,
                    messages: mapMessages(finalMessages),
                    recalledPrompt: String(
                        context.extensionPrompts?.vc_long_term_memory?.value ?? '',
                    ),
                };
                committedSnapshot = readySnapshot;
                if (!readAbort) {
                    snapshot = readySnapshot;
                    emit();
                }
                if (queryClient) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
                }
                return 'opened';
            } catch (error: any) {
                if (!committed) {
                    if (
                        dead ||
                        preflightCancelled ||
                        ticket !== openEpoch ||
                        readController.signal.aborted ||
                        callerAborted()
                    ) {
                        return 'superseded';
                    }
                } else if (dead || commitTicket !== commitEpoch || activeController?.signal.aborted) {
                    return 'superseded';
                }
                retryRow = target;
                const identityRevoked = [401, 403].includes(error?.status) ||
                    error?.code === 'ACCOUNT_CONTEXT_CHANGED';
                const revoked = identityRevoked || error?.status === 404;
                const keepDisplay = committed && activeStorage?.mode === 'GO' && !revoked;
                if ((committed && activeStorage?.mode === 'GO') ||
                    identityRevoked || (revoked && target?.key === committedRow?.key)) {
                    activeAbort?.abort();
                    activatingEpoch = -1;
                    activatedEpoch = -1;
                    clearChatContext();
                }
                const migrating = chatStorage()?.mode === 'FROZEN';
                const unavailable = error?.message === 'chat-storage-unavailable';
                const errorSnapshot: ChatSnapshot = {
                    ...(committed ? (committedSnapshot ?? snapshot) : snapshot),
                    status: 'error',
                    messages: keepDisplay ? displayMessages : migrating && !revoked ? snapshot.messages : [],
                    canSend: false,
                    busy: false,
                    streamingKey: null,
                    notice: migrating ? MIGRATING_NOTICE : keepDisplay ? HISTORY_RETRY_NOTICE : '',
                    error:
                        unavailable
                            ? '暂时不可用，请稍后重试。'
                            : error?.status === 401 || error?.status === 409
                                ? '登录状态或聊天已变化，请重新打开页面。'
                                : '聊天没有加载出来，请重试。',
                };
                if (committed || (revoked && target?.key === committedRow?.key)) {
                    committedSnapshot = errorSnapshot;
                } else if (identityRevoked) {
                    committedSnapshot = null;
                }
                if (!readAbort || readAbort === readController) {
                    if (readAbort === readController) {
                        readAbort = null;
                    }
                    snapshot = errorSnapshot;
                    emit();
                }
                return 'failed';
            } finally {
                if (!storeActivated) chatStore?.close?.();
                detachCallerSignals();
                if (readAbort === readController) {
                    readAbort = null;
                }
                if (inFlightOpen === runOpen) {
                    inFlightOpen = null;
                    inFlightKey = '';
                    inFlightCommitted = false;
                }
            }
        })();

        inFlightOpen = runOpen;
        return runOpen;
    }

    const bridge: SessionBridge = {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot() {
            return snapshot;
        },
        open,
        async send(text, sendOpts = {}) {
            if (!hasActivatedChat()) return false;
            if (sendOpts.type === 'continue') {
                const rt = runtimeInstance ?? (await ensureRuntime().catch(() => null));
                if (dead || !rt) return false;
                const ok = Boolean(await rt.continue?.());
                if (!dead && ok) invalidateChatQueries();
                return !dead && ok;
            }
            const rt = runtimeInstance ?? (await ensureRuntime().catch(() => null));
            if (dead || !rt) return false;
            const draftInput =
                sendOpts.draftInput !== undefined ? sendOpts.draftInput : text;
            const ok = Boolean(
                await rt.send(text, {
                    retry: sendOpts.retry,
                    voiceInput: sendOpts.voiceInput,
                    draftInput,
                }),
            );
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async stop() {
            if (dead) return;
            await runtimeInstance?.stop?.();
        },
        async retry() {
            if (dead) return false;
            if (snapshot.status === 'loading') return false;
            if (snapshot.conflict || !snapshot.canSend) {
                const row = retryRow || activeRow;
                if (row) {
                    return (await open(row, { latest: true })) === 'opened';
                }
            }
            if (!hasActivatedChat()) return false;
            const ok = Boolean(await runtimeInstance?.retry?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async continue() {
            if (!hasActivatedChat()) return false;
            const ok = Boolean(await runtimeInstance?.continue?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async regenerate() {
            if (!hasActivatedChat()) return false;
            const ok = Boolean(await runtimeInstance?.regenerate?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async edit(index, text) {
            const message = fullMessage(snapshot.messages[index]);
            if (!message) return false;
            const ok = Boolean(await runtimeInstance?.edit?.(message.index, text, message.raw));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async remove(index) {
            const message = fullMessage(snapshot.messages[index]);
            if (!message) return false;
            const ok = Boolean(await runtimeInstance?.remove?.(message.index, message.raw));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async swipe(index, delta) {
            const message = fullMessage(snapshot.messages[index]);
            if (!message) return false;
            const ok = Boolean(await runtimeInstance?.swipe?.(message.index, delta, message.raw));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async react(index, emoji) {
            const message = fullMessage(snapshot.messages[index]);
            if (!message) return false;
            const ok = Boolean(await runtimeInstance?.react?.(message.index, emoji, message.raw));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async pat() {
            if (!hasActivatedChat()) return false;
            const ok = Boolean(await runtimeInstance?.pat?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async whenIdle() {
            if (dead) return;
            const rt = runtimeInstance ?? (await ensureRuntime().catch(() => null));
            if (dead || !rt) return;
            await rt.whenIdle?.();
        },
        async createConversation(input) {
            if (dead) return undefined;
            const [rt] = await Promise.all([ensureRuntime(), charactersReady]);
            if (dead || !rt) return undefined;
            const created = await rt.createConversation(input);
            if (dead) return undefined;
            if (queryClient && created) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.relationships });
                void queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
            }
            return created;
        },
        async projectStory(job) {
            if (dead || !chatRuntimeAvailable()) return undefined;
            const rt = runtimeInstance ?? (await ensureRuntime());
            if (dead || !rt) return undefined;
            const result = await rt.projectStory(job);
            if (!dead) {
                invalidateChatQueries();
            }
            return result;
        },
        story: {
            async setRun(turn) {
                if (dead || !chatRuntimeAvailable()) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.setRun(turn);
            },
            async selectActor(actor) {
                if (dead || !chatRuntimeAvailable()) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.selectActor(actor);
            },
            async advance(turn) {
                if (dead || !chatRuntimeAvailable()) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.advance(turn);
            },
            async clear() {
                if (dead || !chatRuntimeAvailable()) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.clear();
            },
        },
        async applySettings(changes) {
            await applyConfiguration(async rt => {
                await rt.applySettings(changes);
                if (dead) return;
                const power = context.powerUserSettings;
                if (power) {
                    const sendOnEnter = power.send_on_enter;
                    snapshot = {
                        ...snapshot,
                        enterToSend:
                            sendOnEnter === undefined ? snapshot.enterToSend : Number(sendOnEnter) !== -1,
                        preferences: { ...power },
                    };
                    emit();
                }
            });
        },
        async applyPreset(apiId, name, changes, value) {
            await applyConfiguration(rt => rt.applyPreset(apiId, name, changes, value));
        },
        async applyWorldbook(name, value, action) {
            await applyConfiguration(rt => rt.applyWorldbook(name, value, action));
        },
        async reloadCharacter(avatar) {
            await applyConfiguration(async rt => {
                await rt.reloadCharacter(avatar);
                if (!dead && queryClient) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
                }
            });
        },
        async commitMetadata(changes, expectedKey = snapshot.key) {
            if (!hasActivatedChat()) return;
            const rt = runtimeInstance ?? (await ensureRuntime());
            if (dead || !rt) return;
            await rt.commitMetadata(changes, expectedKey);
        },
        async deleteCharacter(avatar, deleteChats) {
            if (dead || !chatRuntimeAvailable()) return;
            if (parseConversationKey(inFlightKey)?.avatar === avatar) {
                readAbort?.abort();
                readAbort = null;
                openEpoch += 1;
                inFlightOpen = null;
                inFlightKey = '';
                inFlightCommitted = false;
            }
            const rt = runtimeInstance;
            if (rt) {
                await rt.deleteCharacter(avatar, deleteChats);
            } else {
                const f2 = createF2Client();
                if (committedRow && committedMetadata) {
                    f2.loaded(characterChatPath(committedRow.avatar, committedRow.file), committedMetadata);
                }
                const io = createNativeF2IO({ getRequestHeaders: client.headers, client: f2 });
                const rows = deleteChats
                    ? await client.request('/api/characters/chats', { avatar_url: avatar, simple: true })
                    : [];
                const baselines = await io.baselines((Array.isArray(rows) ? rows : []).map(row => ({ avatar, file: row.file_name })));
                if (dead) return;
                await client.post('/api/characters/delete', { avatar_url: avatar, delete_chats: deleteChats, vc_f2_chats: baselines });
            }
            if (dead) return;
            await bridge.cancelForCharacterDelete(avatar);
            if (dead) return;
            await bridge.reloadCharacter(avatar);
            if (!dead && queryClient) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
                void queryClient.invalidateQueries({ queryKey: queryKeys.relationships });
                void queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
            }
        },
        async refreshCatalog() {
            if (dead) return;
            const rt = runtimeInstance ?? (await ensureRuntime());
            if (dead || !rt) return;
            await rt.refreshCatalog();
        },
        async setBudget(value) {
            if (dead) return;
            const rt = runtimeInstance ?? (await ensureRuntime());
            if (dead || !rt) return;
            await rt.setBudget(value);
        },
        mountLeaf(index, host) {
            const message = snapshot.messages[index];
            if (dead || !message) return () => {};
            const entry: LeafEntry = {
                conversationKey: snapshot.key,
                key: message.key,
                index,
                renderedText: '',
                renderedSwipe: undefined,
                renderedStreaming: false,
                renderedWithCards: false,
                renderedEpoch: -1,
            };
            mountedLeaves.set(host, entry);
            renderLeaf(host, entry, message);

            return () => {
                if (mountedLeaves.get(host) !== entry) return;
                mountedLeaves.delete(host);
                if (typeof entry.cardCleanup === 'function') {
                    entry.cardCleanup();
                } else {
                    host.replaceChildren();
                }
            };
        },
        draft: {
            read(key = snapshot.key) {
                return readScopedDraft(key, false);
            },
            write(key, value) {
                writeScopedDraft(key || snapshot.key, value);
            },
            storageId(key = snapshot.key) {
                return draftStorageId(key);
            },
        },
        mountCardActions(node) {
            if (dead) return;
            const entry: CardActionsEntry = { key: snapshot.key, mountedEpoch: -1 };
            cardActions.set(node, entry);
            syncCardActions();
            return () => {
                if (cardActions.get(node) !== entry) return;
                cardActions.delete(node);
                entry.cleanup?.();
            };
        },
        resolvePopup(result) {
            snapshot.popupRequest?.resolve(result);
        },
        resolvePersonaChoice(avatar) {
            snapshot.personaChoice?.resolve(avatar);
        },
        async copyRejected() {
            if (dead) return '';
            const text =
                (await runtimeInstance?.copyRejected?.()) ||
                snapshot.conflictSnapshot?.input ||
                '';
            if (dead) return text;
            if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(text);
                if (!dead) {
                    toast.show({ title: '已复制', kind: 'success' });
                }
            }
            return text;
        },
        async resolveConflictLatest() {
            const row = retryRow || activeRow;
            snapshot = { ...snapshot, conflict: false, conflictSnapshot: null };
            emit();
            if (row) {
                return open(row, { latest: true });
            }
            return 'failed';
        },
        dismissConflict() {
            snapshot = { ...snapshot, conflict: false, conflictSnapshot: null };
            emit();
        },
        markVoicePlayed(index) {
            const raw = fullMessage(snapshot.messages[index])?.raw;
            if (!raw?.extra?.vc_voice) return;
            raw.extra.vc_voice.played = true;
            void context.saveChatConditional?.();
            snapshot = {
                ...snapshot,
                messages: mapMessages(context.chat),
            };
            emit();
        },
        async cancelForCharacterDelete(avatar) {
            if (
                activeRow?.avatar === avatar ||
                committedRow?.avatar === avatar ||
                parseConversationKey(inFlightKey)?.avatar === avatar
            ) {
                readAbort?.abort();
                readAbort = null;
                activeAbort?.abort();
                activeAbort = null;
                openEpoch += 1;
                commitEpoch += 1;
                inFlightOpen = null;
                inFlightKey = '';
                inFlightCommitted = false;
                activeRow = null;
                committedRow = null;
                committedMetadata = null;
                committedSnapshot = null;
                retryRow = null;
                await runtimeInstance?.stop?.();
                snapshot = {
                    ...snapshot,
                    key: '',
                    messages: [],
                    status: 'empty',
                    canSend: false,
                    busy: false,
                    streamingKey: null,
                    notice: '',
                    error: '',
                    conflict: false,
                    conflictSnapshot: null,
                };
                emit();
            }
        },
        setFirstDisplayedMessageId(key: string, id: number | null) {
            if (!key) return;
            if (id === null) {
                if (firstDisplayedState.key === key) {
                    firstDisplayedState = { key, id: null };
                }
                return;
            }
            if (typeof id === 'number' && Number.isInteger(id) && id >= 0) {
                firstDisplayedState = {
                    key,
                    id,
                    messageKey: snapshot.key === key ? snapshot.messages[id]?.key : undefined,
                };
            }
        },
        getContext() {
            return context;
        },
        destroy() {
            dead = true;
            const pendingPopup = snapshot.popupRequest;
            const pendingPersona = snapshot.personaChoice;
            if (pendingPopup || pendingPersona) {
                snapshot = {
                    ...snapshot,
                    popupRequest: null,
                    personaChoice: null,
                };
            }
            pendingPopup?.resolve(pendingPopup.type === 3 ? null : 0);
            pendingPersona?.resolve('');
            runtimeAbort?.abort();
            runtimeAbort = null;
            pendingConfiguration.length = 0;
            committedMetadata = null;
            readAbort?.abort();
            activeAbort?.abort();
            listeners.clear();
            for (const [host, entry] of mountedLeaves.entries()) {
                if (typeof entry.cardCleanup === 'function') {
                    entry.cardCleanup();
                } else {
                    host.replaceChildren();
                }
            }
            mountedLeaves.clear();
            for (const entry of cardActions.values()) entry.cleanup?.();
            cardActions.clear();
            runtimeInstance?.destroy?.();
            if (typeof globalThis !== 'undefined') {
                const currentSt = (globalThis as any).SillyTavern;
                let ownsGlobal = currentSt === stOwner;
                if (!ownsGlobal && typeof currentSt?.getContext === 'function') {
                    try {
                        ownsGlobal = currentSt.getContext() === context;
                    } catch {
                        ownsGlobal = false;
                    }
                }
                if (ownsGlobal) {
                    delete (globalThis as any).SillyTavern;
                }
            }
        },
    };

    return bridge;
}

const SessionBridgeContext = createContext<SessionBridge | null>(null);

export function SessionBridgeProvider({
    bridge,
    children,
}: {
    bridge: SessionBridge;
    children: ReactNode;
}) {
    return React.createElement(SessionBridgeContext.Provider, { value: bridge }, children);
}

export function useSessionBridge(): SessionBridge {
    const bridge = useContext(SessionBridgeContext);
    if (!bridge) {
        throw new Error('useSessionBridge must be used within SessionBridgeProvider');
    }
    return bridge;
}

export function useChatSnapshot(bridge?: SessionBridge): ChatSnapshot;
export function useChatSnapshot<T>(
    selector: (snapshot: ChatSnapshot) => T,
    bridge?: SessionBridge,
): T;
export function useChatSnapshot<T>(
    arg1?: SessionBridge | ((snapshot: ChatSnapshot) => T),
    arg2?: SessionBridge,
): T | ChatSnapshot {
    const contextBridge = useContext(SessionBridgeContext);
    const isSelector = typeof arg1 === 'function';
    const resolvedBridge = (isSelector ? arg2 : (arg1 as SessionBridge | undefined)) ?? contextBridge;
    if (!resolvedBridge) {
        throw new Error('useChatSnapshot requires a SessionBridge or SessionBridgeProvider');
    }
    const selector = isSelector
        ? (arg1 as (snapshot: ChatSnapshot) => T)
        : ((s: ChatSnapshot) => s as unknown as T);
    return useSyncExternalStore(
        resolvedBridge.subscribe,
        () => selector(resolvedBridge.getSnapshot()),
        () => selector(resolvedBridge.getSnapshot()),
    );
}
