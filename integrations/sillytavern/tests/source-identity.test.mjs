// W06 来源标识边界契约离线单测（node --test，已并入 scripts/check.sh 全量的 tests/*.test.mjs 通配）。
// 被测对象：../server-plugin/virtual-companion/lib/source-identity.js（生产代码，不在测试中修改）。
// 只用真实 crypto.randomUUID（lib 默认注入）与 structuredClone 驱动合同边界，不复刻实现逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    prepareSourceIdentities,
    reconcileSourceIdentities,
    sourceMessages,
} from '../server-plugin/virtual-companion/lib/source-identity.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const header = () => ({ name: 'Test Chat', create_date: '2026-10-28@00:00:00', chat_metadata: {} });
const message = (over = {}) => ({
    name: '澄夏', is_user: false, is_system: false, mes: 'hello', send_date: 't0', extra: {}, ...over,
});
const swipeMessage = (texts, selected = 0, over = {}) => message({
    mes: texts[selected],
    swipes: [...texts],
    swipe_id: selected,
    swipe_info: texts.map(() => ({ extra: {} })),
    ...over,
});
const candidateIds = (m) => m.swipe_info.map((entry) => entry.extra.vc_source.id);
const candidateRevisions = (m) => m.swipe_info.map((entry) => entry.extra.vc_source.revision);

test('prepare 为消息顶层与全部候选分配稳定 UUID，header 不分配', () => {
    const chat = [header(), message(), swipeMessage(['a', 'b'], 1)];
    prepareSourceIdentities(chat);
    const [h, single, multi] = chat;
    assert.equal('vc_message_id' in h, false);
    assert.match(single.vc_message_id, uuidPattern);
    assert.match(multi.vc_message_id, uuidPattern);
    assert.notEqual(single.vc_message_id, multi.vc_message_id);
    for (const id of candidateIds(multi)) assert.match(id, uuidPattern);
    assert.equal(new Set(candidateIds(multi)).size, 2);
    assert.equal(multi.extra.vc_source.id, candidateIds(multi)[1]); // 选中候选与顶层 extra 同一来源
    const before = [single.vc_message_id, multi.vc_message_id, ...candidateIds(multi)];
    prepareSourceIdentities(chat); // 后到保存不为同一行重新铸造身份
    assert.deepEqual([single.vc_message_id, multi.vc_message_id, ...candidateIds(multi)], before);
});

test('入站 chat 内重复 ID 被重新分配，不产生重复', () => {
    const chat = [header(), message(), message()];
    prepareSourceIdentities(chat);
    const dup = structuredClone(chat);
    dup[2].vc_message_id = dup[1].vc_message_id;
    prepareSourceIdentities(dup);
    assert.notEqual(dup[1].vc_message_id, dup[2].vc_message_id);
});

test('JSONL/分支克隆保持既有 ID，内容未变时 reconcile 幂等', () => {
    const chat = [header(), message(), swipeMessage(['a', 'b'])];
    reconcileSourceIdentities(chat, []); // 建立带 revision 的持久形态
    const persisted = structuredClone(chat);
    const branch = structuredClone(persisted); // 分支/克隆副本
    prepareSourceIdentities(branch);
    assert.equal(branch[1].vc_message_id, persisted[1].vc_message_id);
    assert.deepEqual(candidateIds(branch[2]), candidateIds(persisted[2]));
    assert.equal(reconcileSourceIdentities(branch, persisted), false);
    assert.deepEqual(candidateRevisions(branch[2]), [1, 1]);
});

test('删除前序消息不改后序消息 ID 与候选 revision', () => {
    const chat = [header(), message({ mes: 'm1' }), message({ mes: 'm2' }), swipeMessage(['a', 'b'])];
    reconcileSourceIdentities(chat, []);
    const persisted = structuredClone(chat);
    const edited = structuredClone(persisted);
    edited.splice(2, 1); // 删除 m2
    reconcileSourceIdentities(edited, persisted);
    assert.equal(edited[1].vc_message_id, persisted[1].vc_message_id);
    assert.equal(edited[1].extra.vc_source.revision, 1);
    assert.equal(edited[2].vc_message_id, persisted[3].vc_message_id);
    assert.deepEqual(candidateIds(edited[2]), candidateIds(persisted[3]));
    assert.deepEqual(candidateRevisions(edited[2]), [1, 1]);
});

test('原生 swipe 切换与删除保持候选 ID，不产生重复', () => {
    const chat = [header(), swipeMessage(['a', 'b', 'c'], 0)];
    reconcileSourceIdentities(chat, []);
    const originalIds = candidateIds(chat[1]);

    // 原生切换到候选 2：live extra 存回 swipe_info[0]，载入 swipe_info[2].extra
    const persisted = structuredClone(chat);
    const switched = structuredClone(chat);
    const m = switched[1];
    m.swipe_info[0].extra = m.extra;
    m.extra = m.swipe_info[2].extra;
    m.swipe_id = 2;
    m.mes = m.swipes[2];
    reconcileSourceIdentities(switched, persisted);
    assert.deepEqual(candidateIds(m), originalIds);
    assert.equal(m.extra.vc_source.id, originalIds[2]);
    assert.deepEqual(candidateRevisions(m), [1, 1, 1]); // 切换本身不推进

    // 原生删除候选 0：swipes/swipe_info 同步 splice，选中下标前移
    const persistedAfterSwitch = structuredClone(switched);
    m.swipes.splice(0, 1);
    m.swipe_info.splice(0, 1);
    m.swipe_id -= 1;
    reconcileSourceIdentities(switched, persistedAfterSwitch);
    assert.deepEqual(candidateIds(m), [originalIds[1], originalIds[2]]);
    assert.equal(m.extra.vc_source.id, originalIds[2]);
    assert.deepEqual(candidateRevisions(m), [1, 1]);
});

test('swipe_info 全部错误指向 live extra 时仍无重复候选 ID', () => {
    const m = swipeMessage(['a', 'b', 'c'], 0);
    const chat = [header(), m];
    m.swipe_info = [{ extra: m.extra }, { extra: m.extra }, { extra: m.extra }];
    prepareSourceIdentities(chat);
    let ids = candidateIds(m);
    assert.equal(new Set(ids).size, 3);
    assert.equal(m.extra.vc_source.id, ids[0]);
    // 已带来源的 live extra 再被错误别名到全部候选：重复被识别并重新分配
    m.swipe_info = [{ extra: m.extra }, { extra: m.extra }, { extra: m.extra }];
    prepareSourceIdentities(chat);
    ids = candidateIds(m);
    assert.equal(new Set(ids).size, 3);
    assert.equal(ids[0], m.extra.vc_source.id);
});

test('revision 以持久 JSONL 为准：纯 header 变化与客户端伪造不推进', () => {
    const chat = [header(), swipeMessage(['alpha', 'beta'], 0, {
        variables: [{ stat_data: { trust: 10 } }, { stat_data: { trust: 10 } }],
    })];
    reconcileSourceIdentities(chat, []);
    const persisted = structuredClone(chat);

    const headerOnly = structuredClone(persisted);
    headerOnly[0].chat_metadata.note = '纯 header 变化';
    headerOnly[0].create_date = '2099-01-01@00:00:00';
    reconcileSourceIdentities(headerOnly, persisted);
    assert.deepEqual(candidateRevisions(headerOnly[1]), [1, 1]);

    const forged = structuredClone(persisted);
    forged[1].extra.vc_source.revision = 999;
    forged[1].swipe_info[1].extra.vc_source.revision = 999;
    reconcileSourceIdentities(forged, persisted);
    assert.deepEqual(candidateRevisions(forged[1]), [1, 1]);
});

test('文本/name/role/hidden/no_memory/对应 MVU 变量各自推进对应候选', () => {
    const chat = [header(), swipeMessage(['alpha', 'beta'], 0, {
        variables: [{ stat_data: { trust: 10 } }, { stat_data: { trust: 10 } }],
    })];
    reconcileSourceIdentities(chat, []);
    const persisted = structuredClone(chat);

    const textChange = structuredClone(persisted);
    textChange[1].mes = 'alpha-2'; // 选中候选文本
    textChange[1].swipes[1] = 'beta-2'; // 未选中候选文本
    reconcileSourceIdentities(textChange, persisted);
    assert.deepEqual(candidateRevisions(textChange[1]), [2, 2]);

    const nameChange = structuredClone(persisted);
    nameChange[1].name = '新名字';
    reconcileSourceIdentities(nameChange, persisted);
    assert.deepEqual(candidateRevisions(nameChange[1]), [2, 2]);

    const roleChange = structuredClone(persisted);
    roleChange[1].is_user = true;
    reconcileSourceIdentities(roleChange, persisted);
    assert.deepEqual(candidateRevisions(roleChange[1]), [2, 2]);

    const hiddenChange = structuredClone(persisted);
    hiddenChange[1].is_system = true;
    reconcileSourceIdentities(hiddenChange, persisted);
    assert.deepEqual(candidateRevisions(hiddenChange[1]), [2, 2]);

    const noMemory = structuredClone(persisted);
    noMemory[1].extra.no_memory = true; // 原生当前候选使用 live extra，仅候选 0
    reconcileSourceIdentities(noMemory, persisted);
    assert.deepEqual(candidateRevisions(noMemory[1]), [2, 1]);

    const mvu = structuredClone(persisted);
    mvu[1].variables[1].stat_data.trust = 15; // 仅候选 1 的变量
    reconcileSourceIdentities(mvu, persisted);
    assert.deepEqual(candidateRevisions(mvu[1]), [1, 2]);
});

test('新消息、新候选 revision 为 1；previous 输入不被修改', () => {
    const chat = [header(), swipeMessage(['a'], 0)];
    reconcileSourceIdentities(chat, []);
    const persisted = structuredClone(chat);
    const previousSnapshot = structuredClone(persisted);

    const next = structuredClone(persisted);
    next[1].swipes.push('b-2');
    next[1].swipe_info.push({ extra: {} });
    next.push(message({ mes: 'new message' }));
    reconcileSourceIdentities(next, persisted);
    assert.equal(next[1].swipe_info[1].extra.vc_source.revision, 1);
    assert.equal(next[2].extra.vc_source.revision, 1);
    assert.deepEqual(persisted, previousSnapshot);
});

test('legacy 上一持久 JSONL（无 vc 字段）全部按新来源处理，settled 默认 false', () => {
    const legacy = [header(), message({ mes: 'same text' }), swipeMessage(['x', 'y'], 0)];
    const chat = structuredClone(legacy);
    reconcileSourceIdentities(chat, structuredClone(legacy));
    assert.equal(chat[1].extra.vc_source.revision, 1);
    assert.equal(chat[1].extra.vc_source.settled, false);
    assert.deepEqual(candidateRevisions(chat[2]), [1, 1]);
});

test('settled 仅显式 true 有效', () => {
    const chat = [header(), message({ mes: 'a' }), message({ mes: 'b' }), message({ mes: 'c' })];
    reconcileSourceIdentities(chat, []);
    assert.deepEqual(chat.slice(1).map((m) => m.extra.vc_source.settled), [false, false, false]);

    const next = structuredClone(chat);
    next[1].extra.vc_source.settled = 1; // truthy 但非显式 true
    next[2].extra.vc_source.settled = 'true';
    next[3].extra.vc_source.settled = true;
    reconcileSourceIdentities(next, structuredClone(chat));
    assert.deepEqual(next.slice(1).map((m) => m.extra.vc_source.settled), [false, false, true]);

    const flagged = [header(), message()];
    prepareSourceIdentities(flagged, { settled: true });
    assert.equal(flagged[1].extra.vc_source.settled, true);
    prepareSourceIdentities(flagged, { settled: false });
    assert.equal(flagged[1].extra.vc_source.settled, false);
});

test('sourceMessages 只返回当前候选，未选中候选不混入', () => {
    const chat = [
        header(),
        message({ mes: 'solo', is_user: true }),
        message({ mes: 'system note', is_system: true }),
        swipeMessage(['a', 'b', 'c'], 1),
    ];
    reconcileSourceIdentities(chat, []);
    const rows = sourceMessages(chat);
    assert.equal(rows.length, 3);
    assert.deepEqual(
        rows.map((row) => row.messageId),
        [chat[1].vc_message_id, chat[2].vc_message_id, chat[3].vc_message_id],
    );
    assert.equal(rows[2].text, 'b');
    assert.equal(rows[2].candidateId, chat[3].extra.vc_source.id);
    const deselected = [chat[3].swipe_info[0].extra.vc_source.id, chat[3].swipe_info[2].extra.vc_source.id];
    for (const row of rows) assert.equal(deselected.includes(row.candidateId), false);
    assert.deepEqual(rows.map((row) => row.revision), [1, 1, 1]);
    assert.deepEqual(rows.map((row) => row.role), ['user', 'system', 'assistant']);
    assert.deepEqual(rows.map((row) => row.eligible), [true, false, true]);
    assert.deepEqual(rows.map((row) => row.settled), [false, false, false]);
});

test('原生与 Helper 合并需要独立的 selected extra；来源准备不制造别名或循环', () => {
    const m = swipeMessage(['a', 'b']);
    const chat = [header(), m];
    prepareSourceIdentities(chat, { settled: true });
    assert.notEqual(m.extra, m.swipe_info[0].extra);
    assert.notEqual(m.extra.vc_source, m.swipe_info[0].extra.vc_source);
    assert.deepEqual(m.extra.vc_source, m.swipe_info[0].extra.vc_source);
    // A native swipe-info merge must not add an extra property to itself.
    Object.assign(m.swipe_info[0], { extra: m.extra });
    prepareSourceIdentities(chat, { settled: true });
    assert.notEqual(m.extra, m.swipe_info[0].extra);
    assert.doesNotThrow(() => JSON.stringify(chat));
    reconcileSourceIdentities(chat);
    assert.doesNotThrow(() => JSON.stringify(chat));
});
