import { vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDesktopSession } from '../../../extension/vc-model-settings/desktop/standalone/session.js';
import {
    createSessionBridge,
    type SessionBridge,
} from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import type { ConversationRow } from '../../src/data/queries/chat';

export interface TestMessageRecord {
    name?: string;
    mes: string;
    send_date?: string;
    is_user?: boolean;
    is_system?: boolean;
    swipe_id?: number;
    swipes?: string[];
    extra?: Record<string, any>;
}

export interface CreateTestChatEnvOptions {
    conversations?: Partial<ConversationRow>[];
    chatsByKey?: Record<string, TestMessageRecord[]>;
    mountWithIframe?: boolean;
    onActivate?: (
        row: { avatar: string; file: string },
        records: any[],
        options: { signal?: AbortSignal; latest?: boolean },
    ) => Promise<void> | void;
    streamChunks?: string[];
    holdStream?: boolean;
}

export function createTestChatEnv(options: CreateTestChatEnvOptions = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Infinity,
            },
        },
    });

    const conversations: ConversationRow[] = (options.conversations ?? [
        {
            key: '["alice.png","chat-1"]',
            avatar: 'alice.png',
            avatarUrl: '/characters/alice.png',
            file: 'chat-1',
            title: 'Alice',
            preview: 'Hello',
            updatedAt: 1000,
            timeText: '刚刚',
            relationshipId: 'rel-1',
            characterRef: 'char-ref-alice',
            mode: 'COMPANION',
        },
    ]).map(c => ({
        key: c.key || `["${c.avatar || 'alice.png'}","${c.file || 'chat-1'}"]`,
        avatar: c.avatar || 'alice.png',
        avatarUrl: c.avatarUrl || `/characters/${c.avatar || 'alice.png'}`,
        file: (c.file || 'chat-1').replace(/\.jsonl$/i, ''),
        title: c.title || 'Alice',
        preview: c.preview || '',
        updatedAt: c.updatedAt ?? 1000,
        timeText: c.timeText || '',
        relationshipId: c.relationshipId || 'rel-1',
        characterRef: c.characterRef || `ref-${c.avatar || 'alice.png'}`,
        mode: c.mode || 'COMPANION',
    }));

    const storedChats = new Map<string, any[]>();
    for (const conv of conversations) {
        const initialMsgs = options.chatsByKey?.[conv.key] ?? [];
        storedChats.set(conv.key, [
            {
                chat_metadata: {
                    integrity: `int-${conv.file}`,
                    vc_f2: { id: `f2-${conv.file}`, revision: 1 },
                    vc_binding: {
                        relationshipId: conv.relationshipId,
                        conversationId: `conv-${conv.file}`,
                        mode: conv.mode || 'COMPANION',
                    },
                },
            },
            ...initialMsgs.map((m, idx) => ({
                name: m.name ?? (m.is_user ? '你' : conv.title),
                mes: m.mes,
                send_date: m.send_date ?? `2026-11-04T10:0${idx}:00.000Z`,
                is_user: Boolean(m.is_user),
                is_system: Boolean(m.is_system),
                swipe_id: m.swipe_id ?? 0,
                swipes: m.swipes ?? [m.mes],
                extra: m.extra ? structuredClone(m.extra) : {},
            })),
        ]);
    }

    const savedPayloads: any[] = [];
    const sentInputs: string[] = [];
    const renderCallsByHost = new WeakMap<HTMLElement, number>();
    const mountCountByHost = new WeakMap<HTMLElement, number>();
    let totalMountLeafCalls = 0;

    let streamController: {
        pushChunk: (chunk: string) => void;
        finish: () => void;
    } | null = null;

    const client = {
        identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
        headers: () => ({ 'Content-Type': 'application/json' }),
        initialize: vi.fn(async () => ({
            characters: conversations.map(c => ({
                avatar: c.avatar,
                name: c.title,
                description: '',
                data: { extensions: { vc_character_ref: c.characterRef } },
            })),
            chat: [],
            settings: {},
        })),
        characters: vi.fn(async () =>
            conversations.map(c => ({
                avatar: c.avatar,
                name: c.title,
                description: '',
                data: { extensions: { vc_character_ref: c.characterRef } },
            })),
        ),
        recent: vi.fn(async () =>
            conversations.map(c => ({
                avatar: c.avatar,
                file_name: `${c.file}.jsonl`,
                mes: c.preview,
                last_mes: c.updatedAt,
            })),
        ),
        settings: vi.fn(async () => ({
            settings: JSON.stringify({
                username: '你',
                user_avatar: 'user.png',
                power_user: { send_on_enter: 1, swipes: true },
                oai_settings: { preset_settings_openai: 'Default' },
            }),
            openai_setting_names: ['Default'],
            openai_settings: [JSON.stringify({})],
            world_names: [],
        })),
        readChat: vi.fn(async ({ avatar, file }: { avatar: string; file: string }) => {
            const cleanFile = String(file).replace(/\.jsonl$/i, '');
            const key = JSON.stringify([avatar, cleanFile]);
            const existing = storedChats.get(key);
            if (existing) return structuredClone(existing);
            return [
                {
                    chat_metadata: {
                        integrity: `int-${cleanFile}`,
                        vc_f2: { id: `f2-${cleanFile}`, revision: 1 },
                        vc_binding: {
                            relationshipId: 'rel-default',
                            conversationId: `conv-${cleanFile}`,
                            mode: 'COMPANION',
                        },
                    },
                },
            ];
        }),
        request: vi.fn(async (url: string, body?: any) => {
            if (url === '/api/avatars/get') {
                return ['user.png'];
            }
            if (url === '/api/characters/get') {
                const avatar = body?.avatar_url || 'alice.png';
                const conv = conversations.find(c => c.avatar === avatar);
                return {
                    avatar,
                    name: conv?.title || avatar.replace(/\.png$/i, ''),
                    data: {
                        extensions: {
                            vc_character_ref: conv?.characterRef || `ref-${avatar}`,
                        },
                    },
                };
            }
            return {};
        }),
        generate: vi.fn(async () => ({})),
        post: vi.fn(async () => ({})),
        raw: vi.fn(async (url: string, serialized: string) => {
            if (url === '/api/chats/save') {
                const parsed = JSON.parse(serialized);
                savedPayloads.push(parsed);
                const key = JSON.stringify([
                    parsed.avatar_url,
                    String(parsed.file_name).replace(/\.jsonl$/i, ''),
                ]);
                const incomingToken = parsed.chat?.[0]?.chat_metadata?.vc_f2;
                const nextToken = incomingToken
                    ? { id: incomingToken.id, revision: Number(incomingToken.revision || 0) + 1 }
                    : { id: 'f2-default', revision: 1 };
                const storedCopy = structuredClone(parsed.chat);
                if (storedCopy?.[0]?.chat_metadata) {
                    storedCopy[0].chat_metadata.vc_f2 = structuredClone(nextToken);
                }
                storedChats.set(key, storedCopy);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ result: 'ok', vc_f2: nextToken }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({}),
            };
        }),
        saveSettings: vi.fn(async () => ({})),
        settingsChanged: vi.fn(() => false),
        documents: {
            captureSettings: vi.fn(),
            seedPresets: vi.fn(),
            projectSettings: vi.fn(),
            acceptSettings: vi.fn(),
            acceptPreset: vi.fn(),
            captureWorldbook: vi.fn(),
        },
        go: {
            captureSessionContext: vi.fn(async () => ({ userId: 'u-1', sessionId: 's-1' })),
        },
    } as unknown as AppClient;

    let sessionRef: any = null;
    let prepareRuntimeCalls = 0;
    const runtimeSpies = {
        createConversation: vi.fn(),
        projectStory: vi.fn(),
        story: {
            setRun: vi.fn(),
            selectActor: vi.fn(),
            advance: vi.fn(),
            clear: vi.fn(),
        },
        applySettings: vi.fn(),
        applyPreset: vi.fn(),
        applyWorldbook: vi.fn(),
        reloadCharacter: vi.fn(),
        commitMetadata: vi.fn(),
        deleteCharacter: vi.fn(),
        refreshCatalog: vi.fn(),
        setBudget: vi.fn(),
        destroy: vi.fn(),
    };

    const bridge: SessionBridge = createSessionBridge(client, {
        queryClient,
        prepareRuntime: async ({
            client: rtClient,
            context,
            choosePersona,
            onChange,
            onTakeDraft,
            onRestoreDraft,
            onConflict,
        }: any) => {
            prepareRuntimeCalls += 1;
            const engineSettings = {
                username: '你',
                user_avatar: 'user.png',
                power_user: {
                    send_on_enter: 1,
                    continue_on_send: false,
                    swipes: true,
                    personas: { 'user.png': '你' },
                    persona_descriptions: {},
                },
                oai_settings: {
                    preset_settings_openai: 'Default',
                    stream_openai: true,
                },
            };
            context.powerUserSettings = engineSettings.power_user;

            const renderMessage = (
                host: HTMLElement,
                index: number,
                message: any,
                _streaming: boolean,
            ) => {
                renderCallsByHost.set(host, (renderCallsByHost.get(host) ?? 0) + 1);
                let textEl = host.querySelector<HTMLElement>(':scope > .mes_text');
                if (!textEl) {
                    textEl = host.ownerDocument.createElement('div');
                    textEl.className = 'mes_text';
                    host.replaceChildren(textEl);
                }

                const shouldMountIframe =
                    options.mountWithIframe || /<html|<iframe/i.test(String(message?.mes ?? ''));

                if (shouldMountIframe) {
                    let textSpan = textEl.querySelector<HTMLElement>(':scope > .vc-card-caption');
                    if (!textSpan) {
                        textSpan = host.ownerDocument.createElement('span');
                        textSpan.className = 'vc-card-caption';
                        textEl.appendChild(textSpan);
                    }
                    textSpan.textContent = String(message?.mes ?? '');

                    let iframe = textEl.querySelector<HTMLIFrameElement>('iframe');
                    if (!iframe) {
                        iframe = host.ownerDocument.createElement('iframe');
                        textEl.appendChild(iframe);
                    }
                    iframe.id = `TH-message--${index}`;
                } else {
                    textEl.textContent = String(message?.mes ?? '');
                }

                return () => {
                    host.replaceChildren();
                };
            };

            const engine = {
                settings: engineSettings,
                settingsForSave: () => engineSettings,
                bindContext: () => {},
                firstMessage: () => null,
                userMessage: async (text: string) => {
                    sentInputs.push(text);
                    return {
                        message: {
                            name: context.name1 || '你',
                            is_user: true,
                            is_system: false,
                            send_date: new Date().toISOString(),
                            mes: text,
                            extra: {},
                        },
                        bias: '',
                    };
                },
                assistantMessage: (genStarted: number) => ({
                    name: context.name2 || 'Alice',
                    is_user: false,
                    is_system: false,
                    send_date: new Date().toISOString(),
                    gen_started: genStarted,
                    mes: '',
                    swipe_id: 0,
                    swipes: [''],
                    swipe_info: [{ extra: {} }],
                    extra: {},
                }),
                prepare: async () => ({
                    body: { stream: true, chat_completion_source: 'openai', model: 'gpt-test' },
                    prompt: [],
                    stream: true,
                }),
                cleanResponse: (text: string) => String(text ?? ''),
                finalizeMessage: (msg: any) => {
                    msg.gen_finished = Date.now();
                },
                afterReply: async () => {},
                cleanUpMetadata: () => {},
                cards: {
                    settle: async () => {},
                    closeScripts: async () => {},
                    open: async () => {},
                    configure: async () => {},
                    renderMessage,
                    mountCardActions: () => () => {},
                    surface: {
                        refresh: async () => {},
                        clear: () => {},
                    },
                },
            };

            const session = createDesktopSession({
                client: rtClient,
                context,
                engine,
                prepareSourceIdentities: (records: any[]) => records,
                readResponse: async (
                    _response: any,
                    {
                        signal,
                        onUpdate,
                    }: { signal?: AbortSignal; onUpdate?: (val: any) => void } = {},
                ) => {
                    const chunks = [...(options.streamChunks ?? ['Reply from assistant'])];
                    let acc = '';
                    for (const part of chunks) {
                        signal?.throwIfAborted();
                        acc += part;
                        onUpdate?.({ text: acc, swipes: [], state: {} });
                    }
                    if (options.holdStream) {
                        await new Promise<void>((resolve, reject) => {
                            const onAbort = () =>
                                reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
                            if (signal?.aborted) {
                                onAbort();
                                return;
                            }
                            signal?.addEventListener('abort', onAbort, { once: true });
                            streamController = {
                                pushChunk(chunk: string) {
                                    acc += chunk;
                                    onUpdate?.({ text: acc, swipes: [], state: {} });
                                },
                                finish() {
                                    signal?.removeEventListener('abort', onAbort);
                                    resolve();
                                },
                            };
                        });
                    }
                    return {
                        text: acc,
                        swipes: [],
                        state: {},
                        toolCalls: [],
                        finishReason: 'stop',
                    };
                },
                choosePersona,
                onChange,
                onTakeDraft,
                onRestoreDraft,
                onConflict,
                resolveBinding: async (src: any) => ({
                    relationshipId: context.chatMetadata?.vc_binding?.relationshipId || 'rel-1',
                    conversationId: context.chatMetadata?.vc_binding?.conversationId || 'conv-1',
                    mode: src?.mode || 'COMPANION',
                }),
                reconcileSources: async () => {},
                confirmProjection: async () => ({ status: 'confirmed' }),
            });

            const origActivate = session.activate.bind(session);
            session.activate = async (row: any, records: any[], opts: any) => {
                if (options.onActivate) {
                    await options.onActivate(row, records, opts);
                }
                return origActivate(row, records, opts);
            };

            const origCreateConversation = session.createConversation.bind(session);
            const origProjectStory = session.projectStory.bind(session);
            const origDeleteCharacter = session.deleteCharacter.bind(session);
            const origCommitMetadata = session.commitMetadata.bind(session);
            const origSetBudget = session.setBudget.bind(session);

            runtimeSpies.createConversation.mockImplementation((input: any) =>
                origCreateConversation(input),
            );
            runtimeSpies.projectStory.mockImplementation(async (job: any) => ({
                status: 'projected',
                job,
            }));
            runtimeSpies.deleteCharacter.mockImplementation((avatar: string, deleteChats: boolean) =>
                origDeleteCharacter(avatar, deleteChats),
            );
            runtimeSpies.commitMetadata.mockImplementation(
                (changes: any[], expectedKey?: string) => origCommitMetadata(changes, expectedKey),
            );
            runtimeSpies.setBudget.mockImplementation((value: any) => origSetBudget(value));
            runtimeSpies.applySettings.mockImplementation(async (changes: any[]) => {
                for (const change of changes) {
                    if (change.path[0] === 'power_user' && change.path[1] === 'send_on_enter') {
                        engineSettings.power_user.send_on_enter = change.after?.value;
                        if (context.powerUserSettings) {
                            context.powerUserSettings.send_on_enter = change.after?.value;
                        }
                    }
                }
            });

            sessionRef = session;
            return Object.assign(session, {
                renderMessage,
                mountCardActions: () => () => {},
                createConversation: runtimeSpies.createConversation,
                projectStory: runtimeSpies.projectStory,
                story: runtimeSpies.story,
                applySettings: runtimeSpies.applySettings,
                applyPreset: runtimeSpies.applyPreset,
                applyWorldbook: runtimeSpies.applyWorldbook,
                reloadCharacter: runtimeSpies.reloadCharacter,
                commitMetadata: runtimeSpies.commitMetadata,
                deleteCharacter: runtimeSpies.deleteCharacter,
                refreshCatalog: runtimeSpies.refreshCatalog,
                setBudget: runtimeSpies.setBudget,
                destroy() {
                    runtimeSpies.destroy();
                    session.destroySession?.();
                },
            });
        },
    });

    const origMountLeaf = bridge.mountLeaf.bind(bridge);
    bridge.mountLeaf = (index: number, host: HTMLElement) => {
        totalMountLeafCalls += 1;
        mountCountByHost.set(host, (mountCountByHost.get(host) ?? 0) + 1);
        return origMountLeaf(index, host);
    };

    return {
        client,
        queryClient,
        bridge,
        conversations,
        savedPayloads,
        sentInputs,
        runtimeSpies,
        get prepareRuntimeCalls() {
            return prepareRuntimeCalls;
        },
        get session() {
            return sessionRef;
        },
        get streamController() {
            return streamController;
        },
        get totalMountLeafCalls() {
            return totalMountLeafCalls;
        },
        mountCountForHost(host: HTMLElement): number {
            return mountCountByHost.get(host) ?? 0;
        },
        renderCountForHost(host: HTMLElement): number {
            return renderCallsByHost.get(host) ?? 0;
        },
    };
}
