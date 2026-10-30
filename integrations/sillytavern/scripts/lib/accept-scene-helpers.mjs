// 目录规格、前台绑定与夹具捕获。绑定前重新认证，不依赖前序场景已经花了多久。
import { reauthForWrite } from './reauth-write.mjs';
import { rt } from './accept-runtime.mjs';

export function providerCatalogSpec(fixtureKey) {
    const model = (profileKey, modelId, displayName, extra = {}) => ({
        profileKey, modelId, displayName,
        contextWindowTokens: 8192, maxOutputTokens: 2048,
        state: 'ENABLED',
        capabilities: { toolCalls: 'DECLARED', systemMessage: 'DECLARED' },
        reasoningLevels: [],
        generationParams: { temperature: 0.3 },
        // USD / 百万 token。保存目录时同步为账本每 1K token 0.001 / 0.002。
        pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        ...extra,
    });
    return [
        {
            providerId: 'vc03m-chat', displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${rt.FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('chat', 'vc03m-chat', 'Chat 主档'),
                model('chat-tools', 'vc03m-tools', 'Chat 工具档', { generationParams: { temperature: 0.3, topP: 0.9 } }),
                model('chat-slow', 'vc03m-chat-slow', 'Chat 慢速档'),
            ],
        },
        {
            providerId: 'vc03m-resp', displayName: '受管 Responses', protocol: 'OPENAI_RESPONSES',
            baseUrl: `${rt.FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('reasoning', 'vc03m-reasoning', 'Responses 推理+工具档', { reasoningLevels: ['low'], generationParams: { temperature: 0.3, reasoningEffort: 'low' } }),
                model('usage', 'vc03m-usage', 'Responses 用量档'),
            ],
        },
        {
            providerId: 'vc03m-claude', displayName: '受管 Claude', protocol: 'ANTHROPIC_MESSAGES',
            baseUrl: `${rt.FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('chat', 'vc03m-chat', 'Claude 主档'),
                model('tools', 'vc03m-tools', 'Claude 工具档'),
            ],
        },
        {
            providerId: 'vc03m-tiny', displayName: '受管小窗', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${rt.FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [model('tiny', 'vc03m-chat', '小窗档', { contextWindowTokens: 256, maxOutputTokens: 64 })],
        },
    ];
}

/** 把 FOREGROUND_CHAT 绑定到指定 profile，返回含最新 revision 的标记快照。
 *  requireReady=false 允许清 Key 后的 UNAVAILABLE 绑定（快照带 status 供场景断言）。 */
export async function bindForeground(ctx, providerId, profileKey, modelId, { requireReady = true } = {}) {
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`model-purposes 列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((r) => r.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失于用途列表');
    const saved = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId, profileKey, state: 'ENABLED', expectedRevision: row.revision,
    });
    if (saved.status !== 200 || (requireReady && saved.json.status !== 'READY')) {
        throw new Error(`绑定失败：HTTP ${saved.status} ${JSON.stringify(saved.json).slice(0, 200)}`);
    }
    const providers = await ctx.admin.listProviders();
    const provider = providers.json.find((p) => p.providerId === providerId);
    if (!provider) throw new Error(`provider ${providerId} 未在列表中`);
    const bindingRevision = saved.json.revision;
    const marker = `vc-go://model-purposes/FOREGROUND_CHAT?provider=${encodeURIComponent(providerId)}&profile=${encodeURIComponent(profileKey)}&pr=${provider.revision}&br=${bindingRevision}&scope=${encodeURIComponent(ctx.scope)}`;
    return { providerId, profileKey, providerRevision: provider.revision, bindingRevision, modelId, marker, status: saved.json.status };
}

/** 断言某 provider 的用途绑定当前不可用（清 Key 后）。 */
export async function readFixtureCapture(ctx, { protocol, since, index = -1 }) {
    const rows = await ctx.fixtureHttp.captures({ protocol, since });
    if (!rows.length) throw new Error(`fixture 未捕获 ${protocol} 请求`);
    return rows.at(index);
}

