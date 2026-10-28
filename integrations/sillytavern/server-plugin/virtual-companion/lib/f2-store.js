// AGPL-3.0-only. 单 ST Node 实例的 F2 存储边界；JSONL 是 live revision 的唯一权威。
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { reconcileSourceIdentities, sourceMessages } from './source-identity.js';

const stores = new Map();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validToken = (v) => isObject(v) && uuid.test(v.id) && Number.isSafeInteger(v.revision) && v.revision >= 0;
const sameToken = (a, b) => a?.id === b?.id && a?.revision === b?.revision;

export class F2Error extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'F2Error';
        this.status = status;
        this.code = code;
    }
}
const conflict = (message = '聊天读取基线已失效') => new F2Error(409, 'VC_REVISION_CONFLICT', message);
const corrupt = (message = '聊天或身份记录损坏') => new F2Error(500, 'VC_CHAT_CORRUPT', message);
const deleted = () => new F2Error(409, 'VC_CHAT_DELETED', '聊天身份已删除');
function expectedToken(value) {
    if (!validToken(value)) throw new F2Error(428, 'VC_REVISION_REQUIRED', '需要有效的读取基线');
    return { id: value.id, revision: value.revision };
}
function nextToken(token) {
    if (token.revision === Number.MAX_SAFE_INTEGER) throw conflict('聊天版本已达到安全整数上限');
    return { id: token.id, revision: token.revision + 1 };
}
function documentToken(chat) {
    const token = chat[0].chat_metadata?.vc_f2;
    if (token === undefined) return null;
    if (!validToken(token)) throw corrupt('JSONL 中的 F2 基线无效');
    return { id: token.id, revision: token.revision };
}
function validateChat(chat, error) {
    if (!Array.isArray(chat) || !chat.length || chat.some((row) => !isObject(row))
        || (chat[0].chat_metadata !== undefined && !isObject(chat[0].chat_metadata))) throw error;
    return chat;
}
function withToken(chat, token) {
    chat[0].chat_metadata = { ...chat[0].chat_metadata, vc_f2: token };
    return chat.map((row) => JSON.stringify(row)).join('\n') + '\n';
}
async function syncDirectory(dir) {
    const handle = await fs.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicWrite(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.vc-f2.tmp`;
    // 固定临时后缀由本模块保留；同 root 串行，重启后安全丢弃未提交的临时内容。
    await fs.rm(temp, { force: true });
    const handle = await fs.open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
    } finally { await handle.close(); }
    try {
        await fs.rename(temp, file);
        await syncDirectory(path.dirname(file));
    } finally { await fs.rm(temp, { force: true }); }
}
async function unlinkDurable(file) {
    try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await syncDirectory(path.dirname(file));
}
async function readDocument(file) {
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try { return validateChat(text.trim().split('\n').map((line) => JSON.parse(line)), corrupt()); }
    catch (error) { if (error instanceof F2Error) throw error; throw corrupt('JSONL 无法完整解析'); }
}

class F2Store {
    constructor(root) {
        this.root = root;
        this.aliases = new Set([root]);
        this.stateDir = path.join(root, '.vc-f2');
        this.tail = Promise.resolve();
    }
    async file(input) {
        if (typeof input !== 'string' || !input) throw new F2Error(400, 'VC_CHAT_PATH_INVALID', '聊天路径无效');
        let file = path.resolve(this.root, input);
        // macOS /var 与 /private/var 等用户根目录别名；仅认可 getF2Store 已 realpath 验证的根。
        for (const alias of this.aliases) {
            const relative = path.relative(alias, file);
            if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
                file = path.resolve(this.root, relative);
                break;
            }
        }
        const relative = path.relative(this.root, file);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
            || relative.split(path.sep)[0] === '.vc-f2' || file.endsWith('.vc-f2.tmp')) {
            throw new F2Error(400, 'VC_CHAT_PATH_INVALID', '聊天路径必须位于用户目录的非保留区域');
        }
        let current = this.root;
        for (const part of relative.split(path.sep)) {
            current = path.join(current, part);
            try {
                if ((await fs.lstat(current)).isSymbolicLink()) throw new F2Error(400, 'VC_CHAT_PATH_INVALID', '聊天路径不能经过符号链接');
            } catch (error) { if (error.code === 'ENOENT') break; throw error; }
        }
        return file;
    }
    relative(file) { return path.relative(this.root, file); }
    async records() {
        try {
            const info = await fs.lstat(this.stateDir);
            if (!info.isDirectory() || info.isSymbolicLink()) throw corrupt('身份目录不是普通目录');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await fs.mkdir(this.stateDir, { mode: 0o700 });
            await syncDirectory(this.root);
        }
        const records = new Map();
        for (const entry of await fs.readdir(this.stateDir, { withFileTypes: true })) {
            if (!entry.name.endsWith('.json')) continue;
            if (!entry.isFile()) throw corrupt('身份记录不是普通文件');
            let record;
            try { record = JSON.parse(await fs.readFile(path.join(this.stateDir, entry.name), 'utf8')); }
            catch { throw corrupt('身份记录无法解析'); }
            if (!isObject(record) || !uuid.test(record.id) || entry.name !== `${record.id}.json`
                || !['live', 'pending-create', 'renaming', 'deleted'].includes(record.state)) throw corrupt('身份记录格式无效');
            const names = record.state === 'renaming' ? ['from', 'to'] : ['path'];
            for (const key of names) {
                if (typeof record[key] !== 'string' || path.isAbsolute(record[key])) throw corrupt('身份记录路径无效');
                await this.file(record[key]);
            }
            if (['renaming', 'deleted'].includes(record.state)
                && (!Number.isSafeInteger(record.revision) || record.revision < 1)) throw corrupt('待完成操作版本无效');
            records.set(record.id, record);
        }
        return records;
    }
    async record(records, value) {
        await atomicWrite(path.join(this.stateDir, `${value.id}.json`), JSON.stringify(value) + '\n');
        records.set(value.id, value);
    }
    async recover(records) {
        for (const r of records.values()) {
            if (r.state === 'live') continue;
            if (r.state === 'pending-create') {
                const chat = await readDocument(await this.file(r.path));
                if (!chat) continue; // 没有快照副本；仅同 id/path expected=0 的 save 可重试。
                const token = documentToken(chat);
                if (token?.id !== r.id || ![0, 1].includes(token.revision)) throw corrupt('创建中身份与 JSONL 不符');
                await this.record(records, { id: r.id, state: 'live', path: r.path });
                continue;
            }
            if (r.state === 'deleted') {
                const file = await this.file(r.path);
                const chat = await readDocument(file);
                if (chat && documentToken(chat)?.id === r.id) {
                    if (documentToken(chat).revision !== r.revision - 1) throw corrupt('删除中身份版本不符');
                    await unlinkDurable(file);
                }
                continue; // 新 identity 可合法重用旧路径，墓碑不得删除它。
            }
            const source = await this.file(r.from), target = await this.file(r.to);
            const oldChat = await readDocument(source), newChat = await readDocument(target);
            const before = { id: r.id, revision: r.revision - 1 }, after = { id: r.id, revision: r.revision };
            if (oldChat && !sameToken(documentToken(oldChat), before)) throw corrupt('改名源身份版本不符');
            if (newChat && !sameToken(documentToken(newChat), after)) throw corrupt('改名目标已被其他内容占用');
            if (!oldChat && !newChat) throw corrupt('改名的源和目标均不存在');
            if (!newChat) await atomicWrite(target, withToken(oldChat, after));
            if (oldChat) await unlinkDurable(source);
            await this.record(records, { id: r.id, state: 'live', path: r.to });
        }
    }
    run(operation) {
        const result = this.tail.then(async () => {
            const records = await this.records();
            await this.recover(records);
            return operation(records);
        });
        this.tail = result.catch(() => {}); // 仅释放队列；调用者仍收到原始拒绝。
        return result;
    }
    // Account deletion drains the same queue but must also work when its
    // obsolete identity index is corrupt. The host has already frozen access.
    removeAccountData() {
        const result = this.tail.then(async () => {
            await fs.rm(this.root, { recursive: true, force: true });
            await syncDirectory(path.dirname(this.root));
        });
        this.tail = result.catch(() => {});
        return result;
    }
    assertPathFree(records, file, id) {
        const relative = this.relative(file);
        for (const r of records.values()) {
            if (r.id === id || r.state === 'deleted') continue;
            if (r.path === relative || r.from === relative || r.to === relative) throw conflict('聊天路径已有其他身份');
        }
    }
    async current(records, file) {
        const chat = await readDocument(file);
        if (!chat) return null;
        let token = documentToken(chat);
        let sourceChanged;
        try { sourceChanged = reconcileSourceIdentities(chat, chat); }
        catch { throw corrupt('持久来源身份损坏'); }
        const legacy = !token;
        if (!token) {
            this.assertPathFree(records, file, null);
            token = { id: randomUUID(), revision: 0 };
        }
        const r = records.get(token.id);
        if (r?.state === 'deleted') throw deleted();
        if (r && r.path !== this.relative(file)) throw conflict('聊天身份已移动到其他路径');
        this.assertPathFree(records, file, token.id);
        if (legacy || sourceChanged) {
            if (!legacy) token = nextToken(token);
            await atomicWrite(file, withToken(chat, token));
        }
        if (!r || r.state !== 'live') await this.record(records, { id: token.id, state: 'live', path: this.relative(file) });
        return { chat, token };
    }
    async read(input) {
        return this.run(async (records) => (await this.current(records, await this.file(input)))?.chat ?? []);
    }
    async sourceSnapshot(id, revision) {
        if (typeof id !== 'string' || !uuid.test(id)) throw new F2Error(400, 'VC_CHAT_INVALID', '来源身份无效');
        return this.run(async (records) => {
            const record = records.get(id);
            if (!record) return { chatIdentity: id, state: 'UNKNOWN' };
            if (record.state === 'deleted') return { chatIdentity: id, state: 'DELETED', revision: record.revision };
            try {
                const current = await this.current(records, await this.file(record.path));
                if (!current || current.token.id !== id) return { chatIdentity: id, state: 'UNAVAILABLE' };
                const result = { chatIdentity: id, state: 'PRESENT', revision: current.token.revision, location: record.path };
                if (revision === current.token.revision) return { ...result, notModified: true };
                return { ...result, messages: sourceMessages(current.chat) };
            } catch { return { chatIdentity: id, state: 'UNAVAILABLE' }; }
        });
    }
    async save(input, chatArray, { expected, parent, beforeCommit } = {}) {
        const base = expectedToken(expected), parentBase = parent === undefined ? null : expectedToken(parent);
        let snapshot;
        try {
            snapshot = validateChat(structuredClone(chatArray), new F2Error(400, 'VC_CHAT_INVALID', '聊天快照无效'));
            // 尽早拒绝无法编码的数据；排队前固定调用者的编辑快照。
            snapshot = validateChat(JSON.parse(JSON.stringify(snapshot)), new F2Error(400, 'VC_CHAT_INVALID', '聊天快照无效'));
        } catch (error) { if (error instanceof F2Error) throw error; throw new F2Error(400, 'VC_CHAT_INVALID', '聊天快照无法编码'); }
        return this.run(async (records) => {
            const file = await this.file(input);
            const r = records.get(base.id);
            if (r?.state === 'deleted') throw deleted();
            if (r && r.path !== this.relative(file)) throw conflict('聊天身份与目标路径不符');
            const current = await this.current(records, file);
            if (current) {
                if (parentBase || !sameToken(current.token, base)) throw conflict();
            } else {
                if (base.revision !== 0 || (r && r.state !== 'pending-create')) throw conflict('新聊天只能使用未提交的初始基线');
                this.assertPathFree(records, file, base.id);
                if (parentBase) {
                    const parentRecord = records.get(parentBase.id);
                    if (parentBase.id === base.id || parentRecord?.state !== 'live') throw conflict('分支父身份无效');
                    const source = await readDocument(await this.file(parentRecord.path));
                    if (!source || !sameToken(documentToken(source), parentBase)) throw conflict('分支父读取基线已失效');
                }
            }
            if (beforeCommit) await beforeCommit();
            if (!current && !r) await this.record(records, { id: base.id, state: 'pending-create', path: this.relative(file) });
            const token = nextToken(base);
            reconcileSourceIdentities(snapshot, current?.chat ?? []);
            await atomicWrite(file, withToken(snapshot, token));
            if (!current) await this.record(records, { id: base.id, state: 'live', path: this.relative(file) });
            return token;
        });
    }
    async rename(input, destination, { expected } = {}) {
        const base = expectedToken(expected);
        return this.run(async (records) => {
            if (records.get(base.id)?.state === 'deleted') throw deleted();
            const source = await this.file(input), target = await this.file(destination);
            const current = await this.current(records, source);
            if (!current || !sameToken(current.token, base)) throw conflict();
            try { await fs.lstat(target); throw conflict('改名目标已存在'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            this.assertPathFree(records, target, base.id);
            const token = nextToken(base);
            await this.record(records, { id: base.id, state: 'renaming', from: this.relative(source), to: this.relative(target), revision: token.revision });
            await this.recover(records);
            return token;
        });
    }
    async remove(input, { expected } = {}) {
        const base = expectedToken(expected);
        return this.run(async (records) => {
            if (records.get(base.id)?.state === 'deleted') throw deleted();
            const file = await this.file(input), current = await this.current(records, file);
            if (!current || !sameToken(current.token, base)) throw conflict();
            const token = nextToken(base);
            await this.record(records, { id: base.id, state: 'deleted', path: this.relative(file), revision: token.revision });
            await unlinkDurable(file);
            return token;
        });
    }
    // 角色/群组的真实批量消费者：全部基线先核验，再在同一 owner 锁内逐项提交。
    // 不承诺跨多个文件的事务回滚；每项中断均使用同一 pending/tombstone 协议恢复。
    async mutateMany(operations, before = async () => {}, { directory } = {}) {
        const inputs = operations.map((op) => ({ ...op, expected: expectedToken(op.expected) }));
        return this.run(async (records) => {
            const prepared = [];
            const used = new Set();
            for (const op of inputs) {
                if (!['remove', 'rename'].includes(op.kind)) throw new F2Error(400, 'VC_CHAT_INVALID', '批量操作类型无效');
                const file = await this.file(op.file);
                if (used.has(file)) throw conflict('批量操作包含重复聊天');
                used.add(file);
                if (records.get(op.expected.id)?.state === 'deleted') throw deleted();
                const current = await this.current(records, file);
                if (!current || !sameToken(current.token, op.expected)) throw conflict();
                let to;
                if (op.kind === 'rename') {
                    to = await this.file(op.to);
                    if (used.has(to)) throw conflict('批量操作目标重叠');
                    used.add(to);
                    try { await fs.lstat(to); throw conflict('改名目标已存在'); }
                    catch (error) { if (error.code !== 'ENOENT') throw error; }
                    this.assertPathFree(records, to, op.expected.id);
                }
                prepared.push({ ...op, file, to, token: nextToken(op.expected) });
            }
            if (directory !== undefined) {
                const dir = await this.file(directory);
                let entries;
                try { entries = await fs.readdir(dir, { withFileTypes: true }); }
                catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
                const actual = new Set(entries.filter((entry) => entry.name.endsWith('.jsonl')).map((entry) => path.join(dir, entry.name)));
                for (const r of records.values()) {
                    if (['live', 'pending-create'].includes(r.state) && path.dirname(path.join(this.root, r.path)) === dir) actual.add(path.join(this.root, r.path));
                }
                if (actual.size !== prepared.length || prepared.some((op) => !actual.has(op.file))) throw conflict('聊天目录目标已变化，请重新读取');
            }
            await before();
            const result = [];
            for (const op of prepared) {
                if (op.kind === 'remove') {
                    await this.record(records, { id: op.token.id, state: 'deleted', path: this.relative(op.file), revision: op.token.revision });
                    await unlinkDurable(op.file);
                } else {
                    await this.record(records, { id: op.token.id, state: 'renaming', from: this.relative(op.file), to: this.relative(op.to), revision: op.token.revision });
                    await this.recover(records);
                }
                result.push(op.token);
            }
            return result;
        });
    }
    // 仅供监听 HTTP 前的上游旧格式迁移。既有 F2 身份（包括墓碑）不能借迁移重置基线。
    async migrateLegacy(input, chatArray) {
        const snapshot = validateChat(structuredClone(chatArray), new F2Error(400, 'VC_CHAT_INVALID', '旧格式迁移内容无效'));
        if (snapshot[0].chat_metadata?.vc_f2 !== undefined || snapshot[0].chat_metadata?.vc_f2_parent !== undefined) throw conflict('旧格式迁移不能携带 F2 身份');
        return this.run(async (records) => {
            const file = await this.file(input), current = await readDocument(file);
            if (!current) throw conflict('迁移源文件不存在');
            if (documentToken(current) || [...records.values()].some((r) => r.path === this.relative(file))) throw conflict('已有 F2 身份不能执行旧格式迁移');
            const token = { id: randomUUID(), revision: 0 };
            reconcileSourceIdentities(snapshot);
            await atomicWrite(file, withToken(snapshot, token));
            await this.record(records, { id: token.id, state: 'live', path: this.relative(file) });
            return token;
        });
    }
}

export function getF2Store(userRoot) {
    const alias = path.resolve(userRoot);
    const root = realpathSync(alias);
    if (!stores.has(root)) stores.set(root, new F2Store(root));
    stores.get(root).aliases.add(alias);
    return stores.get(root);
}
