// UI-P06 玩家剧情页纯逻辑与控制器。只处理玩家 ActorView 的公开字段；不写 localStorage，不调用模型，不依赖 DOM/弹层。
import * as api from './api.js';
import * as actions from './story-action.js';
import { STORY_SYNC_PENDING } from './story-projection.js';
import { iconSpriteUrl } from './ui/icons.js';

export { STORY_SYNC_PENDING };
export const STORY_CONFLICT = '这一局与当前对话冲突，开局未完成。';
export const SESSION_CHANGED = '登录状态已变化，请重新打开剧情页。';
export const START_FAILED = '开局未完成，请重试。';
export const ACTION_FAILED = '这步行动没有完成，请重试。';
export const ACTION_CONFLICT = '这步行动与当前进度不一致，没有另开分支。';
export const CONFIG_MISSING = '剧情导演或 NPC 尚未绑定可用模型。';
export const REWIND_RECALC = '公开线索和角色私密知情范围会重新计算。备份不会因此全部删除。';
export const REWIND_DEVICES = '同一局的其他设备需要加载最新状态，不会自动合并。';
export const REWIND_BLOCKED = '当前聊天还不能回档';
export const REWIND_FAILED = '回档没有完成，请重试。';
export const NEED_CAST = '请先让一位陪伴入局，再保存共同游玩摘要。';
export const SAVE_HINT = '已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。';
export const DISCARD_HINT = '已放弃共同游玩摘要，不会写入日常记忆。';
export const CASE_TITLE = '雨夜旅馆：失踪的怀表';
export const HIDDEN = /PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+/;
export const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
export const ACTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;
export const CHAT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const PLACES = { lobby: '大堂', kitchen: '厨房', workshop: '维修间' };
export const CASTABLE = ['lin', 'zhou', 'su'];
export const REASONS = {
    bad_command: '这步行动无法识别，世界没有变化。',
    unknown_actor: '当前角色不能做这步行动，世界没有变化。',
    action_not_allowed: '当前不能做这步行动，世界没有变化。',
    no_matching_rule: '没有对应的剧情规则，世界没有变化。',
    precondition_failed: '条件还不足，世界没有变化。',
};
export const STEPS = [
    { id: 'a1', label: '向林岚询问借用记录', action: 'request_evidence', target: 'lin' },
    { id: 'a2', label: '向苏禾询问目击', action: 'request_evidence', target: 'su' },
    { id: 'a3', label: '向周澈出示借用记录', action: 'show_clue', target: 'zhou', clueId: 'loan_note' },
    { id: 'a4', label: '向周澈出示蓝色衣袖', action: 'show_clue', target: 'zhou', clueId: 'blue_sleeve' },
    { id: 'a5', label: '向周澈索要钥匙', action: 'request_key', target: 'zhou' },
    { id: 'a6', label: '检查维修柜', action: 'inspect', target: 'workshop_cabinet' },
    { id: 'a7', label: '指认周澈', action: 'accuse', target: 'zhou' },
];
export const ACTION_GROUPS = [
    { id: 'lin', title: '林岚' },
    { id: 'su', title: '苏禾' },
    { id: 'zhou', title: '周澈' },
    { id: 'place', title: '地点' },
];
export const STAGE_MOTION = {
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
const SPRING_CURVE =
    'linear(0, .006, .025 2.8%, .101 6.1%, .539 18.9%, .721 25.3%, .849 31.5%, .937 38.1%, .968 41.8%, .991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.9%, 1)';

function defaultReducedMotion() {
    try {
        return (
            globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true ||
            globalThis.document?.documentElement?.dataset?.vcReducedMotion === 'true' ||
            globalThis.document?.documentElement?.dataset?.vcNativeReducedMotion === 'true'
        );
    } catch {
        return false;
    }
}

export function shown(value) {
    return typeof value === 'string' && value !== '' && !HIDDEN.test(value) ? value : '';
}

export function decimalOf(value) {
    if (typeof value === 'string' && DECIMAL_ID.test(value)) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    return '';
}

export function allowRun(raw) {
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

export function allowView(raw) {
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
        const worldVersion =
            typeof item.worldVersion === 'number' &&
            Number.isSafeInteger(item.worldVersion) &&
            item.worldVersion >= 0
                ? item.worldVersion
                : null;
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
    return {
        setting: shown(lore.setting),
        knownEvent: shown(lore.knownEvent),
        locations,
        knowledge,
        events,
        participants,
    };
}

export function initial(name) {
    const text = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...text][0] || '人';
}

export function actionGroup(step) {
    if (step.id === 'a6') return 'place';
    if (step.target === 'lin' || step.target === 'su' || step.target === 'zhou') return step.target;
    return 'place';
}

export function actionClass(step) {
    if (step.id === 'a6') return 'vcms-btn vcms-btn-primary';
    if (step.id === 'a7') return 'vcms-btn vcms-btn-danger-ghost';
    return 'vcms-btn vcms-btn-ghost';
}

export function storyTurn(run, view, conversationId) {
    const runId = typeof run?.runId === 'string' && DECIMAL_ID.test(run.runId) ? run.runId : '';
    const branchId = typeof run?.branchId === 'string' && DECIMAL_ID.test(run.branchId) ? run.branchId : '';
    const fromRun =
        typeof run?.conversationId === 'string' && DECIMAL_ID.test(run.conversationId) ? run.conversationId : '';
    const fromChat =
        typeof conversationId === 'string' && DECIMAL_ID.test(conversationId) ? conversationId : '';
    const conversation = fromRun || fromChat;
    const worldVersion =
        typeof view?.worldVersion === 'number' &&
        Number.isSafeInteger(view.worldVersion) &&
        view.worldVersion >= 0
            ? view.worldVersion
            : null;
    if (!runId || !branchId || !conversation || worldVersion === null) return null;
    if (typeof view?.runId === 'string' && view.runId !== runId) return null;
    if (typeof view?.branchId === 'string' && view.branchId !== branchId) return null;
    if (fromRun && fromChat && fromRun !== fromChat) return null;
    return { runId, branchId, worldVersion, conversationId: conversation };
}

export function stageWord(stage) {
    if (stage === 'resolved') return '已结束';
    if (stage === 'investigation') return '调查中';
    return '';
}

export function rewindCopy(ask) {
    return `回到世界版本 ${ask.version}，阶段为${ask.stage}。此版本之后的行动不会留在当前分支，需要重新提交才会再次发生。该阶段之后形成的分支记忆会失效，不会并入当前进度。`;
}

export function viewState(state) {
    if (!state.run || !state.view) return 'unstarted';
    if (state.busy && state.run.stage !== 'resolved') return 'generating';
    if (state.run.stage === 'resolved') return 'ended';
    if (state.reason === ACTION_CONFLICT) return 'conflict';
    if (state.reason) return 'rejected';
    if (state.notice) return 'evidence';
    return 'playing';
}

export function storyMode(state) {
    if (!state.run || !state.view) return 'unstarted';
    return viewState(state);
}

export function rewindTargets(state) {
    const version = state.turn?.worldVersion ?? 0;
    const versions = new Set();
    if (version > 0) versions.add(0);
    for (const event of state.view?.events || []) {
        if (typeof event.worldVersion === 'number' && event.worldVersion < version) {
            versions.add(event.worldVersion);
        }
    }
    return [...versions].sort((a, b) => a - b);
}

export function evidenceIcon(name) {
    const text = String(name);
    if (text.includes('表')) return 'watch';
    if (text.includes('钥匙')) return 'key-round';
    if (text.includes('画')) return 'image';
    return 'sparkles';
}

export function evidenceItems(state) {
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

export function freshClueName(state) {
    const notice = typeof state.notice === 'string' ? state.notice : '';
    const prefix = '发现证据：';
    return notice.startsWith(prefix) ? notice.slice(prefix.length) : '';
}

export function coverPeople(state) {
    const people = (state.view?.participants || []).filter(
        (person) => person.actorId && person.actorId !== 'player',
    );
    if (people.length) return people.slice(0, 3);
    return ACTION_GROUPS.filter((group) => group.id !== 'place').map((group) => ({
        actorId: group.id,
        name: group.title,
    }));
}

export function progressPercent(state) {
    if (state.run?.stage === 'resolved') return 100;
    const version = state.turn?.worldVersion ?? 0;
    return Math.max(0, Math.min(100, Math.round((version / STEPS.length) * 100)));
}

// 只投影允许显示的状态；服务/分支/投影命令仍由原控制器执行。
export function storyViewProps(state, options = {}) {
    const legacy = options.legacy === true,
        playing = Boolean(state.run && state.view);
    const mode = storyMode(state),
        stage = stageWord(state.run?.stage),
        view = state.view || {};
    const people = (view.participants || []).map((person) => ({
        id: person.actorId,
        name: person.name,
        initial: initial(person.name),
        persona: person.persona || '',
        selected: person.actorId === state.actorId,
    }));
    const selected = people.find((person) => person.selected);
    const clue = freshClueName(state);
    return {
        legacy,
        desktop: Boolean(options.desktop),
        gate: options.view !== 'stage' || !playing,
        loading: options.loading === true,
        mode,
        stage,
        title: legacy
            ? state.run?.caseId === 'rainy-inn-v1'
                ? CASE_TITLE
                : '剧情'
            : state.run?.caseId === 'rainy-inn-v1'
              ? '雨夜旅馆'
              : '剧情',
        caseTitle: CASE_TITLE,
        busy: Boolean(state.busy),
        playing,
        ended: state.run?.stage === 'resolved',
        version: state.turn?.worldVersion ?? 0,
        percent: progressPercent(state),
        config: state.configNote || '',
        error: state.error || '',
        reason: state.reason || '',
        notice: state.notice || '',
        sync: state.syncPending ? STORY_SYNC_PENDING : '',
        epilogue: state.epilogue || '',
        people,
        cover: coverPeople(state).map((person) => ({
            id: person.actorId,
            name: person.name,
            initial: initial(person.name),
            persona: '',
            selected: false,
        })),
        setting: view.setting || '',
        known: view.knownEvent || '',
        locations: view.locations || [],
        knowledge: view.knowledge || [],
        lines: (view.events || []).map((event, index, events) => ({
            id: event.worldEventId || String(index),
            text: event.line,
            say: /[“"「]/.test(event.line),
            fresh: Boolean(options.fresh && index === events.length - 1),
        })),
        cards: evidenceItems(state).map((item) => ({
            ...item,
            glyph: evidenceIcon(item.name),
            fresh: item.name === clue,
            flipped: options.flipped?.has(item.name) || false,
        })),
        steps: STEPS.map((step) => ({
            id: step.id,
            label: step.label,
            visible:
                actionGroup(step) === 'place' ||
                (Boolean(selected) && step.target === selected.id),
            group: actionGroup(step),
            className: legacy
                ? actionClass(step)
                : step.action === 'accuse'
                  ? 'vc-btn vc-btn-danger'
                  : 'vc-btn vc-btn-gray',
        })),
        versions: rewindTargets(state),
        selected: selected?.name || '',
        companions: state.companions
            ? state.companions.flatMap((row) =>
                  CASTABLE.map((actor) => ({
                      actor,
                      relationship: String(row.relationshipId),
                      label: `${row.name} 入局为${people.find((person) => person.id === actor)?.name || actor}`,
                  })),
              )
            : null,
        draftSay: options.draftSay || '',
        draftSummary: options.draftSummary || '',
        sprite: iconSpriteUrl(),
        rewind: state.rewindAsk
            ? {
                  version: state.rewindAsk.version,
                  title:
                      state.rewindAsk.version === 0
                          ? '回到调查开始？'
                          : `回到版本 ${state.rewindAsk.version}？`,
                  message: rewindCopy(state.rewindAsk),
                  recalc: REWIND_RECALC,
                  devices: REWIND_DEVICES,
              }
            : null,
        rewindHost: options.rewindHost,
        motion: {
            reduced: options.reducedMotion ?? defaultReducedMotion(),
            duration: STAGE_MOTION.flipMs,
            easing: options.easing || SPRING_CURVE,
        },
        reveal: options.reveal || (() => {}),
        field: options.field || (() => {}),
        cancelRewind: options.cancelRewind || (() => {}),
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
        open: false,
        busy: false,
        error: '',
        conflict: false,
        run: null,
        view: null,
        turn: null,
        actorId: '',
        reason: '',
        notice: '',
        syncPending: false,
        rewindAsk: null,
        epilogue: '',
        companions: null,
        mapped: {},
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
        return current.mode === 'STORY' && DECIMAL_ID.test(current.conversationId || '')
            ? current.conversationId
            : '';
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
        if (branchId) {
            state.turn = {
                ...state.turn,
                runId,
                branchId,
                worldVersion:
                    typeof run?.worldVersion === 'number' ? run.worldVersion : state.turn.worldVersion,
            };
        }
        await refreshView();
        state.notice = '';
    }
    async function projectEvent(result, text) {
        if (typeof project !== 'function' || !result?.worldEventId) {
            return { confirmed: false, appended: false };
        }
        const job = {
            runId: state.turn.runId,
            conversationId: state.turn.conversationId,
            worldEventId: String(result.worldEventId),
            text,
            cancelled: false,
        };
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
            body = await api.storyRequest(
                'GET',
                `/api/v1/story/runs/${state.turn.runId}/projections?state=PENDING`,
            );
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
            state.turn = {
                ...state.turn,
                branchId: decimalOf(result.branchId) || state.turn.branchId,
                worldVersion: result.worldVersion,
            };
            if (result.ended || result.stage === 'resolved') {
                state.run = { ...state.run, stage: 'resolved' };
            } else if (result.stage === 'investigation') {
                state.run = { ...state.run, stage: 'investigation' };
            }
            onAdvance(state.turn);
            await refreshView();
            if (!alive(ticket)) return;
            const event = state.view.events.find(
                (item) => item.worldEventId && item.worldEventId === String(result.worldEventId),
            );
            state.notice = event?.clueName ? `发现证据：${event.clueName}` : '';
            state.syncPending = true;
            emit();
            await projectEvent(result, event?.line || state.notice || '这一步行动已记录');
        } catch (error) {
            if (!alive(ticket)) return;
            if (error?.status === 409 && error?.code !== 'ACCOUNT_CONTEXT_CHANGED') {
                state.reason = ACTION_CONFLICT;
                try {
                    await reloadHead();
                } catch {
                    /* 保持当前头 */
                }
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
            if (state.turn && (current || ensureConversation) && state.turn.conversationId !== current) {
                resetRun();
            }
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
            if (!state.turn || !Number.isSafeInteger(target) || target < 0 || target >= state.turn.worldVersion) {
                return;
            }
            const resolved = state.view?.events?.some(
                (event) => event.worldVersion === target && event.phase === 'resolved',
            );
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
                    worldVersion:
                        typeof result?.worldVersion === 'number'
                            ? result.worldVersion
                            : state.turn.worldVersion,
                };
                if (result?.stage === 'resolved') state.run = { ...state.run, stage: 'resolved' };
                else if (result?.stage === 'investigation') {
                    state.run = { ...state.run, stage: 'investigation' };
                }
                onAdvance(state.turn);
                await refreshView();
            } catch (error) {
                if (!alive(ticket)) return;
                state.reason =
                    error?.status === 409 && error?.code === 'ACCOUNT_CONTEXT_CHANGED'
                        ? SESSION_CHANGED
                        : REWIND_FAILED;
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
            return applyCommand({
                actionId: step.id,
                actorId: 'player',
                action: step.action,
                target: step.target,
                clueId: step.clueId,
            });
        },
        say(text) {
            const spoken = typeof text === 'string' ? text.trim() : '';
            if (
                !state.turn ||
                state.busy ||
                !CASTABLE.includes(state.actorId) ||
                !spoken ||
                state.run?.stage === 'resolved'
            ) {
                if (state.turn && !CASTABLE.includes(state.actorId)) state.reason = '先选择要对谁说。';
                emit();
                return;
            }
            statements += 1;
            return applyCommand({
                actionId: `s${statements}`,
                actorId: 'player',
                target: state.actorId,
                text: spoken,
            });
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
            await actions.mapStoryParticipant({
                runId: state.turn.runId,
                actorId,
                relationshipId: id,
            });
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
                    const bound = await api.resolveSTBinding({
                        chatIdentity,
                        characterRef,
                        mode: 'STORY',
                        displayName: '雨夜旅馆',
                    });
                    if (!alive(ticket)) return;
                    if (!DECIMAL_ID.test(bound?.conversationId || '')) {
                        throw new api.ApiError('invalid', START_FAILED, {
                            status: 0,
                            code: 'INVALID_REQUEST',
                        });
                    }
                    conversationId = bound.conversationId;
                    remembered = conversationId;
                }
                const run = await api.startStoryRun(conversationId);
                if (!alive(ticket)) return;
                const view = await api.fetchStoryActorView({
                    runId: String(run?.runId ?? ''),
                    branchId: String(run?.branchId ?? ''),
                    worldVersion: String(run?.worldVersion ?? ''),
                });
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
