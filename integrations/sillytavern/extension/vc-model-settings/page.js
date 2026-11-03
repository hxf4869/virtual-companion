// Virtual Companion · 模型设置控制器；React 独占可见页面子树，原业务状态与 API 保持单一来源。
// 入口由 ST 扩展 index.js 或独立 harness 调用 mountModelSettings()。
// 样式作用域 .vcms-*；主题 tokens 见 style.css（v2-design §3）。
import { confirmAlert, confirmDiscard } from './ui/alert.js';
import { showToast } from './ui/toast.js';
import * as logic from './model-logic.js';
import * as api from './api.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountModelPageView } from './desktop/build/index.js';
import { registerModelOpener, vcUiEnabled } from './drawers.js';

let extensionInitClaimed = false;

export function claimExtensionInit() {
    if (extensionInitClaimed) return false;
    extensionInitClaimed = true;
    return true;
}

export function observeGenerateBudget(response, onSignal) {
    const type = response?.headers?.get?.('content-type') || '';
    if (!response || response.ok || !type.includes('json') || typeof response.clone !== 'function') return response;
    try {
        const copy = response.clone();
        void copy.json().then((body) => {
            const signal = logic.budgetSignalFromGenerateBody(body);
            if (signal) onSignal?.(signal);
        }).catch(() => {});
    } catch {
        return response;
    }
    return response;
}

export function guardSameTurn(run) {
    let pending = false;
    return (...args) => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; });
        return run(...args);
    };
}

export function legacyDialogAllowed(doc = globalThis.document) {
    return doc?.body?.classList?.contains?.('vc-ui') !== true;
}

const ROOT_ID = 'vc-model-settings-root';
const NEW_KEY_PLACEHOLDER_RE = /^__new_\d+__$/;

let mounted = null;

function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isBlank(v) {
    return v === '' || v === null || v === undefined;
}

function deepClone(obj) {
    return structuredClone(obj);
}

export function mountModelSettings() {
    if (mounted) return mounted;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'vcms-root';
    root.innerHTML = '<div class="vcms-overlay" hidden></div>';
    document.body.appendChild(root);

    const overlay = root.querySelector('.vcms-overlay');
    let view = null;
    let navigationCopy = null;
    let localRerankSaving = false;
    const modelIdentities = new WeakMap();
    let nextModelIdentity = 0;
    let usageRequest = 0;
    let providerRequest = 0;
    let activeModel = null;

    const state = {
        phase: 'idle', // idle | loading | ready | load-error
        loadError: null,
        providers: [], // AdminModelProvider[]（API 形状）
        purposes: [], // 固定 6 条绑定（API 形状）
        selectedProviderId: null,
        creatingNew: false, // 当前编辑的是未持久化的新供应商（与 selectedProviderId 区分）
        draft: null, // 当前供应商草稿
        originalDraft: null, // 选中时的草稿快照
        // 草稿对象保持编辑身份；可编辑的配置标识只作为派生观察值。
        get selectedProfileKey() { return activeModel?.profileKey ?? null; },
        tab: 'provider', // provider | bindings
        saving: false,
        saveError: null,
        conflict: null, // {message, currentRevision}
        contextChanged: null, // 会话上下文变更（409 ACCOUNT_CONTEXT_CHANGED / 401）提示文案；非空时要求显式重新加载
        stash: null, // 冲突「查看最新」前暂存的草稿
        stashBanner: false,
        keyEditing: false, // 替换密钥输入框展开
        keyClearing: false, // 清除密钥确认展开
        cloneFor: null, // {profileKey, newProfileKey, newDisplayName, error}
        deleteFor: null, // 确认删除中的 profileKey
        impact: null, // 保存前共享影响面板
        discoverBusy: false,
        discoverError: null,
        bindingsDraft: new Map(), // purpose -> {providerId, profileKey, state, revision, dirty, error}
        bindingsSaving: false,
        bindingsConflict: null, // {purpose, currentRevision}
        closing: false, // 关闭确认条
        returnToSettings: false,
        toast: null,
        check: { busy: false, error: null, result: null }, // 连接检查（check-only，不改草稿）
        budget: { known: false, insufficient: false },
        usage: { month: logic.currentUsageMonth(), rows: [], error: null, loading: false },
        reauth: { open: false, busy: false, error: null, password: '', retry: null }, // 403 再验证；retry: 'provider' | 'bindings' | 'verify-tool-calls'
        toolVerify: { busy: false, profileKey: null, error: null },
        vcScreen: 'home', // 仅 body.vc-ui：home | provider | model
        localModels: { phase: 'idle' },
        advancedOpen: false,
    };

    function isDirty() {
        if (state.stash) return true;
        if (state.draft && state.originalDraft && logic.draftDiffers(state.draft, state.originalDraft)) return true;
        for (const b of state.bindingsDraft.values()) if (b.dirty) return true;
        return false;
    }

    const catalogSavedCallbacks = [];

    /** 保存目录（供应商 / 用途绑定）成功后通知外部（前台投影刷新等）；回调异常不阻断页面。 */
    function notifyCatalogSaved() {
        for (const cb of catalogSavedCallbacks) {
            try {
                cb();
            } catch {
                // 外部回调失败不影响页面自身流程。
            }
        }
    }

    const controller = {
        open,
        close: requestClose,
        requestLeave,
        isOpen: () => !overlay.hidden,
        isDirty,
        isBusy: () => state.saving || state.bindingsSaving || localRerankSaving || state.reauth.busy,
        // 容器销毁仅卸载视图、失效迟到请求和敏感输入；草稿留在原控制器，不弹出新的离开确认。
        detach: close,
        onCatalogSaved(cb) {
            if (typeof cb === 'function') catalogSavedCallbacks.push(cb);
        },
        applyBudget(payload) {
            state.budget = logic.interpretUsageBudget(payload);
            if (state.phase === 'ready') render();
            syncSendGate();
            return state.budget;
        },
        root,
        _state: state, // 仅 harness / 测试观察用，不作为产品接口
    };

    // ---------- 数据 ----------

    async function load() {
        usageRequest += 1;
        invalidateProviderRequests();
        state.phase = 'loading';
        state.loadError = null;
        state.contextChanged = null;
        render();
        try {
            // 会话上下文快照与目录同批取得：load（含显式重新加载）是唯一刷新快照的入口，
            // 写请求前绝不静默重取（core.go VC-R169 跨账号/旧会话防护）。
            const usageMonth = state.usage.month || logic.currentUsageMonth();
            const [, providers, purposes, usageResult] = await Promise.all([
                api.captureSessionContext(),
                api.fetchProviders(),
                api.fetchModelPurposes(),
                api.fetchUsageSummary(usageMonth).then((data) => ({ data }), (error) => ({ error })),
            ]);
            if (usageResult.error) {
                state.usage = { month: usageMonth, rows: [], error: usageResult.error.message || '用量暂时无法读取', loading: false };
            } else {
                state.usage = {
                    month: usageResult.data?.month || usageMonth,
                    rows: Array.isArray(usageResult.data?.purposes) ? usageResult.data.purposes : [],
                    error: null,
                    loading: false,
                };
            }
            state.providers = Array.isArray(providers) ? providers : [];
            state.purposes = Array.isArray(purposes) ? purposes : [];
            state.bindingsDraft = new Map(
                state.purposes.map((b) => [b.purpose, {
                    providerId: b.providerId ?? '',
                    profileKey: b.profileKey ?? '',
                    state: b.state ?? 'ENABLED',
                    revision: b.revision ?? 0,
                    dirty: false,
                    error: null,
                }]),
            );
            if (!state.selectedProviderId || !state.providers.some((p) => p.providerId === state.selectedProviderId)) {
                state.selectedProviderId = state.providers[0]?.providerId ?? null;
            }
            selectProvider(state.selectedProviderId, { silent: true });
            state.phase = 'ready';
        } catch (err) {
            state.phase = 'load-error';
            state.loadError = err;
        }
        render();
    }

    function invalidateProviderRequests() {
        providerRequest += 1;
        state.discoverBusy = false;
        state.discoverError = null;
        state.check = { busy: false, error: null, result: null };
        state.toolVerify = { busy: false, profileKey: null, error: null };
        state.reauth = { open: false, busy: false, error: null, password: '', retry: null };
    }

    function clearProviderDraft() {
        state.creatingNew = false;
        state.draft = null;
        state.originalDraft = null;
        activeModel = null;
        state.keyEditing = false;
        state.keyClearing = false;
        state.conflict = null;
        state.stash = null;
        state.stashBanner = false;
        state.impact = null;
        state.cloneFor = null;
        state.deleteFor = null;
        state.saveError = null;
    }

    function selectProvider(providerId, { silent = false } = {}) {
        invalidateProviderRequests();
        state.selectedProviderId = providerId;
        const found = state.providers.find((p) => p.providerId === providerId) ?? null;
        // 目录为空时不是「正在新建」。空状态由列表自己呈现，点「新建」才进入草稿。
        if (!found && (providerId == null || providerId === '')) {
            clearProviderDraft();
            if (!silent) render();
            return;
        }
        state.creatingNew = !found;
        state.draft = found ? logic.providerDraftFromApi(found) : logic.newProviderDraft();
        state.originalDraft = deepClone(state.draft);
        activeModel = state.draft.models[0] ?? null;
        state.keyEditing = false;
        state.keyClearing = false;
        state.conflict = null;
        state.stash = null;
        state.stashBanner = false;
        state.impact = null;
        state.cloneFor = null;
        state.deleteFor = null;
        state.saveError = null;
        if (!silent) render();
    }

    function currentModel() {
        return activeModel;
    }

    function normalizeDraftKeys() {
        if (!state.draft) return;
        for (const m of state.draft.models) {
            if (NEW_KEY_PLACEHOLDER_RE.test(m.profileKey) || m.profileKey === '') {
                m.profileKey = String(m.modelId ?? '').trim();
            }
        }
    }

    // ---------- 校验聚合 ----------

    function collectErrors() {
        if (!state.draft) {
            return { provider: {}, credential: {}, models: new Map(), endpoint: null };
        }
        const isNew = state.creatingNew;
        const provider = logic.validateProviderForm(state.draft, { isNew });
        const credential = logic.validateCredentialPlan(state.draft, {
            isNew,
            credentialConfigured: state.draft.credentialConfigured,
        });
        const models = new Map();
        for (const model of state.draft.models) {
            const errs = logic.validateModelForm(model);
            if (Object.keys(errs).length) models.set(model.profileKey, errs);
        }
        return { provider: provider.errors, credential, models, endpoint: provider.endpoint };
    }

    function hasErrors(errors) {
        return Boolean(
            Object.keys(errors.provider).length
            || Object.keys(errors.credential).length
            || errors.models.size > 0,
        );
    }

    function sharedImpactModels() {
        // 被编辑且被用途引用的模型（保存前提示影响 / 另存为）。
        const list = [];
        for (const model of state.draft.models) {
            if (!model.boundPurposes?.length) continue;
            const originalModel = state.originalDraft?.models.find((m) => m.profileKey === model.profileKey);
            let edited = model.isNew || model.isClone || model.editedSubs.size > 0;
            if (!edited && originalModel) {
                edited = model.displayName !== originalModel.displayName
                    || model.modelId !== originalModel.modelId
                    || String(model.contextWindowTokens) !== String(originalModel.contextWindowTokens)
                    || String(model.maxOutputTokens) !== String(originalModel.maxOutputTokens)
                    || model.state !== originalModel.state;
            }
            if (!originalModel) edited = true;
            if (edited) {
                list.push({
                    profileKey: model.profileKey,
                    displayName: model.displayName || model.modelId,
                    usages: model.boundPurposes.map(logic.purposeMeta),
                });
            }
        }
        return list;
    }

    // ---------- 保存 ----------

    async function doSaveProvider() {
        if (state.saving || !state.draft) return;
        normalizeDraftKeys();
        const errors = collectErrors();
        if (hasErrors(errors)) {
            state.impact = null;
            refreshFeedback();
            toast('有字段未通过校验，请按提示修改。', 'error');
            return;
        }
        const impacts = sharedImpactModels();
        const usages = [...new Set(impacts.flatMap((item) => item.usages.map((usage) => usage.label)))];
        if (usages.length > 1 && !state.impact) {
            state.impact = impacts;
            const accepted = await confirmAlert({ title: `同时影响 ${usages.length} 个用途`, message: `${usages.join('、')} 会使用修改后的配置。`, cancel: '检查一下', action: '仍要保存' });
            state.impact = null;
            if (!accepted) return;
        }
        const isNew = state.creatingNew;
        const keepProfileKey = state.selectedProfileKey;
        const payload = logic.buildProviderPut(state.draft, { isNew });
        state.saving = true;
        state.saveError = null;
        render();
        try {
            const providerId = isNew ? state.draft.providerId.trim() : state.draft.providerId;
            await api.saveProvider(providerId, payload);
            state.creatingNew = false;
            state.impact = null;
            state.stash = null;
            state.stashBanner = false;
            state.conflict = null;
            toast('已保存', 'success');
            const keepId = providerId;
            state.providers = await api.fetchProviders();
            state.purposes = await api.fetchModelPurposes();
            for (const b of state.purposes) {
                const d = state.bindingsDraft.get(b.purpose);
                // 只重置未编辑的绑定；编辑中的草稿保留原 revision，不能被刷新悄悄升级。
                if (!d) {
                    state.bindingsDraft.set(b.purpose, {
                        providerId: b.providerId ?? '', profileKey: b.profileKey ?? '',
                        state: b.state ?? 'ENABLED', revision: b.revision ?? 0, dirty: false, error: null,
                    });
                } else if (!d.dirty) {
                    d.providerId = b.providerId ?? '';
                    d.profileKey = b.profileKey ?? '';
                    d.state = b.state ?? 'ENABLED';
                    d.revision = b.revision ?? 0;
                }
            }
            state.selectedProviderId = keepId;
            selectProvider(keepId, { silent: true });
            activeModel = state.draft.models.find(model => model.profileKey === keepProfileKey) ?? activeModel;
            state.saving = false;
            render();
            notifyCatalogSaved(); // 目录已更新 → 前台投影刷新
        } catch (err) {
            state.saving = false;
            state.impact = null;
            if (err instanceof api.ApiError && err.kind === 'conflict-revision') {
                const info = logic.conflictInfo(err);
                state.conflict = {
                    message: '这段配置已在另一处更新。你的输入已保留，请加载最新内容后继续。',
                    currentRevision: info?.currentRevision ?? null,
                };
                state.impact = null;
            } else if (err instanceof api.ApiError && err.kind === 'context-changed') {
                // 会话上下文变更：保留草稿，要求显式重新加载（快照不自动刷新）。
                state.contextChanged = '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，本次未保存。你的输入已保留；请重新加载页面数据后再继续。';
            } else if (err instanceof api.ApiError && err.kind === 'unauthenticated') {
                state.contextChanged = '登录已过期，本次未保存。你的输入已保留；请重新登录后，再重新加载页面数据。';
            } else if (err instanceof api.ApiError && err.kind === 'forbidden') {
                // 403 FreshReauth 过期：最小再验证（密码），成功后自动重试保存。
                state.saveError = '写入前需要重新验证身份。请在下方输入当前登录密码完成验证，验证后将继续保存。';
                state.reauth = { open: true, busy: false, error: null, password: '', retry: 'provider' };
            } else if (err instanceof api.ApiError && err.kind === 'invalid') {
                state.saveError = '保存内容未通过校验，请检查表单后重试。';
            } else if (err instanceof api.ApiError && err.kind === 'profile-in-use') {
                state.saveError = '该模型配置仍被用途绑定引用，请先解除绑定。';
            } else {
                state.saveError = err?.message ?? '保存失败，请重试。';
            }
            render();
        }
    }

    async function viewLatestAfterConflict() {
        const request = providerRequest;
        try {
            const providers = await api.fetchProviders();
            if (request !== providerRequest) return;
            state.providers = Array.isArray(providers) ? providers : [];
            const latest = state.providers.find((p) => p.providerId === state.draft.providerId);
            if (!latest) {
                state.conflict = {
                    message: '最新列表中已不存在该供应商（可能已被删除）。你的输入已保留，可复制为新建供应商。',
                    currentRevision: null,
                };
                render();
                return;
            }
            state.stash = {
                draft: deepClone(state.draft),
                selectedProfileKey: state.selectedProfileKey,
            };
            invalidateProviderRequests();
            state.draft = logic.providerDraftFromApi(latest);
            state.originalDraft = deepClone(state.draft);
            state.conflict = null;
            state.stashBanner = true;
            activeModel = state.draft.models[0] ?? null;
            render();
        } catch (err) {
            if (request !== providerRequest) return;
            state.conflict = {
                message: `加载最新内容失败：${err?.message ?? '网络错误'}。你的输入仍已保留。`,
                currentRevision: state.conflict?.currentRevision ?? null,
            };
            render();
        }
    }

    function restoreStash() {
        if (!state.stash) return;
        const values = state.stash.draft;
        const latestRevision = state.draft.revision;
        // 以最新为基准恢复草稿值：重新应用修改基于最新 revision。
        invalidateProviderRequests();
        state.draft = values;
        state.draft.revision = latestRevision;
        activeModel = state.draft.models.find(model => model.profileKey === state.stash.selectedProfileKey) ?? state.draft.models[0] ?? null;
        state.stash = null;
        state.stashBanner = false;
        render();
    }

    async function doSaveBindings() {
        if (state.bindingsSaving) return;
        const dirty = [...state.bindingsDraft.entries()].filter(([, b]) => b.dirty);
        if (!dirty.length) return;
        state.bindingsSaving = true;
        render();
        let failed = 0;
        for (const [purpose, b] of dirty) {
            b.error = null;
            try {
                await api.saveModelPurpose(purpose, logic.buildBindingPut(b));
                b.dirty = false;
            } catch (err) {
                failed += 1;
                if (err instanceof api.ApiError && err.kind === 'conflict-revision') {
                    b.error = '该用途绑定已在另一处更新；你的选择已保留，请在上方对比后选择。';
                    state.bindingsConflict = { purpose, currentRevision: err.details?.currentRevision ?? null, latest: null };
                } else if (err instanceof api.ApiError && err.kind === 'context-changed') {
                    b.error = '登录会话已变更；你的选择已保留，请重新加载页面数据。';
                    state.contextChanged = '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，本次未保存。你的选择已保留；请重新加载页面数据后再继续。';
                } else if (err instanceof api.ApiError && err.kind === 'forbidden') {
                    b.error = '写入前需要重新验证身份；请在顶部完成验证后重试。';
                    state.reauth = { open: true, busy: false, error: null, password: '', retry: 'bindings' };
                } else {
                    b.error = err?.message ?? '保存失败。';
                }
            }
        }
        state.bindingsSaving = false;
        try {
            const purposes = await api.fetchModelPurposes();
            state.purposes = Array.isArray(purposes) ? purposes : [];
            for (const b of state.purposes) {
                const d = state.bindingsDraft.get(b.purpose);
                // 冲突中的草稿保留原 expectedRevision；只有用户显式选择后才能基于新版本保存。
                if (d && !d.dirty) {
                    d.providerId = b.providerId ?? '';
                    d.profileKey = b.profileKey ?? '';
                    d.state = b.state ?? 'ENABLED';
                    d.revision = b.revision ?? 0;
                }
            }
        } catch {
            // 刷新失败不丢页面状态；下次保存仍带各自 revision。
        }
        if (!failed) toast('用途绑定已保存。', 'success');
        render();
        if (!failed) notifyCatalogSaved(); // 绑定已更新 → 前台投影刷新
    }

    // ---------- 打开 / 关闭 ----------

    let returnFocus = null;

    function open(opener) {
        const opening = overlay.hidden !== false;
        if (opener && typeof opener.focus === 'function') returnFocus = opener;
        if (vcUiEnabled() && opening) {
            state.vcScreen = 'home';
            state.tab = 'bindings';
            if (state.localModels.phase === 'idle') void loadLocalModels();
        }
        overlay.hidden = false;
        document.body.classList.add('vcms-no-scroll');
        // 会话上下文已变更时，重新进入本页也视为显式重新加载（重新捕获快照）。
        if (state.phase === 'idle' || state.phase === 'load-error' || state.contextChanged) {
            load();
        } else {
            render();
        }
        root.querySelector('.vc-nav-title, .vcms-title')?.focus({ preventScroll: true });
    }

    function discardDrafts() {
        selectProvider(state.selectedProviderId, { silent: true });
        for (const [purpose, draft] of state.bindingsDraft) {
            const saved = state.purposes.find((item) => item.purpose === purpose);
            Object.assign(draft, { providerId: saved?.providerId ?? '', profileKey: saved?.profileKey ?? '', state: saved?.state ?? 'ENABLED', revision: saved?.revision ?? 0, dirty: false, error: null });
        }
    }

    let confirmingLeave = false;
    async function requestLeave() {
        if (state.saving || state.bindingsSaving || localRerankSaving || state.reauth.busy || confirmingLeave) return false;
        if (!isDirty()) return true;
        confirmingLeave = true;
        const discard = await confirmDiscard({ opener: document.activeElement });
        confirmingLeave = false;
        if (!discard) return false;
        discardDrafts();
        return true;
    }

    async function requestClose({ toSettings = false } = {}) {
        if (!await requestLeave()) return;
        state.returnToSettings = toSettings;
        close();
    }

    function close() {
        invalidateProviderRequests();
        view?.unmount();
        view = null;
        overlay.hidden = true;
        state.closing = false;
        document.body.classList.remove('vcms-no-scroll');
        const back = returnFocus;
        returnFocus = null;
        back?.focus?.();
        if (state.returnToSettings) {
            state.returnToSettings = false;
            globalThis.dispatchEvent?.(new CustomEvent('vc-shell-navigate', { detail: { destination: 'settings' } }));
        }
    }

    function toast(message, kind) {
        showToast(message, { type: kind });
    }

    // ---------- 渲染 ----------

    let sendGateInstalled = false;
    function installSendGate() {
        if (sendGateInstalled || typeof document.addEventListener !== 'function') return;
        sendGateInstalled = true;
        // #send_but 在宿主里是 div。disabled 属性拦不住点击，也不被 Playwright 当成禁用。
        document.addEventListener('click', (event) => {
            if (!state.budget.insufficient) return;
            const target = event.target;
            const send = target?.closest?.('#send_but') || (target?.id === 'send_but' ? target : null);
            if (!send) return;
            event.preventDefault?.();
            event.stopPropagation?.();
        }, true);
    }

    function syncSendGate() {
        installSendGate();
        const send = document.querySelector('#send_but');
        if (!send) return;
        if (state.budget.insufficient) {
            send.disabled = true;
            send.title = logic.BUDGET_COPY;
            // 宿主 #send_but 是 div。Playwright 只在 button 等角色上承认 aria-disabled。
            if (!send.hasAttribute('role')) {
                send.setAttribute('role', 'button');
                send.setAttribute('data-vc-budget-role', '');
            }
            send.setAttribute('aria-disabled', 'true');
            send.setAttribute('data-vc-budget-gate', '');
            return;
        }
        if (!send.hasAttribute('data-vc-budget-gate')) return;
        send.disabled = false;
        send.removeAttribute('aria-disabled');
        if (send.hasAttribute('data-vc-budget-role')) {
            send.removeAttribute('role');
            send.removeAttribute('data-vc-budget-role');
        }
        if (send.title === logic.BUDGET_COPY) send.removeAttribute('title');
        send.removeAttribute('data-vc-budget-gate');
    }

    function render({ feedbackOnly = false } = {}) {
        if (overlay.hidden) return;
        // 保留既有导航文案更新时机：输入只刷新字段反馈，提交/切屏等动作才刷新标题。
        if (!feedbackOnly) navigationCopy = vcNavCopy();
        const oldScreen = overlay.querySelector('[data-vc-screen]')?.getAttribute('data-vc-screen');
        const props = pageViewProps();
        if (view) view.update(props);
        else view = mountModelPageView(overlay, props);
        syncSendGate();
        if ((vcUiEnabled() && oldScreen !== state.vcScreen) || document.activeElement === document.body) overlay.querySelector('.vc-nav-title, .vcms-title')?.focus({ preventScroll: true });
    }

    function pageViewProps() {
        const errors = collectErrors();
        const dirty = isDirty();
        const anyError = hasErrors(errors);
        const ready = state.phase === 'ready';
        let title = '无法加载模型配置';
        let message = state.loadError?.message ?? '请稍后重试。';
        if (state.loadError instanceof api.ApiError && state.loadError.kind === 'unauthenticated') {
            title = '需要登录';
            message = '登录后才能管理模型配置，请先登录再打开此页。';
        } else if (state.loadError instanceof api.ApiError && state.loadError.kind === 'forbidden') {
            title = '没有管理权限';
            message = '当前身份无权管理模型配置，或需要重新验证身份。';
        }
        return {
            vc: vcUiEnabled(), desktop: desktopView(), sprite: iconSpriteUrl(), inSettings: Boolean(overlay.closest?.('.vc-settings-shell')),
            phase: state.phase, screen: state.vcScreen, tab: state.tab, nav: navigationCopy,
            providerCount: state.providers.length, modelCount: state.providers.reduce((sum, provider) => sum + (provider.models?.length ?? 0), 0), purposeCount: state.purposes.length,
            saving: state.saving, dirty, hasErrors: anyError,
            saveDisabled: ready ? !dirty || anyError || state.saving || state.bindingsSaving : desktopView(),
            clean: ready && !dirty && !anyError && !state.saving && !state.bindingsSaving,
            loadError: { title, message }, budgetInsufficient: state.budget.insufficient, budgetCopy: logic.BUDGET_COPY,
            reauth: state.reauth, toast: state.toast || undefined,
            providers: providersViewProps(), provider: providerPaneViewProps(), bindings: bindingsViewProps(), usage: usageViewProps(), local: localViewProps(),
            events: {
                disabled: state.saving || state.bindingsSaving || state.reauth.busy,
                onAction: (action, target) => { void handleAction(action, target); },
                onEdit(bind, value, checked) { applyBind({ value, checked }, bind); render(); },
            },
        };
    }

    function desktopView() {
        return vcUiEnabled() && document.documentElement?.getAttribute?.('data-vc-layout') === 'desktop' && Boolean(overlay.closest?.('.vc-settings-shell'));
    }

    function vcNavCopy() {
        const screen = state.vcScreen || 'home';
        if (screen === 'model') {
            const model = currentModel();
            return {
                back: state.draft?.displayName || '模型',
                title: model?.displayName || model?.modelId || '模型',
            };
        }
        if (screen === 'provider') {
            return { back: '模型', title: state.draft?.displayName || '供应商' };
        }
        return { back: '设置', title: '模型' };
    }

    function usageMeta(row) {
        return `调用 ${row.calls ?? 0} · 输入 ${logic.formatTokenCount(row.inputTokens)} · 输出 ${logic.formatTokenCount(row.outputTokens)} · 缓存命中率 ${logic.formatCacheHitRate(row.cacheHitRate)} · 费用 ${logic.formatUsageFee(row)}`;
    }

    function usageViewProps() {
        return {
            vc: vcUiEnabled(),
            sprite: iconSpriteUrl(),
            month: state.usage.month,
            loading: state.usage.loading,
            error: state.usage.error || undefined,
            rows: (Array.isArray(state.usage.rows) ? state.usage.rows : []).map(row => ({
                purpose: row.purpose,
                label: logic.usagePurposeLabel(row.purpose),
                calls: row.calls ?? 0,
                unpriced: row.unpricedCalls ?? 0,
                input: logic.formatTokenCount(row.inputTokens),
                output: logic.formatTokenCount(row.outputTokens),
                cached: logic.formatTokenCount(row.cachedInputTokens),
                rate: logic.formatCacheHitRate(row.cacheHitRate),
                fee: logic.formatUsageFee(row),
                meta: usageMeta(row),
            })),
            onAction: (action, target) => { void handleAction(action, target); },
        };
    }

    async function reloadUsage(month) {
        const request = ++usageRequest;
        state.usage = { ...state.usage, month, loading: true, error: null };
        render();
        try {
            const data = await api.fetchUsageSummary(month);
            if (request !== usageRequest) return;
            state.usage = {
                month: data?.month || month,
                rows: Array.isArray(data?.purposes) ? data.purposes : [],
                error: null,
                loading: false,
            };
        } catch (err) {
            if (request !== usageRequest) return;
            state.usage = { month, rows: [], error: err?.message || '用量暂时无法读取', loading: false };
        }
        render();
    }

    function localViewProps() {
        const local = state.localModels;
        const loading = !local || local.phase === 'idle' || local.phase === 'loading';
        const view = loading ? {
            embedding: { name: logic.LOCAL_EMBEDDING_MODEL, label: logic.LOCAL_RUNTIME_LABELS.LOADING, tone: 'neutral' },
            rerank: { name: logic.LOCAL_RERANK_MODEL, label: logic.LOCAL_RUNTIME_LABELS.LOADING, tone: 'neutral', enabled: false, switchDisabled: true },
        } : local.embedding && local.rerank ? local : logic.localModelsUnavailable();
        return {
            desktop: desktopView(),
            embedding: { name: view.embedding?.name || logic.LOCAL_EMBEDDING_MODEL, label: view.embedding?.label || logic.LOCAL_RUNTIME_LABELS.UNAVAILABLE, tone: view.embedding?.tone || 'danger' },
            rerank: { name: view.rerank?.name || logic.LOCAL_RERANK_MODEL, label: view.rerank?.label || logic.LOCAL_RUNTIME_LABELS.UNAVAILABLE, tone: view.rerank?.tone || 'danger', enabled: view.rerank?.enabled === true, disabled: localRerankSaving || state.reauth.busy || Boolean(view.rerank?.switchDisabled) },
            onToggle: enabled => { void saveLocalRerank(enabled); },
        };
    }

    async function loadLocalModels({ quiet = false } = {}) {
        if (!vcUiEnabled()) return;
        if (!quiet) {
            state.localModels = { phase: 'loading' };
            if (overlay && !overlay.hidden) render();
        }
        try {
            state.localModels = logic.localModelsFromPayload(await api.fetchLocalModels());
        } catch {
            state.localModels = logic.localModelsUnavailable();
        }
        if (overlay && !overlay.hidden) render();
    }

    async function saveLocalRerank(enabled) {
        const previous = state.localModels?.rerank ? { ...state.localModels.rerank } : null;
        if (localRerankSaving || previous?.switchDisabled) return;
        localRerankSaving = true;
        const revision = Number.isFinite(previous?.revision) ? previous.revision : 0;
        if (state.localModels?.rerank) state.localModels.rerank.enabled = enabled;
        render();
        try {
            await api.saveLocalModelRerank({ enabled, expectedRevision: revision });
            await loadLocalModels({ quiet: true });
        } catch (err) {
            if (state.localModels && previous) state.localModels.rerank = previous;
            if (err instanceof api.ApiError && err.kind === 'conflict-revision') {
                toast('这段配置已在另一处更新。', 'error');
                await loadLocalModels({ quiet: true });
                return;
            }
            if (err instanceof api.ApiError && err.kind === 'forbidden') {
                state.pendingRerank = enabled;
                state.reauth = { open: true, busy: false, error: null, password: '', retry: 'local-rerank' };
                render();
                return;
            }
            toast(err?.message || '本机模型不可用', 'error');
            render();
        } finally {
            localRerankSaving = false;
            render();
        }
    }

    function providersViewProps() {
        return {
            vc: vcUiEnabled(),
            heading: desktopView() && state.vcScreen === 'home',
            sprite: iconSpriteUrl(),
            creatingNew: state.creatingNew,
            rows: state.providers.map(provider => {
                const keyMissing = !provider.credentialConfigured;
                return {
                    id: provider.providerId,
                    name: provider.displayName || provider.providerId,
                    selected: provider.providerId === state.selectedProviderId,
                    enabled: provider.state === 'ENABLED',
                    disabled: provider.state === 'DISABLED',
                    credentialConfigured: provider.credentialConfigured,
                    stateLabel: logic.PROVIDER_STATE_LABELS[provider.state] ?? provider.state,
                    tone: keyMissing ? 'danger' : provider.state === 'ENABLED' ? 'ok' : 'warn',
                    status: keyMissing ? '缺密钥' : logic.PROVIDER_STATE_LABELS[provider.state] ?? provider.state,
                    protocol: logic.protocolMeta(provider.protocol)?.label ?? provider.protocol,
                    modelCount: provider.models?.length ?? 0,
                };
            }),
            onAction: (action, target) => { void handleAction(action, target); },
        };
    }

    function modelIdentity(model) {
        if (!modelIdentities.has(model)) modelIdentities.set(model, ++nextModelIdentity);
        return modelIdentities.get(model);
    }

    function providerPaneViewProps() {
        const d = state.draft;
        const m = currentModel();
        const errors = collectErrors();
        const events = {
            disabled: state.saving || state.reauth.busy,
            onAction: (action, target) => { void handleAction(action, target); },
            onEdit(bind, value, checked) {
                if (['provider.baseUrl', 'provider.protocol', 'provider.credential'].includes(bind)) invalidateProviderRequests();
                applyBind({ value, checked }, bind);
                refreshFeedback();
            },
        };
        const ledger = logic.normalizeLedgerPrice(m?.ledgerPrice);
        return {
            desktop: desktopView(), vc: vcUiEnabled(), sprite: iconSpriteUrl(), screen: state.vcScreen,
            draft: d, creatingNew: state.creatingNew, updated: fmtTime(d?.updatedAt),
            stateLabel: d ? logic.PROVIDER_STATE_LABELS[d.state] ?? d.state : '',
            errors: { ...errors.provider, ...errors.credential }, protocols: logic.PROTOCOLS,
            endpoint: { ...errors.endpoint, blank: isBlank(d?.baseUrl) },
            keyPlan: d ? logic.keyPlan(d, d.credentialConfigured) : { action: 'none', finalKey: 'none' },
            keyEditing: state.keyEditing, keyClearing: state.keyClearing, keyLabels: logic.KEY_STATE_LABELS,
            conflict: state.conflict || undefined, stashBanner: state.stashBanner, contextChanged: state.contextChanged || undefined,
            discoverBusy: state.discoverBusy, discoverError: state.discoverError || undefined,
            budgetInsufficient: state.budget.insufficient, budgetCopy: logic.BUDGET_COPY,
            models: (d?.models ?? []).map((model, index) => ({
                key: modelIdentity(model), index, profileKey: model.profileKey, selected: model === m,
                name: model.displayName || model.modelId || '未命名模型', id: model.modelId || '（未填 ID）',
                incomplete: isBlank(model.contextWindowTokens), bound: model.boundPurposes?.length ?? 0,
                error: Object.values(errors.models.get(model.profileKey) ?? {})[0],
            })),
            model: m ? {
                identity: modelIdentity(m), desktop: desktopView(), sprite: iconSpriteUrl(), model: m,
                errors: errors.models.get(m.profileKey) ?? {}, ledger: { status: ledger, copy: logic.ledgerPriceCopy(ledger) },
                shared: (m.boundPurposes ?? []).map(purpose => logic.purposeMeta(purpose).label).join('、'),
                contextMissing: logic.contextWindowMissing(m), advancedOpen: state.advancedOpen, onAdvancedChange: open => { state.advancedOpen = open; },
                reasoning: logic.REASONING_LEVELS.map(id => ({ id, label: logic.reasoningLevelLabel(id) })),
                extraReasoning: logic.extraReasoningLevels(m.reasoningLevels),
                capabilities: logic.CAPABILITY_FIELDS.map(field => ({ id: field.key, label: field.label, value: m.capabilities[field.key] ?? 'UNKNOWN' })),
                capabilityStates: logic.CAPABILITY_STATES.map(id => ({ id, label: logic.CAPABILITY_STATE_LABELS[id] })),
                currencies: logic.CURRENCIES.map(id => ({ id, label: logic.CURRENCY_LABELS[id] })), pricingLabel: logic.formatPricing(m.pricing),
                verification: {
                    busy: state.toolVerify.profileKey === m.profileKey && state.toolVerify.busy,
                    error: state.toolVerify.profileKey === m.profileKey ? state.toolVerify.error || '' : '',
                    verifiedNote: logic.TOOL_CALLS_VERIFIED_NOTE, note: logic.TOOL_CALLS_UNVERIFIED_NOTE,
                    hint: logic.TOOL_CALLS_VERIFY_HINT, action: logic.TOOL_CALLS_VERIFY_ACTION,
                },
                deleting: state.deleteFor === m.profileKey, deleteDisabled: Boolean(m.boundPurposes?.length),
                clone: state.cloneFor?.profileKey === m.profileKey ? state.cloneFor : undefined, events,
            } : undefined,
            check: state.check, testTarget: m ? `${d.displayName || d.providerId} · ${m.displayName || m.modelId}` : '未选择模型',
            testUrl: d?.endpointUrl ?? (errors.endpoint?.ok ? errors.endpoint.finalUrl : '—'),
            saveError: state.saveError || undefined, events,
        };
    }

    function bindingTargetLabel(providerId, profileKey) {
        if (!providerId || !profileKey) return '未绑定（待配置）';
        const provider = state.providers.find((p) => p.providerId === providerId);
        const model = provider?.models?.find((m) => m.profileKey === profileKey);
        return `${provider?.displayName ?? providerId} · ${model?.displayName ?? model?.modelId ?? profileKey}`;
    }

    function bindingsViewProps() {
        const desktop = desktopView();
        const conflict = state.bindingsConflict;
        const mine = conflict && state.bindingsDraft.get(conflict.purpose);
        return {
            desktop,
            options: logic.buildBindingOptions(state.providers),
            rows: logic.PURPOSES.map(purpose => {
                const original = state.purposes.find(row => row.purpose === purpose.id);
                const draft = state.bindingsDraft.get(purpose.id);
                const status = original?.status ?? 'PENDING_CONFIGURATION';
                return {
                    id: purpose.id,
                    label: desktop && purpose.id === 'EMBEDDING' ? '向量检索' : purpose.label,
                    description: purpose.desc,
                    bindable: logic.canBindPurpose(purpose.id),
                    current: draft ? `${draft.providerId}::${draft.profileKey}` : '',
                    enabled: draft?.state !== 'DISABLED',
                    dirty: draft?.dirty === true,
                    status,
                    statusLabel: logic.BINDING_STATUS_LABELS[status] ?? status,
                    statusClass: status === 'READY' ? 'vcms-badge-ok' : status === 'PENDING_CONFIGURATION' ? 'vcms-badge-warn' : 'vcms-badge-muted',
                    revision: original?.revision,
                    updated: fmtTime(original?.updatedAt),
                    error: draft?.error,
                };
            }),
            dirtyCount: [...state.bindingsDraft.values()].filter(row => row.dirty).length,
            saving: state.bindingsSaving, disabled: state.reauth.busy,
            contextChanged: state.contextChanged || undefined,
            conflict: conflict ? {
                purpose: conflict.purpose,
                label: logic.purposeMeta(conflict.purpose).label,
                latest: Boolean(conflict.latest),
                revision: conflict.latest?.revision,
                mine: mine ? bindingTargetLabel(mine.providerId, mine.profileKey) : '未绑定（待配置）',
                target: conflict.latest ? bindingTargetLabel(conflict.latest.providerId, conflict.latest.profileKey) : '',
            } : undefined,
            onAction: (action, target) => { void handleAction(action, target); },
            onEdit(bind, value, checked) {
                applyBind({ value, checked }, bind);
                refreshFeedback();
            },
        };
    }

    // 所有可见节点由同一 React root 更新；控制器不再写入表单子树。
    function refreshFeedback() { render({ feedbackOnly: true }); }

    function applyBind(el, bind) {
        const model = currentModel();
        if (bind.startsWith('provider.')) {
            const field = bind.slice('provider.'.length);
            state.draft[field] = el.value;
            return;
        }
        if (bind === 'reauth.password') {
            // 只暂存输入值：render 重建 DOM 后恢复，不触发整页校验。
            state.reauth.password = el.value;
            return;
        }
        if (bind.startsWith('clone.')) {
            const field = bind.slice('clone.'.length);
            if (state.cloneFor) state.cloneFor[field] = el.value;
            return;
        }
        if (bind.startsWith('bindingState.')) {
            const purpose = bind.slice('bindingState.'.length);
            const d = state.bindingsDraft.get(purpose);
            if (d) {
                d.state = el.checked ? 'ENABLED' : 'DISABLED';
                d.dirty = true;
            }
            return;
        }
        if (bind.startsWith('binding.')) {
            const purpose = bind.slice('binding.'.length);
            const d = state.bindingsDraft.get(purpose);
            if (d) {
                if (el.value) {
                    const [providerId, profileKey] = el.value.split('::');
                    d.providerId = providerId;
                    d.profileKey = profileKey;
                } else {
                    d.providerId = '';
                    d.profileKey = '';
                }
                const saved = state.purposes.find((item) => item.purpose === purpose);
                d.dirty = d.providerId !== (saved?.providerId ?? '') || d.profileKey !== (saved?.profileKey ?? '');
            }
            return;
        }
        if (bind.startsWith('model.')) {
            if (!model) return;
            const path = bind.slice('model.'.length);
            if (path === 'modelId') {
                model.modelId = el.value;
                if (model.isNew && (model.autoProfileKey || NEW_KEY_PLACEHOLDER_RE.test(model.profileKey))) {
                    model.autoProfileKey = true;
                    model.profileKey = el.value.trim();
                }
                return;
            }
            if (path === 'profileKey') {
                model.profileKey = el.value;
                model.autoProfileKey = false;
                return;
            }
            if (path === 'reasoningLevels') {
                // 预设档按勾选重建；已保存的额外合法等级始终保留，不静默丢弃。
                const extras = logic.extraReasoningLevels(model.reasoningLevels);
                const selected = new Set(model.reasoningLevels.filter((lv) => logic.REASONING_LEVELS.includes(lv)));
                if (el.checked) selected.add(el.value);
                else selected.delete(el.value);
                model.reasoningLevels = [...logic.REASONING_LEVELS.filter((lv) => selected.has(lv)), ...extras];
                if (model.generationParams.reasoningEffort && !model.reasoningLevels.includes(model.generationParams.reasoningEffort)) {
                    model.generationParams.reasoningEffort = '';
                }
                model.editedSubs.add('reasoningLevels');
                model.editedSubs.add('generationParams');
                return;
            }
            setByPath(model, path, el.value);
            if (path.startsWith('capabilities.')) model.editedSubs.add('capabilities');
            else if (path.startsWith('generationParams.')) model.editedSubs.add('generationParams');
            else if (path.startsWith('pricing.')) model.editedSubs.add('pricing');
        }
    }

    function setByPath(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    async function handleAction(action, el) {
        if (['new-provider', 'select-provider', 'tab', 'vc-back', 'discard'].includes(action) && !await requestLeave()) return;
        switch (action) {
            case 'close':
                requestClose();
                break;
            case 'vc-back': {
                if (!vcUiEnabled()) break;
                const from = state.vcScreen;
                const provider = state.selectedProviderId;
                const modelIndex = state.draft?.models.indexOf(currentModel());
                if (from === 'model') state.vcScreen = 'provider';
                else if (from === 'provider') { state.vcScreen = 'home'; state.tab = 'bindings'; }
                else { void requestClose({ toSettings: true }); break; }
                render();
                const rows = overlay.querySelectorAll(`[data-action="${from === 'model' ? 'select-model' : 'select-provider'}"]`);
                [...rows].find((row) => row.getAttribute(from === 'model' ? 'data-model-index' : 'data-id') === (from === 'model' ? String(modelIndex) : provider))?.focus({ preventScroll: true });
                break;
            }
            case 'local-models-retry':
                void loadLocalModels();
                break;
            case 'local-rerank':
                if (!vcUiEnabled() || state.localModels?.rerank?.switchDisabled) break;
                void saveLocalRerank(state.localModels.rerank?.enabled !== true);
                break;
            case 'keep-editing':
                state.closing = false;
                state.returnToSettings = false;
                render();
                break;
            case 'discard-close':
                close();
                break;
            case 'usage-month': {
                const delta = Number(el.getAttribute('data-delta'));
                if (delta === 1 || delta === -1) reloadUsage(logic.shiftUsageMonth(state.usage.month, delta));
                break;
            }
            case 'tab':
                state.tab = el.getAttribute('data-tab');
                render();
                break;
            case 'retry-load':
                load();
                break;
            case 'new-provider':
                invalidateProviderRequests();
                state.draft = logic.newProviderDraft();
                activeModel = null;
                state.originalDraft = deepClone(state.draft);
                state.creatingNew = true;
                state.tab = 'provider';
                if (vcUiEnabled()) state.vcScreen = 'provider';
                render();
                overlay.querySelector('.vc-nav-title, .vcms-title')?.focus({ preventScroll: true });
                break;
            case 'select-provider': {
                const id = el.getAttribute('data-id');
                if (!id) {
                    invalidateProviderRequests();
                    state.draft = logic.newProviderDraft();
                    activeModel = null;
                    state.originalDraft = deepClone(state.draft);
                    state.creatingNew = true;
                    if (vcUiEnabled()) state.vcScreen = 'provider';
                    render();
                    break;
                }
                if (vcUiEnabled()) state.vcScreen = 'provider';
                selectProvider(id);
                break;
            }
            case 'endpoint-convert': {
                const suggested = el.getAttribute('data-suggested');
                if (suggested) {
                    invalidateProviderRequests();
                    state.draft.baseUrl = suggested;
                    toast('已转换为 Base URL；请检查后保存。', 'info');
                }
                render();
                break;
            }
            case 'discard':
                discardDrafts();
                toast('已放弃未保存的修改。', 'info');
                render();
                break;
            case 'save':
            case 'save-anyway':
                if (vcUiEnabled() && state.vcScreen === 'home') void doSaveBindings();
                else void doSaveProvider();
                break;
            case 'impact-cancel':
                state.impact = null;
                render();
                break;
            case 'conflict-view-latest':
                viewLatestAfterConflict();
                break;
            case 'context-reload':
                // 显式重新加载：重新捕获会话快照并刷新目录（load 是唯一刷新快照的入口）。
                load();
                break;
            case 'context-keep':
                state.contextChanged = null;
                render();
                break;
            case 'conflict-keep':
                state.conflict = null;
                render();
                break;
            case 'restore-stash':
                restoreStash();
                break;
            case 'dismiss-stash-banner':
                state.stash = null;
                state.stashBanner = false;
                render();
                break;
            case 'key-replace':
                state.keyEditing = true;
                render();
                overlay.querySelector('#vcms-f-key')?.focus();
                break;
            case 'key-clear':
                state.keyClearing = true;
                render();
                break;
            case 'key-clear-confirm':
                invalidateProviderRequests();
                state.draft.clearCredential = true;
                state.draft.credential = '';
                if (state.draft.state === 'ENABLED') state.draft.state = 'DISABLED';
                state.keyClearing = false;
                render();
                break;
            case 'key-clear-cancel':
                state.keyClearing = false;
                render();
                break;
            case 'key-undo':
                invalidateProviderRequests();
                state.draft.credential = '';
                state.draft.clearCredential = false;
                state.keyEditing = false;
                render();
                break;
            case 'add-model': {
                const model = logic.newModelDraft();
                model.profileKey = `__new_${state.draft.models.length + 1}__`;
                model.autoProfileKey = true;
                state.draft.models.push(model);
                activeModel = model;
                if (vcUiEnabled()) state.vcScreen = 'model';
                render();
                overlay.querySelector('#vcms-m-id')?.focus();
                break;
            }
            case 'select-model':
                activeModel = state.draft.models[Number(el.getAttribute('data-model-index'))] ?? null;
                state.cloneFor = null;
                state.deleteFor = null;
                if (vcUiEnabled()) state.vcScreen = 'model';
                render();
                break;
            case 'delete-model':
                state.deleteFor = currentModel()?.profileKey ?? null;
                render();
                break;
            case 'delete-model-confirm': {
                const removed = currentModel();
                state.draft.models = state.draft.models.filter(model => model !== removed);
                activeModel = state.draft.models[0] ?? null;
                state.deleteFor = null;
                render();
                break;
            }
            case 'delete-model-cancel':
                state.deleteFor = null;
                render();
                break;
            case 'clone-model': {
                const m = currentModel();
                if (!m) break;
                state.cloneFor = {
                    profileKey: m.profileKey,
                    newProfileKey: suggestProfileKey(m),
                    newDisplayName: `${m.displayName || m.modelId}（副本）`,
                    error: null,
                };
                render();
                break;
            }
            case 'clone-confirm': {
                const m = currentModel();
                const c = state.cloneFor;
                if (!m || !c) break;
                const key = c.newProfileKey.trim() || m.modelId;
                if (state.draft.models.some((x) => x.profileKey === key)) {
                    c.error = '该配置标识已存在，请换一个。';
                    render();
                    break;
                }
                const clone = logic.cloneModelDraft(m, {
                    profileKey: key,
                    displayName: c.newDisplayName.trim() || `${m.displayName || m.modelId}（副本）`,
                });
                state.draft.models.push(clone);
                activeModel = clone;
                state.cloneFor = null;
                toast('已创建副本（未保存）；原配置与现有绑定不受影响。', 'info');
                render();
                break;
            }
            case 'clone-cancel':
                state.cloneFor = null;
                render();
                break;
            case 'cap': {
                const m = currentModel();
                if (!m) break;
                const capKey = el.getAttribute('data-cap-key');
                const capState = el.getAttribute('data-cap-state');
                if (capState === 'VERIFIED') break; // 不可手动设置已验证
                m.capabilities[capKey] = capState;
                m.touchedCaps.add(capKey);
                m.editedSubs.add('capabilities');
                render();
                break;
            }
            case 'discover':
                doDiscover();
                break;
            case 'verify-tool-calls':
                doVerifyToolCalls();
                break;
            case 'check-connection':
                doCheckConnection();
                break;
            case 'check-add-models':
                doAddCheckedModels();
                break;
            case 'reauth-submit':
                doReauth();
                break;
            case 'reauth-cancel':
                state.reauth = { open: false, busy: false, error: null, password: '', retry: null };
                render();
                break;
            case 'save-bindings':
                doSaveBindings();
                break;
            case 'discard-bindings': {
                for (const b of state.bindingsDraft.values()) {
                    b.dirty = false;
                    b.error = null;
                }
                for (const b of state.purposes) {
                    const d = state.bindingsDraft.get(b.purpose);
                    if (d) {
                        d.providerId = b.providerId ?? '';
                        d.profileKey = b.profileKey ?? '';
                        d.state = b.state ?? 'ENABLED';
                        d.revision = b.revision ?? 0;
                    }
                }
                state.bindingsConflict = null;
                render();
                break;
            }
            case 'bindings-view-latest':
                (async () => {
                    try {
                        const purposes = await api.fetchModelPurposes();
                        state.purposes = Array.isArray(purposes) ? purposes : [];
                        // 只更新展示用的最新列表；编辑中草稿的 revision 保持不变。
                        const c = state.bindingsConflict;
                        if (c) {
                            c.latest = state.purposes.find((b) => b.purpose === c.purpose) ?? null;
                        }
                        render();
                    } catch (err) {
                        toast(err?.message ?? '刷新失败。', 'error');
                    }
                })();
                break;
            case 'bindings-adopt-latest': {
                const purpose = el.getAttribute('data-purpose');
                const latest = state.bindingsConflict?.latest;
                const d = purpose ? state.bindingsDraft.get(purpose) : null;
                if (d && latest) {
                    d.providerId = latest.providerId ?? '';
                    d.profileKey = latest.profileKey ?? '';
                    d.state = latest.state ?? 'ENABLED';
                    d.revision = latest.revision ?? 0;
                    d.dirty = false;
                    d.error = null;
                }
                state.bindingsConflict = null;
                render();
                break;
            }
            case 'bindings-retry-latest': {
                const purpose = el.getAttribute('data-purpose');
                const latest = state.bindingsConflict?.latest;
                const d = purpose ? state.bindingsDraft.get(purpose) : null;
                if (d && latest) {
                    // 显式选择：以最新版本为基准重试我的选择（仍需点「保存用途绑定」）。
                    d.revision = latest.revision ?? 0;
                    d.dirty = true;
                    d.error = null;
                }
                state.bindingsConflict = null;
                render();
                break;
            }
            case 'bindings-keep':
                state.bindingsConflict = null;
                render();
                break;
            case 'toast-dismiss':
                state.toast = null;
                render();
                break;
            default:
                break;
        }
    }

    function suggestProfileKey(m) {
        const base = `${m.modelId || 'model'}-copy`;
        let key = base;
        let i = 2;
        while (state.draft.models.some((x) => x.profileKey === key)) {
            key = `${base}${i}`;
            i += 1;
        }
        return key;
    }

    async function doVerifyToolCalls() {
        const model = currentModel();
        if (!model || state.toolVerify.busy) return;
        if (state.creatingNew || model.isNew) {
            state.toolVerify = { busy: false, profileKey: model.profileKey, error: '请先保存该模型，再验证工具调用。' };
            render();
            return;
        }
        if (state.draft && state.originalDraft && logic.draftDiffers(state.draft, state.originalDraft)) {
            state.toolVerify = { busy: false, profileKey: model.profileKey, error: '请先保存当前配置，再验证工具调用。' };
            render();
            return;
        }
        const providerId = state.draft.providerId;
        const profileKey = model.profileKey;
        const request = providerRequest;
        state.toolVerify = { busy: true, profileKey, error: null };
        render();
        try {
            await api.verifyModelToolCalls(providerId, profileKey);
            if (request !== providerRequest) return;
            const providers = await api.fetchProviders();
            if (request !== providerRequest) return;
            state.providers = providers;
            // 核验期间新输入的草稿保留；只刷新仍未编辑的当前配置。
            if (!logic.draftDiffers(state.draft, state.originalDraft)) {
                const keepProfileKey = state.selectedProfileKey;
                selectProvider(providerId, { silent: true });
                activeModel = state.draft.models.find(model => model.profileKey === keepProfileKey) ?? activeModel;
            }
            state.toolVerify = { busy: false, profileKey, error: null };
            toast('已验证', 'success');
        } catch (err) {
            if (request !== providerRequest) return;
            state.toolVerify = { busy: false, profileKey, error: null };
            if (err instanceof api.ApiError && err.kind === 'forbidden') {
                state.reauth = { open: true, busy: false, error: null, password: '', retry: 'verify-tool-calls' };
            } else if (err instanceof api.ApiError && err.kind === 'context-changed') {
                state.contextChanged = '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，这次没有完成验证。你的输入已保留；请重新加载页面数据后再继续。';
            } else if (err instanceof api.ApiError && err.kind === 'unauthenticated') {
                state.contextChanged = '登录已过期，这次没有完成验证。你的输入已保留；请重新登录后，再重新加载页面数据。';
            } else {
                state.toolVerify = { busy: false, profileKey, error: logic.toolCallVerificationFailure(err) };
            }
        }
        render();
    }

    async function doDiscover() {
        if (state.budget.insufficient) return;
        if (state.discoverBusy) return;
        state.check = { busy: false, error: null, result: null }; // 拉取会改草稿模型集合，旧检查结果失效
        const check = logic.validateProviderForm(state.draft, { isNew: state.creatingNew });
        if (check.errors.baseUrl || check.errors.protocol) {
            state.discoverError = '请先填写正确的 Base URL 与协议，再拉取模型列表。';
            render();
            return;
        }
        if (state.creatingNew) {
            state.discoverError = '请先保存供应商，再拉取模型列表。';
            render();
            return;
        }
        if (!state.draft.credentialConfigured && !state.draft.credential) {
            state.discoverError = '拉取模型列表需要先配置 API 密钥（只在你点击时访问服务商接口）。';
            render();
            return;
        }
        state.discoverBusy = true;
        state.discoverError = null;
        const request = providerRequest;
        const draft = state.draft;
        render();
        try {
            const models = await api.discoverProviderModels(draft.providerId, {
                protocol: draft.protocol,
                baseUrl: draft.baseUrl.trim(),
                credential: draft.credential || undefined,
            });
            if (request !== providerRequest) return;
            const found = Array.isArray(models) ? models : [];
            if (!found.length) {
                state.discoverError = '服务商未返回任何模型；仍可手填模型 ID 新增。';
            } else {
                let added = 0;
                for (const item of found) {
                    const modelId = String(item.modelId ?? '').trim();
                    if (!modelId) continue;
                    if (state.draft.models.some((x) => x.modelId === modelId)) continue;
                    const model = logic.newModelDraft();
                    model.modelId = modelId;
                    model.displayName = String(item.displayName ?? modelId);
                    model.profileKey = modelId;
                    state.draft.models.push(model);
                    added += 1;
                }
                if (added) {
                    activeModel = state.draft.models.at(-1) ?? currentModel();
                    toast(`拉取完成，新增 ${added} 个模型配置（未保存）。`, 'success');
                } else {
                    state.discoverError = '拉取到的模型都已存在；仍可手填新增。';
                }
            }
        } catch (err) {
            if (request !== providerRequest) return;
            state.discoverError = err?.message ?? '拉取失败，请检查地址与密钥后重试。';
        }
        state.discoverBusy = false;
        render();
    }

    /**
     * 连接检查（check-only）：复用 discover 接口验证所选供应商的模型列表与鉴权，
     * 不发起生成调用，也不自动修改草稿；「加入列表」由用户显式选择。
     */
    async function doCheckConnection() {
        if (state.check.busy || state.budget.insufficient) return;
        const check = logic.validateProviderForm(state.draft, { isNew: state.creatingNew });
        if (check.errors.baseUrl || check.errors.protocol) {
            state.check = { busy: false, error: '请先填写正确的 Base URL 与协议，再检查连接。', result: null };
            render();
            return;
        }
        if (state.creatingNew) {
            state.check = { busy: false, error: '请先保存供应商，再检查连接（检查按已保存的供应商发起）。', result: null };
            render();
            return;
        }
        if (!state.draft.credentialConfigured && !state.draft.credential) {
            state.check = { busy: false, error: '检查连接需要先配置 API 密钥（只在你点击时访问服务商的模型列表接口）。', result: null };
            render();
            return;
        }
        state.check = { busy: true, error: null, result: null };
        const request = providerRequest;
        const pending = state.check;
        const draft = state.draft;
        render();
        try {
            const found = await api.discoverProviderModels(draft.providerId, {
                protocol: draft.protocol,
                baseUrl: draft.baseUrl.trim(),
                credential: draft.credential || undefined,
            });
            if (request !== providerRequest || state.check !== pending) return;
            const items = Array.isArray(found) ? found : [];
            state.check = {
                busy: false,
                error: null,
                result: {
                    total: items.length,
                    unrecorded: logic.unrecordedModels(items, state.draft.models),
                },
            };
        } catch (err) {
            if (request !== providerRequest || state.check !== pending) return;
            state.check = { busy: false, error: err?.message ?? '连接检查失败，请检查地址与密钥后重试。', result: null };
        }
        render();
    }

    /** 把连接检查发现的未收录模型加入草稿（可选操作；不自动保存）。 */
    function doAddCheckedModels() {
        const unrecorded = state.check.result?.unrecorded;
        if (!Array.isArray(unrecorded) || !unrecorded.length) return;
        let added = 0;
        for (const item of unrecorded) {
            if (state.draft.models.some((x) => x.modelId === item.modelId)) continue;
            const model = logic.newModelDraft();
            model.modelId = item.modelId;
            model.displayName = item.displayName;
            model.profileKey = item.modelId;
            state.draft.models.push(model);
            added += 1;
        }
        if (added) {
            activeModel = state.draft.models.at(-1) ?? currentModel();
            state.check.result = { ...state.check.result, unrecorded: [] };
            toast(`已加入 ${added} 个模型配置（未保存）；请补齐参数后保存。`, 'success');
        }
        render();
    }

    /** 403 FreshReauth 的最小再验证：成功后按来源自动重试保存。 */
    async function doReauth() {
        if (state.reauth.busy) return;
        const password = state.reauth.password;
        if (!password) {
            state.reauth.error = '请输入当前登录密码。';
            render();
            overlay.querySelector('#vcms-reauth-password')?.focus();
            return;
        }
        state.reauth.busy = true;
        state.reauth.error = null;
        render();
        const retry = state.reauth.retry;
        try {
            await api.reauth(password);
            state.reauth = { open: false, busy: false, error: null, password: '', retry: null };
            toast(retry === 'verify-tool-calls' ? '身份验证已更新，继续验证工具调用。' : '身份验证已更新，继续保存。', 'success');
            render();
            if (retry === 'provider') doSaveProvider();
            else if (retry === 'bindings') doSaveBindings();
            else if (retry === 'verify-tool-calls') doVerifyToolCalls();
            else if (retry === 'local-rerank') saveLocalRerank(state.pendingRerank);
        } catch (err) {
            if (err instanceof api.ApiError && err.kind === 'context-changed') {
                // 会话已换，密码再验证无法救回旧快照：转为显式重新加载提示。
                state.reauth = { open: false, busy: false, error: null, password: '', retry: null };
                state.contextChanged = '登录会话已变更（可能在别处登录或退出）。你的输入已保留；请重新加载页面数据后再继续。';
                render();
                return;
            }
            state.reauth.busy = false;
            state.reauth.error = err instanceof api.ApiError && err.status === 404
                ? '密码不正确或会话已失效，请重试。'
                : (err?.message ?? '验证失败，请重试。');
            render();
            overlay.querySelector('#vcms-reauth-password')?.focus();
        }
    }

    registerModelOpener((opener) => {
        if (overlay.hidden) open(opener);
    });
    mounted = controller;
    return controller;
}
