// 陪伴工具的纯描述。注册发生在扩展入口，且只在 SillyTavern 里调用 ToolManager。
// 关系与所有者只来自会话绑定，参数里不提供这两项。

export const COMPANION_TOOL_ACTION_ERROR = '工具结果只来自 Go 执行，不能在浏览器里声称完成';

export const companionToolSpecs = [
    {
        name: 'query_scheduled_follow_ups',
        displayName: '查询待跟进',
        description: '查询当前会话已绑定关系里尚未完成的跟进。不能指定关系或所有者。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'manage_reminder',
        displayName: '创建或取消提醒',
        description: '为当前会话已绑定的关系创建提醒，或取消提醒与跟进。不能指定关系或所有者。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'cancel'] },
                text: { type: 'string' },
                remindAt: { type: 'string' },
                recurrence: { type: 'string', enum: ['NONE', 'DAILY', 'WEEKLY'] },
                target: { type: 'string', enum: ['reminder', 'follow_up'] },
                reminderId: { type: 'string' },
                followUpId: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
        },
    },
];

/** shouldRegister 无参数；剧情回合不注册这两个陪伴工具。 */
export function companionToolsShouldRegister(getContext) {
    try {
        return getContext()?.chatMetadata?.vc_binding?.mode !== 'STORY';
    } catch {
        return true;
    }
}

const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 把当前聊天身份写进真正发出的 generate 体。 */
export function attachCompanionIdentity(generateData, getContext) {
    if (!generateData || typeof generateData !== 'object') return;
    let meta = {};
    try {
        meta = getContext()?.chatMetadata || {};
    } catch {
        return;
    }
    const id = meta.vc_f2?.id;
    if (typeof id === 'string' && CHAT_UUID.test(id)) generateData.vc_chat_identity = id;
    const mode = meta.vc_binding?.mode;
    if (mode === 'COMPANION' || mode === 'STORY') generateData.vc_mode = mode;
}
