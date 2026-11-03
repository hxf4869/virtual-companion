// 正式电脑端的开发入口。不导入 ST script.js、st-context、扩展启动器或原生页面。
import { createDesktopClient } from './client.js';
import { setStHeadersProvider, captureSessionContext } from '../../api.js';
import { mountShell, registerShellTabs } from '../../shell.js';
import { chatSnapshotsFromRecent, avatarUrl } from '../../conversations.js';
import { enableVcUi } from '../../ui/theme.js';
import { iconSpriteUrl } from '../../ui/icons.js';
import { openSheet } from '../../ui/sheet.js';
import { showToast } from '../../ui/toast.js';
import { readDraft, writeDraft } from '../../chat-compose.js';
import { mergeInput, showF2Draft, createF2Client, createNativeF2IO, characterChatPath } from '../../f2-client.js';
import { createChatActions } from './chat-actions.js';
import { gapLabel, parseSendDate } from '../../chat-view.js';
import { mountDesktopFollow, posKey, readStoredNumber } from '../../chat-scroll.js';
import { mountDesktopChatView } from '../build/index.js';
import { mountDesktopShell } from '../host.js';
import { mountSettingsShell } from '../settings-shell.js';
import { mountModelSettings, observeGenerateBudget } from '../../page.js';
import { mountConsentGate } from '../../consent.js';
import { EventEmitter } from './engine/events.js';
import { event_types } from './engine/st/events.js';
import { createDesktopPreferences } from './presentation.js';
import { applyInputMarkdown } from './input-markdown.js';
import { ensureCharacterReferences, importDesktopCharacter, resolveDesktopConversation } from './business.js';
import { openMessageSource } from '../../message-source.js';
import { saveNativePersona, openCompanionStyle } from '../../persona.js';

let modelSettings, preferences, preferencesAccepted = false, budget, catalogSavedWhilePreparing = false;
const client = createDesktopClient({ onGenerateResponse: response => observeGenerateBudget(response, signal => modelSettings.applyBudget(signal)) });
const eventSource = new EventEmitter([event_types.APP_INITIALIZED, event_types.APP_READY]);
const context = { characters: [], chat: [], chatMetadata: {}, characterId: undefined, chatId: '', name1: '', name2: '',
    extensionPrompts: {}, eventSource, eventTypes: event_types };
const getContext = () => context;
const drafts = new Map();
let runtime, runtimeReady, view, shell, settingsHandle, currentRow, currentRecords, retryRow, charactersReady, editCharacter = '', read = 0, committedRead = 0, activated = 0, readAbort, activeAbort, settingsChatReady = false;
async function requireRuntime() { await runtimeReady; if (!runtime) throw new Error('聊天没有加载出来，请重试。'); return runtime; }
const pendingConfiguration = [];
const getSettingsContext = () => chat.status === 'error' ? { ...context, chatMetadata: {}, chatId: '', characterId: undefined, canEditChatMetadata: false } : currentRecords ? { ...context, chatMetadata: currentRecords[0].chat_metadata,
    chatId: currentRow.file, characterId: context.characters.findIndex(card => card.avatar === currentRow.avatar), canEditChatMetadata: chat.status === 'ready' && Boolean(runtime?.ready) } : { ...context, canEditChatMetadata: false };
function applyConfiguration(method, ...args) {
    if (runtime) return runtime[method](...args);
    pendingConfiguration.push([method, args]);
}
const draftId = key => JSON.stringify([client.identity.accountId, ...JSON.parse(key)]);
const draftOf = (key, migrate = false) => {
    if (drafts.has(key)) return drafts.get(key);
    const current = readDraft(draftId(key)), legacy = migrate ? readDraft(JSON.parse(key)[1]) : '';
    // 只在明确打开的会话迁入旧file-only键；列表中同文件名的其他角色不能抢走草稿。
    if (legacy) { const migrated = mergeInput(current, legacy); writeDraft(draftId(key), migrated); writeDraft(JSON.parse(key)[1], ''); return migrated; }
    return current;
};
function setDraft(key, value) {
    drafts.set(key, value); writeDraft(draftId(key), value); shell?.refreshConversationDrafts();
    if (chat.conversation === key) { chat.draft = value; paint(); }
}
const chat = { messages: [], status: 'empty', draft: '', sprite: iconSpriteUrl(), avatar: '', canSend: false, busy: false,
    mountFollow: (node, floatingHost) => mountDesktopFollow(node, { floatingHost, getChatId: () => chat.conversation ? draftId(chat.conversation) : '',getAutoFollow:()=>preferences?.values.auto_scroll_chat_to_bottom!==false,
        dateLabel: index => { const ms = parseSendDate(chat.messages[index]?.send_date); return ms === null ? '' : gapLabel(ms); } }),
    notice: '', conflict: false, enterToSend: true, error: '', conversation: '',
    onDraft(value) { setDraft(chat.conversation, value); },
    onFormatInput(event,node) {if(preferences?.values.enable_md_hotkeys)applyInputMarkdown(event,node);},
    onSend() { actions.send(); },
    onAction(...args) { void actions.run(...args); },
    onPat() { void runtime?.pat(); },
    onEmoji(anchor) { actions.emoji(anchor); },
    tools(index, message) { return actions.tools(index, message); },
    onStop() { void runtime?.stop(); },
    onRetry() { const row = retryRow || currentRow; if (row) return shell.openConversation(row, null, { latest: true }).then(opened => { if (opened) document.querySelector('#send_textarea')?.focus(); }); },
    onNoticeRetry() {
        if (!runtime || chat.notice === '登录状态或聊天已变化，请重新打开页面。') { location.reload(); return; }
        if (chat.conflict) return chat.onRetry();
        if (chat.settingsRequired) { void shell.openSettings('model'); return; }
        if (chat.catalogBlocked) { void runtime.refreshCatalog(); return; }
        if (chat.conflict || !chat.canSend) return chat.onRetry();
        else void runtime.retry();
    },
    async onCopyDraft() {
        try { const text = await runtime?.copyRejected(); if (text) { await navigator.clipboard.writeText(text); showToast('已复制'); } }
        catch { showToast('没有完成，请重试。', { type: 'failure' }); }
    },
};
const actions = createChatActions({ getContext, getSession: () => runtime, chat, paint });
function paint() { document.body.dataset.generating = String(chat.busy);preferences?.refresh();chat.preferences=preferences?.values; view?.update(chat); }
const chatKey = row => JSON.stringify([row.avatar, row.file]);

async function activateCurrent(ticket, latest) {
    if (!runtime || !currentRecords || activated === ticket) return;
    activated = ticket;
    const row = currentRow, records = currentRecords, signal = activeAbort.signal;
    await charactersReady;
    if (ticket !== committedRead) return;
    try { await runtime.activate(row, records, { signal, latest }); }
    catch (error) {
        if (ticket !== committedRead || signal.aborted) return;
        chat.canSend = false; chat.notice = error.status === 401 || error.status === 409
            ? '登录状态或聊天已变化，请重新打开页面。' : '聊天没有加载出来，请重试。'; paint();
    }
}

async function openConversation(row, { latest = false, beforeCommit } = {}) {
    if (!row) return false;
    actions.changed(); retryRow = null;
    readAbort?.abort(); readAbort = new AbortController();
    const controller = readAbort, stopping = runtime?.stop();
    const ticket = ++read;
    const acceptResult = async () => {
        if (ticket !== read || controller.signal.aborted) return false;
        if (beforeCommit && !await beforeCommit()) {
            if (ticket === read) { chat.status = currentRecords ? 'ready' : 'empty'; paint(); runtime?.refreshView(); }
            return false;
        }
        return ticket === read && !controller.signal.aborted;
    };
    chat.status = 'loading'; chat.error = ''; chat.notice = ''; chat.conflict = false; chat.canSend = false; chat.busy = false; paint();
    try {
        if (!row.avatar || !row.file) {
            const resolved = resolveDesktopConversation(await client.recent(), row);
            if (ticket !== read || controller.signal.aborted) return false;
            if (!resolved) throw new Error('source-unavailable');
            Object.assign(row, resolved);
        }
        const records = await client.readChat(row, { signal: controller.signal });
        await stopping;
        if (ticket !== read) return false;
        if (!Array.isArray(records) || !records[0]?.chat_metadata) throw new Error('聊天没有加载出来');
        if (!await acceptResult()) return false;
        activeAbort?.abort(); activeAbort = controller; readAbort = null;
        currentRow = row; committedRead = ticket;
        currentRecords = records;
        chat.conversation = chatKey(row); chat.historyAll = readStoredNumber(posKey(draftId(chat.conversation))) !== null;
        chat.draft = draftOf(chat.conversation, true) || ''; shell?.refreshConversationDrafts();
        Object.assign(chat, { messages: records.slice(1), status: 'ready', avatar: avatarUrl(row.avatar) });
        paint();
        void activateCurrent(ticket, latest);
        return true;
    } catch (error) {
        if (!await acceptResult()) return false;
        retryRow = row;
        chat.status = 'error'; chat.error = error.status === 401 || error.status === 409
            ? '登录状态或聊天已变化，请重新打开页面。' : '聊天没有加载出来，请重试。';
        paint(); return true;
    }
}

function choosePersona(options, { signal }) {
    return new Promise(resolve => {
        let selected = '';
        const body = document.createElement('div'); body.className = 'vc-column';
        const sheet = openSheet({ title: '人设', body, onDone() { signal?.removeEventListener('abort', abort); resolve(selected); } });
        const abort = () => sheet.dismiss();
        signal?.addEventListener('abort', abort, { once: true });
        for (const option of options) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'vc-btn'; button.textContent = option.name;
            button.addEventListener('click', () => { selected = option.avatar; void sheet.close(); }); body.append(button);
        }
    });
}

function characterPageOptions() {
    return { getContext,
        async getCards() { await charactersReady; await ensureCharacterReferences(client, context); return (await import('../../instance-page.js')).cardsFromContext(context); },
        getBindings: async () => chatSnapshotsFromRecent(await client.recent()),
        async importCard(spec) {
            await charactersReady; let imported;
            const apply=async()=>{imported=await importDesktopCharacter(client, context, spec);};
            if(runtime)await runtime.configure(apply);else await apply();
            await runtime?.reloadCharacter(context.characters.find(card=>card.data?.extensions?.vc_character_ref===imported.characterRef).avatar);return imported;
        },
        createBinding: async args => { const created = await (await requireRuntime()).createConversation(args); shell.refreshConversations(); return created; },
        async savePersona(characterRef,fields) {
            let data;const apply=async()=>{data=await saveNativePersona({getContext,characterRef,fields,headers:client.headers()});};
            if(runtime)await runtime.configure(apply);else await apply();
            await runtime?.reloadCharacter(context.characters.find(card=>card.data?.extensions?.vc_character_ref===characterRef).avatar);return data;
        },
        onEditCard: ref => { editCharacter=context.characters.find(card=>card.data?.extensions?.vc_character_ref===ref)?.avatar || ''; void shell.openSettings('right-nav-panel'); },
        onOpenInstance: row => shell.openConversation(row),
    };
}

// 页面控制器按需加载；仅在各自空槽位内渲染，不依赖聊天运行模块就绪。
function lazyPage(load, mount) {
    return (container, args) => {
        let handle, dead = false;
        const pending = load().then(module => { if (!dead) handle = mount(module, container, args); }).catch(() => {
            if (!dead) { const message = document.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = '页面没有加载出来，请重新打开。'; container.append(message); }
        });
        return { refresh() { void pending.then(() => { if (!dead) handle?.refresh?.(); }); }, destroy() { dead = true; handle?.destroy?.(); } };
    };
}

async function start() {
    enableVcUi();
    await client.initialize();
    setStHeadersProvider(client.headers, { identity: client.identity });
    preferences=createDesktopPreferences({getContext:getSettingsContext});
    const session = await captureSessionContext();
    if (session.accountId !== client.identity.accountId || session.sessionId !== client.identity.sessionId) throw new Error('登录状态已变化，请重新打开页面。');
    const onBudgetChange = value => { budget = value; runtime?.setBudget(value); };
    modelSettings = mountModelSettings({ onBudgetChange });
    void mountConsentGate({ ready: Promise.resolve() });
    registerShellTabs({
        characters: lazyPage(() => import('../../instance-page.js'), (module, container, args) => module.mountCharactersTab(container, {
            ...args, ...characterPageOptions(),
        })),
        memory: lazyPage(() => import('../../memory-page.js'), (module, container, args) => module.mountMemoryTab(container, {
            ...args, getRelationshipId: () => context.chatMetadata.vc_binding?.relationshipId || '',
            onOpenMessage: detail => openMessageSource(detail, { getContext,
                loadChats: async () => chatSnapshotsFromRecent(await client.recent()),
                openConversation: row => shell.openConversation(row), afterOpen: async () => { await (await requireRuntime()).whenIdle(); },
                ensureVisible: async () => { chat.historyAll=true; paint(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); },
            }),
        })),
        inbox: lazyPage(() => import('../../inbox-page.js'), (module, container, args) => module.mountInboxTab(container, { ...args,
            onOpenConversation: payload => shell.openConversation({ relationshipId:payload.relationshipId, conversationId:payload.conversationId }),
        })),
        story: lazyPage(() => import('../../story-page.js'), (module, container, args) => module.mountStoryTab(container, { ...args,
            getConversation: () => ({ conversationId:context.chatMetadata.vc_binding?.conversationId || '',mode:context.chatMetadata.vc_binding?.mode || '' }),
            getChatIdentity: () => context.chatMetadata.vc_f2?.id || '', onConfigure: () => shell.openSettings('model'),
            async ensureConversation() {
                const session=await requireRuntime(); await session.whenIdle();
                if(context.chatMetadata.vc_binding?.mode==='STORY')return;
                await charactersReady;
                let card=context.characters.find(card=>card.data?.extensions?.vc_story_case==='rainy-inn-v1');
                if(!card){
                    const imported=await characterPageOptions().importCard({name:'rainy-inn.json',format:'json',bytes:new TextEncoder().encode(JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'雨夜旅馆',description:'',personality:'',scenario:'',first_mes:'',mes_example:'',extensions:{vc_story_case:'rainy-inn-v1'}}}))});
                    card=context.characters.find(card=>card.data?.extensions?.vc_character_ref===imported.characterRef);
                }
                const created=await session.createConversation({characterRef:card.data.extensions.vc_character_ref,displayName:'雨夜旅馆',mode:'STORY'});
                if(!await openConversation(created))throw new Error('source-unavailable');
                await session.whenIdle(); shell.refreshConversations();
            },
            onRun: turn => runtime?.story.setRun(turn), onActor: actor => runtime?.story.selectActor(actor), onAdvance: turn => runtime?.story.advance(turn),
            project: async job => (await requireRuntime()).projectStory(job),
        })),
    });
    shell = mountShell({ independent: true, getContext, storage: { getItem(key) { return key === 'vc-ui' ? 'on' : localStorage.getItem(key); }, setItem: (key, value) => localStorage.setItem(key, value) },
        openCompanionStyle: async opener => { try { await requireRuntime(); openCompanionStyle({getContext,opener}); } catch { showToast('没有完成，请重试。',{type:'failure'}); } },
        getConversationDraft: row => row.avatar && row.file ? draftOf(chatKey(row)) : '',
        loadChatSnapshots: async () => chatSnapshotsFromRecent(await client.recent()), openConversation,
        mountDesktopSettings: container => settingsHandle = mountSettingsShell(container, { getContext: getSettingsContext, onBudgetChange,
            onCatalogSaved() { if (runtime) void runtime.refreshCatalog(); else catalogSavedWhilePreparing = true; },
            async mountTavernSettings(body, options) {
                const module = await import('../tavern-settings.js');
                if (options.signal.aborted) return;
                const initialCharacter=editCharacter;editCharacter='';
                return module.mountTavernSettings(body, { ...options, initialCharacter, client, getContext: getSettingsContext,
                    onSettingsCommit(changes,value) { preferencesAccepted=true;preferences.apply(value);paint();return applyConfiguration('applySettings', changes); },
                    onPresetCommit: (...args) => applyConfiguration('applyPreset', ...args),
                    onWorldbookCommit: (...args) => applyConfiguration('applyWorldbook', ...args),
                    onCharacterSaved: avatar => applyConfiguration('reloadCharacter', avatar),
                    async onDeleteCharacter(avatar,deleteChats) {
                        if(runtime) await runtime.deleteCharacter(avatar,deleteChats);
                        else {
                            const f2=createF2Client();if(currentRecords)f2.loaded(characterChatPath(currentRow.avatar,currentRow.file),currentRecords[0].chat_metadata);
                            const io=createNativeF2IO({getRequestHeaders:client.headers,client:f2});
                            const rows=deleteChats?await client.request('/api/characters/chats',{avatar_url:avatar,simple:true}):[];
                            const baselines=await io.baselines((Array.isArray(rows)?rows:[]).map(row=>({avatar,file:row.file_name})));
                            await client.post('/api/characters/delete',{avatar_url:avatar,delete_chats:deleteChats,vc_f2_chats:baselines});
                        }
                        if(currentRow?.avatar===avatar){activeAbort?.abort();currentRow=currentRecords=null;activated=0;Object.assign(chat,{messages:[],status:'empty',conversation:'',draft:'',canSend:false,busy:false,notice:'',conflict:false});paint();}
                        await applyConfiguration('reloadCharacter',avatar);
                    },
                    onMetadataCommit: changes => runtime.commitMetadata(changes, chat.conversation),
                    onOpenModels: () => shell.openSettings('model'), onOpenAppearance: () => shell.openSettings('appearance'),
                });
            } }),
        mountChatSurface(container) {
            const host = document.createElement('div'); host.className = 'vc-desktop-chat-root'; container.append(host);
            view = mountDesktopChatView(host, chat);
        },
    });
    mountDesktopShell({ shell, getContext, getThemeContext: getSettingsContext, getInstanceOptions: characterPageOptions, beforeSearch: async () => {
        if (!chat.historyAll) { chat.historyAll = true; paint(); await new Promise(resolve => requestAnimationFrame(resolve)); }
    } });
    document.querySelector('#vc-desktop-startup')?.remove();
    document.documentElement.dataset.vcApp = 'ready';
    charactersReady = client.characters().then(characters => {
        context.characters = characters;
    }).catch(() => { document.documentElement.dataset.vcCharacters = 'error'; });
    void client.settings().then(packet => {
        const settings = JSON.parse(packet.settings);
        if(!preferencesAccepted){preferences.apply(settings);paint();}
        if (context.chatId) return;
        context.name1 = settings.username || ''; context.userAvatar = settings.user_avatar || '';
        return eventSource.emit(event_types.PERSONA_CHANGED, context.userAvatar);
    }).catch(() => {});
    // 不 await 聊天准备：导航、历史和设置拥有各自生命周期。
    runtimeReady = import('./runtime.js').then(module => module.prepareChatRuntime({ client, context, choosePersona, readInput: () => chat.draft,
        paint, onConflict(snapshot, error) { showF2Draft(snapshot, error, { latest: () => chat.onNoticeRetry(), copy: () => chat.onCopyDraft() }); },
        onChange(state) {
            if (state.key !== chat.conversation || chat.status !== 'ready') return;
            Object.assign(chat, state); chat.noticeAction = state.settingsRequired ? '模型设置' : ''; paint();
            const ready = Boolean(runtime?.ready);
            if (settingsChatReady !== ready) { settingsChatReady = ready; settingsHandle?.refreshContext(); }
        },
        onTakeDraft(key, input) { if (draftOf(key) === input) setDraft(key, ''); },
        onRestoreDraft(key, input) {
            if (input) setDraft(key, mergeInput(draftOf(key), input));
        },
    })).then(async value => {
        runtime = value;
        for (const [method, args] of pendingConfiguration.splice(0)) await runtime[method](...args);
        runtime.setBudget(budget);
        if (catalogSavedWhilePreparing) { catalogSavedWhilePreparing = false; await runtime.refreshCatalog(); }
        chat.renderMessage = runtime.renderMessage; chat.mountCardActions = runtime.mountCardActions; chat.renderMedia = runtime.renderMedia; chat.mountVoiceInput = runtime.mountVoiceInput; paint();
        document.documentElement.dataset.vcRuntime = 'prepared';
        await eventSource.emit(event_types.APP_INITIALIZED); await eventSource.emit(event_types.APP_READY);
        void activateCurrent(committedRead, false);
        return runtime;
    }).catch(() => { document.documentElement.dataset.vcRuntime = 'error'; chat.notice = '聊天没有加载出来，请重试。'; paint(); });
}
void start().catch(error => {
    const node = document.querySelector('#vc-desktop-startup');
    if (node) { node.setAttribute('role', 'alert'); node.textContent = error.message || '页面没有加载出来，请重新打开。'; }
});
