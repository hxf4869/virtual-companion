// UI-P06 玩家剧情页。只渲染玩家 ActorView 的公开字段；不写 localStorage，不调用模型。
import * as api from './api.js';

export const STORY_CONFLICT = '这一局与当前对话冲突，开局未完成。';
const SESSION_CHANGED = '登录状态已变化，请重新打开剧情页。';
const START_FAILED = '开局未完成，请重试。';
const CASE_TITLE = '雨夜旅馆：失踪的怀表';
const HIDDEN = /PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+/;
const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const ACTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const PLACES = { lobby: '大堂', kitchen: '厨房', workshop: '维修间' };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shown(value) {
    return typeof value === 'string' && value !== '' && !HIDDEN.test(value) ? value : '';
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
    return {
        caseId: raw?.caseId === 'rainy-inn-v1' ? 'rainy-inn-v1' : '',
        stage: raw?.stage === 'investigation' ? 'investigation' : '',
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
        const note = shown(item?.body?.note);
        if (note) events.push(note);
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

export function renderStoryPage(state) {
    const playing = Boolean(state.run && state.view);
    if (!playing) {
        return `<div class="vc-story" data-state="unstarted">
      <header class="vc-story-bar"><h1>雨夜旅馆</h1><button type="button" class="vcms-btn vcms-btn-ghost" data-action="close">关闭</button></header>
      <section class="vc-story-gate"><h2>${CASE_TITLE}</h2>${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}<button type="button" class="vcms-btn vcms-btn-primary" data-action="start" ${state.busy ? 'disabled' : ''}>开局</button></section>
    </div>`;
    }
    const stage = state.run.stage === 'investigation' ? '调查中' : '';
    const people = state.view.participants.map((person) => `<article class="vc-story-person"><h3>${esc(person.name)}</h3>${person.persona ? `<p>${esc(person.persona)}</p>` : ''}</article>`).join('');
    return `<div class="vc-story" data-state="playing">
      <header class="vc-story-bar"><h1>${esc(state.run.caseId === 'rainy-inn-v1' ? CASE_TITLE : '剧情')}</h1>${stage ? `<p class="vc-story-stage">${esc(stage)}</p>` : ''}<button type="button" class="vcms-btn vcms-btn-ghost" data-action="close">关闭</button></header>
      <p class="vc-story-setting">${esc(state.view.setting)}</p>
      <p class="vc-story-known">${esc(state.view.knownEvent)}</p>
      <section class="vc-story-cast">${people}</section>
      <ul class="vc-story-places">${list(state.view.locations)}</ul>
      <ul class="vc-story-clues">${list(state.view.knowledge)}</ul>
      <ul class="vc-story-events">${list(state.view.events)}</ul>
    </div>`;
}

export function createStoryPage({ getConversation = () => ({ conversationId: '', mode: '' }), onChange = () => {} } = {}) {
    const state = { open: false, busy: false, error: '', conflict: false, run: null, view: null };
    let epoch = 0;
    let remembered = '';
    const emit = () => onChange(state);
    const alive = (ticket) => state.open && epoch === ticket;
    function fail(error) {
        state.run = null;
        state.view = null;
        state.conflict = error?.status === 409 && error?.code !== 'ACCOUNT_CONTEXT_CHANGED';
        if (error?.status === 409 && error?.code === 'ACCOUNT_CONTEXT_CHANGED') state.error = SESSION_CHANGED;
        else if (error?.status === 409) state.error = STORY_CONFLICT;
        else state.error = START_FAILED;
    }
    return {
        state,
        async open() {
            state.open = true;
            emit();
            if (state.run) return;
            try {
                await api.captureSessionContext();
            } catch {
                // start() 会再取会话；不把服务端原文放进页面。
            }
        },
        close() {
            epoch += 1;
            state.open = false;
            state.busy = false;
            emit();
        },
        async start() {
            if (!state.open || state.busy || state.run) return;
            const ticket = epoch;
            state.busy = true;
            state.error = '';
            state.conflict = false;
            emit();
            try {
                await api.captureSessionContext();
                if (!alive(ticket)) return;
                const current = getConversation() || {};
                let conversationId = '';
                if (current.mode === 'STORY' && DECIMAL_ID.test(current.conversationId || '')) {
                    conversationId = current.conversationId;
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
                state.error = '';
                state.conflict = false;
            } catch (error) {
                if (!alive(ticket)) return;
                fail(error);
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
    };
}

export function mountStoryPage({ getConversation = () => ({ conversationId: '', mode: '' }) } = {}) {
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
    const render = (state) => {
        if (!state.open) return;
        dialog.innerHTML = `<div class="vc-story-page">${renderStoryPage(state)}</div>`;
    };
    const page = createStoryPage({ getConversation, onChange: render });
    const close = () => {
        page.close();
        dialog.close();
        dialog.innerHTML = '';
        opener?.focus();
    };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target || target.disabled) return;
        if (target.dataset.action === 'close') close();
        if (target.dataset.action === 'start') void page.start();
    });
    return {
        open(returnFocusTarget = document.activeElement) {
            if (dialog.open) return;
            opener = returnFocusTarget;
            dialog.showModal();
            void page.open();
            dialog.querySelector('h1')?.focus();
        },
        close,
    };
}
