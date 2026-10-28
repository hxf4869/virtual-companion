import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createF2Hooks, migrateLegacyChat } from '../server-plugin/virtual-companion/lib/f2-routes.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';

const token = () => ({ id: randomUUID(), revision: 0 });
const content = (base, text = '合成内容', parent) => [{ chat_metadata: { vc_f2: base, ...(parent ? { vc_f2_parent: parent } : {}) } }, { mes: text }];
const errorCode = (code, status) => (e) => e.code === code && e.status === status;
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-f2-hooks-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const user = { profile: { handle: 'synthetic-owner' }, directories: { root, chats: path.join(root, 'chats'), groupChats: path.join(root, 'group chats') } };
    const hooks = createF2Hooks({ getUserDirectories: (handle) => { assert.equal(handle, user.profile.handle); return user.directories; } });
    return { root, hooks, user, file: path.join(root, 'chats/card/main.jsonl'), request: { user, body: {} } };
}

test('原生保存从快照header取expected，父基线不持久化，force无效', async (t) => {
    const { hooks, user, file, root } = await fixture(t);
    const first = token();
    const v1 = await hooks.save(user.profile.handle, file, content(first));
    assert.equal(v1.revision, 1);
    await assert.rejects(hooks.save(user.profile.handle, file, content(first, '旧快照')), errorCode('VC_REVISION_CONFLICT', 409));
    await assert.rejects(hooks.save(user.profile.handle, file, [{ chat_metadata: { force: true } }, { mes: '缺基线' }]), errorCode('VC_REVISION_REQUIRED', 428));
    const child = await hooks.save(user.profile.handle, path.join(root, 'branch.jsonl'), content(token(), '分支', v1));
    const rows = await hooks.read(user, path.join(root, 'branch.jsonl'));
    assert.deepEqual(rows[0].chat_metadata.vc_f2, child);
    assert.equal(Object.hasOwn(rows[0].chat_metadata, 'vc_f2_parent'), false);
});

test('rename/delete消费body基线（支持multipart字符串）；身份只来自认证user', async (t) => {
    const { hooks, user, file, root, request } = await fixture(t);
    const v1 = await hooks.save(user.profile.handle, file, content(token()));
    request.body = { vc_f2: JSON.stringify(v1), owner: 'not-the-owner', force: true };
    const target = path.join(root, 'renamed.jsonl');
    const v2 = await hooks.rename(request, file, target);
    assert.equal(v2.id, v1.id);
    await assert.rejects(hooks.remove(request, target), errorCode('VC_REVISION_CONFLICT', 409));
    request.body.vc_f2 = v2;
    assert.equal((await hooks.remove(request, target)).revision, v2.revision + 1);
    assert.deepEqual(await hooks.read(user, target), []);
    assert.throws(() => hooks.read({ directories: user.directories }, target), errorCode('VC_AUTH_REQUIRED', 401));
});

test('每个新导入生成fresh身份，旧上传token和父权限均丢弃，无需客户端解析格式计数', async (t) => {
    const { hooks, root, user, request } = await fixture(t);
    const stale = { id: randomUUID(), revision: 88 };
    const backup = content(stale, '备份内容', token());
    backup[0].chat_metadata.vc_binding = { relationshipId: 'old-instance', conversationId: 'old-conversation' };
    const raw = backup.map((row) => JSON.stringify(row)).join('\n');
    const a = await hooks.importChat(request, path.join(root, 'a.jsonl'), raw, { existed: false, index: 0 });
    const b = await hooks.importChat(request, path.join(root, 'b.jsonl'), raw, { existed: false, index: 1 });
    assert.notEqual(a.id, stale.id); assert.notEqual(a.id, b.id);
    assert.equal(a.revision, 1);
    assert.equal((await hooks.read(user, path.join(root, 'a.jsonl')))[0].chat_metadata.vc_f2_parent, undefined);
    assert.equal((await hooks.read(user, path.join(root, 'a.jsonl')))[0].chat_metadata.vc_binding, undefined);
});

test('导入撞名拒绝，明确目标基线允许覆盖；删除后不得把覆盖转成新建', async (t) => {
    const { hooks, root, user, request, file } = await fixture(t);
    const current = await hooks.save(user.profile.handle, file, content(token()));
    const raw = content(current, '恢复合成内容').map((row) => JSON.stringify(row)).join('\n');
    await assert.rejects(hooks.importChat(request, file, raw, { existed: true }), errorCode('VC_REVISION_CONFLICT', 409));
    request.body.vc_f2 = JSON.stringify(current);
    const restored = await hooks.importChat(request, file, raw, { existed: true });
    assert.equal(restored.id, current.id); assert.equal(restored.revision, 2);
    request.body.vc_f2 = restored;
    await getF2Store(root).remove(file, { expected: restored });
    await assert.rejects(hooks.importChat(request, file, raw, { existed: true }), errorCode('VC_CHAT_DELETED', 409));
    await assert.rejects(hooks.importChat(request, file, raw, { existed: false }), errorCode('VC_REVISION_CONFLICT', 409));
    delete request.body.vc_f2;
    await hooks.importChat(request, file, raw, { existed: false });
    await assert.rejects(hooks.importChat(request, file, raw, { existed: false }), errorCode('VC_REVISION_CONFLICT', 409));
});

test('坏导入、坏基线与读取失败保持错误，不转换成成功或空数组', async (t) => {
    const { hooks, user, file, root, request } = await fixture(t);
    await assert.rejects(hooks.importChat(request, file, 'invalid', { existed: false }), errorCode('VC_CHAT_INVALID', 400));
    request.body.vc_f2 = '{invalid';
    assert.throws(() => hooks.remove(request, file), errorCode('VC_REVISION_REQUIRED', 428));
    await fs.writeFile(path.join(root, 'broken.jsonl'), 'broken');
    await assert.rejects(hooks.read(user, path.join(root, 'broken.jsonl')), errorCode('VC_CHAT_CORRUPT', 500));
});

test('批量角色改名先核验所有基线，旧第二条不能先改头像或第一条聊天', async (t) => {
    const { hooks, user, request, root } = await fixture(t);
    const from = path.join(root, 'chats/old'), to = path.join(root, 'chats/new');
    const a = await hooks.save(user.profile.handle, path.join(from, 'a.jsonl'), content(token()));
    const b = await hooks.save(user.profile.handle, path.join(from, 'b.jsonl'), content(token()));
    const b2 = await hooks.save(user.profile.handle, path.join(from, 'b.jsonl'), content(b, '新修改'));
    request.body.vc_f2_chats = [{ path: 'chats/old/a.jsonl', expected: a }, { path: 'chats/old/b.jsonl', expected: b }];
    let cardWritten = false;
    await assert.rejects(hooks.renameDirectory(request, from, to, () => { cardWritten = true; }), errorCode('VC_REVISION_CONFLICT', 409));
    assert.equal(cardWritten, false);
    assert.deepEqual((await hooks.read(user, path.join(from, 'a.jsonl')))[0].chat_metadata.vc_f2, a);
    request.body.vc_f2_chats[1].expected = b2;
    const result = await hooks.renameDirectory(request, from, to, () => { cardWritten = true; });
    assert.equal(cardWritten, true); assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.path).sort(), ['chats/old/a.jsonl', 'chats/old/b.jsonl']);
    assert.equal((await hooks.read(user, path.join(to, 'a.jsonl')))[0].chat_metadata.vc_f2.id, a.id);
    await assert.rejects(hooks.save(user.profile.handle, path.join(from, 'a.jsonl'), content(a)), errorCode('VC_REVISION_CONFLICT', 409));
});

test('群组/Data Maid逐聊天基线缺项或冲突时不先删其他聊天；接受现有report的hash定位', async (t) => {
    const { hooks, user, request, root } = await fixture(t);
    const aPath = path.join(root, 'group chats/a.jsonl'), bPath = path.join(root, 'group chats/b.jsonl');
    const a = await hooks.save(user.profile.handle, aPath, content(token()));
    const b = await hooks.save(user.profile.handle, bPath, content(token()));
    request.body.vc_f2_chats = [{ path: 'group chats/a.jsonl', expected: a }];
    await assert.rejects(hooks.removeChats(request, [aPath, bPath]), errorCode('VC_REVISION_REQUIRED', 428));
    assert.equal((await hooks.read(user, aPath)).length, 2);
    request.body.vc_f2_chats = JSON.stringify([{ hash: 'existing-report-entry-a', expected: a }, { hash: 'existing-report-entry-b', expected: b }]);
    assert.equal(hooks.isChatFile(user, aPath), true);
    assert.equal(hooks.isChatFile(user, path.join(root, 'backups/a.jsonl')), false);
    const result = await hooks.removeChats(request, [{ path: aPath, hash: 'existing-report-entry-a' }, { path: bPath, hash: 'existing-report-entry-b' }]);
    assert.equal(result.length, 2);
    assert.deepEqual(await hooks.read(user, aPath), []);
    await assert.rejects(hooks.save(user.profile.handle, bPath, content(b)), errorCode('VC_CHAT_DELETED', 409));
});

test('目录目标集合在同owner锁内复核，枚举后新增或pending聊天不能被静默遗漏', async (t) => {
    const { hooks, user, root } = await fixture(t);
    const dir = path.join(root, 'chats/card'), aPath = path.join(dir, 'a.jsonl');
    const a = await hooks.save(user.profile.handle, aPath, content(token()));
    await hooks.save(user.profile.handle, path.join(dir, 'b.jsonl'), content(token()));
    let ran = false;
    await assert.rejects(getF2Store(root).mutateMany([{ kind: 'remove', file: aPath, expected: a }], () => { ran = true; }, { directory: dir }), errorCode('VC_REVISION_CONFLICT', 409));
    assert.equal(ran, false);
    assert.equal((await hooks.read(user, aPath)).length, 2);
    const emptyDir = path.join(root, 'chats/pending');
    const pending = token();
    await fs.writeFile(path.join(root, '.vc-f2', `${pending.id}.json`), JSON.stringify({ id: pending.id, state: 'pending-create', path: 'chats/pending/not-written.jsonl' }));
    await assert.rejects(getF2Store(root).mutateMany([], () => { ran = true; }, { directory: emptyDir }), errorCode('VC_REVISION_CONFLICT', 409));
    assert.equal(ran, false);
});

test('启动legacy迁移只初始化无身份原文件，已有F2或上传旧revision不能被重置', async (t) => {
    const { root, user, hooks } = await fixture(t);
    const file = path.join(root, 'legacy-group.jsonl');
    await fs.writeFile(file, JSON.stringify({ is_user: false, mes: '无头部的旧消息' }) + '\n');
    const migrated = await migrateLegacyChat(user.directories, file, [{ chat_metadata: { integrity: 'native-identity' } }, { is_user: false, mes: '无头部的旧消息' }]);
    assert.equal(migrated.revision, 0);
    const rows = await hooks.read(user, file);
    assert.equal(rows[1].mes, '无头部的旧消息');
    await assert.rejects(migrateLegacyChat(user.directories, file, [{ chat_metadata: {} }, { mes: '不可重写' }]), errorCode('VC_REVISION_CONFLICT', 409));
    const another = path.join(root, 'legacy-with-restored-metadata.jsonl');
    await fs.writeFile(another, JSON.stringify({ mes: '原文' }) + '\n');
    await assert.rejects(migrateLegacyChat(user.directories, another, content({ id: randomUUID(), revision: 99 })), errorCode('VC_REVISION_CONFLICT', 409));
    assert.deepEqual((await hooks.read(user, file))[0].chat_metadata.vc_f2, migrated);
});

test('F2基线优先于原生integrity，原生检查失败不落盘也不推进版本', async (t) => {
    const { hooks, user, file } = await fixture(t);
    const current = await hooks.save(user.profile.handle, file, content(token(), '已保存'));
    let called = false;
    const check = () => { called = true; throw new Error('native integrity rejected'); };
    await assert.rejects(hooks.save(user.profile.handle, file, [{ chat_metadata: { integrity: 'wrong' } }, { mes: '缺基线' }], check), errorCode('VC_REVISION_REQUIRED', 428));
    assert.equal(called, false);
    await assert.rejects(hooks.save(user.profile.handle, file, content(current, '禁止写入'), check), /native integrity rejected/);
    assert.equal(called, true);
    const rows = await hooks.read(user, file);
    assert.equal(rows[1].mes, '已保存');
    assert.deepEqual(rows[0].chat_metadata.vc_f2, current);
});
