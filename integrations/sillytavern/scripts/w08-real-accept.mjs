// Explicitly selected Owner-authorized real extraction sample. Credentials are
// decoded from the private ignored source in memory and never enter artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { REPO_ROOT } from './lib/paths.mjs';
import path from 'node:path';
const expect = (r, status, label) => { assert.equal(r.status, status, `${label}: HTTP ${r.status} (${r.json?.code || 'native'})`); return r.json; };

export async function sceneMemoryRealModel(ctx) {
    const lines = new TextDecoder('gb18030').decode(await fs.readFile(path.join(REPO_ROOT, 'agents.txt'))).split(/\r?\n/);
    const value = label => {
        const line = lines.find(s => s.toLowerCase().startsWith(label));
        return line?.replace(/^[^:：]*[:：]\s*/, '').trim();
    };
    const baseUrl = value('api 地址'), credential = value('api key');
    const modelId = 'cline-pass/deepseek-v4.1-flash-1017';
    assert.ok(baseUrl?.startsWith('https://') && credential && value('模型id') === modelId, '私有模型配置必须完整匹配已授权模型');
    const models = [{ profileKey: 'memory', modelId, displayName: 'Owner 实际提取验收', contextWindowTokens: 32768, maxOutputTokens: 4096,
        state: 'ENABLED', capabilities: { systemMessage: 'DECLARED' }, reasoningLevels: ['max'], generationParams: { reasoningEffort: 'max' } }];
    const spec = { displayName: 'Owner 已授权私有模型', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl, state: 'ENABLED', models };
    let provider;
    try {
        ctx.w08.seedRealEstimate();
        for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING'])
            expect(await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'w08-authorized-real-sample', granted: true }), 200, '合成账号实际提取授权');
        provider = expect(await ctx.admin.saveProvider('vc08-real', { ...spec, credential, expectedRevision: 0 }), 200, '注入私有用途配置');
        const embeddingModel = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find(m => m.name === 'qwen3-embedding:0.6b');
        assert.ok(embeddingModel);
        const previous = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
        expect(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', { model: embeddingModel.name, artifactVersion: embeddingModel.digest,
            dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2',
            state: 'ENABLED', expectedRevision: previous.status === 200 ? previous.json.revision : 0 }), 200, '绑定本机embedding');
        let purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途');
        const purpose = purposes.find(p => p.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        expect(await ctx.admin.savePurpose(purpose.purpose, { providerId: 'vc08-real', profileKey: 'memory', state: 'ENABLED', expectedRevision: purpose.revision }), 200, '启用实际提取用途');
        const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
            extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
        const card = await importSyntheticCard(st, 'W08 实际模型合成样本');
        let relationshipId, firstPreferenceId, preferenceChat;
        const inputs = ['我最喜欢喝乌龙茶，每天下午都会喝一杯。', '我改口了，我现在最喜欢喝茉莉花茶，不再喜欢乌龙茶。', '我计划下周五去厦门参加朋友婚礼。'];
        const observed = [];
        for (let n = 0; n < inputs.length; n++) {
            const identity = crypto.randomUUID(), file = `W08-real-${crypto.randomUUID()}`;
            const rows = [{ chat_metadata: { vc_f2: { id: identity, revision: 0 } } },
                { name: '合成用户', is_user: true, mes: inputs[n], send_date: '2026-10-20T20:00:00+08:00', extra: {} }];
            prepareSourceIdentities(rows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
            expect(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }), 200, '保存少量合成来源');
            const binding = expect(await ctx.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: identity, characterRef: card.avatar,
                mode: 'COMPANION', displayName: 'W08 实际提取样本', ...(relationshipId ? { relationshipId } : {}) }), 200, '绑定同一实例独立聊天');
            relationshipId = binding.relationshipId;
            expect(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [identity] }), 200, '对账并入正式队列');
            let progress;
            await waitFor(() => {
                progress = ctx.w08.realProgress();
                return progress.failed > 0 || progress.done >= n + 1;
            }, { timeoutMs: 300000, label: `第${n + 1}条实际提取完成` });
            assert.equal(progress.failed, 0, '实际提取任务失败；关闭用途并停止新增样本');
            const memories = expect(await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/memories?limit=100`), 200, '读取实际模型发布结果');
            if (n === 0) firstPreferenceId = memories.find(m => m.lifecycle === 'ACTIVE' && m.summary.includes('乌龙茶'))?.memoryId;
            if (n === 1) {
                assert.ok(firstPreferenceId, '首条偏好应被实际提取');
                assert.equal(memories.find(m => m.memoryId === firstPreferenceId)?.lifecycle, 'SUPERSEDED', '中文改口应替代旧偏好');
                preferenceChat = { identity, file };
            }
            observed.push({ phase: n + 1, active: memories.filter(m => m.lifecycle === 'ACTIVE').length,
                jasmine: memories.some(m => m.lifecycle === 'ACTIVE' && m.summary.includes('茉莉花茶')),
                wedding: memories.some(m => m.lifecycle === 'ACTIVE' && m.summary.includes('婚礼')),
                normalizedDate: memories.find(m => m.lifecycle === 'ACTIVE' && m.summary.includes('婚礼'))?.time?.eventDate || null });
        }
        const memories = expect(await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/memories?limit=100`), 200, '读取最终模型结果');
        const currentTea = memories.find(m => m.lifecycle === 'ACTIVE' && m.summary.includes('茉莉花茶'));
        assert.ok(currentTea, '中文改口应产生新的偏好');
        assert.equal(observed[2].normalizedDate, '2026-10-30', '相对日期由原始来源时间规范化');
        expect(await ctx.admin.call('DELETE', `/api/v1/memories/${currentTea.memoryId}`), 202, '遗忘实际提取结果');
        const forgotten = expect(await ctx.admin.call('GET', `/api/v1/memories/${currentTea.memoryId}`), 200, '读取即时抑制');
        assert.equal(forgotten.recallEligible, false);
        const savedPreference = expect(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: preferenceChat.file }), 200, '读回改口聊天当前版本');
        const token = savedPreference[0].chat_metadata.vc_f2;
        const recall = expect(await ctx.admin.call('POST', '/api/v1/st/memory/recall', { chatIdentity: token.id, revision: token.revision,
            enabled: true, budgetTokens: 1024 }), 200, '遗忘后正式召回');
        assert.ok(!recall.memoryIds.includes(currentTea.memoryId) && !recall.memoryIds.includes(firstPreferenceId), '被遗忘偏好与被替代旧记录不能召回');
        ctx.results.memoryRealModel = { model: modelId, reasoningEffort: 'max', sourceInputs: 3, observations: observed,
            forgottenImmediately: true, pricing: 'conservative_acceptance_estimate_not_supplier_bill', usage: ctx.w08.realUsage() };
    } finally {
        // Disable before teardown so a failed assertion cannot leave a paid
        // background path enabled. The disposable PG container is removed by
        // accept-managed; this also clears the credential while it is reachable.
        const purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途以关闭实际调用');
        const purpose = purposes.find(p => p.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        if (purpose) expect(await ctx.admin.savePurpose(purpose.purpose, { providerId: 'vc08-real', profileKey: 'memory', state: 'DISABLED', expectedRevision: purpose.revision }), 200, '关闭实际提取用途');
        if (provider) expect(await ctx.admin.saveProvider('vc08-real', { ...spec, state: 'DISABLED', clearCredential: true, expectedRevision: provider.revision }), 200, '清除临时私有凭据');
        const usage = ctx.w08.realUsage();
        ctx.results.memoryRealModel ??= { model: modelId, reasoningEffort: 'max', usage, completed: false, pricing: 'conservative_acceptance_estimate_not_supplier_bill' };
        ctx.results.memoryRealModel.usage = usage;
    }
}
