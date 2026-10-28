// W06 辅助测试：createAccountData 的导出净化、同 owner 串行队列与在线删号时序。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAccountData } from '../server-plugin/virtual-companion/lib/account-data.js';
import { getF2Store, F2Error } from '../server-plugin/virtual-companion/lib/f2-store.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 有界轮询：deleteData 置位 frozen 只差几个微任务，轮询只为等待真实落盘。
async function waitFor(predicate) {
    for (let i = 0; i < 500; i++) {
        if (await predicate()) return;
        await sleep(2);
    }
    assert.fail('轮询超时：条件在限定时间内未成立');
}
async function makeBase(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-account-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return dir;
}
// 各 handle 的用户根目录直接位于测试 base 下；登记记录落在 <base>/_vc_accounts/<owner>.json。
const users = (dir) => (handle) => ({ root: path.join(dir, handle) });
async function write(root, relative, data) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return file;
}
async function readRecord(dir, owner) {
    return JSON.parse(await fs.readFile(path.join(dir, '_vc_accounts', `${owner}.json`), 'utf8'));
}

test('完整导出包含全部私有文件并按根级保留名单排除', async (t) => {
    const dir = await makeBase(t);
    const data = createAccountData({ getUserDirectories: users(dir), purgeProfile: async () => {} });
    const root = path.join(dir, 'alpha');
    const chat = '聊天合成内容\n';
    await write(root, 'chats/card/main.jsonl', chat);
    await write(root, 'characters/A.png', 'png-synthetic');
    await write(root, 'world/lore.json', '{"lore":true}');
    await write(root, 'settings.json', '{"theme":"dark"}');
    // 根级保留条目都不进入导出：凭据、备份、可再生成内容、上传暂存与 F2 索引。
    await write(root, 'secrets.json', '{"secret":"must-not-leak"}');
    await write(root, 'backups/b.json', 'backup');
    await write(root, 'thumbnails/t.png', 'thumb');
    await write(root, 'vectors/v.bin', 'vector');
    await write(root, '.uploads/u.bin', 'upload');
    await write(root, '.vc-f2/x.json', 'index');
    const result = await data.exportData('10001', 'alpha');
    assert.equal(result.ownerAccountId, '10001');
    assert.equal(result.handle, 'alpha');
    assert.equal(result.state, 'COMPLETE');
    assert.equal(result.snapshot, 'PER_FILE');
    assert.equal(result.fileCount, 4);
    assert.equal(result.files.length, 4);
    assert.deepEqual(result.files.map((file) => file.path).sort(),
        ['chats/card/main.jsonl', 'characters/A.png', 'settings.json', 'world/lore.json'].sort());
    for (const excluded of ['secrets.json', 'backups/b.json', 'thumbnails/t.png', 'vectors/v.bin', '.uploads/u.bin', '.vc-f2/x.json']) {
        assert.ok(!result.files.some((file) => file.path === excluded), `${excluded} 不应进入导出`);
    }
    assert.ok(result.files.every((file) => file.encoding === 'base64'));
    assert.equal(result.bytes, result.files.reduce((sum, file) => sum + file.bytes, 0));
    const chatEntry = result.files.find((file) => file.path === 'chats/card/main.jsonl');
    assert.deepEqual(Buffer.from(chatEntry.data, 'base64'), Buffer.from(chat));
});

test('settings.json 凭据键被递归净化；非法 settings.json 以解析错误拒绝导出', async (t) => {
    const dir = await makeBase(t);
    const data = createAccountData({ getUserDirectories: users(dir), purgeProfile: async () => {} });
    const secretValues = ['hunter2-plain', 'sk-owner-live', 'tok-live', 'nested-key'];
    await write(path.join(dir, 'alpha'), 'settings.json', JSON.stringify({
        theme: 'dark',
        password: 'hunter2-plain',
        api_key_openai: 'sk-owner-live',
        custom: { accessToken: 'tok-live', note: '保留备注' },
        list: [{ api_key: 'nested-key', label: '一行' }],
    }));
    const result = await data.exportData('10001', 'alpha');
    assert.equal(result.fileCount, 1);
    const entry = result.files.find((file) => file.path === 'settings.json');
    const text = Buffer.from(entry.data, 'base64').toString('utf8');
    for (const secret of secretValues) assert.ok(!text.includes(secret), `净化后的 settings 不应包含凭据值 ${secret}`);
    const decoded = JSON.parse(text);
    assert.equal(decoded.theme, 'dark');
    assert.equal(decoded.custom.note, '保留备注');
    assert.equal(decoded.list[0].label, '一行');
    assert.equal(decoded.password, undefined);
    assert.equal(decoded.api_key_openai, undefined);
    assert.equal(decoded.custom.accessToken, undefined);
    assert.equal(decoded.list[0].api_key, undefined);
    // 另一 owner 的 settings.json 非法：导出以 SyntaxError 拒绝，而不是返回伪完整。
    await write(path.join(dir, 'beta'), 'chats/main.jsonl', 'synthetic\n');
    await write(path.join(dir, 'beta'), 'settings.json', '{"theme": broken');
    await assert.rejects(data.exportData('10002', 'beta'), SyntaxError);
});

test('树内符号链接、根符号链接与超过大小上限的导出都被拒绝', async (t) => {
    const dir = await makeBase(t);
    const getUserDirectories = users(dir);
    const purgeProfile = async () => {};
    const data = createAccountData({ getUserDirectories, purgeProfile });
    // 树内文件是指向树外目标的符号链接。
    const rootA = path.join(dir, 'alpha');
    await write(rootA, 'chats/card/main.jsonl', 'synthetic\n');
    const outside = await write(dir, 'outside-secret.txt', 'outside-secret\n');
    await fs.symlink(outside, path.join(rootA, 'chats', 'leak.jsonl'));
    await assert.rejects(data.exportData('10001', 'alpha'), /A private file is a symlink/);
    // 根自身是指向真实目录的符号链接，名字仍是 handle。
    const real = path.join(dir, 'real-beta');
    await write(real, 'chats/main.jsonl', 'synthetic\n');
    await fs.symlink(real, path.join(dir, 'beta'));
    await assert.rejects(data.exportData('10002', 'beta'), /Account directory is unavailable/);
    // 单个文件超过 maxExportBytes。
    const capped = createAccountData({ getUserDirectories, purgeProfile, maxExportBytes: 64 });
    await write(path.join(dir, 'gamma'), 'chats/big.bin', 'x'.repeat(100));
    await assert.rejects(capped.exportData('10003', 'gamma'), /Account export exceeds the supported size/);
});

test('删除排空在途请求并与其它账号隔离；expectedHandle 不匹配不改状态', async (t) => {
    const dir = await makeBase(t);
    const data = createAccountData({ getUserDirectories: users(dir), purgeProfile: async () => {} });
    const rootA = path.join(dir, 'aaa'), rootB = path.join(dir, 'bbb');
    await write(rootA, 'chats/main.jsonl', 'A-synthetic\n');
    await write(rootB, 'chats/main.jsonl', 'B-synthetic\n');
    const res1 = new EventEmitter(), res2 = new EventEmitter(), resB = new EventEmitter();
    assert.equal(await data.enter('10001', 'aaa', res1), true);
    assert.equal(await data.enter('10001', 'aaa', res2), true);
    assert.equal(await data.enter('10002', 'bbb', resB), true);
    // expectedHandle 与当前 handle 不一致：立即拒绝，登记仍保持 ACTIVE。
    await assert.rejects(data.deleteData('10002', 'bbb', 'wrong'), /Account mapping changed/);
    assert.deepEqual(await readRecord(dir, '10002'), { ownerAccountId: '10002', handle: 'bbb', state: 'ACTIVE' });
    assert.equal(await data.readable('10002', 'bbb'), true);
    const D = data.deleteData('10001', 'aaa');
    let settled = false;
    D.then(() => { settled = true; }, () => { settled = true; });
    await waitFor(async () => (await data.readable('10001', 'aaa')) === false);
    assert.equal(await data.enter('10001', 'aaa', new EventEmitter()), false);
    // 只释放 res1 时仍有一个在途请求，删除不能完成。
    res1.emit('finish');
    for (let i = 0; i < 10; i++) await sleep(2);
    assert.equal(settled, false);
    res2.emit('close');
    assert.deepEqual(await D, { ownerAccountId: '10001', handle: 'aaa', state: 'DELETED' });
    await assert.rejects(fs.stat(rootA), { code: 'ENOENT' });
    assert.deepEqual(await readRecord(dir, '10001'), { ownerAccountId: '10001', handle: 'aaa', state: 'DELETED' });
    // 另一账号完全不受影响。
    await fs.stat(path.join(rootB, 'chats', 'main.jsonl'));
    assert.equal(await data.readable('10002', 'bbb'), true);
    assert.equal(await data.enter('10002', 'bbb', new EventEmitter()), true);
});

test('排空超时把记录留在 DELETING；迟到释放无害；重建实例完成删除', async (t) => {
    const dir = await makeBase(t);
    const options = { getUserDirectories: users(dir), purgeProfile: async () => {}, drainTimeoutMs: 20 };
    const root = path.join(dir, 'alpha');
    await write(root, 'chats/main.jsonl', 'synthetic\n');
    const first = createAccountData(options);
    const res = new EventEmitter();
    assert.equal(await first.enter('10001', 'alpha', res), true);
    await assert.rejects(first.deleteData('10001', 'alpha'), /Account requests are still running/);
    assert.equal(await first.readable('10001', 'alpha'), false);
    assert.deepEqual(await readRecord(dir, '10001'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETING' });
    res.emit('close'); // 排空已超时，迟到的释放必须是无害的。
    const second = createAccountData(options);
    assert.deepEqual(await second.deleteData('10001', 'alpha'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('purgeProfile 失败把记录留在 DELETING；重建后幂等完成且不再调用 purge', async (t) => {
    const dir = await makeBase(t);
    const getUserDirectories = users(dir);
    let purges = 0;
    const purgeProfile = async () => { purges += 1; if (purges === 1) throw new Error('合成 purge 失败'); };
    const root = path.join(dir, 'alpha');
    await write(root, 'chats/main.jsonl', 'synthetic\n');
    const first = createAccountData({ getUserDirectories, purgeProfile });
    await assert.rejects(first.deleteData('10001', 'alpha'), /合成 purge 失败/);
    assert.equal(purges, 1);
    assert.equal(await first.readable('10001', 'alpha'), false);
    assert.equal(await first.enter('10001', 'alpha', new EventEmitter()), false);
    // removeAccountData 先于 purgeProfile：根目录已被清除，登记停在 DELETING。
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
    assert.deepEqual(await readRecord(dir, '10001'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETING' });
    const second = createAccountData({ getUserDirectories, purgeProfile });
    assert.deepEqual(await second.deleteData('10001', 'alpha'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    assert.equal(purges, 2);
    // 同实例与全新实例的重复删号都直接返回 DELETED，不再触发 purge。
    assert.deepEqual(await second.deleteData('10001', 'alpha'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    assert.equal(purges, 2);
    const third = createAccountData({ getUserDirectories, purgeProfile });
    assert.deepEqual(await third.deleteData('10001', 'alpha'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    assert.equal(purges, 2);
});

test('损坏的 .vc-f2 索引不阻止删号', async (t) => {
    const dir = await makeBase(t);
    const root = path.join(dir, 'alpha');
    await write(root, 'chats/main.jsonl', 'synthetic\n');
    await write(root, '.vc-f2/broken.json', 'not-json{');
    const store = getF2Store(root);
    // 索引确实损坏：读取以 VC_CHAT_CORRUPT 拒绝（code 在 F2Error.code 上，不在 message 里）。
    await assert.rejects(store.read('chats/main.jsonl'),
        (error) => error instanceof F2Error && error.code === 'VC_CHAT_CORRUPT' && error.status === 500);
    const data = createAccountData({ getUserDirectories: users(dir), purgeProfile: async () => {} });
    assert.deepEqual(await data.deleteData('10001', 'alpha'), { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('导出与删号对同一 owner 串行；删除在途时发起的导出绝不 COMPLETE', async (t) => {
    const dir = await makeBase(t);
    const data = createAccountData({ getUserDirectories: users(dir), purgeProfile: async () => {} });
    const rootA = path.join(dir, 'alpha');
    const total = 120;
    for (let group = 0; group < 4; group++) {
        for (let i = 0; i < 30; i++) {
            await write(rootA, `chats/g${group}/chat-${i}.jsonl`, `{"i":${i}}\n`);
        }
    }
    const E = data.exportData('10001', 'alpha');
    const D = data.deleteData('10001', 'alpha');
    const [exported, deleted] = await Promise.allSettled([E, D]);
    assert.equal(exported.status, 'fulfilled');
    assert.equal(exported.value.state, 'COMPLETE');
    assert.equal(exported.value.fileCount, total);
    assert.equal(deleted.status, 'fulfilled');
    assert.deepEqual(deleted.value, { ownerAccountId: '10001', handle: 'alpha', state: 'DELETED' });
    await assert.rejects(fs.stat(rootA), { code: 'ENOENT' });
    // 删除被未释放的 enter 阻塞时发起的导出，只能在删除之后以“删除进行中”拒绝。
    const rootB = path.join(dir, 'beta');
    await write(rootB, 'chats/main.jsonl', 'synthetic\n');
    const res = new EventEmitter();
    assert.equal(await data.enter('10002', 'beta', res), true);
    const D2 = data.deleteData('10002', 'beta');
    await waitFor(async () => (await data.readable('10002', 'beta')) === false);
    const E2 = data.exportData('10002', 'beta');
    let exportSettled = false;
    E2.then(() => { exportSettled = true; }, () => { exportSettled = true; });
    for (let i = 0; i < 10; i++) await sleep(2);
    assert.equal(exportSettled, false); // 删除仍在排空，导出不可能提前完成。
    const rejection = assert.rejects(E2, /Account deletion in progress/);
    res.emit('close');
    await rejection;
    assert.deepEqual(await D2, { ownerAccountId: '10002', handle: 'beta', state: 'DELETED' });
    await assert.rejects(fs.stat(rootB), { code: 'ENOENT' });
});

test('只排除锁定受管扩展的调试 source map，保留运行代码和用户扩展', async (t) => {
    const dir=await makeBase(t), root=path.join(dir,'alpha');
    const data=createAccountData({getUserDirectories:users(dir),purgeProfile:async()=>{}});
    await write(root,'extensions/ST-Prompt-Template/dist/index.js.map','rebuildable debug');
    await write(root,'extensions/ST-Prompt-Template/dist/index.js','executable');
    await write(root,'extensions/private-addon/private.map','owner content');
    const result=await data.exportData('10001','alpha');
    assert.deepEqual(result.files.map((f)=>f.path).sort(),['extensions/ST-Prompt-Template/dist/index.js','extensions/private-addon/private.map'].sort());
    assert.ok(result.exclusions.includes('managed-extension-source-maps'));
});
