import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getF2Store, F2Error } from '../server-plugin/virtual-companion/lib/f2-store.js';
import { reconcileSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const moduleURL = new URL('../server-plugin/virtual-companion/lib/f2-store.js', import.meta.url).href;
const fresh = () => ({ id: randomUUID(), revision: 0 });
const chat = (message = '合成消息', token) => [{ chat_metadata: { ...(token ? { vc_f2: token } : {}), fixture: true } }, { is_user: false, mes: message }];
const matches = (code, status = 409) => (error) => error instanceof F2Error && error.code === code && error.status === status;
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-f2-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, store: getF2Store(root), file: path.join(root, 'chats/card/main.jsonl') };
}
async function rawWrite(root, relative, data) {
    const file = path.join(root, relative);
    if (data[0]?.chat_metadata?.vc_f2) reconcileSourceIdentities(data);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data.map((row) => JSON.stringify(row)).join('\n') + '\n');
}
async function identity(root, record) {
    await fs.mkdir(path.join(root, '.vc-f2'), { recursive: true });
    await fs.writeFile(path.join(root, '.vc-f2', `${record.id}.json`), JSON.stringify(record));
}
async function record(root, id) { return JSON.parse(await fs.readFile(path.join(root, '.vc-f2', `${id}.json`), 'utf8')); }

test('W07 分支根在父CAS内确定，后续保存和孙分支不能借浏览器改根', async (t) => {
    const { root, store, file } = await fixture(t);
    const base = await store.save(file, chat('父聊天'), { expected: fresh() });
    const childFile = path.join(root, 'chats/card/blue.jsonl');
    const child = await store.save(childFile, chat('蓝门'), { expected: fresh(), parent: base });
    assert.equal((await store.sourceSnapshot(child.id)).branchRoot, base.id);
    const changed = await store.read(childFile);
    changed[0].chat_metadata.vc_branch_root = randomUUID();
    const updated = await store.save(childFile, changed, { expected: child });
    assert.equal((await store.sourceSnapshot(child.id)).branchRoot, base.id);
    const grandchild = await store.save(path.join(root, 'chats/card/blue-next.jsonl'), chat('蓝门下一幕'), { expected: fresh(), parent: updated });
    assert.equal((await store.sourceSnapshot(grandchild.id)).branchRoot, base.id);
    assert.equal((await store.sourceSnapshot(base.id)).branchRoot, base.id);
});

// 两个编辑者持同一已读基线，服务端只允许一个完整快照提交。
test('共享实例、同基线并发一成一冲，force不能绕过，调用时冻结快照', async (t) => {
    const { root, store, file } = await fixture(t);
    assert.equal(getF2Store(path.join(root, '.')), store);
    const base = await store.save(file, chat(), { expected: fresh() });
    const a = chat('候选A'), b = chat('候选B');
    const p1 = store.save(file, a, { expected: base });
    const p2 = store.save(file, b, { expected: base, force: true });
    a[1].mes = '排队后篡改';
    const result = await Promise.allSettled([p1, p2]);
    assert.equal(result[0].status, 'fulfilled');
    assert.equal(result[1].status, 'rejected');
    assert.ok(matches('VC_REVISION_CONFLICT')(result[1].reason));
    const saved = await store.read(file);
    assert.equal(saved[1].mes, '候选A');
    assert.deepEqual(saved[0].chat_metadata.vc_f2, { id: base.id, revision: 2 });
    assert.deepEqual(await record(root, base.id), { id: base.id, state: 'live', path: 'chats/card/main.jsonl' });
});

test('缺基线拒绝；合法旧JSONL仅初始化一次；新进程读取持久基线', async (t) => {
    const { root, store, file } = await fixture(t);
    await assert.rejects(store.save(file, chat()), matches('VC_REVISION_REQUIRED', 428));
    assert.deepEqual(await store.read(file), []);
    await rawWrite(root, 'chats/card/main.jsonl', chat('旧合成内容'));
    const initial = await store.read(file);
    const token = initial[0].chat_metadata.vc_f2;
    assert.equal(token.revision, 0);
    assert.equal(initial[1].mes, '旧合成内容');
    const token1 = await store.save(file, chat('更新内容'), { expected: token });
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
        `const {getF2Store}=await import(${JSON.stringify(moduleURL)}); const c=await getF2Store(process.argv[1]).read(process.argv[2]); process.stdout.write(JSON.stringify(c[0].chat_metadata.vc_f2));`, root, file]);
    assert.deepEqual(JSON.parse(stdout), token1);
    assert.deepEqual((await store.read(file))[0].chat_metadata.vc_f2, token1);
});

test('删除墓碑拒绝旧保存；新的身份可以使用相同路径', async (t) => {
    const { root, store, file } = await fixture(t);
    const token = await store.save(file, chat(), { expected: fresh() });
    const tombstone = await store.remove(file, { expected: token });
    assert.deepEqual(tombstone, { id: token.id, revision: token.revision + 1 });
    assert.equal((await record(root, token.id)).state, 'deleted');
    assert.deepEqual(await store.read(file), []);
    await assert.rejects(store.save(file, chat('陈旧'), { expected: token, force: true }), matches('VC_CHAT_DELETED'));
    await assert.rejects(store.save(file, chat('旧身份伪装新建'), { expected: { id: token.id, revision: 0 } }), matches('VC_CHAT_DELETED'));
    const replacement = await store.save(file, chat('新身份'), { expected: fresh() });
    assert.notEqual(replacement.id, token.id);
    assert.equal((await store.read(file))[1].mes, '新身份');
});

test('改名保持身份并推进版本；旧路径写与目的冲突都拒绝', async (t) => {
    const { root, store, file } = await fixture(t);
    const target = path.join(root, 'chats/card/renamed.jsonl');
    const base = await store.save(file, chat('改名内容'), { expected: fresh() });
    const next = await store.rename(file, target, { expected: base });
    assert.deepEqual(next, { id: base.id, revision: 2 });
    assert.deepEqual(await store.read(file), []);
    assert.equal((await store.read(target))[1].mes, '改名内容');
    await assert.rejects(store.save(file, chat('旧路径'), { expected: next }), matches('VC_REVISION_CONFLICT'));
    await store.save(file, chat('其他身份'), { expected: fresh() });
    await assert.rejects(store.rename(target, file, { expected: next }), matches('VC_REVISION_CONFLICT'));
    assert.deepEqual((await store.read(target))[0].chat_metadata.vc_f2, next);
});

test('分支原子验证父读取基线，不能复用父身份或越过旧父版本', async (t) => {
    const { root, store, file } = await fixture(t);
    const parent = await store.save(file, chat('父初始'), { expected: fresh() });
    const latest = await store.save(file, chat('父更新'), { expected: parent });
    const target = path.join(root, 'chats/card/branch.jsonl'), child = fresh();
    await assert.rejects(store.save(target, chat('旧分支'), { expected: child, parent }), matches('VC_REVISION_CONFLICT'));
    await assert.rejects(store.save(target, chat('同身份'), { expected: { id: parent.id, revision: 0 }, parent: latest }), matches('VC_REVISION_CONFLICT'));
    const branch = await store.save(target, chat('新分支'), { expected: child, parent: latest });
    assert.equal(branch.id, child.id);
    assert.deepEqual((await store.read(file))[0].chat_metadata.vc_f2, latest);
});

test('pending-create 无文件只允许同身份同路径expected0重试；写完内容后可补live登记', async (t) => {
    const { root, store, file } = await fixture(t);
    const first = fresh();
    await identity(root, { id: first.id, state: 'pending-create', path: 'chats/card/main.jsonl' });
    assert.deepEqual(await store.read(file), []);
    await assert.rejects(store.save(file, chat(), { expected: fresh() }), matches('VC_REVISION_CONFLICT'));
    await assert.rejects(store.save('elsewhere.jsonl', chat(), { expected: first }), matches('VC_REVISION_CONFLICT'));
    const saved = await store.save(file, chat('原操作重试'), { expected: first });
    assert.equal(saved.revision, 1);
    const interrupted = { id: randomUUID(), revision: 1 };
    await identity(root, { id: interrupted.id, state: 'pending-create', path: 'complete.jsonl' });
    await rawWrite(root, 'complete.jsonl', chat('内容先落盘', interrupted));
    assert.deepEqual((await store.read('complete.jsonl'))[0].chat_metadata.vc_f2, interrupted);
    assert.equal((await record(root, interrupted.id)).state, 'live');
});

test('pending-rename 的登记后、目标写后、源删除后三个中断点均恢复', async (t) => {
    for (const stage of ['intent', 'target', 'source-removed']) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-f2-rename-'));
        t.after(() => fs.rm(dir, { recursive: true, force: true }));
        const before = { id: randomUUID(), revision: 4 }, after = { id: before.id, revision: 5 };
        if (stage !== 'source-removed') await rawWrite(dir, 'old.jsonl', chat('原文', before));
        if (stage !== 'intent') await rawWrite(dir, 'new.jsonl', chat('原文', after));
        await identity(dir, { id: before.id, state: 'renaming', from: 'old.jsonl', to: 'new.jsonl', revision: 5 });
        const store = getF2Store(dir);
        assert.deepEqual((await store.read('new.jsonl'))[0].chat_metadata.vc_f2, after);
        assert.deepEqual(await store.read('old.jsonl'), []);
        assert.deepEqual(await record(dir, before.id), { id: before.id, state: 'live', path: 'new.jsonl' });
        await assert.rejects(store.save('old.jsonl', chat(), { expected: after }), matches('VC_REVISION_CONFLICT'));
    }
});

test('pending-delete 先墓碑后删除恢复；异常目标不被rename恢复覆盖', async (t) => {
    const { root, store, file } = await fixture(t);
    const before = { id: randomUUID(), revision: 2 };
    await rawWrite(root, 'chats/card/main.jsonl', chat('待删除', before));
    await identity(root, { id: before.id, state: 'deleted', path: 'chats/card/main.jsonl', revision: 3 });
    assert.deepEqual(await store.read(file), []);
    await assert.rejects(store.save(file, chat(), { expected: before }), matches('VC_CHAT_DELETED'));
    const source = { id: randomUUID(), revision: 1 }, other = fresh();
    await rawWrite(root, 'source.jsonl', chat('源', source));
    await rawWrite(root, 'target.jsonl', chat('不可覆盖', other));
    await identity(root, { id: source.id, state: 'renaming', from: 'source.jsonl', to: 'target.jsonl', revision: 2 });
    await assert.rejects(store.read('target.jsonl'), matches('VC_CHAT_CORRUPT', 500));
    assert.match(await fs.readFile(path.join(root, 'target.jsonl'), 'utf8'), /不可覆盖/);
});

test('坏JSONL、目录读错误、越界路径与符号链接均不冒充空聊天', async (t) => {
    const { root, store } = await fixture(t);
    await fs.writeFile(path.join(root, 'broken.jsonl'), '{}\nnot-json\n');
    await assert.rejects(store.read('broken.jsonl'), matches('VC_CHAT_CORRUPT', 500));
    await fs.mkdir(path.join(root, 'directory.jsonl'));
    await assert.rejects(store.read('directory.jsonl'), { code: 'EISDIR' });
    await assert.rejects(store.read('../outside.jsonl'), matches('VC_CHAT_PATH_INVALID', 400));
    await assert.rejects(store.save('/tmp/outside-vc.jsonl', chat(), { expected: fresh() }), matches('VC_CHAT_PATH_INVALID', 400));
    await fs.symlink(os.tmpdir(), path.join(root, 'link'));
    await assert.rejects(store.save('link/outside.jsonl', chat(), { expected: fresh() }), matches('VC_CHAT_PATH_INVALID', 400));
    await assert.rejects(store.read('.vc-f2/state.json'), matches('VC_CHAT_PATH_INVALID', 400));
});
