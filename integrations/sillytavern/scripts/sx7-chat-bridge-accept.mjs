import { randomUUID } from 'node:crypto';

const root = '/api/plugins/virtual-companion/go/api/v1/chats';

function expect(condition, step) {
    if (!condition) throw new Error(`SX7 聊天桥 ${step}`);
}

async function run({ sx7Chat: { st, origin, vcCsrf, signal, sources } }) {
    await st.ensureCsrf();
    const call = async (method, path, expectedStatus, body, csrf = vcCsrf) => {
        const response = await st.call(method, path, body, { origin, vcCsrf: csrf, signal });
        expect(response.status === expectedStatus && response.json, `${method} ${path.replace(root, '/chats').replace(/\/[0-9a-f-]{36}/g, '/{id}')} HTTP ${response.status}，预期 ${expectedStatus}`);
        return response.json;
    };

    const create = {
        requestId: randomUUID(), authorityEpoch: '2', kind: 'SINGLE', mode: 'COMPANION',
        characterRef: 'sx7-synthetic-character', title: 'SX7 合成聊天',
    };
    const rejected = await call('POST', root, 403, create, '');
    expect(rejected.code === 'ACCESS_DENIED', '缺少 Go CSRF 时应由 Go 拒绝');
    const created = await call('POST', root, 201, create);
    const list = await call('GET', root, 200);
    expect(list.authorityEpoch === '2' && list.items?.length === 1 && list.items[0].chatId === created.chatId, '列表缺少合成聊天');
    const chat = `${root}/${list.items[0].chatId}`;
    const opened = await call('GET', chat + '/messages?include=chat&view=full', 200);
    expect(opened.chat?.chatId === created.chatId && opened.items?.length === 0, '打开聊天时基线异常');

    const messageId = randomUUID();
    const append = {
        requestId: randomUUID(), authorityEpoch: opened.authorityEpoch,
        messages: [{ clientMessageId: messageId, data: { mes: 'synthetic source', is_user: true, extra: { no_memory: true } } }],
    };
    const commit = await call('POST', chat + '/messages', 201, append);
    expect(commit.changed?.length === 1 && commit.changed[0].messageId === messageId, '追加回执缺少消息');
    const changes = await call('GET', `${chat}/changes?afterRevision=${opened.chatRevision}`, 200);
    const [event] = changes.items ?? [];
    expect(changes.items?.length === 1 && changes.currentRevision === commit.chatRevision &&
        changes.throughRevision === commit.chatRevision && event.operationId === commit.operationId &&
        event.changedIds?.length === 1 && event.changedIds[0] === messageId, '增量与追加回执不一致');

    const message = await call('GET', `${chat}/messages/${messageId}`, 200);
    const candidate = message.candidates?.find((candidate) => candidate.candidateId === message.selectedCandidateId);
    expect(candidate && message.data?.mes === append.messages[0].data.mes, '重新读取未找到已保存候选');
    const persisted = sources();
    const [source] = persisted;
    expect(persisted.length === 1 && source.present && !source.eligible && source.goSource &&
        source.goRevision === commit.chatRevision && source.chatId === created.chatId &&
        source.messageId === messageId && source.candidateId === candidate.candidateId &&
        source.revision === candidate.sourceRevision && source.generation === candidate.sourceGeneration &&
        source.sourceRef === `st:${created.chatId}:${messageId}:${candidate.candidateId}:${candidate.sourceRevision}:${candidate.sourceGeneration}`,
    'PostgreSQL 来源投影与选中候选或修订不一致');

    // A real bridge client must continue a nonterminal empty search window.
    // 201 newer nonmatching messages put the original match beyond 200 rows.
    for(let remaining=201;remaining>0;){
        const count=Math.min(100,remaining);
        await call('POST',chat+'/messages',201,{
            requestId:randomUUID(),authorityEpoch:opened.authorityEpoch,
            messages:Array.from({length:count},()=>({clientMessageId:randomUUID(),
                data:{mes:'synthetic nonmatching filler',is_user:true,extra:{no_memory:true}}})),
        });
        remaining-=count;
    }
    const query='?q='+encodeURIComponent('synthetic source');
    const empty=await call('GET',chat+'/messages'+query,200);
    expect(empty.items?.length===0&&empty.hasOlder&&empty.beforeCursor,'空搜索窗口缺少继续游标');
    const found=await call('GET',chat+'/messages'+query+'&before='+encodeURIComponent(empty.beforeCursor),200);
    expect(found.items?.length===1&&found.items[0].messageId===messageId&&!found.hasOlder,'空页续扫漏掉原始匹配');
}

export const sx7ChatBridgeScene = {
    id: 'sx7f-chat-bridge',
    title: 'SX7 受管管理桥本人聊天列表、打开、追加与来源增量',
    needs: ['go', 'stack'],
    default: false,
    run,
};
