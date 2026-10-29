// UI-P06 玩家剧情页。只渲染玩家 ActorView 的公开字段；不写 localStorage，不调用模型。
import * as api from './api.js';
import * as actions from './story-action.js';
import { STORY_SYNC_PENDING } from './story-projection.js';

export { STORY_SYNC_PENDING };
export const STORY_CONFLICT = '这一局与当前对话冲突，开局未完成。';
const SESSION_CHANGED = '登录状态已变化，请重新打开剧情页。';
const START_FAILED = '开局未完成，请重试。';
const ACTION_FAILED = '这步行动没有完成，请重试。';
const ACTION_CONFLICT = '这步行动与当前进度不一致，没有另开分支。';
const CONFIG_MISSING = '剧情导演或 NPC 尚未绑定可用模型。';
const GENERATING = '正在生成这一步';
const REWIND_RECALC = '公开线索和角色私密知情范围会重新计算。备份不会因此全部删除。';
const REWIND_DEVICES = '同一局的其他设备需要加载最新状态，不会自动合并。';
const REWIND_BLOCKED = '当前聊天还不能回档';
const REWIND_FAILED = '回档没有完成，请重试。';
const NEED_CAST = '请先让一位陪伴入局，再保存共同游玩摘要。';
const SAVE_HINT = '已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。';
const DISCARD_HINT = '已放弃共同游玩摘要，不会写入日常记忆。';
const CASE_TITLE = '雨夜旅馆：失踪的怀表';
const HIDDEN = /PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+/;
const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const ACTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const CHAT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PLACES = { lobby: '大堂', kitchen: '厨房', workshop: '维修间' };
const CASTABLE = ['lin', 'zhou', 'su'];
const REASONS = {
    bad_command: '这步行动无法识别，世界没有变化。',
    unknown_actor: '当前角色不能做这步行动，世界没有变化。',
    action_not_allowed: '当前不能做这步行动，世界没有变化。',
    no_matching_rule: '没有对应的剧情规则，世界没有变化。',
    precondition_failed: '条件还不足，世界没有变化。',
};
const STEPS = [
    { id: 'a1', label: '向林岚询问借用记录', action: 'request_evidence', target: 'lin' },
    { id: 'a2', label: '向苏禾询问目击', action: 'request_evidence', target: 'su' },
    { id: 'a3', label: '向周澈出示借用记录', action: 'show_clue', target: 'zhou', clueId: 'loan_note' },
    { id: 'a4', label: '向周澈出示蓝色衣袖', action: 'show_clue', target: 'zhou', clueId: 'blue_sleeve' },
    { id: 'a5', label: '向周澈索要钥匙', action: 'request_key', target: 'zhou' },
    { id: 'a6', label: '检查维修柜', action: 'inspect', target: 'workshop_cabinet' },
    { id: 'a7', label: '指认周澈', action: 'accuse', target: 'zhou' },
];
const ACTION_GROUPS = [
    { id: 'lin', title: '林岚' },
    { id: 'su', title: '苏禾' },
    { id: 'zhou', title: '周澈' },
    { id: 'place', title: '地点' },
];

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shown(value) {
    return typeof value === 'string' && value !== '' && !HIDDEN.test(value) ? value : '';
}

function decimalOf(value) {
    if (typeof value === 'string' && DECIMAL_ID.test(value)) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    return '';
}

function allowRun(raw) {
    const participants = [];
    for (const item of Array.isArray(raw?.participants) ? raw.participants : []) {
        const actorId = typeof item?.actorId === 'string' && ACTOR_ID.test(item.actorId) ? item.actorId : '';
        const name = shown(item?.name);
        const role = item?.role === 'player' || item?.role === 'npc' ? item.role : '';
        if (!actorId || !name || !role) continue;
        participants.push({ actorId, name, role });
    }
    const stage = raw?.stage === 'investigation' || raw?.stage === 'resolved' ? raw.stage : '';
    return {
        caseId: raw?.caseId === 'rainy-inn-v1' ? 'rainy-inn-v1' : '',
        stage,
        participants,
    };
}

function allowView(raw) {
    const lore = raw?.publicLore ?? {};
    const locations = [];
    for (const id of Array.isArray(lore.locations) ? lore.locations : []) {
        if (PLACES[id]) locations.push(PLACES[id]);
    }
    const knowledge = [];
    for (const item of Array.isArray(raw?.knowledge) ? raw.knowledge : []) {
        const fact = shown(item?.fact);
        if (fact) knowledge.push(fact);
    }
    const events = [];
    for (const item of Array.isArray(raw?.events) ? raw.events : []) {
        const body = item?.body;
        if (!body || typeof body !== 'object') continue;
        const clueName = shown(body.clueName);
        const text = shown(body.text);
        const note = shown(body.note);
        const qualification = shown(body.qualification);
        const parts = [clueName, text, note, qualification].filter(Boolean);
        if (parts.length === 0) continue;
        const line = parts.join('\n');
        const worldVersion = typeof item.worldVersion === 'number' && Number.isSafeInteger(item.worldVersion) && item.worldVersion >= 0
            ? item.worldVersion : null;
        events.push({
            worldEventId: decimalOf(item.eventId),
            worldVersion,
            phase: body.phase === 'resolved' ? 'resolved' : 'investigation',
            line,
            clueName,
        });
    }
    const participants = [];
    for (const item of Array.isArray(raw?.participants) ? raw.participants : []) {
        const actorId = typeof item?.actorId === 'string' && ACTOR_ID.test(item.actorId) ? item.actorId : '';
        const name = shown(item?.name);
        const persona = shown(item?.publicPersona);
        if (!actorId || !name) continue;
        participants.push({ actorId, name, persona });
    }
    return { setting: shown(lore.setting), knownEvent: shown(lore.knownEvent), locations, knowledge, events, participants };
}

function list(items) {
    return items.map((item) => `<li>${esc(item)}</li>`).join('');
}

function initial(name) {
    const text = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...text][0] || '人';
}

function actionGroup(step) {
    if (step.id === 'a6') return 'place';
    if (step.target === 'lin' || step.target === 'su' || step.target === 'zhou') return step.target;
    return 'place';
}

function actionClass(step) {
    if (step.id === 'a6') return 'vcms-btn vcms-btn-primary';
    if (step.id === 'a7') return 'vcms-btn vcms-btn-danger-ghost';
    return 'vcms-btn vcms-btn-ghost';
}

function storyTurn(run, view, conversationId) {
    const runId = typeof run?.runId === 'string' && DECIMAL_ID.test(run.runId) ? run.runId : '';
    const branchId = typeof run?.branchId === 'string' && DECIMAL_ID.test(run.branchId) ? run.branchId : '';
    const fromRun = typeof run?.conversationId === 'string' && DECIMAL_ID.test(run.conversationId) ? run.conversationId : '';
    const fromChat = typeof conversationId === 'string' && DECIMAL_ID.test(conversationId) ? conversationId : '';
    const conversation = fromRun || fromChat;
    const worldVersion = typeof view?.worldVersion === 'number' && Number.isSafeInteger(view.worldVersion) && view.worldVersion >= 0
        ? view.worldVersion : null;
    if (!runId || !branchId || !conversation || worldVersion === null) return null;
    if (typeof view?.runId === 'string' && view.runId !== runId) return null;
    if (typeof view?.branchId === 'string' && view.branchId !== branchId) return null;
    if (fromRun && fromChat && fromRun !== fromChat) return null;
    return { runId, branchId, worldVersion, conversationId: conversation };
}

function stageWord(stage) {
    if (stage === 'resolved') return '已结束';
    if (stage === 'investigation') return '调查中';
    return '';
}

function rewindCopy(ask) {
    return `回到世界版本 ${ask.version}，阶段为${ask.stage}。此版本之后的行动不会留在当前分支，需要重新提交才会再次发生。该阶段之后形成的分支记忆会失效，不会并入当前进度。`;
}

function viewState(state) {
    if (!state.run || !state.view) return 'unstarted';
    if (state.busy && state.run.stage !== 'resolved') return 'generating';
    if (state.run.stage === 'resolved') return 'ended';
    if (state.reason === ACTION_CONFLICT) return 'conflict';
    if (state.reason) return 'rejected';
    if (state.notice) return 'evidence';
    return 'playing';
}

function configBanner(state) {
    if (!state.configNote) return '';
    return `<div class="vc-story-config" data-config="missing" role="status"><p>${esc(state.configNote)}</p><button type="button" class="vcms-btn" data-action="configure">打开模型设置</button></div>`;
}

function rewindDialog(ask) {
    if (!ask) return '';
    const title = ask.version === 0 ? '回到调查开始？' : `回到版本 ${ask.version}？`;
    return `<dialog class="vc-story-rewind-dialog" aria-labelledby="vc-story-rewind-title"><h2 id="vc-story-rewind-title" tabindex="-1">${esc(title)}</h2><p>${esc(rewindCopy(ask))}</p><p>${esc(REWIND_RECALC)}</p><p>${esc(REWIND_DEVICES)}</p><div class="vc-story-rewind-actions"><button type="button" class="vcms-btn" data-action="cancel-rewind">取消</button><button type="button" class="vcms-btn" data-action="confirm-rewind">确认回档</button></div></dialog>`;
}

export function renderStoryPage(state) {
    const playing = Boolean(state.run && state.view);
    if (!playing) {
        return `<div class="vc-story" data-state="unstarted">
      <header class="vc-story-bar"><h1 tabindex="-1">雨夜旅馆</h1><button type="button" class="vcms-btn vcms-btn-ghost" data-action="close">关闭</button></header>
      ${configBanner(state)}
      <section class="vc-story-gate"><h2>${CASE_TITLE}</h2>${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}<button type="button" class="vcms-btn vcms-btn-primary" data-action="start" ${state.busy ? 'disabled' : ''}>开局</button></section>
    </div>`;
    }
    const mode = viewState(state);
    const ended = state.run.stage === 'resolved';
    const stage = stageWord(state.run.stage);
    const version = state.turn?.worldVersion ?? 0;
    const hold = state.busy ? ' disabled' : '';
    const selected = state.view.participants.find((person) => person.actorId === state.actorId);
    const people = state.view.participants.map((person) => {
        const pressed = state.actorId === person.actorId;
        return `<button type="button" class="vc-story-person" data-action="select-actor" data-actor="${esc(person.actorId)}" aria-pressed="${pressed ? 'true' : 'false'}"><span class="vc-story-person-mark" aria-hidden="true">${esc(initial(person.name))}</span><span class="vc-story-person-copy"><h3>${esc(person.name)}</h3>${pressed ? '<span class="vc-story-badge">当前</span>' : ''}${person.persona ? `<p>${esc(person.persona)}</p>` : ''}</span></button>`;
    }).join('');
    const versions = new Set();
    if (version > 0) versions.add(0);
    for (const event of state.view.events) {
        if (typeof event.worldVersion === 'number' && event.worldVersion < version) versions.add(event.worldVersion);
    }
    const rewind = [...versions].sort((a, b) => a - b).map((item) => `<button type="button" class="vcms-btn" data-action="ask-rewind" data-version="${item}"${hold}>回到版本 ${item}</button>`).join('');
    const steps = ended ? '' : ACTION_GROUPS.map((group) => {
        const buttons = STEPS.filter((step) => actionGroup(step) === group.id).map((step) => `<button type="button" class="${actionClass(step)}" data-action="act" data-step="${esc(step.id)}"${hold}>${esc(step.label)}</button>`).join('');
        return buttons ? `<div class="vc-story-action-group" data-group="${group.id}"><h3>${esc(group.title)}</h3>${buttons}</div>` : '';
    }).join('');
    const sayPlaceholder = selected ? `对${selected.name}说` : '先选择一位角色';
    const companions = state.companions ? state.companions.map((row) => CASTABLE.map((actorId) => {
        const person = state.view.participants.find((item) => item.actorId === actorId);
        const label = person?.name || actorId;
        return `<button type="button" class="vcms-btn" data-action="map-companion" data-actor="${esc(actorId)}" data-relationship="${esc(row.relationshipId)}">${esc(row.name)} 入局为${esc(label)}</button>`;
    }).join('')).join('') : '<button type="button" class="vcms-btn" data-action="show-companions">选择陪伴入局</button>';
    const evidence = state.notice ? `<p class="vc-story-evidence" data-evidence="show">${esc(state.notice)}</p>` : '';
    return `<div class="vc-story" data-state="${mode}" data-world-version="${version}">
      <header class="vc-story-bar"><h1 tabindex="-1">${esc(state.run.caseId === 'rainy-inn-v1' ? CASE_TITLE : '剧情')}</h1>${stage ? `<p class="vc-story-stage"><span class="vc-story-badge">${esc(stage)}</span></p>` : ''}<button type="button" class="vcms-btn vcms-btn-ghost vc-story-close" data-action="close">关闭</button></header>
      ${configBanner(state)}
      ${mode === 'generating' ? `<p class="vc-story-generating" role="status">${esc(GENERATING)}</p>` : ''}
      ${state.syncPending ? `<p class="vc-story-sync">${esc(STORY_SYNC_PENDING)}</p>` : ''}
      ${state.reason ? `<p role="alert">${esc(state.reason)}</p>` : ''}
      ${evidence}
      <section class="vc-story-panel" aria-label="公开设定"><h2>公开设定</h2><p class="vc-story-setting">${esc(state.view.setting)}</p></section>
      <section class="vc-story-cast">${people}</section>
      <section class="vc-story-panel" aria-label="地点"><h2>地点</h2><ul class="vc-story-places">${list(state.view.locations)}</ul></section>
      <section class="vc-story-panel" aria-label="线索"><h2>线索</h2><ul class="vc-story-clues">${list(state.view.knowledge)}</ul></section>
      <section class="vc-story-panel" aria-label="公开时间线"><h2>公开时间线</h2>${state.view.knownEvent ? `<p class="vc-story-known">${esc(state.view.knownEvent)}</p>` : ''}<ul class="vc-story-events">${list(state.view.events.map((event) => event.line))}</ul></section>
      ${ended ? '' : `<section class="vc-story-actions">${steps}<div class="vc-story-say"><label class="vc-story-say-row"><input data-field="say" maxlength="4000" aria-label="对所选角色说" placeholder="${esc(sayPlaceholder)}"${hold}><button type="button" class="vcms-btn vcms-btn-primary" data-action="say"${hold}>对所选角色说</button></label></div></section>`}
      ${rewind ? `<section class="vc-story-rewind">${rewind}</section>` : ''}
      ${rewindDialog(state.rewindAsk)}
      <section class="vc-story-companions">${companions}</section>
      ${ended ? `<section class="vc-story-ending"><h2>结局</h2>${state.epilogue ? `<p>${esc(state.epilogue)}</p>` : ''}<textarea data-field="summary" maxlength="2000" aria-label="共同游玩摘要"></textarea><button type="button" class="vcms-btn" data-action="save-epilogue">保存共同游玩摘要</button><button type="button" class="vcms-btn" data-action="discard-epilogue">放弃共同游玩摘要</button></section>` : ''}
    </div>`;
}

export function createStoryPage({
    getConversation = () => ({ conversationId: '', mode: '' }),
    onChange = () => {},
    onRun = () => {},
    onActor = () => {},
    onAdvance = () => {},
    getChatIdentity = () => '',
    project = null,
} = {}) {
    const state = {
        open: false, busy: false, error: '', conflict: false, run: null, view: null, turn: null, actorId: '',
        reason: '', notice: '', syncPending: false, rewindAsk: null, epilogue: '', companions: null, mapped: {},
        configNote: '',
    };
    let epoch = 0;
    let remembered = '';
    let statements = 0;
    const jobs = new Set();
    const emit = () => onChange(state);
    const alive = (ticket) => state.open && epoch === ticket;
    function currentStoryId() {
        const current = getConversation() || {};
        return current.mode === 'STORY' && DECIMAL_ID.test(current.conversationId || '') ? current.conversationId : '';
    }
    function resetRun() {
        state.run = null;
        state.view = null;
        state.turn = null;
        state.actorId = '';
        state.reason = '';
        state.notice = '';
        state.syncPending = false;
        state.rewindAsk = null;
        state.epilogue = '';
        state.companions = null;
        state.mapped = {};
        onRun(null);
    }
    async function refreshConfig() {
        try {
            const rows = await api.fetchModelPurposes();
            if (!Array.isArray(rows)) {
                state.configNote = CONFIG_MISSING;
                return;
            }
            const missing = ['STORY_DIRECTOR', 'NPC_DIALOGUE'].some((id) => {
                const row = rows.find((item) => item?.purpose === id);
                return !row || row.status !== 'READY';
            });
            state.configNote = missing ? CONFIG_MISSING : '';
        } catch {
            // 用途检查失败不打断开局，也不把响应写进页面。
        }
    }
    function fail(error) {
        resetRun();
        state.conflict = error?.status === 409 && error?.code !== 'ACCOUNT_CONTEXT_CHANGED';
        if (error?.status === 409 && error?.code === 'ACCOUNT_CONTEXT_CHANGED') state.error = SESSION_CHANGED;
        else if (error?.status === 409) state.error = STORY_CONFLICT;
        else state.error = START_FAILED;
    }
    async function refreshView() {
        const view = await api.fetchStoryActorView({
            runId: state.turn.runId,
            branchId: state.turn.branchId,
            worldVersion: state.turn.worldVersion,
        });
        state.view = allowView(view);
        const turn = storyTurn(state.turn, view, state.turn.conversationId);
        if (turn) {
            state.turn = turn;
            onAdvance(turn);
        }
    }
    async function reloadHead() {
        const run = await api.startStoryRun(state.turn.conversationId);
        const allowed = allowRun(run);
        if (allowed.caseId) state.run = allowed;
        const branchId = decimalOf(run?.branchId);
        const runId = decimalOf(run?.runId) || state.turn.runId;
        if (branchId) state.turn = { ...state.turn, runId, branchId, worldVersion: typeof run?.worldVersion === 'number' ? run.worldVersion : state.turn.worldVersion };
        await refreshView();
        state.notice = '';
    }
    async function projectEvent(result, text) {
        if (typeof project !== 'function' || !result?.worldEventId) return { confirmed: false, appended: false };
        const job = { runId: state.turn.runId, worldEventId: String(result.worldEventId), text, cancelled: false };
        jobs.add(job);
        try {
            const done = await project(job);
            if (done?.confirmed) state.syncPending = false;
            return done || { confirmed: false, appended: false };
        } catch {
            // 世界已经生效。补写失败时留下待同步，不把错误冒泡成开局失败。
            return { confirmed: false, appended: false };
        } finally {
            jobs.delete(job);
        }
    }
    async function syncPendingProjections(ticket) {
        if (typeof project !== 'function' || !state.turn?.runId) return;
        let body;
        try {
            body = await api.storyRequest('GET', `/api/v1/story/runs/${state.turn.runId}/projections?state=PENDING`);
        } catch {
            return;
        }
        if (!alive(ticket)) return;
        const rows = Array.isArray(body?.projections) ? body.projections : [];
        let saw = false;
        let stuck = false;
        for (const item of rows) {
            if (!alive(ticket)) return;
            const worldEventId = decimalOf(item?.worldEventId);
            const text = shown(item?.text);
            if (!worldEventId || !text) continue;
            saw = true;
            state.syncPending = true;
            const done = await projectEvent({ worldEventId }, text);
            if (!alive(ticket)) return;
            if (!done?.confirmed && done?.skipped !== 'deleted') stuck = true;
        }
        if (alive(ticket) && saw) state.syncPending = stuck;
    }
    async function applyCommand(command) {
        const ticket = epoch;
        state.busy = true;
        state.reason = '';
        state.notice = '';
        emit();
        try {
            const result = await actions.commitStoryAction({
                runId: state.turn.runId,
                branchId: state.turn.branchId,
                expectedWorldVersion: state.turn.worldVersion,
                ...command,
            });
            if (!alive(ticket)) return;
            if (!result?.accepted) {
                state.reason = REASONS[result?.reason] || '这步行动没有生效，世界没有变化。';
                state.syncPending = false;
                await refreshView();
                return;
            }
            if (result.replayed) {
                await reloadHead();
                return;
            }
            state.turn = { ...state.turn, branchId: decimalOf(result.branchId) || state.turn.branchId, worldVersion: result.worldVersion };
            if (result.ended || result.stage === 'resolved') state.run = { ...state.run, stage: 'resolved' };
            else if (result.stage === 'investigation') state.run = { ...state.run, stage: 'investigation' };
            onAdvance(state.turn);
            await refreshView();
            if (!alive(ticket)) return;
            const event = state.view.events.find((item) => item.worldEventId && item.worldEventId === String(result.worldEventId));
            state.notice = event?.clueName ? `发现证据：${event.clueName}` : '';
            state.syncPending = true;
            emit();
            await projectEvent(result, event?.line || state.notice || '这一步行动已记录');
        } catch (error) {
            if (!alive(ticket)) return;
            if (error?.status === 409 && error?.code !== 'ACCOUNT_CONTEXT_CHANGED') {
                state.reason = ACTION_CONFLICT;
                try { await reloadHead(); } catch { /* 保持当前头 */ }
            } else if (error?.status === 409) state.reason = SESSION_CHANGED;
            else state.reason = ACTION_FAILED;
        } finally {
            if (alive(ticket)) {
                state.busy = false;
                emit();
            }
        }
    }
    return {
        state,
        async open() {
            state.open = true;
            const ticket = epoch;
            const current = currentStoryId();
            if (state.turn && current && state.turn.conversationId !== current) resetRun();
            emit();
            try {
                await api.captureSessionContext();
            } catch {
                // start() 会再取会话；不把服务端原文放进页面。
            }
            await refreshConfig();
            if (state.turn && state.turn.conversationId === currentStoryId()) {
                await syncPendingProjections(ticket);
            }
            if (state.open) emit();
        },
        close() {
            epoch += 1;
            state.open = false;
            state.busy = false;
            emit();
        },
        selectActor(actorId) {
            if (!state.turn || !state.view) return;
            if (!state.view.participants.some((person) => person.actorId === actorId)) return;
            state.actorId = actorId;
            onActor(actorId);
            emit();
        },
        askRewind(version) {
            const target = Number(version);
            if (!state.turn || !Number.isSafeInteger(target) || target < 0 || target >= state.turn.worldVersion) return;
            const resolved = state.view?.events?.some((event) => event.worldVersion === target && event.phase === 'resolved');
            state.rewindAsk = { version: target, stage: resolved ? '已结束' : '调查中' };
            state.reason = '';
            emit();
        },
        cancelRewind() {
            if (!state.rewindAsk) return;
            state.rewindAsk = null;
            emit();
        },
        async confirmRewind() {
            if (!state.rewindAsk || !state.turn || state.busy) return;
            const chatIdentity = getChatIdentity() || '';
            if (!CHAT_IDENTITY.test(chatIdentity)) {
                state.reason = REWIND_BLOCKED;
                emit();
                return;
            }
            const ticket = epoch;
            for (const job of jobs) job.cancelled = true;
            state.busy = true;
            state.reason = '';
            emit();
            try {
                const result = await actions.rewindStory({
                    runId: state.turn.runId,
                    toWorldVersion: state.rewindAsk.version,
                    chatIdentity,
                });
                if (!alive(ticket)) return;
                state.rewindAsk = null;
                state.notice = '';
                state.syncPending = false;
                state.turn = {
                    ...state.turn,
                    branchId: decimalOf(result?.branchId) || state.turn.branchId,
                    worldVersion: typeof result?.worldVersion === 'number' ? result.worldVersion : state.turn.worldVersion,
                };
                if (result?.stage === 'resolved') state.run = { ...state.run, stage: 'resolved' };
                else if (result?.stage === 'investigation') state.run = { ...state.run, stage: 'investigation' };
                onAdvance(state.turn);
                await refreshView();
            } catch (error) {
                if (!alive(ticket)) return;
                state.reason = error?.status === 409 && error?.code === 'ACCOUNT_CONTEXT_CHANGED' ? SESSION_CHANGED : REWIND_FAILED;
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        act(stepId) {
            const step = STEPS.find((item) => item.id === stepId);
            if (!state.turn || !state.run || state.busy || !step || state.run.stage === 'resolved') return;
            return applyCommand({ actionId: step.id, actorId: 'player', action: step.action, target: step.target, clueId: step.clueId });
        },
        say(text) {
            const spoken = typeof text === 'string' ? text.trim() : '';
            if (!state.turn || state.busy || !CASTABLE.includes(state.actorId) || !spoken || state.run?.stage === 'resolved') {
                if (state.turn && !CASTABLE.includes(state.actorId)) state.reason = '先选择要对谁说。';
                emit();
                return;
            }
            statements += 1;
            return applyCommand({ actionId: `s${statements}`, actorId: 'player', target: state.actorId, text: spoken });
        },
        async showCompanions() {
            if (!state.turn) return;
            const list = await api.fetchRelationships();
            const rows = [];
            for (const item of Array.isArray(list) ? list : []) {
                const relationshipId = decimalOf(item?.relationshipId);
                const name = shown(item?.companionName) || shown(item?.personaRef);
                if (!relationshipId || !name) continue;
                rows.push({ relationshipId, name });
            }
            state.companions = rows;
            emit();
        },
        async mapCompanion(actorId, relationshipId) {
            const id = decimalOf(relationshipId);
            if (!state.turn || !CASTABLE.includes(actorId) || !id) return;
            await actions.mapStoryParticipant({ runId: state.turn.runId, actorId, relationshipId: id });
            state.mapped = { ...state.mapped, [actorId]: id };
            emit();
        },
        async saveEpilogue(summary) {
            if (state.run?.stage !== 'resolved' || !state.turn) return;
            const actorId = CASTABLE.find((id) => state.mapped[id]);
            const text = typeof summary === 'string' ? summary.trim() : '';
            if (!actorId || !text) {
                state.epilogue = NEED_CAST;
                emit();
                return;
            }
            await actions.decideStoryEpilogue({
                runId: state.turn.runId,
                decision: 'save',
                relationshipId: state.mapped[actorId],
                summary: text,
            });
            state.epilogue = SAVE_HINT;
            emit();
        },
        async discardEpilogue() {
            if (state.run?.stage !== 'resolved' || !state.turn) return;
            await actions.decideStoryEpilogue({ runId: state.turn.runId, decision: 'discard' });
            state.epilogue = DISCARD_HINT;
            emit();
        },
        async start() {
            const current = currentStoryId();
            if (state.turn && current && state.turn.conversationId !== current) resetRun();
            if (!state.open || state.busy || state.run) return;
            const ticket = epoch;
            state.busy = true;
            state.error = '';
            state.conflict = false;
            emit();
            try {
                await api.captureSessionContext();
                if (!alive(ticket)) return;
                const chat = getConversation() || {};
                let conversationId = '';
                if (chat.mode === 'STORY' && DECIMAL_ID.test(chat.conversationId || '')) {
                    conversationId = chat.conversationId;
                } else if (DECIMAL_ID.test(remembered)) {
                    conversationId = remembered;
                } else {
                    const chatIdentity = crypto.randomUUID();
                    let characterRef = crypto.randomUUID();
                    if (characterRef === chatIdentity) characterRef = crypto.randomUUID();
                    const bound = await api.resolveSTBinding({ chatIdentity, characterRef, mode: 'STORY', displayName: '雨夜旅馆' });
                    if (!alive(ticket)) return;
                    if (!DECIMAL_ID.test(bound?.conversationId || '')) throw new api.ApiError('invalid', START_FAILED, { status: 0, code: 'INVALID_REQUEST' });
                    conversationId = bound.conversationId;
                    remembered = conversationId;
                }
                const run = await api.startStoryRun(conversationId);
                if (!alive(ticket)) return;
                const view = await api.fetchStoryActorView({ runId: String(run?.runId ?? ''), branchId: String(run?.branchId ?? ''), worldVersion: String(run?.worldVersion ?? '') });
                if (!alive(ticket)) return;
                state.run = allowRun(run);
                state.view = allowView(view);
                state.turn = storyTurn(run, view, conversationId);
                state.actorId = '';
                state.error = '';
                state.conflict = false;
                state.reason = '';
                state.notice = '';
                state.syncPending = false;
                state.rewindAsk = null;
                state.epilogue = '';
                onRun(state.turn);
                await syncPendingProjections(ticket);
            } catch (error) {
                if (!alive(ticket)) return;
                fail(error);
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    await refreshConfig();
                    emit();
                }
            }
        },
    };
}

export function mountStoryPage({
    getConversation = () => ({ conversationId: '', mode: '' }),
    onRun = () => {},
    onActor = () => {},
    onAdvance = () => {},
    getChatIdentity = () => '',
    project = null,
    onConfigure = null,
} = {}) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./story.css', import.meta.url).href;
    style.setAttribute('data-vc-story', '');
    if (!document.querySelector('link[data-vc-story]')) (document.head || document.documentElement).append(style);
    const root = document.createElement('div');
    root.className = 'vcms-root vc-story-root';
    const dialog = document.createElement('dialog');
    dialog.className = 'vc-story-dialog';
    dialog.setAttribute('aria-label', '剧情');
    root.append(dialog);
    document.body.append(root);
    let opener;
    let rewindVersion = null;
    const sheetOf = () => root.querySelector('.vc-story-rewind-dialog');
    const render = (next) => {
        if (!next.open) return;
        const previous = rewindVersion;
        const stale = sheetOf();
        if (stale?.open) stale.close();
        stale?.remove();
        dialog.innerHTML = `<div class="vc-story-page">${renderStoryPage(next)}</div>`;
        const sheet = dialog.querySelector('.vc-story-rewind-dialog');
        if (next.rewindAsk && sheet) {
            root.append(sheet);
            sheet.addEventListener('cancel', (event) => {
                event.preventDefault();
                event.stopPropagation();
                page.cancelRewind();
            });
            if (!sheet.open) sheet.showModal();
            sheet.querySelector('#vc-story-rewind-title')?.focus();
            rewindVersion = next.rewindAsk.version;
            return;
        }
        rewindVersion = null;
        if (previous !== null && !next.rewindAsk) {
            const back = dialog.querySelector(`[data-action="ask-rewind"][data-version="${previous}"]`);
            (back || dialog.querySelector('h1'))?.focus();
        }
    };
    const page = createStoryPage({ getConversation, onRun, onActor, onAdvance, getChatIdentity, project, onChange: render });
    const close = () => {
        const sheet = sheetOf();
        if (sheet?.open) sheet.close();
        sheet?.remove();
        rewindVersion = null;
        page.close();
        dialog.close();
        dialog.innerHTML = '';
        opener?.focus();
    };
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (sheetOf()?.open) {
            page.cancelRewind();
            return;
        }
        close();
    });
    root.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target || target.disabled) return;
        const action = target.dataset.action;
        if (action === 'close') close();
        if (action === 'start') void page.start();
        if (action === 'select-actor') page.selectActor(target.dataset.actor);
        if (action === 'act') void page.act(target.dataset.step);
        if (action === 'say') void page.say(dialog.querySelector('[data-field="say"]')?.value || '');
        if (action === 'ask-rewind') page.askRewind(target.dataset.version);
        if (action === 'cancel-rewind') page.cancelRewind();
        if (action === 'confirm-rewind') void page.confirmRewind();
        if (action === 'show-companions') void page.showCompanions();
        if (action === 'map-companion') void page.mapCompanion(target.dataset.actor, target.dataset.relationship);
        if (action === 'save-epilogue') void page.saveEpilogue(dialog.querySelector('[data-field="summary"]')?.value || '');
        if (action === 'discard-epilogue') void page.discardEpilogue();
        if (action === 'configure') {
            if (typeof onConfigure === 'function') onConfigure();
            else document.getElementById('vc_models_menu_button')?.click();
        }
    });
    return {
        open(returnFocusTarget = document.activeElement) {
            if (dialog.open) return;
            opener = returnFocusTarget;
            dialog.showModal();
            dialog.querySelector('h1')?.focus();
            void page.open().then(() => {
                if (!dialog.open || sheetOf()?.open) return;
                const active = document.activeElement;
                if (!active || active === document.body || !root.contains(active)) dialog.querySelector('h1')?.focus();
            });
        },
        close,
    };
}
