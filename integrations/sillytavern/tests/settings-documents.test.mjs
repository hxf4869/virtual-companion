import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDocumentChanges, commitDocument } from '../server-plugin/virtual-companion/lib/document-commit.js';
import { createSettingsDocuments, documentChanges } from '../extension/vc-model-settings/settings-documents.js';

const change = (path, before, value) => ({ path, before: { exists: true, value: before }, after: { exists: true, value } });
const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('Go请求scope不是持久设置：切会话不制造写入，其他修改仍保留读取基线', async () => {
    let saved={oai_settings:{custom_url:'vc-go://model-purposes/FOREGROUND_CHAT?provider=synthetic&scope=old'},unknown:1};
    const docs=createSettingsDocuments({post:async(_url,body)=>{saved=applyDocumentChanges(saved,body.vc_changes);return new Response('{}');}});
    const current=clone(saved);docs.captureSettings(saved,current);current.oai_settings.custom_url=current.oai_settings.custom_url.replace('scope=old','scope=new');
    assert.equal(docs.settingsChanged(current),false);current.unknown=2;await docs.saveSettings(current);
    assert.equal(saved.unknown,2);assert.ok(saved.oai_settings.custom_url.endsWith('scope=old'));
});
test('Go目录热投影不参与原ST偏好冲突；Helper修改仍以真实磁盘值比较',async()=>{
    let saved={oai_settings:{custom_model:'old'},extension_settings:{variables:{global:{n:1}}}},submitted;
    const docs=createSettingsDocuments({post:async(_url,body)=>{submitted=body;saved=applyDocumentChanges(saved,body.vc_changes);return new Response('{}');}});
    docs.captureSettings(saved);const current=clone(saved);current.oai_settings.custom_model='new';docs.projectSettings([['oai_settings','custom_model']],current);
    saved.oai_settings.custom_model='new';current.extension_settings.variables.global.n=2;await docs.saveSettings(current);
    assert.equal(saved.extension_settings.variables.global.n,2);assert.equal(submitted.vc_changes.some(row=>row.path[0]==='oai_settings'),false);
});

function host(t, value) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-documents-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'settings.json');
    if (value !== undefined) fs.writeFileSync(file, JSON.stringify(value));
    let writes = 0;
    const submit = body => {
        const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        const handled = commitDocument({ body, user: { profile: { handle: 'synthetic' }, directories: { root } } }, response, file,
            { write(next) { writes++; fs.writeFileSync(file, JSON.stringify(next)); }, result: { result: 'ok' }, allowCreate: true });
        return { ...response, handled };
    };
    return { submit, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), get writes() { return writes; } };
}

test('文档提交保留未知键：两个读取同一基线的客户端可以修改不同字段，相同字段整批409', t => {
    const f = host(t, { a: 1, b: 2, unknown: { keep: true } });
    assert.equal(f.submit({ vc_changes: [change(['a'], 1, 3)] }).statusCode, 200);
    assert.equal(f.submit({ vc_changes: [change(['b'], 2, 4)] }).statusCode, 200);
    const rejected = f.submit({ vc_changes: [change(['b'], 4, 5), change(['a'], 1, 9)] });
    assert.equal(rejected.statusCode, 409); assert.equal(rejected.body.code, 'VC_DOCUMENT_CONFLICT');
    assert.deepEqual(f.read(), { a: 3, b: 4, unknown: { keep: true } }); assert.equal(f.writes, 2);
    assert.deepEqual(Object.keys(rejected.body).sort(), ['code', 'message']);
});

test('文档提交区分缺失/null与删除，数组整体比较；重叠/下标/原型路径不写入', t => {
    const f = host(t, { nullable: null, list: ['a', 'b'], vars: { 'key.with.dot': 3 } });
    const rename = { path: ['vars', 'key.with.dot'], before: { exists: true, value: 3 }, after: { exists: false } };
    const add = { path: ['created'], before: { exists: false }, after: { exists: true, value: null } };
    assert.equal(f.submit({ vc_changes: [rename, add, change(['list'], ['a', 'b'], ['b'])] }).statusCode, 200);
    assert.deepEqual(f.read(), { nullable: null, list: ['b'], vars: {}, created: null });
    for (const [changes, status] of [[[add],409], [[change(['list', '0'], 'b', 'c')],400], [[change(['__proto__', 'polluted'], 1, true)],400],
        [[change(['vars'], {}, {}), change(['vars', 'nested'], null, 1)],400]]) assert.equal(f.submit({ vc_changes: changes }).statusCode,status);
    assert.equal(f.writes, 1); assert.equal({}.polluted, undefined);
});

test('文档新建带不存在基线；并发同名创建拒绝，原完整替换请求仍交给原端点', t => {
    const f = host(t);
    const creation = { path: [], before: { exists: false }, after: { exists: true, value: { entries: {} } } };
    assert.equal(f.submit({ vc_changes: [creation] }).statusCode, 200);
    assert.equal(f.submit({ vc_changes: [creation] }).statusCode, 409);
    assert.equal(f.submit({ entries: { untouched: true } }).handled, false); assert.equal(f.writes, 1);
});

test('归一化表单不删除磁盘未知键，不保存未编辑缺省值；缺失父对象作为比较边界', () => {
    const raw = { visible: 1, unknown: 'keep' }, view = { visible: 1, defaults: { a: 2, b: 3 } };
    const changed = clone(view); changed.visible = 4;
    assert.deepEqual(applyDocumentChanges(raw, documentChanges(raw, view, changed)), { visible: 4, unknown: 'keep' });
    changed.defaults.a = 5;
    const changes = documentChanges(raw, view, changed);
    assert.deepEqual(changes.find(row => row.path[0] === 'defaults').path, ['defaults']);
    assert.deepEqual(applyDocumentChanges(raw, changes), { visible: 4, unknown: 'keep', defaults: { a: 5, b: 3 } });
});

test('共享客户端序列化保存并推进自己的基线，迟到修改仍是脏值，冲突后不盲重试', async () => {
    const gate = deferred(); let saved = { a: 1, b: 2 }, writes = 0;
    const docs = createSettingsDocuments({ post: async (_url, body) => {
        writes++; if (writes === 1) await gate.promise;
        try { saved = applyDocumentChanges(saved, body.vc_changes); return new Response('{"result":"ok"}'); }
        catch (error) { return new Response(JSON.stringify({ code: error.code }), { status: error.status }); }
    } });
    const current = clone(saved); docs.captureSettings(saved, current); current.a = 3;
    const first = docs.saveSettings(current); current.a = 4; gate.resolve(); await first;
    assert.equal(saved.a, 3); assert.equal(docs.settingsChanged(current), true);
    await docs.saveSettings(current); assert.equal(saved.a, 4); assert.equal(docs.settingsChanged(current), false);
    saved.a = 9; current.a = 5;
    await assert.rejects(docs.saveSettings(current), error => error.status === 409);
    await assert.rejects(docs.saveSettings(current), error => error.status === 409);
    assert.equal(writes, 3); assert.equal(saved.a, 9);
    docs.captureSettings(saved, clone(saved)); await docs.saveSettings({ ...saved, b: 6 }); assert.equal(saved.b, 6);
});

test('桌面表单已提交字段不会吞掉同一运行模块仍未提交的Helper修改', async () => {
    let saved = { a: 1, b: 2 };
    const docs = createSettingsDocuments({ post: async (_url, body) => { saved = applyDocumentChanges(saved, body.vc_changes); return new Response('{}'); } });
    docs.captureSettings(saved); const current = { a: 3, b: 4 };
    const external = [change(['b'], 2, 4)]; saved = applyDocumentChanges(saved, external);
    docs.acceptSettings(external, current);
    assert.equal(docs.settingsChanged(current), true); await docs.saveSettings(current);
    assert.deepEqual(saved, current);
});
test('迟到ACK只推进已提交路径；排队的自动保存读取最新状态，不能回滚已接受的表单值',async()=>{
    const gate=deferred();let saved={a:0,b:0},calls=0,current=clone(saved);
    const docs=createSettingsDocuments({post:async(_url,body)=>{if(++calls===1)await gate.promise;saved=applyDocumentChanges(saved,body.vc_changes);return new Response('{}');}});
    docs.captureSettings(saved);current.a=1;const first=docs.saveSettings(()=>current);await new Promise(resolve=>setImmediate(resolve));
    current.a=2;const second=docs.saveSettings(()=>current);
    const ui=[change(['b'],0,3)];saved=applyDocumentChanges(saved,ui);current.b=3;docs.acceptSettings(ui,current);
    gate.resolve();await first;await second;assert.deepEqual(saved,{a:2,b:3});assert.equal(docs.settingsChanged(current),false);
});

test('预设保留原生过滤器未输出的键；已知格式预设从原settings包种子，新建不能覆盖同名', async () => {
    const stored = new Map([['existing', { name: 'existing', temp: 1, extensions: { keep: true } }],['context',{ name: 'context', story_string: '{{char}}' }]]), calls = [];
    const docs = createSettingsDocuments({ post: async (url, body) => { calls.push([url, body]);
        try { stored.set(body.name, applyDocumentChanges(stored.get(body.name), body.vc_changes)); return new Response(JSON.stringify({ name: body.name })); }
        catch (error) { return new Response(JSON.stringify({ code: error.code }), { status: error.status }); }
    } });
    docs.seedPresets({ openai_setting_names: ['existing'], openai_settings: [JSON.stringify(stored.get('existing'))], context: [{ name: 'context', story_string: '{{char}}' }] });
    await docs.savePreset('openai', 'existing', { temp: .5 }); assert.deepEqual(stored.get('existing'), { name: 'existing', temp: .5, extensions: { keep: true } });
    await docs.savePreset('context', 'context', { name: 'context', story_string: '{{user}}' }); assert.equal(calls.at(-1)[1].apiId, 'context');
    stored.set('new', { collision: true }); await assert.rejects(docs.savePreset('openai', 'new', { temp: 1 }), error => error.status === 409);
});
