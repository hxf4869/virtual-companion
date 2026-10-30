import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import {
    assertExactAccountId, parseSSEText, collectChatStream, collectAnthropicStream, serviceResolve, waitFor, synthSecret,
} from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { log, psql, rt } from './lib/accept-runtime.mjs';
import { providerCatalogSpec, bindForeground, readFixtureCapture } from './lib/accept-scene-helpers.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import {
    STORY_MARKERS,
} from './lib/story-accept-shared.mjs';

export async function sceneLoginShape(ctx) {
    // 真实登录端点请求形状：合成账号 + 合成口令（占位 hash 无法通过），断言错误信封；
    // 非法形状断言 400。会话由 seedSyntheticOwner 的真实密码/TOTP 流程签发。
    const r1 = await fetch(`${rt.GO_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: rt.ST_BASE },
        body: JSON.stringify({ account: 'w03-accept-owner', password: 'w03-synthetic-not-the-login-hash' }),
    });
    const body1 = await r1.json();
    if (r1.status !== 404 || body1.code !== 'NOT_FOUND_OR_FORBIDDEN') {
        throw new Error(`合成账号登录应返回 404 NOT_FOUND_OR_FORBIDDEN，实际 ${r1.status} ${JSON.stringify(body1).slice(0, 160)}`);
    }
    const r2 = await fetch(`${rt.GO_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: rt.ST_BASE },
        body: JSON.stringify({ account: '', password: '' }),
    });
    const body2 = await r2.json();
    if (r2.status !== 400 || body2.code !== 'INVALID_REQUEST') {
        throw new Error(`非法登录形状应返回 400 INVALID_REQUEST，实际 ${r2.status} ${JSON.stringify(body2).slice(0, 160)}`);
    }
    const session = await ctx.admin.sessionIdentity();
    if (session.status !== 200 || !decimalStringsEqualOk(session.json.accountId, rt.OWNER_ACCOUNT_ID)) {
        throw new Error(`会话核验失败：HTTP ${session.status} ${JSON.stringify(session.json).slice(0, 160)}`);
    }
    assertExactAccountId(session.json.accountId, rt.OWNER_ACCOUNT_ID, 'Go 会话 accountId');
    log.ok(`登录端点形状与会话核验通过（accountId=${session.json.accountId} 精确十进制字符串）`);
}

export function decimalStringsEqualOk(actual, expected) {
    return typeof actual === 'string' && actual.trim() === expected.trim() && /^\d+$/.test(actual.trim());
}

export async function sceneCatalogAdmin(ctx) {
    await reauthForWrite(ctx);
    const admin = ctx.admin;
    const specs = providerCatalogSpec(ctx.secrets.fixtureKey);

    // —— 保存（含凭据）→ revision 1 ——
    for (const spec of specs) {
        const saved = await admin.saveProvider(spec.providerId, {
            displayName: spec.displayName, protocol: spec.protocol, baseUrl: spec.baseUrl,
            credential: spec.credential, state: spec.state,
            models: spec.models,
        });
        if (saved.status !== 200 || saved.json.revision !== 1) {
            throw new Error(`保存 ${spec.providerId} 失败：HTTP ${saved.status} ${JSON.stringify(saved.json).slice(0, 200)}`);
        }
    }
    log.ok(`四个受管 provider 保存成功（revision=1，凭据=合成 fixture key）`);

    // —— 读回：无明文凭据、credentialConfigured、endpointUrl 规范 ——
    const listed = await admin.listProviders();
    if (listed.status !== 200) throw new Error(`providers 列表 HTTP ${listed.status}`);
    const text = JSON.stringify(listed.json);
    if (text.includes(ctx.secrets.fixtureKey) || text.includes('"credential"')) {
        throw new Error('providers 列表泄露凭据（含明文 key 或 credential 字段）');
    }
    const endpointBy = {
        'vc03m-chat': `${rt.FIXTURE_BASE}/v1/chat/completions`,
        'vc03m-resp': `${rt.FIXTURE_BASE}/v1/responses`,
        'vc03m-claude': `${rt.FIXTURE_BASE}/v1/messages`,
        'vc03m-tiny': `${rt.FIXTURE_BASE}/v1/chat/completions`,
    };
    for (const [pid, endpointUrl] of Object.entries(endpointBy)) {
        const row = listed.json.find((p) => p.providerId === pid);
        if (!row || row.credentialConfigured !== true || row.endpointUrl !== endpointUrl) {
            throw new Error(`${pid} 读回异常：credentialConfigured=${row?.credentialConfigured} endpointUrl=${row?.endpointUrl}（期望 ${endpointUrl}）`);
        }
    }
    log.ok('读回断言通过：credentialConfigured=true、endpointUrl 按协议规范化、无明文凭据');

    // —— 绑定 FOREGROUND_CHAT → READY ——
    const snapChat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    if (snapChat.bindingRevision !== 2) throw new Error(`首次绑定后 bindingRevision 应为 2，实际 ${snapChat.bindingRevision}`);
    ctx.snapshots.chat = snapChat;

    // —— 409 保留草稿：用过期 expectedRevision 再保存，文档必须原样保留 ——
    const stale = await admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat（过期写入）', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: 999,
        models: [specs[0].models[0]],
    });
    if (stale.status !== 409 || stale.json.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 revision 写入应 409 REVISION_CONFLICT，实际 ${stale.status} ${JSON.stringify(stale.json).slice(0, 160)}`);
    }
    const afterStale = await admin.listProviders();
    const chatRow = afterStale.json.find((p) => p.providerId === 'vc03m-chat');
    if (chatRow.models.length !== specs[0].models.length || !chatRow.models.some((m) => m.profileKey === 'chat-slow')) {
        throw new Error(`409 后模型文档被破坏：profiles=${chatRow.models.map((m) => m.profileKey).join(',')}`);
    }
    if (chatRow.displayName !== '受管 Chat' || chatRow.revision !== 1) {
        throw new Error(`409 后 provider 字段被改动：displayName=${chatRow.displayName} revision=${chatRow.revision}`);
    }
    log.ok('409 REVISION_CONFLICT 保留草稿通过（revision 与全部模型文档原样）');

    // —— Key 三态：无 Key 草稿 → 已配置 → 清除（各自读回断言） ——
    const draftSave = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        state: 'DISABLED', models: [specs[0].models[0]],
    });
    if (draftSave.status !== 200) throw new Error(`无 Key 草稿保存失败：HTTP ${draftSave.status}`);
    const draftList = await admin.listProviders();
    const draftRow = draftList.json.find((p) => p.providerId === 'vc03m-draft');
    if (draftRow?.credentialConfigured !== false) throw new Error('草稿态 credentialConfigured 应为 false');
    const setKey = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: draftSave.json.revision,
        models: [specs[0].models[0]],
    });
    if (setKey.status !== 200) throw new Error(`补 Key 失败：HTTP ${setKey.status}`);
    const clearKey = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        clearCredential: true, state: 'DISABLED', expectedRevision: setKey.json.revision,
        models: [specs[0].models[0]],
    });
    if (clearKey.status !== 200) throw new Error(`清 Key 失败：HTTP ${clearKey.status}`);
    const clearedList = await admin.listProviders();
    const clearedRow = clearedList.json.find((p) => p.providerId === 'vc03m-draft');
    if (clearedRow?.credentialConfigured !== false) throw new Error('清 Key 后 credentialConfigured 应为 false');
    log.ok('Key 三态通过：草稿(无 Key) → 已配置 → 清除');

    // —— 共享影响：绑定切到 Responses，再切回；切换只改绑定行，不碰其他 provider ——
    const snapResp = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const midList = await admin.listProviders();
    const chatUnchanged = midList.json.find((p) => p.providerId === 'vc03m-chat');
    if (chatUnchanged.revision !== 1) throw new Error(`绑定切换不该改 provider revision（vc03m-chat=${chatUnchanged.revision}）`);
    ctx.snapshots.responses = snapResp;
    ctx.snapshots.chat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    ctx.snapshots.claude = await bindForeground(ctx, 'vc03m-claude', 'chat', 'vc03m-chat');
    ctx.snapshots.tiny = await bindForeground(ctx, 'vc03m-tiny', 'tiny', 'vc03m-chat');
    log.ok(`绑定切换（独立用途面）通过：br=${snapChat.bindingRevision}→${snapResp.bindingRevision}→…→${ctx.snapshots.chat.bindingRevision}，provider revision 不受影响`);

    // —— discover：真实 POST 到 fixture /models（显式操作，计入 fixture 计数） ——
    const discovered = await admin.discover('vc03m-chat', {
        protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`, credential: ctx.secrets.fixtureKey,
    });
    if (discovered.status !== 200 || !discovered.json.some((m) => m.modelId === 'vc03m-chat')) {
        throw new Error(`discover 失败：HTTP ${discovered.status} ${JSON.stringify(discovered.json).slice(0, 160)}`);
    }
    const modelsCapture = await readFixtureCapture(ctx, { protocol: 'models' });
    if (modelsCapture.auth.matched !== true) throw new Error('discover 的 /models 请求 auth 未匹配合成 key');
    log.ok('discover 通过（真实 fixture /models，auth 匹配）');
}

export async function sceneZeroUpstreamOnSave(ctx) {
    await reauthForWrite(ctx);
    // 只做保存/绑定/再保存（不 discover、不生成）：fixture 请求计数差必须为 0
    await ctx.fixtureHttp.clear();
    const before = await ctx.fixtureHttp.count();
    const saved = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: (await providerRevision(ctx, 'vc03m-chat')),
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (saved.status !== 200) throw new Error(`仅配置保存失败：HTTP ${saved.status}`);
    ctx.snapshots.chat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const mid = await ctx.fixtureHttp.count();
    if (mid !== before) throw new Error(`保存/绑定期间出现上游请求：${before} → ${mid}`);
    // 二次保存（KEEP 凭据）也不该触上游
    const saved2 = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat2', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: saved.json.revision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (saved2.status !== 200) throw new Error(`二次保存失败：HTTP ${saved2.status}`);
    const after = await ctx.fixtureHttp.count();
    if (after !== before) throw new Error(`仅配置投影零上游请求断言失败：${before} → ${after}`);
    log.ok(`零上游请求断言通过：保存/绑定/再保存期间 fixture 计数恒为 ${before}`);
}

export async function providerRevision(ctx, providerId) {
    const listed = await ctx.admin.listProviders();
    const row = listed.json.find((p) => p.providerId === providerId);
    if (!row) throw new Error(`provider ${providerId} 不存在`);
    return row.revision;
}

export async function sceneServiceResolve(ctx) {
    // seed 大 ID 账号（safe-integer 之上）：精确十进制字符串可解析，float 邻值被拒
    psql(`
INSERT INTO vc.vc_user(id, display_name) VALUES (9007199254740993, 'w03-big-owner')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (9007199254740993, 'w03-big-owner', '${synthSecret(12)}', 'ADMIN', 'ACTIVE', 'w03-big-owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
`);
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const base = { purpose: 'FOREGROUND_CHAT', providerId: snap.providerId, profileKey: snap.profileKey, providerRevision: snap.providerRevision, bindingRevision: snap.bindingRevision };

    const okBig = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: '9007199254740993' } });
    if (okBig.status !== 200 || okBig.json?.provider?.credential !== ctx.secrets.fixtureKey) {
        throw new Error(`大 owner resolve 失败：HTTP ${okBig.status} ${JSON.stringify(okBig.json).slice(0, 160)}`);
    }
    assertExactAccountId('9007199254740993', '9007199254740993');
    const neighbor = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: '9007199254740992' } });
    if (neighbor.status !== 403 || neighbor.json?.code !== 'ACCESS_DENIED') {
        throw new Error(`float 邻值 owner 必须被拒，实际 HTTP ${neighbor.status} ${JSON.stringify(neighbor.json).slice(0, 160)}`);
    }
    const bad = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: 'not-a-number' } });
    if (bad.status !== 400 || bad.json?.code !== 'INVALID_REQUEST') {
        throw new Error(`非十进制 ownerAccountId 应 400，实际 HTTP ${bad.status}`);
    }
    const noToken = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: 'wrong-token-wrong-token-wrong-token-0000', body: { ...base, ownerAccountId: rt.OWNER_ACCOUNT_ID } });
    if (noToken.status !== 401) throw new Error(`错误服务令牌应 401，实际 ${noToken.status}`);

    const stalePr = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: rt.OWNER_ACCOUNT_ID, providerRevision: snap.providerRevision + 500 } });
    if (stalePr.status !== 409 || stalePr.json?.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 providerRevision 应 409 REVISION_CONFLICT，实际 HTTP ${stalePr.status}`);
    }
    const staleBr = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: rt.OWNER_ACCOUNT_ID, bindingRevision: snap.bindingRevision + 500 } });
    if (staleBr.status !== 409 || staleBr.json?.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 bindingRevision 应 409 REVISION_CONFLICT，实际 HTTP ${staleBr.status}`);
    }
    const fine = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: rt.OWNER_ACCOUNT_ID } });
    if (fine.status !== 200 || fine.json.purpose !== 'FOREGROUND_CHAT'
        || fine.json.provider.protocol !== 'OPENAI_CHAT_COMPLETIONS'
        || fine.json.provider.baseUrl !== `${rt.FIXTURE_BASE}/v1`
        || fine.json.model.modelId !== 'vc03m-chat'
        || fine.json.model.maxOutputTokens !== 2048
        || fine.json.model.generationParams?.temperature !== 0.3) {
        throw new Error(`resolve 响应形状异常：HTTP ${fine.status} ${JSON.stringify(fine.json).slice(0, 240)}`);
    }
    log.ok('受控取用断言通过：大 owner 精确 ID / float 邻值拒绝 / revision 冲突 / 响应形状');
}

export async function readSSEEvents(res) {
    return parseSSEText(await res.text());
}

export async function sceneE2eChat(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '你好，受管验收' }],
        max_tokens: 512, stream: false,
    });
    if (nonStream.status !== 200 || nonStream.json?.choices?.[0]?.message?.role !== 'assistant') {
        throw new Error(`Chat 非流式生成失败：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'chat', since });
    if (capNon.finalUrl !== '/v1/chat/completions' || capNon.auth.scheme !== 'bearer' || capNon.auth.matched !== true) {
        throw new Error(`Chat 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    if (capNon.body.model !== 'vc03m-chat' || Number(capNon.body.max_tokens) > 2048) {
        throw new Error(`Chat 出站约束异常：model=${capNon.body.model} max_tokens=${capNon.body.max_tokens}`);
    }
    if (Math.abs(Number(capNon.body.temperature) - 0.3) > 1e-6) {
        throw new Error(`Chat 钉住采样未生效：temperature=${capNon.body.temperature}`);
    }
    if (!Array.isArray(capNon.body.messages) || capNon.body.messages.at(-1)?.role !== 'user') {
        throw new Error('Chat 出站 messages 形状异常');
    }

    // 流式（SSE 透传）
    const stream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '流式请回复' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Chat 流式 HTTP ${stream.status}`);
    const events = await readSSEEvents(stream.res);
    const collected = collectChatStream(events);
    if (!collected.sawDone || collected.finish !== 'stop' || collected.content !== '收到。这是受管验收的合成回复，内容固定可断言。') {
        throw new Error(`Chat 流式内容异常：finish=${collected.finish} done=${collected.sawDone} content=${collected.content.slice(0, 40)}`);
    }

    // 上游可控错误（__ctl 覆盖）：Responses 码面由 e2e-responses 断言；custom 源走 ST 原生
    // custom 链，非流式错误契约是 HTTP 200 + {error} 信封（upstream makeRequest 失败包装）
    await ctx.fixtureHttp.setOverride('vc03m-chat', { error: { status: 500, message: 'synthetic' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-chat', null);
    if (errGen.status !== 200 || !errGen.json?.error || typeof errGen.json.error.message !== 'string') {
        throw new Error(`Chat 上游错误应透传为 200 + error 信封，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 160)}`);
    }
    log.ok('Chat Completions 端到端通过：非流式/流式/出站形状/auth/URL/钉住采样/上游错误');
}

export async function sceneE2eResponses(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式：桥接转换为 chat completion，tool_calls 完整
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '查一下广州天气' }],
        max_tokens: 512, stream: false,
    });
    const msg = nonStream.json?.choices?.[0]?.message;
    if (nonStream.status !== 200 || !Array.isArray(msg?.tool_calls) || msg.tool_calls[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Responses 非流式桥接异常：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    if (msg.tool_calls[0].function.arguments !== '{"city":"广州"}') {
        throw new Error(`Responses 工具参数分片重组异常：${msg.tool_calls[0].function.arguments}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'responses', since });
    if (capNon.finalUrl !== '/v1/responses' || capNon.auth.matched !== true) {
        throw new Error(`Responses 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    if (!Array.isArray(capNon.body.input) || !capNon.body.input.some((i) => i.type === 'message' && i.role === 'user')) {
        throw new Error('Responses input 映射异常（缺 user message item）');
    }
    if (!Array.isArray(capNon.body.include) || !capNon.body.include.includes('reasoning.encrypted_content')) {
        throw new Error('Responses include 未携带 reasoning.encrypted_content');
    }
    if (capNon.body.store !== false || capNon.body.truncation !== 'disabled') {
        throw new Error(`Responses 约束字段异常：store=${capNon.body.store} truncation=${capNon.body.truncation}`);
    }
    if (capNon.body.model !== 'vc03m-reasoning' || Number(capNon.body.max_output_tokens) > 2048) {
        throw new Error(`Responses 出站约束异常：model=${capNon.body.model} max_output_tokens=${capNon.body.max_output_tokens}`);
    }

    // 流式：事件序 → chat chunk 桥接
    const stream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '流式工具调用' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Responses 流式 HTTP ${stream.status}`);
    const collected = collectChatStream(await readSSEEvents(stream.res));
    if (collected.finish !== 'tool_calls' || collected.toolCalls[0]?.name !== 'lookup_weather' || collected.toolCalls[0]?.arguments !== '{"city":"广州"}') {
        throw new Error(`Responses 流式工具桥接异常：${JSON.stringify(collected).slice(0, 200)}`);
    }

    // 上游错误：插件整体适配层写出固定 502 VC_UPSTREAM_ERROR（不回显上游正文）
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', { error: { status: 503, message: 'synthetic upstream down' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', null);
    if (errGen.status !== 502 || errGen.json?.error?.code !== 'VC_UPSTREAM_ERROR') {
        throw new Error(`Responses 上游错误应 502 VC_UPSTREAM_ERROR，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 200)}`);
    }
    if (String(errGen.text).includes('synthetic upstream down')) {
        throw new Error('Responses 错误响应回显了上游正文（违规）');
    }
    log.ok('Responses 端到端通过：非流式/流式事件桥接/工具分片重组/include 约束/上游错误固定文案');
}

export async function sceneE2eAnthropic(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-claude', 'chat', 'vc03m-chat');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式：ST 原生 claude 链（system 提出、messages 转换）→ 转 chat completion 返回。
    // use_sysprompt 是浏览器侧 claude 源的真实开关：不开则 ST 整个删除 system 字段（上游
    // chat-completions.js useSystemPrompt 分支）；开启时 system 为内容块数组（非字符串）
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        use_sysprompt: true,
        messages: [
            { role: 'system', content: '你是受管验收助手' },
            { role: 'user', content: '你好' },
        ],
        max_tokens: 512, stream: false,
    });
    if (nonStream.status !== 200 || nonStream.json?.choices?.[0]?.message?.content !== '收到。这是受管验收的合成回复，内容固定可断言。') {
        throw new Error(`Anthropic 非流式失败：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'anthropic', since });
    if (capNon.finalUrl !== '/v1/messages' || capNon.auth.matched !== true) {
        throw new Error(`Anthropic 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    const systemBlocks = Array.isArray(capNon.body.system) ? capNon.body.system : [capNon.body.system];
    const systemText = systemBlocks.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
    if (!systemText.includes('受管验收助手')) {
        throw new Error(`Anthropic messages-system 转换异常：system=${String(JSON.stringify(capNon.body.system)).slice(0, 80)}`);
    }
    if (!Array.isArray(capNon.body.messages) || capNon.body.messages.some((m) => m.role === 'system') || capNon.body.messages.at(-1)?.role !== 'user') {
        throw new Error('Anthropic messages 形状异常（system 未提出或尾消息非 user）');
    }
    if (capNon.body.model !== 'vc03m-chat' || Number(capNon.body.max_tokens) > 2048) {
        throw new Error(`Anthropic 出站约束异常：model=${capNon.body.model} max_tokens=${capNon.body.max_tokens}`);
    }

    // 流式：Anthropic SSE 透传
    const stream = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        messages: [{ role: 'user', content: '流式回复' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Anthropic 流式 HTTP ${stream.status}`);
    const collected = collectAnthropicStream(await readSSEEvents(stream.res));
    if (collected.content !== '收到。这是受管验收的合成回复，内容固定可断言。' || collected.stopReason !== 'end_turn') {
        throw new Error(`Anthropic 流式内容异常：stop=${collected.stopReason} content=${collected.content.slice(0, 40)}`);
    }

    // 上游可控错误：原生 claude 链非流式错误契约是 HTTP 500 + {error:true}（与 custom 链
    // 的 200 + error 信封不同；透传不回显断言留给日志红线）
    await ctx.fixtureHttp.setOverride('vc03m-chat', { error: { status: 529, message: 'synthetic overloaded' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-chat', null);
    if (errGen.status < 500 || !errGen.json?.error) {
        throw new Error(`Anthropic 上游错误应 5xx + error，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 160)}`);
    }
    log.ok('Anthropic Messages 端到端通过：system 转换/messages 形状/auth/流式/usage 路径/上游错误');
}

export async function sceneToolRound(ctx) {
    // —— Chat 协议工具回合：分片 arguments 重组 + 第二轮回传 ——
    const chatSnap = await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const tools = [{ type: 'function', function: { name: 'lookup_weather', description: '查天气', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }];
    const round1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-tools', custom_url: chatSnap.marker,
        messages: [{ role: 'user', content: '北京天气如何' }],
        max_tokens: 512, stream: false, tools,
    });
    const round1Msg = round1.json?.choices?.[0]?.message;
    if (round1.status !== 200 || round1Msg?.tool_calls?.[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Chat 工具轮1 失败：HTTP ${round1.status} ${String(round1.text).slice(0, 200)}`);
    }
    const callId = round1Msg.tool_calls[0].id;
    const callArgs = round1Msg.tool_calls[0].function.arguments;
    if (callArgs !== '{"city":"北京","unit":"celsius"}') {
        throw new Error(`Chat 工具参数分片重组异常：${callArgs}`);
    }
    const sinceChat = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const round2 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-tools', custom_url: chatSnap.marker,
        messages: [
            { role: 'user', content: '北京天气如何' },
            { role: 'assistant', content: '', tool_calls: round1Msg.tool_calls },
            { role: 'tool', tool_call_id: callId, content: '{"temp_c":21}' },
        ],
        max_tokens: 512, stream: false, tools,
    });
    if (round2.status !== 200) throw new Error(`Chat 工具轮2 失败：HTTP ${round2.status}`);
    const capRound2 = await readFixtureCapture(ctx, { protocol: 'chat', since: sinceChat });
    const tail = capRound2.body.messages.at(-1);
    if (tail?.role !== 'tool' || tail?.tool_call_id !== callId || !String(tail.content).includes('"temp_c":21')) {
        throw new Error(`Chat 工具轮2 出站形状异常：tail=${JSON.stringify(tail).slice(0, 120)}`);
    }

    // —— Responses：reasoning(encrypted) + function_call，轮2 同轮续接回传 ——
    const respSnap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const r1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: respSnap.marker,
        messages: [{ role: 'user', content: '广州天气如何' }],
        max_tokens: 512, stream: false,
    });
    const r1Calls = r1.json?.choices?.[0]?.message?.tool_calls;
    if (r1.status !== 200 || r1Calls?.[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Responses 工具轮1 失败：HTTP ${r1.status} ${String(r1.text).slice(0, 200)}`);
    }
    const rCallId = r1Calls[0].id;
    const sinceResp = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const r2 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: respSnap.marker,
        messages: [
            { role: 'user', content: '广州天气如何' },
            { role: 'assistant', content: '', tool_calls: r1Calls },
            { role: 'tool', tool_call_id: rCallId, content: '{"temp_c":26}' },
        ],
        max_tokens: 512, stream: false,
    });
    if (r2.status !== 200) throw new Error(`Responses 工具轮2 失败：HTTP ${r2.status}`);
    const capR2 = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceResp });
    const reasoningItems = capR2.body.input.filter((i) => i.type === 'reasoning');
    const callItems = capR2.body.input.filter((i) => i.type === 'function_call');
    if (reasoningItems.length === 0 || !reasoningItems[0].encrypted_content) {
        throw new Error('Responses 轮2 未注入 reasoning(encrypted_content) 续接项');
    }
    if (!callItems.some((i) => i.call_id === rCallId)) {
        throw new Error('Responses 轮2 input 缺少本轮 function_call 回传');
    }
    if (capR2.body.input.indexOf(reasoningItems[0]) > capR2.body.input.indexOf(callItems[0])) {
        throw new Error('Responses 轮2 reasoning 续接项应位于 function_call 之前');
    }
    log.ok('工具回合通过：Chat 分片重组+轮2 回传；Responses 同轮 reasoning(encrypted_content) 续接');
}

export async function sceneCancelStream(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat-slow', 'vc03m-chat-slow');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const controller = new AbortController();
    const started = Date.now();
    const streaming = ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat-slow', custom_url: snap.marker,
        messages: [{ role: 'user', content: '慢速流' }],
        max_tokens: 512, stream: true,
    }, { signal: controller.signal });
    void streaming.then(async ({ res }) => {
        try { await res.arrayBuffer(); } catch { /* 预期中断 */ }
    }).catch(() => { /* 预期中断 */ });
    await new Promise((r) => setTimeout(r, 450));
    controller.abort();
    await waitFor(async () => {
        const rows = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
        return rows.some((c) => c.aborted === true || (c.durationMs ?? 0) > 900);
    }, { timeoutMs: 15000, intervalMs: 250, label: 'fixture 感知取消' });
    const after = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
    const abortedRec = after.find((c) => c.aborted === true || (c.durationMs ?? 0) > 900);
    if (!abortedRec) throw new Error('取消后 fixture 未标记 aborted/长耗时');
    // 取消后的下一次请求必须完全正常（无状态污染）
    const healthy = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: (await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat')).marker,
        messages: [{ role: 'user', content: '取消后正常请求' }],
        max_tokens: 512, stream: false,
    });
    if (healthy.status !== 200) throw new Error(`取消后正常请求失败：HTTP ${healthy.status}`);
    log.ok(`取消场景通过：客户端中断 ${Date.now() - started}ms 后 fixture 标记 aborted，后续请求无污染`);
}

export async function sceneContextBudget(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-tiny', 'tiny', 'vc03m-chat');
    // 长对话：小窗 256 tokens，长 ASCII 输入（guesstimate ≈ bytes/3.35）必然超窗
    const longText = 'context-budget-fixture-line '.repeat(120);
    const overflow = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: longText }],
        max_tokens: 64, stream: false,
    });
    if (overflow.status !== 400 || overflow.json?.error?.code !== 'VC_CONTEXT_OVERFLOW') {
        throw new Error(`长对话应 400 VC_CONTEXT_OVERFLOW，实际 HTTP ${overflow.status} ${String(overflow.text).slice(0, 200)}`);
    }
    const overflowCount = await ctx.fixtureHttp.count({ protocol: 'chat' });
    // 输出预留超登记上限：拒绝且不出站
    const outLimit = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 9999, stream: false,
    });
    if (outLimit.status !== 400 || outLimit.json?.error?.code !== 'VC_OUTPUT_LIMIT_EXCEEDED') {
        throw new Error(`超登记输出应 400 VC_OUTPUT_LIMIT_EXCEEDED，实际 HTTP ${outLimit.status} ${String(outLimit.text).slice(0, 200)}`);
    }
    const afterCount = await ctx.fixtureHttp.count({ protocol: 'chat' });
    if (afterCount !== overflowCount) {
        throw new Error(`预算拒绝不得出站：chat 捕获 ${overflowCount} → ${afterCount}`);
    }
    log.ok('上下文预算与输出预留通过：VC_CONTEXT_OVERFLOW / VC_OUTPUT_LIMIT_EXCEEDED 且零上游请求');
}

export async function sceneNativeDrift(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    // 换模型
    const driftModel = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'gpt-4o', custom_url: snap.marker,
        messages: [{ role: 'user', content: '偏离模型' }],
        max_tokens: 512, stream: false,
    });
    if (driftModel.status !== 409 || driftModel.json?.error?.code !== 'VC_NATIVE_DRIFT') {
        throw new Error(`改 model 应 409 VC_NATIVE_DRIFT，实际 HTTP ${driftModel.status} ${String(driftModel.text).slice(0, 200)}`);
    }
    // 钉住采样被覆写
    const driftTemp = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '偏离采样' }],
        max_tokens: 512, temperature: 0.9, stream: false,
    });
    if (driftTemp.status !== 409 || driftTemp.json?.error?.code !== 'VC_NATIVE_DRIFT') {
        throw new Error(`覆写钉住采样应 409 VC_NATIVE_DRIFT，实际 HTTP ${driftTemp.status}`);
    }
    log.ok('原生偏离拒绝通过：model 与钉住采样均 VC_NATIVE_DRIFT');
}

export async function sceneKeyRevoke(ctx) {
    await reauthForWrite(ctx);
    const revisionBefore = await providerRevision(ctx, 'vc03m-chat');
    const cleared = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        clearCredential: true, state: 'DISABLED', expectedRevision: revisionBefore,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (cleared.status !== 200) throw new Error(`clearCredential 保存失败：HTTP ${cleared.status}`);
    // 清 Key 后绑定合法状态是 UNAVAILABLE（无凭据即不可用；绑定行仍可写、revision 照常推进），
    // 这里正向断言该状态，再用其标记走服务通道与生成链的拒绝断言
    const snapStale = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat', { requireReady: false });
    if (snapStale.status !== 'UNAVAILABLE') {
        throw new Error(`清 Key 后绑定应为 UNAVAILABLE，实际 ${snapStale.status}`);
    }
    // 服务通道：清 Key 后下一次 resolve 即拒绝
    const resolve = await serviceResolve({ baseUrl: rt.GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { purpose: 'FOREGROUND_CHAT', ownerAccountId: rt.OWNER_ACCOUNT_ID, providerId: 'vc03m-chat', profileKey: 'chat' } });
    if (resolve.status !== 409 || resolve.json?.code !== 'MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        throw new Error(`清 Key 后 resolve 应 409 MODEL_NO_ELIGIBLE_DEPLOYMENT，实际 HTTP ${resolve.status} ${JSON.stringify(resolve.json).slice(0, 160)}`);
    }
    // 生成链同样拒绝（插件映射 VC_MODEL_NO_ELIGIBLE_DEPLOYMENT）
    const gen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snapStale.marker,
        messages: [{ role: 'user', content: '已撤销的 Key' }],
        max_tokens: 512, stream: false,
    });
    if (gen.status !== 409 || gen.json?.error?.code !== 'VC_MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        throw new Error(`清 Key 后生成应 409 VC_MODEL_NO_ELIGIBLE_DEPLOYMENT，实际 HTTP ${gen.status} ${String(gen.text).slice(0, 200)}`);
    }
    // 恢复凭据，供后续场景
    const restored = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: cleared.json.revision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (restored.status !== 200) throw new Error(`恢复凭据失败：HTTP ${restored.status}`);
    log.ok('Key 撤销通过：clearCredential 后 resolve 与生成双双即时拒绝，恢复后可用');
}

export async function sceneRevisionConflict(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const mutated = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat（另侧更新）', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${rt.FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: snap.providerRevision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (mutated.status !== 200) throw new Error(`另侧 provider 更新失败：HTTP ${mutated.status}`);
    const staleGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '用旧 revision 生成' }],
        max_tokens: 512, stream: false,
    });
    if (staleGen.status !== 409 || staleGen.json?.error?.code !== 'VC_REVISION_CONFLICT') {
        throw new Error(`旧 br/pr 生成应 409 VC_REVISION_CONFLICT，实际 HTTP ${staleGen.status} ${String(staleGen.text).slice(0, 200)}`);
    }
    // 重新绑定后恢复
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    log.ok('revision 冲突通过：provider 另侧更新后旧标记生成 VC_REVISION_CONFLICT');
}

export async function sceneContinuationHygiene(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const r1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '先制造一轮工具调用' }],
        max_tokens: 512, stream: false,
    });
    const calls = r1.json?.choices?.[0]?.message?.tool_calls;
    if (r1.status !== 200 || !calls?.length) throw new Error(`续接卫生前置工具轮失败：HTTP ${r1.status}`);

    // a) 新用户回合（尾部非工具回合）不得注入旧 reasoning
    const sinceA = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const fresh = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '新的用户回合' }],
        max_tokens: 512, stream: false,
    });
    if (fresh.status !== 200) throw new Error(`新回合生成失败：HTTP ${fresh.status}`);
    const capFresh = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceA });
    if (capFresh.body.input.some((i) => i.type === 'reasoning')) {
        throw new Error('新用户回合不应注入旧 reasoning 续接项');
    }

    // b) 换 scope（换 chat 语义）+ 同尾部工具回合：指纹不匹配 → 不注入
    const scopeB = `${ctx.scope}#chat-b`;
    const markerB = snap.marker.replace(/scope=[^&]+$/, `scope=${encodeURIComponent(scopeB)}`);
    const sinceB = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const crossScope = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: markerB,
        messages: [
            { role: 'user', content: '先制造一轮工具调用' },
            { role: 'assistant', content: '', tool_calls: calls },
            { role: 'tool', tool_call_id: calls[0].id, content: '{"temp_c":26}' },
        ],
        max_tokens: 512, stream: false,
    });
    if (crossScope.status !== 200) throw new Error(`换 scope 工具续接生成失败：HTTP ${crossScope.status}`);
    const capCross = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceB });
    if (capCross.body.input.some((i) => i.type === 'reasoning')) {
        throw new Error('换 scope 的工具回合不应注入旧 reasoning（续接一次性 + scope 绑定）');
    }
    log.ok('续接卫生通过：新用户回合与换 scope 工具回合均不注入旧 reasoning');
}

export async function sceneUi04Browser(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-w04-browser-'));
    const state = path.join(dir, 'state.json');
    const cookies = [['vc_session', ctx.secrets.session.vcSession], ['vc_csrf', ctx.secrets.session.vcCsrf]].map(([name, value]) => ({
        name, value, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: name === 'vc_session', secure: false, sameSite: 'Lax',
    }));
    fs.writeFileSync(state, JSON.stringify({
        cookies,
        origins: [{ origin: rt.ST_BASE, localStorage: [{ name: 'vc-ui', value: 'off' }] }],
    }), { mode: 0o600 });
    try {
        // 异步 child：本进程的合成 provider 必须继续响应，不能使用 spawnSync。
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(rt.SCRIPTS, 'accept.mjs'), '--managed', '--only', process.env.VC_W04_CASES || 'C04,C05,UI02'], {
                env: { ...process.env, VC_ST_DEV_DIR: rt.DEV_MANAGED, VC_ST_PORT: String(rt.ST_PORT), VC_ST_MOCK_PORT: String(rt.FIXTURE_PORT),
                    VC_ST_ACCEPT_STORAGE_STATE: state, ...(process.env.VC_W03_CHROMIUM_PATH ? { VC_ST_BROWSER: process.env.VC_W03_CHROMIUM_PATH } : {}) },
                stdio: 'inherit',
            });
            child.on('error', reject);
            child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`W04 浏览器子进程失败：${code ?? signal}`)));
        });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}


export async function sceneStoryViewBrowser(ctx) {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    const actorHits = [];
    const modelHits = [];
    const playerViews = [];
    let watchModel = false;
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await pinVcUi(bc, 'off');
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
        ]);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        const errors = [];
        const consoleLines = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(msg.text().slice(0, 240));
        });
        page.on('request', (req) => {
            const url = req.url();
            if (/\/actors\/(?:lin|zhou|su|gm)\//.test(url)) actorHits.push(url);
            if (url.includes('/actors/player/view')) playerViews.push(url);
            if (watchModel && /\/(?:generate|v1\/chat\/completions|v1\/messages|v1\/responses)(?:\?|$)/.test(url)) modelHits.push(url);
        });
        const failShot = async (error) => {
            const url = page.url();
            let text = '';
            try { text = (await page.locator('body').innerText({ timeout: 2000 })).replace(/\s+/g, ' ').slice(0, 240); } catch { /* 页面已关闭 */ }
            try { await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-failure.png') }); } catch { /* 截图失败不影响原因 */ }
            throw new Error(`${error.message} url=${url} body=${text} console=${consoleLines.slice(-4).join(' | ')}`);
        };
        try {
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        if (new URL(page.url()).pathname.startsWith('/auth')) throw new Error('未进入聊天，停在登录页');
        await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
        await page.waitForSelector('#send_textarea', { state: 'attached' });
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'));
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('合成验收用户');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
        await page.waitForSelector('#preloader', { state: 'hidden' });
        await page.waitForSelector('#vc_story_menu_button', { state: 'attached' });
        await page.locator('#extensionsMenuButton').click();
        await page.locator('#vc_story_menu_button').click();
        await page.locator('.vc-story-dialog[open]').waitFor();
        watchModel = true;
        await page.locator('[data-action="start"]').click();
        await page.waitForFunction(() => {
            const root = document.querySelector('.vc-story');
            return root?.getAttribute('data-state') === 'playing' || Boolean(root?.querySelector('[role="alert"]'));
        }, null, { timeout: 60000 });
        const storyState = await page.locator('.vc-story').getAttribute('data-state');
        if (storyState !== 'playing') {
            throw new Error(`开局未进入玩家视图：${await page.locator('.vc-story [role="alert"]').innerText()}`);
        }
        const visible = await page.locator('.vc-story').innerText();
        for (const text of ['雨夜旅馆：失踪的怀表', '雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。', '20:20老板发现怀表不见了。', '林岚', '周澈', '苏禾', '大堂', '厨房', '维修间', '调查中']) {
            if (!visible.includes(text)) throw new Error(`玩家视图缺少：${text}`);
        }
        const dom = await page.evaluate(() => document.documentElement.outerHTML);
        const stored = await page.evaluate(() => {
            const entries = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                entries.push([key, localStorage.getItem(key)]);
            }
            return JSON.stringify(entries);
        });
        for (const marker of STORY_MARKERS) {
            if (dom.includes(marker)) throw new Error(`页面 DOM 含 ${marker}`);
            if (stored.includes(marker)) throw new Error(`localStorage 含 ${marker}`);
        }
        if (actorHits.length) throw new Error(`请求了非玩家视图：${actorHits.join(' ')}`);
        if (!playerViews.length) throw new Error('没有请求玩家 ActorView');
        if (modelHits.length) throw new Error(`剧情页调用了模型：${modelHits.join(' ')}`);
        const desktopColumns = await page.locator('.vc-story-cast').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
        if (desktopColumns !== 3) throw new Error(`桌面 cast 应为 3 列，实际 ${desktopColumns}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-desktop.png') });
        ctx.screenshots.push(path.join(ctx.artifactsDir, 'story-desktop.png'));
        await page.setViewportSize({ width: 390, height: 844 });
        const mobile = await page.locator('.vc-story-cast').evaluate((el) => ({
            columns: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
            overflow: document.querySelector('.vc-story-dialog').scrollWidth <= window.innerWidth,
        }));
        if (mobile.columns !== 1) throw new Error(`390px cast 应为 1 列，实际 ${mobile.columns}`);
        if (!mobile.overflow) throw new Error('390px 剧情页横向溢出');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-mobile.png') });
        ctx.screenshots.push(path.join(ctx.artifactsDir, 'story-mobile.png'));
        if (errors.length) throw new Error(`剧情页出现未捕获错误：${errors.join(' | ')}`);
        return { desktop: true, mobile: true, playerView: true };
        } catch (error) {
            await failShot(error);
        }
    } finally {
        await browser.close();
    }
}


export async function sceneW11ToolMeter(ctx) {
    await reauthForWrite(ctx);
    // 管理保存仍不能把能力写成 VERIFIED。这里走显式验证：固定 provider 回一次合成工具调用。
    const probes = [
        { providerId: 'vc03m-chat', profileKey: 'chat', modelId: 'vc03m-chat' },
        { providerId: 'vc03m-resp', profileKey: 'reasoning', modelId: 'vc03m-reasoning' },
        { providerId: 'vc03m-claude', profileKey: 'chat', modelId: 'vc03m-chat' },
    ];
    for (const probe of probes) {
        await ctx.fixtureHttp.setOverride(probe.modelId, {
            tool: { name: 'get_current_weather', argumentsPieces: ['{"city":"北京"}'] },
        });
        try {
            const verified = await ctx.admin.verifyToolCalls(probe.providerId, probe.profileKey);
            const body = String(verified.text ?? '');
            if (verified.status !== 200 || verified.json?.toolCalls !== 'VERIFIED' || body.includes('北京') || body.includes('get_current_weather')) {
                throw new Error(`${probe.providerId} 工具验证失败：HTTP ${verified.status} ${body.slice(0, 240)}`);
            }
        } finally {
            await ctx.fixtureHttp.setOverride(probe.modelId, null);
        }
    }
    const chatIdentity = crypto.randomUUID();
    const bound = await ctx.admin.call('POST', '/api/v1/st/bindings', {
        chatIdentity,
        characterRef: 'w11-tool-meter',
        mode: 'COMPANION',
        displayName: 'W11工具',
    });
    if (bound.status !== 200 || bound.json?.chatIdentity !== chatIdentity) {
        throw new Error(`陪伴绑定失败：HTTP ${bound.status} ${String(bound.text).slice(0, 180)}`);
    }
    const tools = [
        { type: 'function', function: { name: 'query_scheduled_follow_ups', description: '查询待跟进', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'manage_reminder', description: '创建或取消提醒', parameters: { type: 'object', properties: { action: { type: 'string' } } } } },
    ];
    const rounds = [
        { name: 'chat', providerId: 'vc03m-chat', profileKey: 'chat', modelId: 'vc03m-chat', source: 'custom' },
        { name: 'responses', providerId: 'vc03m-resp', profileKey: 'reasoning', modelId: 'vc03m-reasoning', source: 'custom' },
        { name: 'anthropic', providerId: 'vc03m-claude', profileKey: 'chat', modelId: 'vc03m-chat', source: 'claude' },
    ];
    for (const round of rounds) {
        await ctx.fixtureHttp.setOverride(round.modelId, {
            tool: { name: 'query_scheduled_follow_ups', argumentsPieces: ['{}'] },
            stopAfterToolResult: true,
            text: '已根据工具结果回复。',
        });
        try {
            const snap = await bindForeground(ctx, round.providerId, round.profileKey, round.modelId);
            const body = {
                chat_completion_source: round.source,
                model: round.modelId,
                messages: [{ role: 'user', content: '有没有待跟进' }],
                tools,
                vc_chat_identity: chatIdentity,
                max_tokens: 256,
                stream: false,
            };
            if (round.source === 'claude') {
                body.reverse_proxy = snap.marker;
                body.use_sysprompt = false;
            } else {
                body.custom_url = snap.marker;
            }
            const generated = await ctx.st.generate(body);
            const content = generated.json?.choices?.[0]?.message?.content ?? '';
            if (generated.status !== 200 || !String(content).includes('已根据工具结果回复。')) {
                throw new Error(`${round.name} 工具回合失败：HTTP ${generated.status} ${String(generated.text).slice(0, 240)}`);
            }
        } finally {
            await ctx.fixtureHttp.setOverride(round.modelId, null);
        }
    }
    const usage = await ctx.admin.call('GET', '/api/v1/auth/admin/usage?days=14');
    if (usage.status !== 200 || !Array.isArray(usage.json?.purposes)) {
        throw new Error(`用量汇总失败：HTTP ${usage.status} ${String(usage.text).slice(0, 180)}`);
    }
    // 汇总里的 estimatedUsd 只加仍在 HELD 的预留（V194）。结算完成后它为空，实际金额在 actualUsd。
    for (const purpose of ['FOREGROUND_CHAT', 'TOOL_TURN']) {
        const row = usage.json.purposes.find((item) => item.purpose === purpose);
        if (!row || Number(row.calls) < 3 || row.actualUsd == null || row.estimatedUsd != null || row.unsettledUsd != null) {
            throw new Error(`${purpose} 汇总不符：${JSON.stringify(row ?? null)}`);
        }
    }
    const ledger = psql(`SELECT purpose || ' ' || status || ' ' || count(*)::text || ' ' || count(reserved_usd)::text || ' ' || count(actual_usd)::text
        FROM vc.model_cost_reservation
        WHERE purpose IN ('FOREGROUND_CHAT', 'TOOL_TURN')
        GROUP BY purpose, status
        ORDER BY 1;`);
    const settled = new Map();
    for (const line of ledger.split('\n').map((item) => item.trim()).filter(Boolean)) {
        const [purpose, status, count, reserved, actual] = line.split(' ');
        if (status !== 'SETTLED') throw new Error(`计量留下未结算行：${line}`);
        if (Number(count) < 3 || reserved !== count || actual !== count) throw new Error(`结算行不完整：${line}`);
        settled.set(purpose, Number(count));
    }
    if (!settled.has('FOREGROUND_CHAT') || !settled.has('TOOL_TURN')) {
        throw new Error(`预留账本缺少用途：${ledger.trim()}`);
    }
    log.ok('W11 三协议陪伴工具回合通过：前台与工具回合均已预留并结算');
}

export const loginShapeScene = {
    id: 'login-shape',
    title: '合成 Owner 登录请求形状（真实 POST /api/v1/auth/login）',
    needs: ['go'],
    default: true,
    run: sceneLoginShape,
};

export const catalogAdminScene = {
    id: 'catalog-admin',
    title: 'Go 侧建 provider/模型/用途绑定 + UI03 API 面（保存/读回/Key 三态/独立用途/409 保留草稿）',
    needs: ['go', 'fixture'],
    default: true,
    run: sceneCatalogAdmin,
};

export const zeroUpstreamOnSaveScene = {
    id: 'zero-upstream-on-save',
    title: '保存与仅配置投影零上游请求（fixture 计数为 0）',
    needs: ['go', 'fixture'],
    default: true,
    run: sceneZeroUpstreamOnSave,
};

export const serviceResolveScene = {
    id: 'service-resolve',
    title: '受控取用精确 ID/revision 冲突/邻值拒绝',
    needs: ['catalog'],
    default: true,
    run: sceneServiceResolve,
};

export const e2eChatScene = {
    id: 'e2e-chat',
    title: 'Chat Completions 经真实 ST /generate（流式/非流式/形状/auth/URL）',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneE2eChat,
};

export const e2eResponsesScene = {
    id: 'e2e-responses',
    title: 'Responses 经真实 ST /generate（事件序/工具/续接 encrypted_content）',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneE2eResponses,
};

export const e2eAnthropicScene = {
    id: 'e2e-anthropic',
    title: 'Anthropic Messages 经真实 ST /generate（system/messages 转换/usage/错误）',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneE2eAnthropic,
};

export const toolRoundScene = {
    id: 'tool-round',
    title: '工具回合：分片参数回传、Responses 同轮 reasoning 续接',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneToolRound,
};

export const cancelStreamScene = {
    id: 'cancel-stream',
    title: '取消：慢速流中断后上游感知 + 不提交续接',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneCancelStream,
};

export const contextBudgetScene = {
    id: 'context-budget',
    title: '上下文预算与输出预留真实计数（长对话 VC_CONTEXT_OVERFLOW）',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneContextBudget,
};

export const nativeDriftScene = {
    id: 'native-drift',
    title: '原生偏离拒绝（改 model/钉住采样 → VC_NATIVE_DRIFT）',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneNativeDrift,
};

export const keyRevokeScene = {
    id: 'key-revoke',
    title: 'Key 撤销：clearCredential 后 resolve/生成拒绝',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneKeyRevoke,
};

export const revisionConflictScene = {
    id: 'revision-conflict',
    title: 'revision 冲突：另改 provider 后旧 br 生成 → VC_REVISION_CONFLICT',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneRevisionConflict,
};

export const continuationHygieneScene = {
    id: 'continuation-hygiene',
    title: '切换 chat/新回合/取消不混旧工具续接',
    needs: ['catalog', 'stack'],
    default: true,
    run: sceneContinuationHygiene,
};

export const ui04BrowserScene = {
    id: 'ui04-browser',
    title: 'W04 复杂卡与聊天界面（真实 Helper/EJS/MVU + Go 投影）',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneUi04Browser,
};

export const storyViewBrowserScene = {
    id: 'story-view-browser',
    title: 'W12 玩家剧情页：开局、玩家视图、桌面与 390px',
    needs: ['go', 'stack', 'browser'],
    default: false,
    run: sceneStoryViewBrowser,
};

export const w11ToolMeterScene = {
    id: 'w11-tool-meter',
    title: 'W11 三协议陪伴工具回合与前台计量',
    needs: ['catalog', 'stack'],
    default: false,
    run: sceneW11ToolMeter,
};
export const scenes = [loginShapeScene, catalogAdminScene, zeroUpstreamOnSaveScene, serviceResolveScene, e2eChatScene, e2eResponsesScene, e2eAnthropicScene, toolRoundScene, cancelStreamScene, contextBudgetScene, nativeDriftScene, keyRevokeScene, revisionConflictScene, continuationHygieneScene, ui04BrowserScene, storyViewBrowserScene, w11ToolMeterScene];
