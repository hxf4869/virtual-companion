// UI-P06 玩家剧情页。只渲染玩家 ActorView 的公开字段；不写 localStorage，不调用模型。
import { confirmAlert } from './ui/alert.js';
import { mountStoryView } from './desktop/build/index.js';
import { readVcUiFlag } from './ui/theme.js';
import { desktopLayout } from './desktop/presentation.js';
import { popMenu } from './ui/menu.js';
import { animate, EASE_IN_OUT, EASE_OUT, prefersReducedMotion, SPRING } from './ui/motion.js';
import { showToast } from './ui/toast.js';
import {
    STORY_SYNC_PENDING,
    STORY_CONFLICT,
    SESSION_CHANGED,
    START_FAILED,
    ACTION_FAILED,
    ACTION_CONFLICT,
    CONFIG_MISSING,
    REWIND_RECALC,
    REWIND_DEVICES,
    REWIND_BLOCKED,
    REWIND_FAILED,
    NEED_CAST,
    SAVE_HINT,
    DISCARD_HINT,
    CASE_TITLE,
    HIDDEN,
    DECIMAL_ID,
    ACTOR_ID,
    CHAT_IDENTITY,
    PLACES,
    CASTABLE,
    REASONS,
    STEPS,
    ACTION_GROUPS,
    shown,
    decimalOf,
    allowRun,
    allowView,
    initial,
    actionGroup,
    actionClass,
    storyTurn,
    stageWord,
    rewindCopy,
    viewState,
    storyMode,
    rewindTargets,
    evidenceIcon,
    evidenceItems,
    freshClueName,
    coverPeople,
    progressPercent,
    storyViewProps as storyViewPropsBase,
    createStoryPage,
} from './story-logic.js';

export {
    STORY_SYNC_PENDING,
    STORY_CONFLICT,
    SESSION_CHANGED,
    START_FAILED,
    ACTION_FAILED,
    ACTION_CONFLICT,
    CONFIG_MISSING,
    REWIND_RECALC,
    REWIND_DEVICES,
    REWIND_BLOCKED,
    REWIND_FAILED,
    NEED_CAST,
    SAVE_HINT,
    DISCARD_HINT,
    CASE_TITLE,
    HIDDEN,
    DECIMAL_ID,
    ACTOR_ID,
    CHAT_IDENTITY,
    PLACES,
    CASTABLE,
    REASONS,
    STEPS,
    ACTION_GROUPS,
    shown,
    decimalOf,
    allowRun,
    allowView,
    initial,
    actionGroup,
    actionClass,
    storyTurn,
    stageWord,
    rewindCopy,
    viewState,
    storyMode,
    rewindTargets,
    evidenceIcon,
    evidenceItems,
    freshClueName,
    coverPeople,
    progressPercent,
    createStoryPage,
};

export function storyViewProps(state, options = {}) {
    return storyViewPropsBase(state, {
        ...options,
        desktop: options.desktop ?? desktopLayout(),
        reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
        easing: options.easing ?? SPRING,
    });
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
