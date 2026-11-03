// UI-P06 玩家剧情页。只渲染玩家 ActorView 的公开字段；不写 localStorage，不调用模型。
import * as api from './api.js';
import * as actions from './story-action.js';
import { STORY_SYNC_PENDING } from './story-projection.js';
import { confirmAlert } from './ui/alert.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountStoryView } from './desktop/build/index.js';
import { readVcUiFlag } from './ui/theme.js';
import { desktopLayout } from './desktop/presentation.js';
import { popMenu } from './ui/menu.js';
import { animate, EASE_IN_OUT, EASE_OUT, prefersReducedMotion, SPRING } from './ui/motion.js';
import { showToast } from './ui/toast.js';

export { STORY_SYNC_PENDING };
export const STORY_CONFLICT = '这一局与当前对话冲突，开局未完成。';
const SESSION_CHANGED = '登录状态已变化，请重新打开剧情页。';
const START_FAILED = '开局未完成，请重试。';
const ACTION_FAILED = '这步行动没有完成，请重试。';
const ACTION_CONFLICT = '这步行动与当前进度不一致，没有另开分支。';
const CONFIG_MISSING = '剧情导演或 NPC 尚未绑定可用模型。';
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
// 黑幕色与开场时长。组件库补上对应 token 之前，页面只从这里取。
const STAGE_MOTION = {
    letterbox: '#000000',
    barMs: 900,
    titleDelayMs: 650,
    titleMs: 1600,
    openMs: 900,
    titleOutMs: 420,
    holdMs: 800,
    flipMs: 800,
    reducedMs: 150,
};



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

// 只投影允许显示的状态；服务/分支/投影命令仍由原控制器执行。
export function storyViewProps(state, options = {}) {
    const legacy = options.legacy === true, playing = Boolean(state.run && state.view);
    const mode = storyMode(state), stage = stageWord(state.run?.stage), view = state.view || {};
    const people = (view.participants || []).map(person => ({ id: person.actorId, name: person.name, initial: initial(person.name), persona: person.persona || '', selected: person.actorId === state.actorId }));
    const selected = people.find(person => person.selected);
    const clue = freshClueName(state);
    return {
        legacy, desktop: desktopLayout(), gate: options.view !== 'stage' || !playing, loading: options.loading === true,
        mode, stage, title: legacy ? (state.run?.caseId === 'rainy-inn-v1' ? CASE_TITLE : '剧情') : (state.run?.caseId === 'rainy-inn-v1' ? '雨夜旅馆' : '剧情'), caseTitle: CASE_TITLE,
        busy: Boolean(state.busy), playing, ended: state.run?.stage === 'resolved', version: state.turn?.worldVersion ?? 0, percent: progressPercent(state),
        config: state.configNote || '', error: state.error || '', reason: state.reason || '', notice: state.notice || '', sync: state.syncPending ? STORY_SYNC_PENDING : '', epilogue: state.epilogue || '',
        people, cover: coverPeople(state).map(person => ({ id: person.actorId, name: person.name, initial: initial(person.name), persona: '', selected: false })),
        setting: view.setting || '', known: view.knownEvent || '', locations: view.locations || [], knowledge: view.knowledge || [],
        lines: (view.events || []).map((event, index, events) => ({ id: event.worldEventId || String(index), text: event.line, say: /[“"「]/.test(event.line), fresh: Boolean(options.fresh && index === events.length - 1) })),
        cards: evidenceItems(state).map(item => ({ ...item, glyph: evidenceIcon(item.name), fresh: item.name === clue, flipped: options.flipped?.has(item.name) || false })),
        steps: STEPS.map(step => ({ id: step.id, label: step.label, visible: actionGroup(step) === 'place' || Boolean(selected) && step.target === selected.id, group: actionGroup(step), className: legacy ? actionClass(step) : step.action === 'accuse' ? 'vc-btn vc-btn-danger' : 'vc-btn vc-btn-gray' })),
        versions: rewindTargets(state), selected: selected?.name || '',
        companions: state.companions ? state.companions.flatMap(row => CASTABLE.map(actor => ({ actor, relationship: String(row.relationshipId), label: `${row.name} 入局为${people.find(person => person.id === actor)?.name || actor}` }))) : null,
        draftSay: options.draftSay || '', draftSummary: options.draftSummary || '', sprite: iconSpriteUrl(),
        rewind: state.rewindAsk ? { version: state.rewindAsk.version, title: state.rewindAsk.version === 0 ? '回到调查开始？' : `回到版本 ${state.rewindAsk.version}？`, message: rewindCopy(state.rewindAsk), recalc: REWIND_RECALC, devices: REWIND_DEVICES } : null,
        rewindHost: options.rewindHost,
        motion: { reduced: prefersReducedMotion(), duration: STAGE_MOTION.flipMs, easing: SPRING },
        reveal: options.reveal || (() => {}), field: options.field || (() => {}), cancelRewind: options.cancelRewind || (() => {}),
    };
}

export function createStoryPage({
    getConversation = () => ({ conversationId: '', mode: '' }),
    onChange = () => {},
    onRun = () => {},
    onActor = () => {},
    onAdvance = () => {},
    getChatIdentity = () => '',
    project = null,
    ensureConversation,
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
        const job = { runId: state.turn.runId, conversationId: state.turn.conversationId, worldEventId: String(result.worldEventId), text, cancelled: false };
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
            if (state.turn && (current || ensureConversation) && state.turn.conversationId !== current) resetRun();
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
                if (ensureConversation) await ensureConversation();
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
    // 旧对话框整段重绘。已填对白记在 DOM 外面，否则 open() 后半段刷新会把还没提交的句子清掉。
    let draftSay = '';
    let draftSummary = '';
    const sheetOf = () => root.querySelector('.vc-story-rewind-dialog');
    let view = null;
    const fields = (name, value) => { if (name === 'say') draftSay = value; if (name === 'summary') draftSummary = value; render(page.state); };
    const render = next => {
        if (!next.open) return;
        const previous = rewindVersion;
        const props = storyViewProps(next, { legacy: true, draftSay, draftSummary, rewindHost: root, field: fields, cancelRewind: () => page.cancelRewind() });
        if (view) view.update(props); else view = mountStoryView(dialog, props, root);
        rewindVersion = next.rewindAsk?.version ?? null;
        if (previous !== null && !next.rewindAsk) (dialog.querySelector(`[data-action="ask-rewind"][data-version="${previous}"]`) || dialog.querySelector('h1'))?.focus();
    };
    const page = createStoryPage({ getConversation, onRun, onActor, onAdvance, getChatIdentity, project, onChange: render });
    const close = () => {
        rewindVersion = null; page.close(); view?.unmount(); view = null;
        dialog.close(); opener?.focus();
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
        if (action === 'say') {
            const text = dialog.querySelector('[data-field="say"]')?.value || '';
            draftSay = '';
            const pending = page.say(text);
            if (!page.state.busy) {
                draftSay = text;
                render(page.state);
            }
            void pending;
        }
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

function isVcUiOn() {
    try {
        if (globalThis.document?.body?.classList?.contains('vc-ui')) return true;
    } catch {
        /* 文档不可用时只看存储标志。 */
    }
    return readVcUiFlag();
}

function storyMode(state) {
    if (!state.run || !state.view) return 'unstarted';
    return viewState(state);
}

function rewindTargets(state) {
    const version = state.turn?.worldVersion ?? 0;
    const versions = new Set();
    if (version > 0) versions.add(0);
    for (const event of state.view?.events || []) {
        if (typeof event.worldVersion === 'number' && event.worldVersion < version) versions.add(event.worldVersion);
    }
    return [...versions].sort((a, b) => a - b);
}

function evidenceIcon(name) {
    const text = String(name);
    if (text.includes('表')) return 'watch';
    if (text.includes('钥匙')) return 'key-round';
    if (text.includes('画')) return 'image';
    return 'sparkles';
}

function evidenceItems(state) {
    const items = [];
    const seen = new Set();
    const add = (name, detail) => {
        const label = shown(name);
        if (!label || seen.has(label)) return;
        seen.add(label);
        items.push({ name: label, detail: shown(detail) });
    };
    for (const fact of state.view?.knowledge || []) add(fact, '');
    for (const event of state.view?.events || []) add(event.clueName, '');
    return items;
}

function freshClueName(state) {
    const notice = typeof state.notice === 'string' ? state.notice : '';
    const prefix = '发现证据：';
    return notice.startsWith(prefix) ? notice.slice(prefix.length) : '';
}

function coverPeople(state) {
    const people = (state.view?.participants || []).filter((person) => person.actorId && person.actorId !== 'player');
    if (people.length) return people.slice(0, 3);
    return ACTION_GROUPS.filter((group) => group.id !== 'place').map((group) => ({ actorId: group.id, name: group.title }));
}

function progressPercent(state) {
    if (state.run?.stage === 'resolved') return 100;
    const version = state.turn?.worldVersion ?? 0;
    return Math.max(0, Math.min(100, Math.round((version / STEPS.length) * 100)));
}

function stampAlert(root, cancelAction, okAction) {
    const dialog = root.querySelector('.vc-alert');
    if (!dialog) return;
    dialog.querySelector('[data-vc-cancel]')?.setAttribute('data-action', cancelAction);
    dialog.querySelector('[data-vc-ok]')?.setAttribute('data-action', okAction);
    const title = dialog.querySelector('h4');
    if (title && okAction === 'confirm-rewind') {
        title.id = 'vc-story-rewind-title';
        dialog.setAttribute('aria-labelledby', 'vc-story-rewind-title');
    }
}

function animationDone(anim) {
    return anim?.finished || Promise.resolve();
}

function wait(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function beginLetterbox(host, title, stageLabel) {
    const doc = host.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'vc-letterbox';
    box.style.setProperty('--vc-letterbox', STAGE_MOTION.letterbox);
    box.innerHTML = '<i class="vc-letterbox-bar is-top"></i><i class="vc-letterbox-bar is-bottom"></i><div class="vc-letterbox-card"><b></b><span></span></div>';
    box.querySelector('b').textContent = title;
    const stage = box.querySelector('span');
    stage.textContent = stageLabel || '';
    host.append(box);
    const top = box.querySelector('.is-top');
    const bottom = box.querySelector('.is-bottom');
    const card = box.querySelector('.vc-letterbox-card');
    let ready;
    let finish;
    if (prefersReducedMotion()) {
        ready = animationDone(animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: STAGE_MOTION.reducedMs }));
        finish = async () => {
            await animationDone(animate(box, [{ opacity: 1 }, { opacity: 0 }], { duration: STAGE_MOTION.reducedMs }));
            box.remove();
        };
    } else {
        const bars = Promise.all([
            animationDone(animate(top, [{ opacity: 0, transform: 'translateY(-100%)' }, { opacity: 1, transform: 'none' }], { duration: STAGE_MOTION.barMs, easing: EASE_IN_OUT })),
            animationDone(animate(bottom, [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, transform: 'none' }], { duration: STAGE_MOTION.barMs, easing: EASE_IN_OUT })),
        ]);
        const titleIn = wait(STAGE_MOTION.titleDelayMs).then(() => animationDone(animate(card, [
            { opacity: 0, letterSpacing: '0.02em' },
            { opacity: 1, letterSpacing: '0.14em' },
        ], { duration: STAGE_MOTION.titleMs, easing: EASE_OUT })));
        ready = Promise.all([bars, titleIn]).then(async () => {
            box.dataset.pose = 'hold';
            await wait(STAGE_MOTION.holdMs);
        });
        finish = async () => {
            if (!box.isConnected) return;
            await Promise.all([
                animationDone(animate(top, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-100%)' }], { duration: STAGE_MOTION.openMs, easing: EASE_IN_OUT })),
                animationDone(animate(bottom, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(100%)' }], { duration: STAGE_MOTION.openMs, easing: EASE_IN_OUT })),
                animationDone(animate(card, [{ opacity: 1 }, { opacity: 0 }], { duration: STAGE_MOTION.titleOutMs, easing: EASE_OUT })),
            ]);
            box.remove();
        };
    }
    return {
        box,
        ready,
        setStage(value) { stage.textContent = value || ''; },
        finish,
    };
}

export function focusIfDetached(opener, title) {
    const live = opener?.isConnected === true || (opener?.isConnected == null && opener?.parent);
    if (live) return false;
    title?.focus?.();
    return true;
}

export function mountStoryTab(container, options = {}) {
    const doc = container?.ownerDocument || globalThis.document;
    if (doc && typeof doc.createElement === 'function' && !doc.querySelector?.('link[data-vc-story]')) {
        const style = doc.createElement('link');
        style.rel = 'stylesheet';
        style.href = new URL('./story.css', import.meta.url).href;
        style.setAttribute('data-vc-story', '');
        (doc.head || doc.documentElement).append(style);
    }
    if (!isVcUiOn()) return { async refresh() {}, destroy() {} };
    if (!container) throw new Error('mountStoryTab requires a container');
    const root = doc.createElement('div');
    root.className = 'vc-story-tab';
    root.style.setProperty('--vc-letterbox', STAGE_MOTION.letterbox);
    root.setAttribute('aria-label', '剧情');
    container.append(root);
    const body = doc.createElement('div');
    body.className = 'vc-story-body';
    root.append(body);
    let dead = false;
    let suppress = false;
    let loading = true;
    let view = 'gate';
    let entering = false;
    let alertOpen = false;
    let seenVersion = -1;
    const flipped = new Set();
    let draftSay = '';
    let draftSummary = '';
    let lastNotice = '';
    let desktop = desktopLayout();
    const resize = () => {
        const next = desktopLayout();
        if (next === desktop) return;
        desktop = next;
        if (!dead) paint();
    };
    globalThis.addEventListener('resize', resize);
    let holdTimer = 0;
    const page = createStoryPage({
        getConversation: options.getConversation,
        onRun: options.onRun,
        onActor: options.onActor,
        onAdvance: options.onAdvance,
        getChatIdentity: options.getChatIdentity,
        project: options.project,
        ensureConversation: options.ensureConversation,
        onChange(state) {
            if (dead || suppress) return;
            loading = false;
            paint(state);
            void maybeRewind(state);
        },
    });
    function syncCover(next = view) {
        const shell = root.closest?.('#vc-shell');
        if (!shell) return;
        if (next === 'stage') {
            shell.dataset.cover = 'story';
            if (shell.dataset.settings === 'page') delete shell.dataset.settings;
        } else if (shell.dataset.cover === 'story') delete shell.dataset.cover;
    }
    let storyView = null;
    const reveal = name => flipped.add(name);
    const field = (name, value) => { if (dead) return; if (name === 'say') draftSay = value; if (name === 'summary') draftSummary = value; paint(); };
    function paint(state = page.state) {
        if (dead) return;
        const pushing = view === 'stage' && root.dataset.view !== 'stage';
        root.dataset.view = view;
        root.classList.toggle('vc-desktop-story', view === 'gate');
        container.classList.toggle('vc-desktop-story-stage', view === 'stage');
        syncCover();
        if (pushing) { root.classList.add('is-push'); root.addEventListener('animationend', () => root.classList.remove('is-push'), { once: true }); }
        const version = state.turn?.worldVersion ?? -1, fresh = seenVersion >= 0 && version > seenVersion;
        if (version >= 0) seenVersion = version;
        const props = storyViewProps(state, { view, loading, fresh, draftSay, draftSummary, flipped, reveal, field });
        if (storyView) storyView.update(props); else storyView = mountStoryView(body, props, root);
        if (state.notice && state.notice !== lastNotice) { lastNotice = state.notice; showToast(state.notice, { root, icon: 'sparkles' }); }
        else if (!state.notice) lastNotice = '';
    }
    async function maybeRewind(state) {
        if (!state.rewindAsk || alertOpen || dead) return;
        alertOpen = true;
        const ask = state.rewindAsk;
        const title = ask.version === 0 ? '回到调查开始？' : `回到版本 ${ask.version}？`;
        const opener = body.querySelector('[data-action="ask-rewind"]');
        const pending = confirmAlert({
            title,
            message: '之后的行动与新发现的证物会被撤销。',
            action: '回档',
            root,
            opener,
        });
        stampAlert(root, 'cancel-rewind', 'confirm-rewind');
        requestAnimationFrame(() => stampAlert(root, 'cancel-rewind', 'confirm-rewind'));
        const ok = await pending;
        alertOpen = false;
        if (dead) return;
        focusIfDetached(opener, body.querySelector('.vc-nav-title'));
        if (ok) await page.confirmRewind();
        else page.cancelRewind();
    }
    async function enterStage() {
        if (entering || dead) return;
        entering = true;
        const intro = beginLetterbox(root, '雨夜旅馆', stageWord(page.state.run?.stage));
        try {
            if (!page.state.run) await page.start();
            intro.setStage(stageWord(page.state.run?.stage));
            await intro.ready;
            if (dead || !page.state.run || !page.state.view) {
                intro.box.remove();
                view = 'gate';
                paint();
                return;
            }
            view = 'stage';
            paint();
            await intro.finish();
        } finally {
            entering = false;
        }
    }
    function leaveStage() {
        view = 'gate';
        draftSay = '';
        paint();
    }
    function configure() {
        if (typeof options.onConfigure === 'function') options.onConfigure();
        else root.ownerDocument.getElementById('vc_models_menu_button')?.click();
    }
    function openPersona(btn) {
        const name = btn.querySelector('.vc-npc-name')?.textContent || '';
        const label = btn.getAttribute('aria-label') || '';
        const persona = label.startsWith(name) ? label.slice(name.length).replace(/^，/, '') : '';
        if (!persona) return;
        popMenu(btn, [{ label: persona }], { root });
    }
    async function confirmAccuse(step) {
        if (alertOpen || dead) return;
        alertOpen = true;
        const who = page.state.view?.participants?.find((person) => person.actorId === step.target)?.name || '';
        const ok = await confirmAlert({
            title: who ? `指认${who}？` : '指认这一位？',
            message: '指认之后不能撤回。',
            action: '指认',
            root,
        });
        alertOpen = false;
        if (ok && !dead) await page.act(step.id);
    }
    root.addEventListener('scroll', (event) => {
        if (root.dataset.view !== 'gate') return;
        const scroll = event.target;
        if (!scroll?.classList?.contains?.('vc-scroll')) return;
        const bar = body.querySelector('.vc-navbar');
        if (!bar) return;
        bar.style.setProperty('--vc-nav-p', String(Math.min(1, scroll.scrollTop / 48)));
    }, { capture: true, passive: true });
    root.addEventListener('pointerdown', (event) => {
        const btn = event.target?.closest?.('.vc-npc');
        if (!btn || event.button !== 0) return;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            holdTimer = 0;
            btn.dataset.held = '1';
            openPersona(btn);
        }, 480);
    });
    const clearHold = () => { clearTimeout(holdTimer); holdTimer = 0; };
    root.addEventListener('pointerup', clearHold);
    root.addEventListener('pointercancel', clearHold);
    root.addEventListener('pointermove', (event) => {
        if (Math.abs(event.movementX) + Math.abs(event.movementY) > 8) clearHold();
    });
    root.addEventListener('contextmenu', (event) => {
        const btn = event.target?.closest?.('.vc-npc');
        if (!btn || !root.contains(btn)) return;
        event.preventDefault();
        openPersona(btn);
    });
    root.addEventListener('click', (event) => {
        const target = event.target?.closest?.('button');
        if (!target || target.disabled || !root.contains(target)) return;
        const action = target.dataset.action;
        if (action === 'start' || action === 'enter') void enterStage();
        if (action === 'close') leaveStage();
        if (action === 'select-actor') {
            if (target.dataset.held === '1') {
                delete target.dataset.held;
                return;
            }
            page.selectActor(target.dataset.actor);
        }
        if (action === 'act') {
            const step = STEPS.find((item) => item.id === target.dataset.step);
            if (step?.action === 'accuse') void confirmAccuse(step);
            else void page.act(target.dataset.step);
        }
        if (action === 'say') {
            const text = draftSay;
            if (!text.trim()) return;
            draftSay = '';
            const pending = page.say(text);
            if (!page.state.busy) {
                draftSay = text;
                paint();
            }
            void pending;
        }
        if (action === 'ask-rewind') page.askRewind(target.dataset.version);
        if (action === 'cancel-rewind') page.cancelRewind();
        if (action === 'confirm-rewind') void page.confirmRewind();
        if (action === 'show-companions') void page.showCompanions();
        if (action === 'map-companion') void page.mapCompanion(target.dataset.actor, target.dataset.relationship);
        if (action === 'save-epilogue') void page.saveEpilogue(draftSummary);
        if (action === 'discard-epilogue') void page.discardEpilogue();
        if (action === 'configure') configure();
    });
    root.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        if (event.target?.dataset?.field !== 'say') return;
        event.preventDefault();
        const send = event.target.closest('.vc-field')?.querySelector('[data-action="say"]');
        if (send && !send.disabled) send.click();
    });
    async function refresh() {
        if (dead) return;
        const active = doc.activeElement;
        const focusAction = body.contains(active) ? active.getAttribute('data-action') : '';
        loading = true;
        view = 'gate';
        suppress = true;
        paint();
        try {
            await page.open();
        } finally {
            suppress = false;
            loading = false;
            if (!dead) {
                paint();
                if (focusAction && !active.isConnected && doc.activeElement === doc.body) [...body.querySelectorAll('[data-action]')].find(node => node.getAttribute('data-action') === focusAction)?.focus();
            }
        }
    }
    function destroy() {
        clearTimeout(holdTimer);
        holdTimer = 0;
        dead = true;
        globalThis.removeEventListener('resize', resize);
        syncCover('gate');
        page.close();
        storyView?.unmount(); storyView = null;
        root.remove();
    }
    void refresh();
    return { refresh, destroy };
}
