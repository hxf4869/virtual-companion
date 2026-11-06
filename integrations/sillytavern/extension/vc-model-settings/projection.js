// Virtual Companion · 前台投影 — 把 Go FOREGROUND_CHAT 绑定投影进 ST 原生 chatCompletionSettings。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 分层：本文件上半部分是纯逻辑（无 DOM / 无 ST import，Node --test 直接可测）；
// 下半部分 createProjectionController 是 ST 胶水（DOM 写入、事件接线、受管横幅），
// ST 宿主 API 一律经参数注入，index.js 是唯一注入真实 getContext 的入口。
//
// 冻结契约（V2-W03 收口，与服务端 generate-bridge.js 严格一致）：
//   标记：vc-go://model-purposes/FOREGROUND_CHAT?provider=<id>&profile=<profileKey>
//         &pr=<providerRevision 十进制>&br=<bindingRevision 十进制>&scope=<opaque>
//   scope = `${characterKey}|${chatKey}|${runId}`（整体作为一个 query 值，URLSearchParams 编码）；
//   服务端把 scope 当 opaque 续接隔离键，前端不解释其内容。

import {
    MARKER_SCHEME,
    FOREGROUND_PURPOSE,
    buildBindingMarker,
    parseBindingMarker,
    sameMarkerIdentity,
    buildScope,
    characterKeyOf,
    chatKeyOf,
    isToolContinuation,
    advanceRunState,
    resetRunState,
    NATIVE_REASONING_EFFORTS,
    reasoningEffortWritePlan,
    ineligibleReasonLabel,
    resolveForegroundProjection,
    settingsMarkerFor,
    diffProjection,
    DRIFT_FIELD_LABELS,
    driftSummary,
    rewriteGenerateData,
    restoreManagedReasoningEffort,
    BANNER_TEST_NOTE,
    bannerModel,
} from './projection-logic.js';

export {
    MARKER_SCHEME,
    FOREGROUND_PURPOSE,
    buildBindingMarker,
    parseBindingMarker,
    sameMarkerIdentity,
    buildScope,
    characterKeyOf,
    chatKeyOf,
    isToolContinuation,
    advanceRunState,
    resetRunState,
    NATIVE_REASONING_EFFORTS,
    reasoningEffortWritePlan,
    ineligibleReasonLabel,
    resolveForegroundProjection,
    settingsMarkerFor,
    diffProjection,
    DRIFT_FIELD_LABELS,
    driftSummary,
    rewriteGenerateData,
    restoreManagedReasoningEffort,
    BANNER_TEST_NOTE,
    bannerModel,
};

// ---------- ST 胶水控制器（依赖注入；Node 测试只覆盖上方纯逻辑） ----------

const BANNER_ID = 'vc_foreground_banner';
const MARKER_HOST_PANEL = '#openai_api'; // 原生 API 连接面板；横幅注入其顶部，不改 online_status

// 投影管理的原生字段（冻结清单）；用户对这些字段的编辑触发偏离检测。
const MANAGED_EDIT_SELECTORS = [
    '#chat_completion_source',
    '#custom_api_url_text',
    '#openai_reverse_proxy',
    '#custom_model_id',
    '#model_claude_select',
    '#openai_max_context',
    '#openai_max_tokens',
    '#temp_openai',
    '#top_p_openai',
    '#openai_reasoning_effort',
].join(',');

function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {object} host
 * @param {() => any} host.getContext ST getContext()：chatCompletionSettings（oai_settings 活引用）、
 *   saveSettingsDebounced、chatId、characterId、groupId、characters、eventSource、eventTypes。
 * @param {() => Promise<any>} host.fetchPurposes GET /api/v1/admin/model-purposes
 * @param {() => Promise<any>} host.fetchProviders GET /api/v1/admin/providers
 * @param {() => void} host.openModelSettings 打开模型设置页（横幅跳转入口）
 */
export function createProjectionController(host) {
    const doc = typeof document !== 'undefined' ? document : null;
    const runState = { runId: 0 };
    const state = { phase: 'loading', decision: null, loadError: null, drifts: [] };
    let writing = false; // 程序写入期间屏蔽偏离检测（jQuery trigger 同样走 DOM 事件）
    let listenersBound = false;

    function jquery() {
        return typeof window !== 'undefined' ? (window.jQuery ?? window.$ ?? null) : null;
    }

    /** 原生 DOM 写入：jQuery val + trigger；值未变时跳过（幂等，避免重复触发 status check）。 */
    function setField(selector, value, eventName, { force = false } = {}) {
        if (!doc) return false;
        const el = doc.querySelector(selector);
        if (!el) return false;
        const $ = jquery();
        if ($) {
            const wrapped = $(el);
            if (!force && String(wrapped.val() ?? '') === String(value)) return true;
            wrapped.val(value).trigger(eventName);
            return true;
        }
        if (!force && String(el.value ?? '') === String(value)) return true;
        el.value = String(value);
        const EventCtor = doc.defaultView?.Event ?? globalThis.Event;
        el.dispatchEvent(new EventCtor(eventName, { bubbles: true }));
        return true;
    }

    /**
     * 模型字段写入。custom 是文本输入，直接 val+trigger('input')；
     * claude 是原生 select，onModelChange 会做 '-v'→'-' 改写并把空值回退为默认 Claude 模型
     * （都会造成 body.model ≠ 绑定 modelId），因此仅当下拉包含目标选项且值不含 '-v' 时走原生
     * change，否则只写 oai_settings 活引用（服务端每请求覆写 body.model，显示值不参与判定）。
     */
    function writeModelField(decision) {
        const ctx = safeContext();
        if (!ctx) return;
        if (decision.modelField === 'custom_model') {
            setField('#custom_model_id', decision.modelId, 'input');
            return;
        }
        const select = doc?.querySelector('#model_claude_select');
        const hasOption = Boolean(select && [...select.options].some((o) => o.value === decision.modelId));
        const safeForNative = hasOption && !String(decision.modelId).includes('-v');
        if (safeForNative) {
            setField('#model_claude_select', decision.modelId, 'change');
        } else if (select) {
            writing = true;
            try {
                jquery()?.(select).val(decision.modelId); // 仅同步显示，不触发 onModelChange 改写
                if (ctx.chatCompletionSettings) ctx.chatCompletionSettings.claude_model = decision.modelId;
                ctx.saveSettingsDebounced?.();
            } finally {
                writing = false;
            }
        }
    }

    function safeContext() {
        try {
            return host.getContext();
        } catch {
            return null;
        }
    }

    /** 当前 scope（设置内标记用）；runId 为 0（尚无生成请求）时按 1 落一个完整合法标记。 */
    function currentScope() {
        const ctx = safeContext();
        return buildScope(
            characterKeyOf(ctx ?? {}),
            chatKeyOf(ctx?.chatId),
            runState.runId > 0 ? runState.runId : 1,
        );
    }

    /**
     * 投影写入（或资格缺失时的清空）。绝不写任何密钥字段 / api key 输入框。
     * 只清空标记承载字段里以 vc-go:// 开头的值（投影自己写入的），不动用户手工 URL。
     */
    function applyProjection() {
        const ctx = safeContext();
        if (!ctx?.chatCompletionSettings) return;
        const oai = ctx.chatCompletionSettings;
        writing = true;
        try {
            const decision = state.decision;
            if (decision?.eligible && state.phase === 'ready') {
                const marker = settingsMarkerFor(decision, currentScope());
                // 写入顺序：标记 / 模型 / 参数先落（进 oai_settings 持久状态），main_api 与
                // source 的 change 最后切 —— ST 在 main_api / source 变更时会发起连接检查，
                // 必须让它读到完整 vc-go:// 标记才能经桥真实取到模型列表并连上（否则
                // no_connection 会隐藏发送键，用户需手动点连接）。三协议 main_api 均为
                // 'openai'（#main_api 无 claude 选项）；setField 幂等，不重复 trigger。
                if (decision.markerField === 'custom_url') {
                    setField('#custom_api_url_text', marker, 'input');
                    if (String(oai.reverse_proxy ?? '').startsWith(MARKER_SCHEME)) {
                        setField('#openai_reverse_proxy', '', 'input');
                    }
                } else {
                    setField('#openai_reverse_proxy', marker, 'input');
                    if (String(oai.custom_url ?? '').startsWith(MARKER_SCHEME)) {
                        setField('#custom_api_url_text', '', 'input');
                    }
                }
                writeModelField(decision);
                setField('#openai_max_context', decision.contextWindowTokens, 'input');
                setField('#openai_max_tokens', decision.maxOutputTokens, 'input');
                if (decision.pinned.temperature !== undefined) {
                    setField('#temp_openai', decision.pinned.temperature, 'input');
                }
                if (decision.pinned.topP !== undefined) {
                    setField('#top_p_openai', decision.pinned.topP, 'input');
                }
                if (decision.source === 'custom') {
                    const plan = reasoningEffortWritePlan(decision.pinned.reasoningEffort ?? 'auto');
                    if (plan?.kind === 'native-option') {
                        setField(plan.selector, plan.value, plan.eventName);
                        oai.reasoning_effort = plan.value;
                    } else if (plan && String(oai.reasoning_effort ?? '') !== plan.value) {
                        // 扩展等级不在原生六档内：直写活引用（幂等），不 trigger 原生 select；
                        // saveSettingsDebounced 在本函数尾部统一调用。
                        oai.reasoning_effort = plan.value;
                    }
                }
                // 标记与参数已就位：main_api 的原生 change 只切族与面板（openai 分支不发起
                // 请求，script.js changeMainAPI），保留 change 触发；source 绝不能 trigger
                // change —— 原生处理链 openai.js:6967 会 reconnectOpenAi(:6188) 自动点
                // "连接"发起真实上游 /models 拉取，违反"保存/投影零上游请求"契约
                // （page.js 保存不自动拉取/试连/生成、MASTER_PLAN:103）。只写 select 值与
                // oai_settings 活引用；连接由用户显式点击"连接"完成。
                setField('#main_api', decision.mainApi, 'change');
                const sourceSelect = doc?.querySelector('#chat_completion_source');
                if (sourceSelect && String(sourceSelect.value ?? '') !== decision.source) {
                    const $$ = jquery();
                    if ($$) $$(sourceSelect).val(decision.source);
                    else sourceSelect.value = decision.source;
                }
                oai.chat_completion_source = decision.source;
            } else if (state.phase === 'ready') {
                // 目录明确判定不满足资格：只清标记字段，保留模型文本与用户其他设置。
                if (String(oai.custom_url ?? '').startsWith(MARKER_SCHEME)) setField('#custom_api_url_text', '', 'input');
                if (String(oai.reverse_proxy ?? '').startsWith(MARKER_SCHEME)) setField('#openai_reverse_proxy', '', 'input');
            }
            ctx.saveSettingsDebounced?.();
        } finally {
            writing = false;
        }
        evaluateDrift();
    }

    function evaluateDrift() {
        const ctx = safeContext();
        if (!ctx?.chatCompletionSettings || !state.decision?.eligible || state.phase !== 'ready') {
            state.drifts = [];
        } else {
            state.drifts = diffProjection(ctx.chatCompletionSettings, state.decision);
        }
        renderBanner();
    }

    function onManagedEdit(ev) {
        if (writing) return;
        const target = ev.target;
        if (!target || typeof target.matches !== 'function') return;
        if (!target.matches(MANAGED_EDIT_SELECTORS)) return;
        evaluateDrift();
    }

    function onSettingsReady(generateData) {
        try {
            if (!state.decision?.eligible || state.phase !== 'ready') return;
            advanceRunState(runState, isToolContinuation(generateData?.messages));
            const ctx = safeContext();
            const scope = buildScope(characterKeyOf(ctx ?? {}), chatKeyOf(ctx?.chatId), runState.runId);
            rewriteGenerateData(generateData, state.decision, scope);
            // getReasoningEffort 已把 CUSTOM 的 max/min 收成 high/low；这里按界面值写回。
            // 注册早于 memory.attach / attachCompanionIdentity / story.install，后三者不改该字段。
            restoreManagedReasoningEffort(generateData, state.decision, ctx?.chatCompletionSettings);
        } catch {
            // emit 会吞 handler 异常；此处再自保一次，绝不打断生成链。
        }
    }

    function onChatChanged() {
        try {
            resetRunState(runState);
            applyProjection(); // chatKey 变化 → 设置内标记的 scope 同步刷新
        } catch {
            // 同上：切换会话路径上的任何异常都不外抛。
        }
    }

    function renderBanner() {
        if (!doc) return;
        const panel = doc.querySelector(MARKER_HOST_PANEL);
        if (!panel) return;
        const model = bannerModel({
            phase: state.phase === 'error' ? 'error' : (state.phase === 'ready' ? 'ready' : 'pending'),
            decision: state.phase === 'ready' ? state.decision : null,
            drifts: state.drifts,
            loadError: state.loadError,
        });
        let el = doc.getElementById(BANNER_ID);
        if (!el) {
            el = doc.createElement('div');
            el.id = BANNER_ID;
            panel.prepend(el);
        }
        el.className = `vcfg-banner vcfg-banner-${model.phase}`;
        const icons = { ready: 'fa-circle-check', pending: 'fa-triangle-exclamation', drift: 'fa-code-compare' };
        el.innerHTML = `
            <div class="vcfg-banner-main">
                <i class="fa-solid ${icons[model.phase]}"></i>
                <div>
                    <p class="vcfg-banner-title">${escHtml(model.title)}</p>
                    <p class="vcfg-banner-detail">${escHtml(model.detail)}</p>
                    <p class="vcfg-banner-meta">${escHtml(BANNER_TEST_NOTE)}</p>
                </div>
            </div>
            <div class="vcfg-banner-actions">
                ${model.actions.includes('reproject') ? '<button type="button" class="vcfg-banner-btn" data-vcfg-action="reproject">恢复为模型页设置</button>' : ''}
                ${model.actions.includes('open-settings') ? '<button type="button" class="vcfg-banner-btn" data-vcfg-action="open-settings">打开模型设置</button>' : ''}
            </div>`;
        el.querySelector('[data-vcfg-action="reproject"]')?.addEventListener('click', () => {
            applyProjection();
        });
        el.querySelector('[data-vcfg-action="open-settings"]')?.addEventListener('click', () => {
            try {
                host.openModelSettings();
            } catch {
                // 打开页面失败不阻断横幅其余功能。
            }
        });
    }

    async function refresh() {
        state.phase = 'loading';
        renderBanner();
        try {
            const [purposes, providers] = await Promise.all([
                host.fetchPurposes(),
                host.fetchProviders(),
            ]);
            state.decision = resolveForegroundProjection(purposes, providers);
            state.phase = 'ready';
            state.loadError = null;
        } catch (err) {
            // 目录加载失败：不动已投影的设置（可能是瞬时故障），横幅降级为待配置并说明错误。
            state.decision = null;
            state.phase = 'error';
            state.loadError = err?.message ?? '服务暂时不可用';
        }
        applyProjection();
        renderBanner();
    }

    function bindListeners() {
        if (listenersBound || !doc) return;
        const ctx = safeContext();
        if (!ctx?.eventSource || !ctx?.eventTypes) {
            console.warn('[vc-projection] ST 事件接口不可用，投影事件接线未完成');
            return;
        }
        ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
        ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, onChatChanged);
        doc.addEventListener('input', onManagedEdit);
        doc.addEventListener('change', onManagedEdit);
        listenersBound = true;
    }

    return {
        init() {
            bindListeners();
            return refresh();
        },
        refresh,
        /** 页面保存目录成功后的回调（index.js 经 page controller.onCatalogSaved 接入）。 */
        onCatalogSaved() {
            return refresh();
        },
        /** 恢复为模型页设置（横幅按钮同款入口，供外部诊断调用）。 */
        reproject() {
            applyProjection();
        },
        _state: state, // 仅 harness / 测试观察用，不作为产品接口
    };
}
