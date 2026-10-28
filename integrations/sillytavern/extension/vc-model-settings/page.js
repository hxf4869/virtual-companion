// Virtual Companion · 模型设置页 — 页面控制器（原生 DOM，无框架）。
// 入口由 ST 扩展 index.js 或独立 harness 调用 mountModelSettings()。
// 样式作用域 .vcms-*；主题 tokens 见 style.css（v2-design §3）。
import * as logic from './model-logic.js';
import * as api from './api.js';

const ROOT_ID = 'vc-model-settings-root';
const NEW_KEY_PLACEHOLDER_RE = /^__new_\d+__$/;

let mounted = null;

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

    const state = {
        phase: 'idle', // idle | loading | ready | load-error
        loadError: null,
        providers: [], // AdminModelProvider[]（API 形状）
        purposes: [], // 固定 6 条绑定（API 形状）
        selectedProviderId: null,
        creatingNew: false, // 当前编辑的是未持久化的新供应商（与 selectedProviderId 区分）
        draft: null, // 当前供应商草稿
        originalDraft: null, // 选中时的草稿快照
        selectedProfileKey: null,
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
        toast: null,
        check: { busy: false, error: null, result: null }, // 连接检查（check-only，不改草稿）
        reauth: { open: false, busy: false, error: null, password: '', retry: null }, // 403 再验证；retry: 'provider' | 'bindings'
    };

    function isDirty() {
        if (!state.draft || !state.originalDraft) return false;
        if (logic.draftDiffers(state.draft, state.originalDraft)) return true;
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
        close,
        isOpen: () => !overlay.hidden,
        isDirty,
        onCatalogSaved(cb) {
            if (typeof cb === 'function') catalogSavedCallbacks.push(cb);
        },
        root,
        _state: state, // 仅 harness / 测试观察用，不作为产品接口
    };

    // ---------- 数据 ----------

    async function load() {
        state.phase = 'loading';
        state.loadError = null;
        state.contextChanged = null;
        render();
        try {
            // 会话上下文快照与目录同批取得：load（含显式重新加载）是唯一刷新快照的入口，
            // 写请求前绝不静默重取（core.go VC-R169 跨账号/旧会话防护）。
            const [, providers, purposes] = await Promise.all([
                api.captureSessionContext(),
                api.fetchProviders(),
                api.fetchModelPurposes(),
            ]);
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

    function selectProvider(providerId, { silent = false } = {}) {
        state.selectedProviderId = providerId;
        const found = state.providers.find((p) => p.providerId === providerId) ?? null;
        state.creatingNew = !found;
        state.draft = found ? logic.providerDraftFromApi(found) : logic.newProviderDraft();
        state.originalDraft = deepClone(state.draft);
        state.selectedProfileKey = state.draft.models[0]?.profileKey ?? null;
        state.keyEditing = false;
        state.keyClearing = false;
        state.conflict = null;
        state.stash = null;
        state.stashBanner = false;
        state.impact = null;
        state.cloneFor = null;
        state.deleteFor = null;
        state.saveError = null;
        state.discoverError = null;
        state.check = { busy: false, error: null, result: null }; // 连接检查结果随供应商切换失效
        if (!silent) render();
    }

    function currentModel() {
        return state.draft?.models.find((m) => m.profileKey === state.selectedProfileKey) ?? null;
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
        if (state.saving) return;
        normalizeDraftKeys();
        const errors = collectErrors();
        if (hasErrors(errors)) {
            state.impact = null;
            refreshFeedback();
            toast('有字段未通过校验，请按提示修改。', 'error');
            return;
        }
        const impacts = sharedImpactModels();
        if (impacts.length && !state.impact) {
            state.impact = impacts;
            render();
            return;
        }
        const isNew = state.creatingNew;
        const payload = logic.buildProviderPut(state.draft, { isNew });
        state.saving = true;
        state.saveError = null;
        render();
        try {
            const providerId = isNew ? state.draft.providerId.trim() : state.draft.providerId;
            await api.saveProvider(providerId, payload);
            state.saving = false;
            state.creatingNew = false;
            state.impact = null;
            state.stash = null;
            state.stashBanner = false;
            state.conflict = null;
            toast('已保存。', 'success');
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
        try {
            const providers = await api.fetchProviders();
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
            state.draft = logic.providerDraftFromApi(latest);
            state.conflict = null;
            state.stashBanner = true;
            state.selectedProfileKey = state.draft.models[0]?.profileKey ?? null;
            render();
        } catch (err) {
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
        state.draft = values;
        state.draft.revision = latestRevision;
        state.selectedProfileKey = state.stash.selectedProfileKey
            && state.draft.models.some((m) => m.profileKey === state.stash.selectedProfileKey)
            ? state.stash.selectedProfileKey
            : state.draft.models[0]?.profileKey ?? null;
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

    function open() {
        overlay.hidden = false;
        document.body.classList.add('vcms-no-scroll');
        // 会话上下文已变更时，重新进入本页也视为显式重新加载（重新捕获快照）。
        if (state.phase === 'idle' || state.phase === 'load-error' || state.contextChanged) {
            load();
        } else {
            render();
        }
        root.querySelector('.vcms-panel')?.focus();
    }

    function requestClose() {
        if (isDirty()) {
            state.closing = true;
            render();
            return;
        }
        close();
    }

    function close() {
        overlay.hidden = true;
        state.closing = false;
        document.body.classList.remove('vcms-no-scroll');
    }

    function toast(message, kind) {
        state.toast = { message, kind, at: Date.now() };
        render();
        const ttl = 3200;
        setTimeout(() => {
            if (state.toast && Date.now() - state.toast.at >= ttl) {
                state.toast = null;
                render();
            }
        }, ttl + 50);
    }

    // ---------- 渲染 ----------

    function render() {
        overlay.innerHTML = renderShell();
        refreshFeedback();
    }

    function renderShell() {
        return `
        <div class="vcms-panel" tabindex="-1" role="dialog" aria-modal="true" aria-label="模型设置">
            ${renderHeader()}
            <div class="vcms-body">
                ${state.reauth.open ? renderReauthBar() : ''}
                ${state.phase === 'loading' ? renderSkeleton() : ''}
                ${state.phase === 'load-error' ? renderLoadError() : ''}
                ${state.phase === 'ready' ? renderContent() : ''}
            </div>
            ${renderFooter()}
        </div>
        ${state.toast ? `<div class="vcms-toast vcms-toast-${esc(state.toast.kind)}" data-action="toast-dismiss">${esc(state.toast.message)}</div>` : ''}
        `;
    }

    function renderHeader() {
        const providerCount = state.providers.length;
        const modelCount = state.providers.reduce((sum, p) => sum + (p.models?.length ?? 0), 0);
        return `
        <header class="vcms-header">
            <div class="vcms-header-titles">
                <h2 class="vcms-title">模型设置</h2>
                <p class="vcms-subtitle">供应商 ${providerCount} · 模型配置 ${modelCount} · 用途绑定 ${state.purposes.length}</p>
            </div>
            <div class="vcms-header-actions">
                <span class="vcms-dirty" id="vcms-dirty" hidden><span class="vcms-dot"></span>未保存的修改</span>
                <button type="button" class="vcms-btn vcms-btn-ghost" id="vcms-discard" data-action="discard" hidden>放弃修改</button>
                <button type="button" class="vcms-btn vcms-btn-primary" id="vcms-save" data-action="save">保存更改</button>
                <button type="button" class="vcms-iconbtn" data-action="close" aria-label="关闭模型设置" title="关闭（Esc）"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </header>`;
    }

    function renderSkeleton() {
        return `
        <div class="vcms-skeleton">
            <div class="vcms-sk-col">${'<div class="vcms-sk-card"></div>'.repeat(3)}</div>
            <div class="vcms-sk-main">${'<div class="vcms-sk-line"></div>'.repeat(8)}</div>
        </div>`;
    }

    function renderLoadError() {
        const err = state.loadError;
        let title = '无法加载模型配置';
        let message = err?.message ?? '请稍后重试。';
        if (err instanceof api.ApiError && err.kind === 'unauthenticated') {
            title = '需要登录';
            message = '登录后才能管理模型配置，请先登录再打开此页。';
        } else if (err instanceof api.ApiError && err.kind === 'forbidden') {
            title = '没有管理权限';
            message = '当前身份无权管理模型配置，或需要重新验证身份。';
        }
        return `
        <div class="vcms-stateblock">
            <i class="fa-solid fa-plug-circle-xmark vcms-stateblock-icon"></i>
            <h3>${esc(title)}</h3>
            <p>${esc(message)}</p>
            <button type="button" class="vcms-btn vcms-btn-primary" data-action="retry-load"><i class="fa-solid fa-rotate-right"></i> 重试</button>
        </div>`;
    }

    function renderContent() {
        return `
        <div class="vcms-layout">
            <aside class="vcms-providers" aria-label="供应商列表">
                <div class="vcms-providers-head">
                    <span class="vcms-section-label">接入的供应商</span>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="new-provider"><i class="fa-solid fa-plus"></i> 新建</button>
                </div>
                <div class="vcms-provider-list" id="vcms-provider-list">${renderProviderCards()}</div>
            </aside>
            <main class="vcms-main">
                <div class="vcms-tabs" role="tablist">
                    <button type="button" role="tab" class="vcms-tab ${state.tab === 'provider' ? 'is-active' : ''}" aria-selected="${state.tab === 'provider'}" data-action="tab" data-tab="provider">供应商与模型</button>
                    <button type="button" role="tab" class="vcms-tab ${state.tab === 'bindings' ? 'is-active' : ''}" aria-selected="${state.tab === 'bindings'}" data-action="tab" data-tab="bindings">用途绑定</button>
                </div>
                <div class="vcms-tabpanes">
                    ${state.tab === 'provider' ? renderProviderPane() : renderBindingsPane()}
                </div>
            </main>
        </div>`;
    }

    function renderProviderCards() {
        const creatingNew = state.creatingNew;
        if (!state.providers.length && !creatingNew) {
            return `
            <div class="vcms-empty-providers">
                <p>还没有供应商。</p>
                <p class="vcms-muted">新建供应商，选择一种接口协议并填写 Base URL 与密钥，再添加模型配置。</p>
                <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="new-provider"><i class="fa-solid fa-plus"></i> 新建供应商</button>
            </div>`;
        }
        const cards = state.providers.map((p) => `
            <button type="button" class="vcms-provider-card ${p.providerId === state.selectedProviderId ? 'is-selected' : ''} ${p.state === 'DISABLED' ? 'is-disabled' : ''}" data-action="select-provider" data-id="${esc(p.providerId)}">
                <span class="vcms-provider-name">${esc(p.displayName || p.providerId)}</span>
                <span class="vcms-provider-meta">
                    <span class="vcms-badge ${p.state === 'ENABLED' ? 'vcms-badge-ok' : 'vcms-badge-muted'}">${logic.PROVIDER_STATE_LABELS[p.state] ?? p.state}</span>
                    <span class="vcms-badge ${p.credentialConfigured ? 'vcms-badge-ok' : 'vcms-badge-warn'}">${p.credentialConfigured ? '密钥已配置' : '缺密钥'}</span>
                </span>
                <span class="vcms-provider-sub">${esc(logic.protocolMeta(p.protocol)?.label ?? p.protocol)} · ${p.models?.length ?? 0} 个模型</span>
            </button>`).join('');
        const newCard = creatingNew
            ? `<button type="button" class="vcms-provider-card is-selected is-new" data-action="select-provider" data-id="">
                   <span class="vcms-provider-name">新建供应商（未保存）</span>
                   <span class="vcms-provider-sub">草稿</span>
               </button>`
            : '';
        return cards + newCard;
    }

    function renderProviderPane() {
        if (!state.draft) return '<div class="vcms-stateblock"><p>请选择或新建一个供应商。</p></div>';
        const d = state.draft;
        const isNew = state.creatingNew;
        const key = logic.keyPlan(d, d.credentialConfigured);
        return `
        ${renderConflictBanners()}
        ${renderContextBanner()}
        <div class="vcms-form">
            ${!d.credentialConfigured && key.finalKey === 'none' ? `
            <div class="vcms-callout vcms-callout-warn" role="alert">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div>该供应商尚未配置 API Key。可以先保存为停用草稿；配置密钥并启用后才能用于生成。</div>
            </div>` : ''}
            <section class="vcms-section">
                <h3 class="vcms-section-title">基本信息</h3>
                <div class="vcms-grid2">
                    <div class="vcms-field">
                        <label for="vcms-f-display">显示名称</label>
                        <input id="vcms-f-display" type="text" data-bind="provider.displayName" value="${esc(d.displayName)}" placeholder="例如：我的模型服务" maxlength="60">
                        <p class="vcms-field-err" data-err-for="displayName"></p>
                    </div>
                    <div class="vcms-field">
                        <label for="vcms-f-id">供应商 ID</label>
                        ${isNew
            ? `<input id="vcms-f-id" type="text" data-bind="provider.providerId" value="${esc(d.providerId)}" placeholder="小写字母 / 数字 / - / _" autocomplete="off" spellcheck="false">`
            : `<input id="vcms-f-id" type="text" class="vcms-mono" value="${esc(d.providerId)}" readonly aria-readonly="true">`}
                        <p class="vcms-field-err" data-err-for="providerId"></p>
                    </div>
                </div>
                <div class="vcms-field">
                    <span class="vcms-field-label">状态</span>
                    <div class="vcms-switch-row">
                        <button type="button" class="vcms-switch ${d.state === 'ENABLED' ? 'is-on' : ''}" data-action="toggle-provider-state" role="switch" aria-checked="${d.state === 'ENABLED'}" aria-label="启用或停用该供应商">
                            <span class="vcms-switch-knob"></span>
                        </button>
                        <span>${logic.PROVIDER_STATE_LABELS[d.state] ?? d.state}</span>
                    </div>
                    <p class="vcms-field-err" data-err-for="state"></p>
                </div>
                <div class="vcms-field">
                    <label for="vcms-f-base">Base URL</label>
                    <input id="vcms-f-base" type="url" data-bind="provider.baseUrl" value="${esc(d.baseUrl)}" placeholder="https://api.example.com" spellcheck="false">
                    <p class="vcms-field-err" data-err-for="baseUrl"></p>
                </div>
                <div class="vcms-field">
                    <span class="vcms-field-label">接口协议</span>
                    <div class="vcms-protocols" role="radiogroup" aria-label="接口协议">
                        ${logic.PROTOCOLS.map((p) => `
                        <label class="vcms-protocol ${d.protocol === p.id ? 'is-selected' : ''}">
                            <input type="radio" name="vcms-protocol" value="${p.id}" ${d.protocol === p.id ? 'checked' : ''} data-bind="provider.protocol">
                            <span class="vcms-protocol-name">${esc(p.label)}</span>
                            <span class="vcms-protocol-endpoint vcms-mono">${esc(p.endpoint)}</span>
                        </label>`).join('')}
                    </div>
                    <p class="vcms-field-err" data-err-for="protocol"></p>
                </div>
                <div class="vcms-endpoint-line" id="vcms-endpoint-line"></div>
            </section>

            <section class="vcms-section">
                <h3 class="vcms-section-title">API 密钥</h3>
                ${renderKeySection(key)}
            </section>

            <section class="vcms-section">
                <div class="vcms-section-head">
                    <h3 class="vcms-section-title">模型配置</h3>
                    <div class="vcms-section-tools">
                        <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="discover" ${state.discoverBusy ? 'disabled' : ''}>
                            <i class="fa-solid fa-cloud-arrow-down ${state.discoverBusy ? 'fa-spin' : ''}"></i>
                            ${state.discoverBusy ? '拉取中…' : '拉取模型列表'}
                        </button>
                        <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="add-model"><i class="fa-solid fa-plus"></i> 新增模型</button>
                    </div>
                </div>
                <p class="vcms-muted vcms-section-note">拉取是显式操作，只在你点击时访问服务商接口；保存不会自动拉取、试连或生成。模型 ID 始终可以手填。</p>
                ${state.discoverError ? `<div class="vcms-callout vcms-callout-danger" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div>${esc(state.discoverError)}</div></div>` : ''}
                ${d.models.length ? `<div class="vcms-model-list" id="vcms-model-list">${renderModelList()}</div>` : `
                <div class="vcms-empty-models">
                    <p>还没有模型配置。</p>
                    <p class="vcms-muted">手填新增，或先配置密钥后从服务商拉取列表。</p>
                </div>`}
                ${currentModel() ? renderModelForm(currentModel()) : ''}
            </section>

            ${renderTestSection()}
            ${renderImpactPanel()}
            ${state.saveError ? `<div class="vcms-callout vcms-callout-danger" role="alert" id="vcms-save-error"><i class="fa-solid fa-triangle-exclamation"></i><div>${esc(state.saveError)} <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="save">重试保存</button></div></div>` : ''}
            <div class="vcms-update-meta vcms-muted">更新于 ${fmtTime(d.updatedAt)} · 配置版本 v${d.revision}${d.endpointUrl ? ` · 最终地址 ${esc(d.endpointUrl)}` : ''}</div>
        </div>`;
    }

    function renderConflictBanners() {
        let html = '';
        if (state.conflict) {
            html += `
            <div class="vcms-callout vcms-callout-warn vcms-conflict" role="alert">
                <i class="fa-solid fa-code-merge"></i>
                <div>
                    <p>${esc(state.conflict.message)}${state.conflict.currentRevision !== null ? `（最新配置版本 v${state.conflict.currentRevision}）` : ''}</p>
                    <div class="vcms-callout-actions">
                        <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="conflict-view-latest">查看最新</button>
                        <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="conflict-keep">保留草稿</button>
                    </div>
                </div>
            </div>`;
        }
        if (state.stashBanner) {
            html += `
            <div class="vcms-callout vcms-callout-info" role="status">
                <i class="fa-solid fa-circle-info"></i>
                <div>
                    <p>已加载最新内容（配置版本 v${state.draft?.revision ?? '—'}），未保存的输入已暂存。</p>
                    <div class="vcms-callout-actions">
                        <button type="button" class="vcms-btn vcms-btn-primary-outline vcms-btn-sm" data-action="restore-stash">恢复未保存的草稿</button>
                        <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="dismiss-stash-banner">保留最新内容</button>
                    </div>
                </div>
            </div>`;
        }
        return html;
    }

    /** 会话上下文变更横幅：保留草稿，要求显式重新加载（复用 conflict callout 形态）。 */
    function renderContextBanner() {
        if (!state.contextChanged) return '';
        return `
        <div class="vcms-callout vcms-callout-warn vcms-conflict" role="alert">
            <i class="fa-solid fa-user-shield"></i>
            <div>
                <p>${esc(state.contextChanged)}</p>
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="context-reload">重新加载页面数据</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="context-keep">保留草稿，暂不重载</button>
                </div>
            </div>
        </div>`;
    }

    function renderKeySection(key) {
        const d = state.draft;
        if (key.action === 'keep' && state.keyEditing) {
            return `
            <div class="vcms-field">
                <label for="vcms-f-key">新密钥（保存后替换）</label>
                <input id="vcms-f-key" type="password" data-bind="provider.credential" value="" placeholder="粘贴新密钥；留空则不替换" autocomplete="new-password" spellcheck="false">
                <p class="vcms-muted">保存后只显示“已配置”，不会回显原值，也不会写入聊天记录或日志。</p>
                <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="key-undo">取消替换</button>
            </div>`;
        }
        if (key.action === 'keep') {
            return `
            <div class="vcms-keybox">
                <div class="vcms-keybox-state">
                    <i class="fa-solid fa-key"></i>
                    <span>${logic.KEY_STATE_LABELS.configured}</span>
                    <span class="vcms-muted">密钥不回显、不写入页面数据；只在本页替换或清除。</span>
                </div>
                <div class="vcms-keybox-actions">
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="key-replace">替换密钥</button>
                    <button type="button" class="vcms-btn vcms-btn-danger-ghost vcms-btn-sm" data-action="key-clear">清除密钥</button>
                </div>
            </div>
            ${state.keyClearing ? `
            <div class="vcms-keyclear-confirm" role="alertdialog" aria-label="确认清除密钥">
                <p>清除后供应商将保持停用，后续请求不再携带该密钥。确认清除？</p>
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-danger vcms-btn-sm" data-action="key-clear-confirm">确认清除</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="key-clear-cancel">取消</button>
                </div>
            </div>` : ''}`;
        }
        if (key.action === 'will-clear') {
            return `
            <div class="vcms-keybox">
                <div class="vcms-keybox-state"><i class="fa-solid fa-key"></i><span class="vcms-badge vcms-badge-danger">${logic.KEY_STATE_LABELS['will-clear']}</span></div>
                <div class="vcms-keybox-actions">
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="key-undo">撤销</button>
                </div>
            </div>`;
        }
        return `
            <div class="vcms-field">
                <label for="vcms-f-key">${key.action === 'will-replace' ? '新密钥（保存后替换）' : 'API 密钥'}</label>
                <input id="vcms-f-key" type="password" data-bind="provider.credential" value="${esc(d.credential)}" placeholder="粘贴服务方提供的密钥" autocomplete="new-password" spellcheck="false">
                <p class="vcms-muted">保存后只显示“已配置”，不回显原值，也不会写入聊天记录或日志。</p>
            </div>
            ${key.action === 'will-replace' ? '<button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="key-undo">撤销替换</button>' : ''}`;
    }

    function renderModelList() {
        const errors = collectErrors();
        return state.draft.models.map((m) => {
            const err = errors.models.get(m.profileKey);
            const selected = m.profileKey === state.selectedProfileKey;
            return `
            <div class="vcms-model-row ${selected ? 'is-selected' : ''}" data-action="select-model" data-key="${esc(m.profileKey)}" role="button" tabindex="0" aria-pressed="${selected}">
                <div class="vcms-model-row-main">
                    <span class="vcms-model-name">${esc(m.displayName || m.modelId || '未命名模型')}</span>
                    <span class="vcms-model-id vcms-mono">${esc(m.modelId || '（未填 ID）')}</span>
                </div>
                <div class="vcms-model-row-badges">
                    ${isBlank(m.contextWindowTokens) ? '<span class="vcms-badge vcms-badge-warn">配置不完整</span>' : ''}
                    ${m.boundPurposes?.length ? `<span class="vcms-badge vcms-badge-info">${m.boundPurposes.length} 个用途在用</span>` : ''}
                    ${err ? `<span class="vcms-badge vcms-badge-danger" title="${esc(Object.values(err)[0])}">有校验错误</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function renderModelForm(m) {
        const errors = logic.validateModelForm(m);
        const err = (field) => `<p class="vcms-field-err" data-err-for="${field}">${esc(errors[field] ?? '')}</p>`;
        const isShared = m.boundPurposes?.length > 0;
        return `
        <div class="vcms-model-form" data-profile="${esc(m.profileKey)}">
            ${isShared ? `<div class="vcms-callout vcms-callout-info"><i class="fa-solid fa-share-nodes"></i><div>该配置正被这些用途使用：${m.boundPurposes.map((p) => esc(logic.purposeMeta(p).label)).join('、')}。此处的修改保存后会影响它们；如需不影响，请用「另存为新配置」。</div></div>` : ''}
            <div class="vcms-grid2">
                <div class="vcms-field">
                    <label for="vcms-m-display">模型显示名称</label>
                    <input id="vcms-m-display" type="text" data-bind="model.displayName" value="${esc(m.displayName)}" maxlength="80">
                    ${err('displayName')}
                </div>
                <div class="vcms-field">
                    <label for="vcms-m-id">模型 ID</label>
                    <input id="vcms-m-id" type="text" class="vcms-mono" data-bind="model.modelId" value="${esc(m.modelId)}" placeholder="服务方的模型 ID，可手填" spellcheck="false">
                    ${err('modelId')}
                </div>
            </div>
            <div class="vcms-field">
                <label for="vcms-m-profile">配置标识</label>
                ${m.isNew || m.isClone
        ? `<input id="vcms-m-profile" type="text" class="vcms-mono" data-bind="model.profileKey" value="${esc(m.profileKey)}" placeholder="默认同模型 ID">`
        : `<input id="vcms-m-profile" type="text" class="vcms-mono" value="${esc(m.profileKey)}" readonly aria-readonly="true">`}
                <p class="vcms-muted">同一模型 ID 可以有多份配置（不同参数 / 计价）；「另存为新配置」会生成新的配置标识，不覆盖原配置。</p>
                ${err('profileKey')}
            </div>
            <div class="vcms-grid2">
                <div class="vcms-field">
                    <label for="vcms-m-ctx">上下文窗口（token）</label>
                    <input id="vcms-m-ctx" type="number" min="1" step="1" data-bind="model.contextWindowTokens" value="${esc(m.contextWindowTokens)}" placeholder="例如 200000">
                    ${err('contextWindowTokens')}
                </div>
                <div class="vcms-field">
                    <label for="vcms-m-max">最大输出（token 预留）</label>
                    <input id="vcms-m-max" type="number" min="1" step="1" data-bind="model.maxOutputTokens" value="${esc(m.maxOutputTokens)}" placeholder="例如 8192">
                    ${err('maxOutputTokens')}
                </div>
            </div>
            <p class="vcms-muted">上下文窗口包含历史消息、角色卡、世界书、记忆与工具结果；输出与工具结果需要预留空间。</p>
            <p class="vcms-callout vcms-callout-warn vcms-inline-note" data-note="ctx" role="alert"><i class="fa-solid fa-triangle-exclamation"></i>未填写上下文窗口：配置不完整，绑定前台聊天前需要补齐。</p>

            <details class="vcms-advanced">
                <summary>高级设置（推理 · 参数 · 能力 · 计价）</summary>
                <div class="vcms-advanced-body">
                    <h4 class="vcms-subsection-title">推理</h4>
                    <div class="vcms-field">
                        <span class="vcms-field-label">声明可用推理等级</span>
                        <div class="vcms-checks">
                            ${logic.REASONING_LEVELS.map((lv) => `
                            <label class="vcms-check"><input type="checkbox" data-bind="model.reasoningLevels" value="${lv}" ${m.reasoningLevels.includes(lv) ? 'checked' : ''}>${logic.reasoningLevelLabel(lv)}</label>`).join('')}
                            ${logic.extraReasoningLevels(m.reasoningLevels).map((lv) => `
                            <label class="vcms-check" title="已保存的等级，继续保留"><input type="checkbox" checked disabled>${esc(lv)}</label>`).join('')}
                        </div>
                        <p class="vcms-muted">等级按当前协议映射为对应参数；未知映射保持待配置，不硬发统一字段。</p>
                    </div>
                    <div class="vcms-field">
                        <label for="vcms-m-effort">默认推理等级</label>
                        <select id="vcms-m-effort" data-bind="model.generationParams.reasoningEffort">
                            <option value="" ${!m.generationParams.reasoningEffort ? 'selected' : ''}>未设置</option>
                            ${m.reasoningLevels.map((lv) => `<option value="${esc(lv)}" ${m.generationParams.reasoningEffort === lv ? 'selected' : ''}>${esc(logic.reasoningLevelLabel(lv))}</option>`).join('')}
                        </select>
                        ${err('reasoningEffort')}
                    </div>
                    <h4 class="vcms-subsection-title">生成参数</h4>
                    <div class="vcms-grid2">
                        <div class="vcms-field">
                            <label for="vcms-m-temp">温度 temperature（0–2）</label>
                            <input id="vcms-m-temp" type="number" min="0" max="2" step="0.1" data-bind="model.generationParams.temperature" value="${esc(m.generationParams.temperature)}">
                            ${err('temperature')}
                        </div>
                        <div class="vcms-field">
                            <label for="vcms-m-topp">top P（0–1）</label>
                            <input id="vcms-m-topp" type="number" min="0" max="1" step="0.05" data-bind="model.generationParams.topP" value="${esc(m.generationParams.topP)}">
                            ${err('topP')}
                        </div>
                    </div>

                    <h4 class="vcms-subsection-title">能力与输入类型</h4>
                    <p class="vcms-muted">每项独立标记；「已验证」只能来自后端核验，不能手动选择。声明不代表实际可用。</p>
                    ${err('capabilities')}
                    <div class="vcms-capgrid">
                        ${logic.CAPABILITY_FIELDS.map((f) => {
        const value = m.capabilities[f.key] ?? 'UNKNOWN';
        return `
                        <div class="vcms-caprow">
                            <span class="vcms-capname">${esc(f.label)}</span>
                            <div class="vcms-seg" role="group" aria-label="${esc(f.label)}状态">
                                ${logic.CAPABILITY_STATES.map((s) => {
            const isVerified = s === 'VERIFIED';
            const active = value === s;
            return `<button type="button" class="vcms-seg-btn vcms-cap-${s.toLowerCase()} ${active ? 'is-active' : ''}" data-action="cap" data-cap-key="${f.key}" data-cap-state="${s}" ${isVerified && !active ? 'disabled' : ''} title="${isVerified ? '已验证状态来自后端核验，不能手动设置' : ''}" aria-pressed="${active}">${logic.CAPABILITY_STATE_LABELS[s]}</button>`;
        }).join('')}
                            </div>
                        </div>`;
    }).join('')}
                    </div>

                    <h4 class="vcms-subsection-title">计价（可选元数据）</h4>
                    <p class="vcms-muted">当前显示：${esc(logic.formatPricing(m.pricing))}。价格未知显示「未配置」，不会当作免费。</p>
                    <div class="vcms-grid3">
                        <div class="vcms-field">
                            <label for="vcms-m-currency">币种</label>
                            <select id="vcms-m-currency" data-bind="model.pricing.currency">
                                <option value="" ${!m.pricing.currency ? 'selected' : ''}>未配置</option>
                                ${logic.CURRENCIES.map((c) => `<option value="${c}" ${m.pricing.currency === c ? 'selected' : ''}>${logic.CURRENCY_LABELS[c]}</option>`).join('')}
                            </select>
                            ${err('pricingCurrency')}
                        </div>
                        <div class="vcms-field">
                            <label for="vcms-m-pin">输入价格 / 百万 token</label>
                            <input id="vcms-m-pin" type="number" min="0" step="0.01" data-bind="model.pricing.inputPerMillionTokens" value="${esc(m.pricing.inputPerMillionTokens)}" placeholder="未知">
                            ${err('pricingInput')}
                        </div>
                        <div class="vcms-field">
                            <label for="vcms-m-pout">输出价格 / 百万 token</label>
                            <input id="vcms-m-pout" type="number" min="0" step="0.01" data-bind="model.pricing.outputPerMillionTokens" value="${esc(m.pricing.outputPerMillionTokens)}" placeholder="未知">
                            ${err('pricingOutput')}
                        </div>
                    </div>
                </div>
            </details>

            <div class="vcms-model-actions">
                <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="clone-model"><i class="fa-solid fa-copy"></i> 另存为新配置</button>
                ${state.deleteFor === m.profileKey ? `
                <span class="vcms-inline-confirm">删除该模型配置？
                    <button type="button" class="vcms-btn vcms-btn-danger vcms-btn-sm" data-action="delete-model-confirm">删除</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="delete-model-cancel">取消</button>
                </span>` : `
                <button type="button" class="vcms-btn vcms-btn-danger-ghost vcms-btn-sm" data-action="delete-model" ${m.boundPurposes?.length ? 'disabled title="该配置仍被用途绑定引用，先解除绑定"' : ''}><i class="fa-solid fa-trash-can"></i> 删除</button>`}
            </div>
            ${state.cloneFor?.profileKey === m.profileKey ? renderCloneForm(m) : ''}
        </div>`;
    }

    function renderCloneForm() {
        const c = state.cloneFor;
        return `
        <div class="vcms-clone-form">
            <p class="vcms-field-label">另存为新配置（不影响现有用途绑定）</p>
            <div class="vcms-grid2">
                <div class="vcms-field">
                    <label for="vcms-clone-key">新配置标识 profileKey</label>
                    <input id="vcms-clone-key" type="text" class="vcms-mono" data-bind="clone.newProfileKey" value="${esc(c.newProfileKey)}" spellcheck="false">
                </div>
                <div class="vcms-field">
                    <label for="vcms-clone-name">新显示名称</label>
                    <input id="vcms-clone-name" type="text" data-bind="clone.newDisplayName" value="${esc(c.newDisplayName)}" maxlength="80">
                </div>
            </div>
            ${c.error ? `<p class="vcms-field-err is-visible">${esc(c.error)}</p>` : ''}
            <div class="vcms-callout-actions">
                <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="clone-confirm">创建副本</button>
                <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="clone-cancel">取消</button>
            </div>
        </div>`;
    }

    function renderTestSection() {
        const m = currentModel();
        const d = state.draft;
        const target = m ? `${d.displayName || d.providerId} · ${m.displayName || m.modelId}` : '未选择模型';
        const errors = collectErrors();
        const url = d.endpointUrl ?? (errors.endpoint?.ok ? errors.endpoint.finalUrl : '—');
        const check = state.check;
        const resultBlock = check.result
            ? `
            <div class="vcms-check-result">
                <p class="vcms-check-line"><i class="fa-solid fa-circle-check"></i> 已连通：服务方返回 ${check.result.total} 个模型，其中 ${check.result.unrecorded.length} 个未收录。</p>
                ${check.result.unrecorded.length ? `
                <ul class="vcms-check-list">
                    ${check.result.unrecorded.map((item) => `<li><span class="vcms-mono">${esc(item.modelId)}</span><span class="vcms-muted">${esc(item.displayName)}</span></li>`).join('')}
                </ul>
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-primary-outline vcms-btn-sm" data-action="check-add-models">把未收录模型加入列表（可选）</button>
                </div>` : '<p class="vcms-muted">返回的模型都已收录；如需其他模型可继续手填模型 ID。</p>'}
            </div>` : '';
        return `
        <section class="vcms-section">
            <h3 class="vcms-section-title">连接检查</h3>
            <div class="vcms-testbox">
                <div class="vcms-test-target">
                    <span class="vcms-muted">目标</span>
                    <span class="vcms-test-name">${esc(target)}</span>
                    <span class="vcms-mono vcms-test-url">${esc(url)}</span>
                </div>
                <p class="vcms-callout vcms-callout-info vcms-inline-note"><i class="fa-solid fa-circle-info"></i>连接检查只调用一次「拉取模型列表」接口：仅验证所选供应商的模型列表与鉴权，不发起生成调用，也不代表生成可用；真实生成以聊天为准。检查不会修改当前草稿。</p>
                ${check.error ? `<div class="vcms-callout vcms-callout-danger" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div>${esc(check.error)}</div></div>` : ''}
                ${resultBlock}
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-primary" data-action="check-connection" ${check.busy ? 'disabled' : ''}>
                        <i class="fa-solid fa-plug-circle-check ${check.busy ? 'fa-spin' : ''}"></i>
                        ${check.busy ? '检查中…' : '检查连接'}
                    </button>
                    <span class="vcms-muted">模型 ID 始终可以手填新增，检查不是必经步骤。</span>
                </div>
            </div>
        </section>`;
    }

    function renderReauthBar() {
        if (!state.reauth.open) return '';
        const r = state.reauth;
        return `
        <div class="vcms-reauth-bar" role="alertdialog" aria-label="重新验证身份">
            <div class="vcms-reauth-main">
                <i class="fa-solid fa-user-shield"></i>
                <p>写入前需要重新验证身份。输入当前登录密码完成验证，验证成功后将继续未完成的保存。</p>
            </div>
            <div class="vcms-reauth-form">
                <input id="vcms-reauth-password" type="password" data-bind="reauth.password" value="${esc(r.password)}" placeholder="当前登录密码" autocomplete="current-password" spellcheck="false">
                ${r.error ? `<p class="vcms-field-err is-visible">${esc(r.error)}</p>` : ''}
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="reauth-submit" ${r.busy ? 'disabled' : ''}>${r.busy ? '验证中…' : '验证并继续保存'}</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="reauth-cancel" ${r.busy ? 'disabled' : ''}>取消</button>
                </div>
            </div>
        </div>`;
    }

    function renderImpactPanel() {
        if (!state.impact?.length) return '';
        const items = state.impact.map((i) => `
            <li><strong>${esc(i.displayName)}</strong> 正被 ${i.usages.map((u) => esc(u.label)).join('、')} 使用</li>`).join('');
        return `
        <div class="vcms-callout vcms-callout-warn" role="alert" id="vcms-impact">
            <i class="fa-solid fa-share-nodes"></i>
            <div>
                <p>保存将影响正在共用这些配置的用途：</p>
                <ul>${items}</ul>
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="save-anyway">仍要保存</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="impact-cancel">先不保存，我再检查</button>
                </div>
            </div>
        </div>`;
    }

    function bindingTargetLabel(providerId, profileKey) {
        if (!providerId || !profileKey) return '未绑定（待配置）';
        const provider = state.providers.find((p) => p.providerId === providerId);
        const model = provider?.models?.find((m) => m.profileKey === profileKey);
        return `${provider?.displayName ?? providerId} · ${model?.displayName ?? model?.modelId ?? profileKey}`;
    }

    function renderBindingsConflict() {
        const c = state.bindingsConflict;
        if (!c) return '';
        const label = esc(logic.purposeMeta(c.purpose).label);
        if (!c.latest) {
            return `
            <div class="vcms-callout vcms-callout-warn" role="alert">
                <i class="fa-solid fa-code-merge"></i>
                <div>
                    <p>「${label}」的绑定已在另一处更新。你的选择已保留，未被覆盖。</p>
                    <div class="vcms-callout-actions">
                        <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="bindings-view-latest">查看最新</button>
                        <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="bindings-keep">暂不处理</button>
                    </div>
                </div>
            </div>`;
        }
        const draft = state.bindingsDraft.get(c.purpose);
        const mine = draft ? bindingTargetLabel(draft.providerId, draft.profileKey) : '未绑定（待配置）';
        const latest = bindingTargetLabel(c.latest.providerId, c.latest.profileKey);
        return `
        <div class="vcms-callout vcms-callout-warn" role="alert">
            <i class="fa-solid fa-code-merge"></i>
            <div>
                <p>「${label}」的绑定已在另一处更新（最新配置版本 v${c.latest.revision ?? '—'}）。请对比后选择：</p>
                <div class="vcms-conflict-compare">
                    <div><span class="vcms-muted">最新内容</span><br>${esc(latest)}</div>
                    <div><span class="vcms-muted">我的选择（未保存）</span><br>${esc(mine)}</div>
                </div>
                <div class="vcms-callout-actions">
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="bindings-adopt-latest" data-purpose="${esc(c.purpose)}">采用最新，放弃我的修改</button>
                    <button type="button" class="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="bindings-retry-latest" data-purpose="${esc(c.purpose)}">基于最新重试我的选择</button>
                    <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="bindings-keep">暂不处理</button>
                </div>
            </div>
        </div>`;
    }

    function renderBindingsPane() {
        const rows = logic.PURPOSES.map((p) => {
            const original = state.purposes.find((b) => b.purpose === p.id);
            const draft = state.bindingsDraft.get(p.id);
            const bindable = logic.canBindPurpose(p.id);
            const options = logic.buildBindingOptions(state.providers);
            const current = draft ? `${draft.providerId}::${draft.profileKey}` : '';
            const status = original?.status ?? 'PENDING_CONFIGURATION';
            const statusLabel = logic.BINDING_STATUS_LABELS[status] ?? status;
            const statusCls = status === 'READY' ? 'vcms-badge-ok' : status === 'PENDING_CONFIGURATION' ? 'vcms-badge-warn' : 'vcms-badge-muted';
            return `
            <tr class="vcms-binding-row ${draft?.dirty ? 'is-dirty' : ''} ${!bindable ? 'is-embed' : ''}">
                <td class="vcms-binding-purpose">
                    <span class="vcms-binding-name">${esc(p.label)}</span>
                    <span class="vcms-muted vcms-binding-desc">${esc(p.desc)}</span>
                </td>
                <td class="vcms-binding-select">
                    ${bindable ? `
                    <select data-bind="binding.${p.id}" aria-label="${esc(p.label)}绑定的模型配置">
                        ${options.map((o) => `<option value="${esc(o.value)}" ${current === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                    </select>
                    <label class="vcms-check vcms-binding-enabled"><input type="checkbox" data-bind="bindingState.${p.id}" ${draft?.state !== 'DISABLED' ? 'checked' : ''} ${!current ? 'disabled' : ''}>启用</label>` : `
                    <span class="vcms-badge vcms-badge-warn">待配置</span>
                    <span class="vcms-muted vcms-binding-embednote">Embedding 使用独立接口；本轮不可绑定，三种聊天协议不能用作 embedding。</span>`}
                </td>
                <td class="vcms-binding-status"><span class="vcms-badge ${statusCls}">${statusLabel}</span></td>
                <td class="vcms-binding-revision vcms-mono">v ${original?.revision ?? '—'}${draft?.dirty ? ' *' : ''}</td>
                <td class="vcms-binding-updated vcms-muted">${fmtTime(original?.updatedAt)}</td>
            </tr>
            ${draft?.error ? `<tr class="vcms-binding-errorrow"><td colspan="5"><p class="vcms-field-err is-visible">${esc(draft.error)}</p></td></tr>` : ''}`;
        }).join('');
        const dirtyCount = [...state.bindingsDraft.values()].filter((b) => b.dirty).length;
        return `
        ${renderBindingsConflict()}
        ${renderContextBanner()}
        <div class="vcms-section">
            <h3 class="vcms-section-title">用途绑定</h3>
            <p class="vcms-muted vcms-section-note">每个用途独立绑定自己的模型配置；可以共用同一配置，但切换某一用途不影响其他用途。待配置的用途不会自动回退到其他 Key 或模型。</p>
            <div class="vcms-table-wrap">
                <table class="vcms-bindings-table">
                    <thead>
                        <tr><th>用途</th><th>模型配置</th><th>状态</th><th>生效版本</th><th>更新时间</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${dirtyCount ? `
            <div class="vcms-bindings-save">
                <span class="vcms-muted">${dirtyCount} 个用途待保存</span>
                <button type="button" class="vcms-btn vcms-btn-primary" data-action="save-bindings" ${state.bindingsSaving ? 'disabled' : ''}>${state.bindingsSaving ? '保存中…' : '保存用途绑定'}</button>
                <button type="button" class="vcms-btn vcms-btn-ghost" data-action="discard-bindings">放弃修改</button>
            </div>` : ''}
        </div>`;
    }

    function renderFooter() {
        return `
        <footer class="vcms-footer">
            <button type="button" class="vcms-btn vcms-btn-ghost" data-action="close">取消并返回</button>
            <button type="button" class="vcms-btn vcms-btn-primary" id="vcms-save-footer" data-action="save">保存配置</button>
        </footer>
        ${state.closing ? `
        <div class="vcms-unsaved-bar" role="alertdialog" aria-label="有未保存的修改">
            <span>有未保存的修改，确定要关闭吗？关闭后本次输入将丢失。</span>
            <button type="button" class="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="keep-editing">继续编辑</button>
            <button type="button" class="vcms-btn vcms-btn-danger vcms-btn-sm" data-action="discard-close">放弃修改并关闭</button>
        </div>` : ''}`;
    }

    // ---------- 反馈刷新（不重渲染表单，避免丢焦点） ----------

    function refreshFeedback() {
        if (state.phase !== 'ready' || !overlay.isConnected) return;
        const errors = collectErrors();
        const anyError = hasErrors(errors);
        const dirty = isDirty();

        const endpointEl = overlay.querySelector('#vcms-endpoint-line');
        if (endpointEl) {
            if (isBlank(state.draft.baseUrl)) {
                endpointEl.innerHTML = '<span class="vcms-muted">填写 Base URL 后显示规范化最终请求地址。</span>';
                endpointEl.classList.remove('is-error');
            } else if (errors.endpoint?.ok) {
                endpointEl.innerHTML = `
                <span class="vcms-muted">最终请求地址</span>
                <span class="vcms-mono vcms-endpoint-url">${esc(errors.endpoint.finalUrl)}</span>
                <span class="vcms-muted">（${esc(errors.endpoint.hint)}；最终地址以保存后的结果为准）</span>`;
                endpointEl.classList.remove('is-error');
            } else if (errors.endpoint?.kind === 'full-endpoint' && errors.endpoint.suggestedBaseUrl) {
                endpointEl.innerHTML = `
                <span class="vcms-field-err is-visible">${esc(errors.endpoint.error)}</span>
                <button type="button" class="vcms-btn vcms-btn-primary-outline vcms-btn-sm" data-action="endpoint-convert" data-suggested="${esc(errors.endpoint.suggestedBaseUrl)}">转换为 Base URL</button>
                <span class="vcms-mono vcms-endpoint-url">${esc(errors.endpoint.suggestedBaseUrl)}</span>`;
                endpointEl.classList.add('is-error');
            } else {
                endpointEl.innerHTML = `<span class="vcms-field-err is-visible">${esc(errors.endpoint?.error ?? 'Base URL 未通过校验')}</span>`;
                endpointEl.classList.add('is-error');
            }
        }

        for (const [field, msg] of Object.entries({ ...errors.provider, ...errors.credential })) {
            const el = overlay.querySelector(`[data-err-for="${field}"]`);
            if (el) {
                el.textContent = msg;
                el.classList.toggle('is-visible', Boolean(msg));
            }
        }
        const model = currentModel();
        if (model) {
            const modelErrors = errors.models.get(model.profileKey) ?? {};
            overlay.querySelectorAll('.vcms-model-form [data-err-for]').forEach((el) => {
                const field = el.getAttribute('data-err-for');
                const msg = modelErrors[field] ?? '';
                el.textContent = msg;
                el.classList.toggle('is-visible', Boolean(msg));
            });
            const ctxNote = overlay.querySelector('.vcms-model-form [data-note="ctx"]');
            if (ctxNote) ctxNote.hidden = !isBlank(model.contextWindowTokens);
        }

        const saveDisabled = anyError || state.saving;
        for (const id of ['vcms-save', 'vcms-save-footer']) {
            const btn = overlay.querySelector(`#${id}`);
            if (btn) {
                btn.disabled = saveDisabled;
                btn.textContent = state.saving ? '保存中…' : (id === 'vcms-save' ? '保存更改' : '保存配置');
                if (anyError) btn.title = '存在校验错误，请先按提示修改';
                else btn.removeAttribute('title');
            }
        }
        const dirtyEl = overlay.querySelector('#vcms-dirty');
        if (dirtyEl) dirtyEl.hidden = !dirty;
        const discardBtn = overlay.querySelector('#vcms-discard');
        if (discardBtn) discardBtn.hidden = !dirty;

        const listEl = overlay.querySelector('#vcms-provider-list');
        if (listEl) listEl.innerHTML = renderProviderCards();
        const modelListEl = overlay.querySelector('#vcms-model-list');
        if (modelListEl) modelListEl.innerHTML = renderModelList();
    }

    // ---------- 事件 ----------

    overlay.addEventListener('click', (ev) => {
        const actionEl = ev.target.closest('[data-action]');
        if (!actionEl || !overlay.contains(actionEl)) return;
        handleAction(actionEl.getAttribute('data-action'), actionEl);
    });

    overlay.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            ev.stopPropagation();
            requestClose();
            return;
        }
        if (ev.key === 'Enter' && ev.target?.id === 'vcms-reauth-password') {
            ev.preventDefault();
            doReauth();
            return;
        }
        const row = ev.target.closest?.('.vcms-model-row');
        if (row && (ev.key === 'Enter' || ev.key === ' ')) {
            ev.preventDefault();
            state.selectedProfileKey = row.getAttribute('data-key');
            render();
        }
    });

    overlay.addEventListener('input', (ev) => {
        const el = ev.target;
        const bind = el.getAttribute('data-bind');
        if (!bind) return;
        applyBind(el, bind);
        if (bind === 'model.modelId') {
            // 新建模型未手动改过配置标识时，profileKey 跟随 modelId。
            const model = currentModel();
            if (model && model.isNew && NEW_KEY_PLACEHOLDER_RE.test(model.profileKey)) {
                model.profileKey = el.value.trim();
            }
        }
        refreshFeedback();
    });

    overlay.addEventListener('change', (ev) => {
        const el = ev.target;
        const bind = el.getAttribute('data-bind');
        if (!bind) return;
        applyBind(el, bind);
        if (bind === 'provider.protocol' || bind.startsWith('binding')) {
            render();
        } else {
            refreshFeedback();
        }
    });

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
                d.dirty = true;
            }
            return;
        }
        if (bind.startsWith('model.')) {
            if (!model) return;
            const path = bind.slice('model.'.length);
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

    function guardDirtySwitch() {
        if (!isDirty()) return false;
        toast('有未保存的修改。请先保存，或点「放弃修改」后再切换。', 'info');
        return true;
    }

    function handleAction(action, el) {
        switch (action) {
            case 'close':
                requestClose();
                break;
            case 'keep-editing':
                state.closing = false;
                render();
                break;
            case 'discard-close':
                close();
                break;
            case 'tab':
                state.tab = el.getAttribute('data-tab');
                render();
                break;
            case 'retry-load':
                load();
                break;
            case 'new-provider':
                if (guardDirtySwitch()) break;
                state.draft = logic.newProviderDraft();
                state.originalDraft = deepClone(state.draft);
                state.creatingNew = true;
                state.tab = 'provider';
                render();
                overlay.querySelector('#vcms-f-display')?.focus();
                break;
            case 'select-provider': {
                if (guardDirtySwitch()) break;
                const id = el.getAttribute('data-id');
                if (!id) {
                    state.draft = logic.newProviderDraft();
                    state.originalDraft = deepClone(state.draft);
                    state.creatingNew = true;
                    render();
                    break;
                }
                selectProvider(id);
                break;
            }
            case 'endpoint-convert': {
                const suggested = el.getAttribute('data-suggested');
                if (suggested) {
                    state.draft.baseUrl = suggested;
                    toast('已转换为 Base URL；请检查后保存。', 'info');
                }
                render();
                break;
            }
            case 'toggle-provider-state':
                state.draft.state = state.draft.state === 'ENABLED' ? 'DISABLED' : 'ENABLED';
                render();
                break;
            case 'discard':
                selectProvider(state.selectedProviderId, { silent: true });
                toast('已放弃未保存的修改。', 'info');
                render();
                break;
            case 'save':
            case 'save-anyway':
                doSaveProvider();
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
                state.draft.credential = '';
                state.draft.clearCredential = false;
                state.keyEditing = false;
                render();
                break;
            case 'add-model': {
                const model = logic.newModelDraft();
                model.profileKey = `__new_${state.draft.models.length + 1}__`;
                state.draft.models.push(model);
                state.selectedProfileKey = model.profileKey;
                render();
                overlay.querySelector('#vcms-m-id')?.focus();
                break;
            }
            case 'select-model':
                state.selectedProfileKey = el.getAttribute('data-key');
                state.cloneFor = null;
                state.deleteFor = null;
                render();
                break;
            case 'delete-model':
                state.deleteFor = currentModel()?.profileKey ?? null;
                render();
                break;
            case 'delete-model-confirm': {
                const key = state.deleteFor;
                state.draft.models = state.draft.models.filter((m) => m.profileKey !== key);
                if (state.selectedProfileKey === key) state.selectedProfileKey = state.draft.models[0]?.profileKey ?? null;
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
                state.selectedProfileKey = clone.profileKey;
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

    async function doDiscover() {
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
        render();
        try {
            const models = await api.discoverProviderModels(state.draft.providerId, {
                protocol: state.draft.protocol,
                baseUrl: state.draft.baseUrl.trim(),
                credential: state.draft.credential || undefined,
            });
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
                    state.selectedProfileKey = state.draft.models[state.draft.models.length - 1]?.profileKey ?? state.selectedProfileKey;
                    toast(`拉取完成，新增 ${added} 个模型配置（未保存）。`, 'success');
                } else {
                    state.discoverError = '拉取到的模型都已存在；仍可手填新增。';
                }
            }
        } catch (err) {
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
        if (state.check.busy) return;
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
        render();
        try {
            const found = await api.discoverProviderModels(state.draft.providerId, {
                protocol: state.draft.protocol,
                baseUrl: state.draft.baseUrl.trim(),
                credential: state.draft.credential || undefined,
            });
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
            state.selectedProfileKey = state.draft.models[state.draft.models.length - 1]?.profileKey ?? state.selectedProfileKey;
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
            toast('身份验证已更新，继续保存。', 'success');
            render();
            if (retry === 'provider') doSaveProvider();
            else if (retry === 'bindings') doSaveBindings();
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

    mounted = controller;
    return controller;
}
