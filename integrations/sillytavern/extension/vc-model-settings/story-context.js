// W13-4：剧情回合只在 CHAT_COMPLETION_SETTINGS_READY 写入 vc_story 身份。
// 不读取 ActorView 正文，也不过滤世界书、宏或 EJS 改写；那些由服务端整段重写。
const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const ACTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const CHAT_IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function decimal(value) {
    return typeof value === 'string' && DECIMAL_ID.test(value) ? value : '';
}

function worldVersionOf(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createStoryContext({ getContext }) {
    let run = null;
    let actorId = '';

    function setRun(turn) {
        actorId = '';
        const runId = decimal(turn?.runId);
        const branchId = decimal(turn?.branchId);
        const conversationId = decimal(turn?.conversationId);
        const worldVersion = worldVersionOf(turn?.worldVersion);
        if (!turn || !runId || !branchId || !conversationId || worldVersion === null) {
            run = null;
            return;
        }
        run = { runId, branchId, conversationId, worldVersion };
    }

    // 替换当前对话角色。不累积，一次发送只有这一个 actor。
    function selectActor(next) {
        if (!run || typeof next !== 'string' || !ACTOR_ID.test(next)) return;
        actorId = next;
    }

    function clear() {
        run = null;
        actorId = '';
    }

    function currentIdentity() {
        let ctx;
        try { ctx = getContext() || {}; } catch { return null; }
        const binding = ctx.chatMetadata?.vc_binding;
        if (binding?.mode !== 'STORY' || !run || binding.conversationId !== run.conversationId) return null;
        const chatIdentity = ctx.chatMetadata?.vc_f2?.id;
        if (!actorId || typeof chatIdentity !== 'string' || !CHAT_IDENTITY.test(chatIdentity)) return null;
        return {
            runId: run.runId,
            branchId: run.branchId,
            actorId,
            worldVersion: run.worldVersion,
            chatIdentity,
        };
    }

    function attachStoryIdentity(body) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return;
        const identity = currentIdentity();
        if (!identity) {
            delete body.vc_story;
            return;
        }
        body.vc_story = identity;
    }

    // 调用方须在扩展 init 里注册。本扩展 loading_order 为 100，EJS 为 1，
    // 因此这里的 on() 排在 EJS 的 SETTINGS_READY 改写之后。不要插到队首。
    function install(eventSource, eventName) {
        eventSource.on(eventName, attachStoryIdentity);
    }

    return { setRun, selectActor, clear, install };
}
