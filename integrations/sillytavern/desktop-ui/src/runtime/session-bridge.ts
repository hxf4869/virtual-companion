import React, { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { prepareChatRuntime } from '../../../extension/vc-model-settings/desktop/standalone/runtime.js';
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
    getContext(): any;
    destroy(): void;
}

export interface SessionBridgeDeps {
    queryClient?: QueryClient;
    prepareRuntime?: typeof prepareChatRuntime;
}

interface LeafEntry {
    key: string;
    raw: any;
    index: number;
    renderedText: string;
    renderedSwipe: number | undefined;
    renderedStreaming: boolean;
    renderedWithCards: boolean;
    cardCleanup?: (() => void) | void;
}

export function createSessionBridge(
    client: AppClient,
    deps: SessionBridgeDeps = {},
): SessionBridge {
    const queryClient = deps.queryClient;
    const prepareRuntimeFn = deps.prepareRuntime ?? prepareChatRuntime;
    const listeners = new Set<() => void>();
    const drafts = new Map<string, string>();
    const mountedLeaves = new Map<HTMLElement, LeafEntry>();

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
    let committedRow: NormalizedRow | null = null;
    let committedMetadata: Record<string, any> | null = null;
    let committedSnapshot: ChatSnapshot | null = null;
    let sessionPublishedKey = '';
    let retryRow: NormalizedRow | null = null;
    let attachCallerSignal: ((signal: AbortSignal) => void) | null = null;
    let runtimeInstance: any = null;
    let runtimePromise: Promise<any> | null = null;
    let charactersReady: Promise<any> = Promise.resolve([]);
    let dead = false;
    const pendingConfiguration: Array<(runtime: any) => unknown> = [];

    async function applyConfiguration(apply: (runtime: any) => unknown): Promise<void> {
        if (dead) return;
        if (!runtimeInstance) {
            pendingConfiguration.push(apply);
            return;
        }
        await apply(runtimeInstance);
    }

    const eventSource = new EventEmitter([event_types.APP_INITIALIZED, event_types.APP_READY]);
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
    };

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

    function messageKeyFromSession(raw: any, index: number): string {
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
            key: keys?.[index] || messageKeyFromSession(raw, index),
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
        if (typeof document !== 'undefined' && document.body) {
            document.body.dataset.generating = String(Boolean(busy));
        }
    }

    function renderLeaf(host: HTMLElement, entry: LeafEntry) {
        const rawMsg =
            entry.raw ??
            context.chat[entry.index] ?? {
                mes: snapshot.messages[entry.index]?.mes ?? '',
                is_user: snapshot.messages[entry.index]?.is_user,
                is_system: snapshot.messages[entry.index]?.is_system,
                swipe_id: snapshot.messages[entry.index]?.swipe_id,
            };
        const streaming = Boolean(
            snapshot.busy &&
                entry.index === context.chat.length - 1 &&
                !rawMsg.is_user &&
                !rawMsg.is_system,
        );

        if (runtimeInstance?.renderMessage && snapshot.status === 'ready') {
            entry.cardCleanup = runtimeInstance.renderMessage(
                host,
                entry.index,
                rawMsg,
                streaming,
            );
            entry.renderedWithCards = true;
        } else {
            if (entry.renderedWithCards) {
                entry.cardCleanup?.();
                entry.cardCleanup = undefined;
            }
            let textEl = host.querySelector<HTMLElement>(':scope > .mes_text');
            if (!textEl) {
                textEl = host.ownerDocument.createElement('div');
                textEl.className = 'mes_text';
                host.replaceChildren(textEl);
            }
            textEl.textContent = String(rawMsg.mes ?? '');
            entry.renderedWithCards = false;
        }

        entry.renderedText = String(rawMsg.mes ?? '');
        entry.renderedSwipe = rawMsg.swipe_id;
        entry.renderedStreaming = streaming;
    }

    function syncMountedLeaves() {
        for (const [host, entry] of mountedLeaves.entries()) {
            if (!host.isConnected) continue;
            let nextIndex = entry.raw ? context.chat.indexOf(entry.raw) : -1;
            if (nextIndex < 0) {
                const byKeyIdx = snapshot.messages.findIndex(m => m.key === entry.key);
                if (byKeyIdx >= 0 && context.chat[byKeyIdx]) {
                    nextIndex = byKeyIdx;
                    entry.raw = context.chat[byKeyIdx];
                }
            }
            if (nextIndex < 0) continue;

            const rawMsg = context.chat[nextIndex];
            const streaming = Boolean(
                snapshot.busy &&
                    nextIndex === context.chat.length - 1 &&
                    !rawMsg?.is_user &&
                    !rawMsg?.is_system,
            );
            const hasCards = Boolean(runtimeInstance?.renderMessage && snapshot.status === 'ready');
            const needsUpdate =
                nextIndex !== entry.index ||
                String(rawMsg?.mes ?? '') !== entry.renderedText ||
                rawMsg?.swipe_id !== entry.renderedSwipe ||
                streaming !== entry.renderedStreaming ||
                (hasCards && !entry.renderedWithCards);

            if (needsUpdate) {
                entry.index = nextIndex;
                renderLeaf(host, entry);
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
        return new Promise(resolve => {
            const id = ++popupSeq;
            const textContent =
                typeof content === 'string'
                    ? content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
                    : String(content?.textContent ?? content ?? '').trim();
            const popupType = (type === 2 || type === 3 ? type : 1) as 1 | 2 | 3;
            snapshot = {
                ...snapshot,
                popupRequest: {
                    id,
                    type: popupType,
                    content: textContent,
                    initial: String(initial ?? ''),
                    resolve(result) {
                        if (snapshot.popupRequest?.id === id) {
                            snapshot = { ...snapshot, popupRequest: null };
                            emit();
                        }
                        resolve(result);
                    },
                },
            };
            emit();
        });
    }

    function choosePersona(
        personaOptions: PersonaChoiceOption[],
        { signal }: { signal?: AbortSignal } = {},
    ): Promise<string> {
        return new Promise(resolve => {
            const id = ++personaSeq;
            const finish = (avatar: string) => {
                signal?.removeEventListener('abort', onAbort);
                if (snapshot.personaChoice?.id === id) {
                    snapshot = { ...snapshot, personaChoice: null };
                    emit();
                }
                resolve(avatar);
            };
            const onAbort = () => finish('');
            signal?.addEventListener('abort', onAbort, { once: true });
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

    function ensureRuntime(): Promise<any> {
        if (dead) return Promise.resolve(null);
        if (runtimePromise) return runtimePromise;
        if (!deps.prepareRuntime && (!client || typeof (client as any).settings !== 'function')) {
            return Promise.resolve(null);
        }

        snapshot = { ...snapshot, runtime: 'preparing' };
        emit();

        charactersReady =
            typeof client.characters === 'function'
                ? client
                      .characters()
                      .then((chars: any[]) => {
                          if (Array.isArray(chars)) context.characters = chars;
                          return chars;
                      })
                      .catch(() => {
                          if (typeof document !== 'undefined' && document.documentElement) {
                              document.documentElement.dataset.vcCharacters = 'error';
                          }
                          return [];
                      })
                : Promise.resolve([]);

        void client
            .settings()
            .then((packet: any) => {
                if (dead || !packet?.settings) return;
                const parsed = JSON.parse(packet.settings);
                const power = parsed?.power_user || {};
                const sendOnEnter = power.send_on_enter;
                snapshot = {
                    ...snapshot,
                    enterToSend: sendOnEnter === undefined ? true : Number(sendOnEnter) !== -1,
                    preferences: { ...power },
                };
                if (!context.chatId) {
                    context.name1 = parsed.username || '';
                    context.userAvatar = parsed.user_avatar || '';
                }
                emit();
            })
            .catch(() => {});

        runtimePromise = prepareRuntimeFn({
            client,
            context,
            choosePersona,
            callGenericPopup,
            readInput: () => readScopedDraft(snapshot.key, false),
            onToast: (message: string, opts?: { type?: string }) => {
                toast.show({
                    title: String(message || ''),
                    kind:
                        opts?.type === 'failure' || opts?.type === 'error'
                            ? 'error'
                            : 'success',
                });
            },
            onConflict: (serialized: string, error: any) => {
                if (dead) return;
                const activeKey = committedSnapshot?.key || snapshot.key;
                const nextConflictSnapshot = {
                    raw: serialized,
                    input: readScopedDraft(activeKey, false),
                    code: error?.code || 'VC_REVISION_CONFLICT',
                };
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
                if (dead) return;
                const matchesCommitted = Boolean(
                    committedSnapshot && state.key === committedSnapshot.key,
                );
                const matchesVisible = !readAbort && state.key === snapshot.key;
                if (!matchesCommitted && !matchesVisible) return;

                const base = matchesVisible ? snapshot : committedSnapshot!;
                const mapped = mapMessages(state.messages || context.chat, state.messageKeys);
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
                if (readScopedDraft(key, false) === input) {
                    writeScopedDraft(key, '');
                }
            },
            onRestoreDraft: (key: string, input: string) => {
                if (input) {
                    const merged = mergeInput(readScopedDraft(key, false), input);
                    writeScopedDraft(key, merged);
                }
            },
            paint: () => {
                if (dead || !snapshot.key) return;
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
                const attemptedConfiguration: Array<(runtime: any) => unknown> = [];
                try {
                    while (!dead && pendingConfiguration.length) {
                        const apply = pendingConfiguration.shift()!;
                        attemptedConfiguration.push(apply);
                        await apply(rt);
                    }
                } catch (error) {
                    if (!dead) pendingConfiguration.unshift(...attemptedConfiguration);
                    rt?.destroy?.();
                    throw error;
                }
                if (dead) {
                    rt?.destroy?.();
                    return rt;
                }
                runtimeInstance = rt;
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.dataset.vcRuntime = 'prepared';
                }
                snapshot = { ...snapshot, runtime: 'prepared' };
                await eventSource.emit(event_types.APP_INITIALIZED);
                await eventSource.emit(event_types.APP_READY);
                emit();
                return rt;
            })
            .catch((err: any) => {
                runtimePromise = null;
                if (dead) throw err;
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.dataset.vcRuntime = 'error';
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

    if (deps.prepareRuntime || (client && typeof (client as any).settings === 'function')) {
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
            if (snapshot.status === 'ready' && snapshot.key === provisionalKey) {
                return 'opened';
            }
        }

        readAbort?.abort();
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
            try {
                if (
                    (!target?.avatar || !target?.file) &&
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

                const runtimeTask = ensureRuntime();
                void runtimeTask.catch(() => {});
                const records = await client.readChat(
                    { avatar: target.avatar, file: target.file },
                    { signal: readController.signal },
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
                if (!Array.isArray(records) || !records[0]?.chat_metadata) {
                    throw new Error('聊天没有加载出来');
                }

                // Commit boundary: preflight readChat succeeded, detach caller route-leave signals
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

                committedRow = target;
                committedMetadata = records[0].chat_metadata;
                activeRow = target;
                retryRow = null;
                sessionPublishedKey = '';
                readScopedDraft(key, true);
                const binding = records[0].chat_metadata?.vc_binding;
                const initialCard = context.characters.find((c: any) => c.avatar === target!.avatar);
                const initialTitle =
                    initialCard?.name || target.title || target.avatar.replace(/\.png$/i, '');

                committedSnapshot = {
                    ...snapshot,
                    status: 'switching',
                    key,
                    messages: !runtimeInstance ? mapMessages(records.slice(1)) : snapshot.messages,
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
                    notice: '',
                    error: '',
                    conflict: false,
                    conflictSnapshot: null,
                    canSend: false,
                };
                if (!readAbort) {
                    snapshot = committedSnapshot;
                    emit();
                }

                const [rt] = await Promise.all([runtimeTask, charactersReady]);

                if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                    return 'superseded';
                }

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

                if (rt) {
                    await rt.activate(
                        { avatar: target.avatar, file: target.file },
                        records,
                        {
                            signal: activeController.signal,
                            latest,
                        },
                    );
                } else {
                    context.chat = records.slice(1);
                    context.chatMetadata = records[0].chat_metadata;
                    context.chatId = target.file;
                }

                if (dead || commitTicket !== commitEpoch || activeController.signal.aborted) {
                    return 'superseded';
                }

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
                const errorSnapshot: ChatSnapshot = {
                    ...(committed ? (committedSnapshot ?? snapshot) : snapshot),
                    status: 'error',
                    messages: [],
                    canSend: false,
                    busy: false,
                    error:
                        error?.status === 401 || error?.status === 409
                            ? '登录状态或聊天已变化，请重新打开页面。'
                            : '聊天没有加载出来，请重试。',
                };
                if (committed) {
                    committedSnapshot = errorSnapshot;
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
            if (dead) return false;
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
            if (snapshot.conflict || !snapshot.canSend) {
                const row = retryRow || activeRow;
                if (row) {
                    return (await open(row, { latest: true })) === 'opened';
                }
            }
            const ok = Boolean(await runtimeInstance?.retry?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async continue() {
            if (dead) return false;
            const ok = Boolean(await runtimeInstance?.continue?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async regenerate() {
            if (dead) return false;
            const ok = Boolean(await runtimeInstance?.regenerate?.());
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async edit(index, text) {
            if (dead) return false;
            const message = context.chat[index];
            const ok = Boolean(await runtimeInstance?.edit?.(index, text, message));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async remove(index) {
            if (dead) return false;
            const message = context.chat[index];
            const ok = Boolean(await runtimeInstance?.remove?.(index, message));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async swipe(index, delta) {
            if (dead) return false;
            const message = context.chat[index];
            const ok = Boolean(await runtimeInstance?.swipe?.(index, delta, message));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async react(index, emoji) {
            if (dead) return false;
            const message = context.chat[index];
            const ok = Boolean(await runtimeInstance?.react?.(index, emoji, message));
            if (!dead && ok) invalidateChatQueries();
            return !dead && ok;
        },
        async pat() {
            if (dead) return false;
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
            if (dead) return undefined;
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
                if (dead) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.setRun(turn);
            },
            async selectActor(actor) {
                if (dead) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.selectActor(actor);
            },
            async advance(turn) {
                if (dead) return;
                const rt = runtimeInstance ?? (await ensureRuntime());
                if (dead || !rt) return;
                await rt.story?.advance(turn);
            },
            async clear() {
                if (dead) return;
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
            if (dead) return;
            const rt = runtimeInstance ?? (await ensureRuntime());
            if (dead || !rt) return;
            await rt.commitMetadata(changes, expectedKey);
        },
        async deleteCharacter(avatar, deleteChats) {
            if (dead) return;
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
            const raw = context.chat[index];
            const msgSnap = snapshot.messages[index];
            const entry: LeafEntry = {
                key: msgSnap?.key ?? (raw ? messageKeyFromSession(raw, index) : String(index)),
                raw,
                index,
                renderedText: '',
                renderedSwipe: undefined,
                renderedStreaming: false,
                renderedWithCards: false,
                cardCleanup: undefined,
            };
            mountedLeaves.set(host, entry);
            renderLeaf(host, entry);

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
            if (runtimeInstance?.mountCardActions) {
                return runtimeInstance.mountCardActions(node);
            }
            let cleanup: (() => void) | void;
            let disposed = false;
            void ensureRuntime()
                .then(rt => {
                    if (!disposed && rt?.mountCardActions && node.isConnected) {
                        cleanup = rt.mountCardActions(node);
                    }
                })
                .catch(() => {});
            return () => {
                disposed = true;
                if (typeof cleanup === 'function') cleanup();
            };
        },
        resolvePopup(result) {
            snapshot.popupRequest?.resolve(result);
        },
        resolvePersonaChoice(avatar) {
            snapshot.personaChoice?.resolve(avatar);
        },
        async copyRejected() {
            const text =
                (await runtimeInstance?.copyRejected?.()) ||
                snapshot.conflictSnapshot?.input ||
                '';
            if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(text);
                toast.show({ title: '已复制', kind: 'success' });
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
            const raw = context.chat[index];
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
        getContext() {
            return context;
        },
        destroy() {
            dead = true;
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
