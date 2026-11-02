import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 执行真实 SFC 的选项方法；只替换网络和界面反馈边界。
function component(file, dependencies) {
    const script = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
    const body = script.slice(script.indexOf('export default ') + 'export default '.length).trim().replace(/;$/, '');
    const options = new Function(...Object.keys(dependencies), `return (${body});`)(...Object.values(dependencies));
    const view = options.data();
    for (const [name, method] of Object.entries(options.methods)) view[name] = method.bind(view);
    return view;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const feedback = { writeAction: action => action(), showToast() {}, errorText: error => error.message };
const policy = (id, mode) => ({ relationshipId: id, mode, quietHoursStart: '', quietHoursEnd: '', quietHoursTimezone: '' });

test('切换角色的策略尚未返回时不能把旧策略写到新角色', async () => {
    const view = component('../src/components/CompanionList.vue', { ...feedback, VcAvatar: {}, VcIcon: {}, VcVoice: {}, incomingState: {}, INCOMING_COPY: {} });
    const pending = deferred(), writes = [];
    view.policy = policy('A', 'OFF'); view.baseline = JSON.stringify(view.policy); view.relationshipId = 'B';
    view.call = async (_, method, ...args) => {
        if (method === 'getProactivePolicy') return pending.promise;
        if (method === 'listFollowUps') return [];
        if (method === 'readProactivePolicy') return { ...args[0], relationshipId: args[1] };
        if (method === 'proactivePolicyPayload') return { mode: args[0].mode };
        if (method === 'putProactivePolicy') writes.push(args);
    };
    const loading = view.loadPolicy();
    await view.savePolicy();
    assert.equal(writes.length, 0, '加载期间不写入旧策略');
    pending.resolve(policy('B', 'DAILY')); await loading;
    await view.savePolicy();
    assert.deepEqual(writes, [['B', { mode: 'DAILY' }]]);
});

test('用途保存完成后仍保留请求期间新选模型的未保存状态', async () => {
    const view = component('../src/settings/ModelSettings.vue', { ...feedback, VcIcon: {}, PROTOCOLS: [], newModelDraft() {} });
    const pending = deferred(); let sent;
    let refreshed = 0; view.refreshProjection = async () => { refreshed += 1; };
    view.call = async (_, purpose, body) => { sent = { purpose, body }; return pending.promise; };
    const binding = { purpose: 'FOREGROUND_CHAT', choice: 'provider::A', original: '', revision: 3 };
    const saving = view.saveBinding(binding);
    binding.choice = 'provider::B'; pending.resolve({ revision: 4 }); await saving;
    assert.equal(sent.body.profileKey, 'A');
    assert.equal(binding.original, 'provider::A');
    assert.equal(binding.choice, 'provider::B');
    assert.notEqual(binding.choice, binding.original);
    assert.equal(binding.revision, 4);
    assert.equal(refreshed, 1, '保存绑定后刷新同一个酒馆引擎的模型投影');
});
