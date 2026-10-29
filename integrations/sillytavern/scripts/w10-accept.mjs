// W10 inbox 与本地通知验收。只连接本进程的 SMTP 与 Webhook，不访问外部邮件或飞书。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { createStClient } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const GREETING = 'w10-greeting-preview-must-stay-private';
const decimalId = /^[1-9][0-9]{0,18}$/;

function decodeQuotedPrintable(input) {
    const joined = input.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < joined.length; i += 1) {
        if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
            bytes.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(joined.charCodeAt(i) & 0xff);
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

function decodeWords(value) {
    return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _charset, encoding, text) => {
        if (encoding.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf8');
        return decodeQuotedPrintable(text.replace(/_/g, ' '));
    });
}

export function decodeCapturedMail(raw) {
    const unstuffed = String(raw).replace(/\r\n\.\./g, '\r\n.');
    const parts = unstuffed.split(/\r?\n\r?\n/);
    const header = parts.shift() || '';
    let body = parts.join('\r\n\r\n');
    const unfolded = header.replace(/\r?\n[ \t]+/g, ' ');
    const encoding = /content-transfer-encoding:\s*([^\r\n;]+)/i.exec(unfolded)?.[1]?.trim().toLowerCase() || '';
    const subject = decodeWords((/subject:\s*([^\r\n]*)/i.exec(unfolded)?.[1] || '').trim());
    if (encoding === 'base64') body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
    else if (encoding === 'quoted-printable') body = decodeQuotedPrintable(body);
    return `${subject}\n${body}`;
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
}

export async function startW10Capture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-w10-smtp-'));
    fs.chmodSync(dir, 0o700);
    const keyFile = path.join(dir, 'key.pem');
    const certFile = path.join(dir, 'cert.pem');
    const configFile = path.join(dir, 'openssl.cnf');
    fs.writeFileSync(configFile, [
        '[req]', 'distinguished_name=dn', 'x509_extensions=v3', 'prompt=no',
        '[dn]', 'CN=127.0.0.1',
        '[v3]', 'subjectAltName=IP:127.0.0.1,DNS:localhost', 'basicConstraints=CA:TRUE',
        '',
    ].join('\n'), { mode: 0o600 });
    const issued = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyFile, '-out', certFile, '-days', '1',
        '-config', configFile, '-extensions', 'v3',
    ], { encoding: 'utf8' });
    if (issued.status !== 0) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error('本地 SMTP 证书生成失败');
    }
    fs.chmodSync(keyFile, 0o600);
    fs.chmodSync(certFile, 0o600);
    const capture = {
        dir, keyFile, caFile: certFile,
        smtpPassword: crypto.randomBytes(18).toString('hex'),
        signSecret: crypto.randomBytes(18).toString('hex'),
        smtpTexts: [],
        feishuTexts: [],
        servers: [],
        sockets: new Set(),
    };
    const track = (socket) => {
        capture.sockets.add(socket);
        socket.on('close', () => capture.sockets.delete(socket));
    };
    const smtp = tls.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, (socket) => {
        track(socket);
        let buffer = '';
        let mode = 'cmd';
        let data = '';
        socket.write('220 localhost\r\n');
        socket.on('data', (chunk) => {
            buffer += chunk.toString('latin1');
            for (;;) {
                if (mode === 'data') {
                    const end = buffer.indexOf('\r\n.\r\n');
                    if (end < 0) return;
                    data += buffer.slice(0, end);
                    buffer = buffer.slice(end + 5);
                    mode = 'cmd';
                    capture.smtpTexts.push(data);
                    data = '';
                    socket.write('250 OK\r\n');
                    continue;
                }
                const nl = buffer.indexOf('\r\n');
                if (nl < 0) return;
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 2);
                const upper = line.toUpperCase();
                if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
                else if (upper === 'AUTH PLAIN') socket.write('334\r\n');
                else if (upper.startsWith('AUTH PLAIN ')) socket.write('235 OK\r\n');
                else if (upper === 'DATA') {
                    mode = 'data';
                    socket.write('354 Go\r\n');
                } else if (upper === 'QUIT') {
                    socket.write('221 Bye\r\n');
                    socket.end();
                } else socket.write('250 OK\r\n');
            }
        });
    });
    smtp.on('connection', track);
    capture.smtpPort = await listen(smtp);
    capture.servers.push(smtp);
    const hook = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (typeof parsed?.content?.text === 'string') capture.feishuTexts.push(parsed.content.text);
            } catch {
                /* 非法体仍返回业务成功，让投递按响应码闭合。 */
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"code":0}');
        });
    });
    const hookPort = await listen(hook);
    capture.servers.push(hook);
    capture.webhookURL = `http://127.0.0.1:${hookPort}/hook`;
    return capture;
}

export async function stopW10Capture(capture) {
    if (!capture) return;
    for (const socket of capture.sockets) socket.destroy();
    await Promise.all(capture.servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    fs.rmSync(capture.dir, { recursive: true, force: true });
}

function assertNotice(text, conversationId, { waiting = false, feishu = false } = {}) {
    const required = waiting ? '有待继续的互动' : '有一条新的陪伴消息';
    assert.equal(text.includes(required), true, waiting ? '缺少待继续提示' : '缺少通知标题');
    assert.equal(text.includes('请登录后查看。'), true, '缺少登录提示');
    if (feishu) assert.equal(text.includes('此消息对群内成员可见。'), true, '缺少群可见说明');
    assert.equal(text.includes(`/api/v1/conversations/${conversationId}`), true, '缺少受登录保护的会话链接');
    assert.equal(text.includes(GREETING), false, '通知包含正文预览');
}

async function poll(read, label, timeoutMs = 20000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        last = read();
        if (last === true) return;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(label);
}

export async function sceneInboxNotify(ctx) {
    const capture = ctx.w10?.capture;
    if (!capture) throw new Error('本地捕获未启动');
    const owner = String(ctx.w05.ownerId);
    if (!decimalId.test(owner)) throw new Error('账号编号无效');
    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const reauth = await ctx.admin.reauth(ctx.secrets.password);
    if (!reauth.ok) throw new Error(`重新认证失败 ${reauth.status}`);
    const card = await importSyntheticCard(st, 'W10 通知');
    const file = `W10-${crypto.randomUUID()}`;
    const token = { id: crypto.randomUUID(), revision: 0 };
    const chat = [{ chat_metadata: { vc_f2: token } }, { name: '合成用户', is_user: true, mes: 'w10-user-line', extra: {} }];
    prepareSourceIdentities(chat, { settled: true });
    const save = (rows, force = false) => st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows, force });
    const read = async () => {
        const result = await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file });
        if (result.status !== 200 || !Array.isArray(result.json)) throw new Error(`读回聊天失败 ${result.status}`);
        return result.json;
    };
    if ((await save(chat)).status !== 200) throw new Error('初始保存失败');
    const binding = await ctx.admin.call('POST', '/api/v1/st/bindings', {
        chatIdentity: token.id, characterRef: crypto.randomUUID(), mode: 'COMPANION', displayName: 'W10通知',
    });
    if (binding.status !== 200) throw new Error(`绑定失败 ${binding.status}`);
    const relationshipId = String(binding.json.relationshipId);
    const conversationId = String(binding.json.conversationId);
    if (!decimalId.test(relationshipId) || !decimalId.test(conversationId)) throw new Error('绑定编号无效');
    const reconcile = async () => {
        const result = await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [token.id] });
        if (result.status !== 200) throw new Error(`对账失败 ${result.status}`);
        return result.json[0];
    };
    if ((await reconcile()).state !== 'PRESENT') throw new Error('绑定后的来源不是 PRESENT');
    const before = structuredClone(await read());
    const putChannel = async (channel, target, credential) => {
        const result = await ctx.admin.call('PUT', '/api/v1/notification-channels', {
            channel, enabled: true, configuredTarget: target, previewBody: false,
            relationshipIds: [relationshipId], credential,
        });
        if (result.status !== 200 || result.text.includes(capture.smtpPassword) || result.text.includes(capture.signSecret)) {
            throw new Error(`渠道保存失败 ${result.status}`);
        }
    };
    await putChannel('EMAIL', 'owner@example.test', `mailer\n${capture.smtpPassword}`);
    await putChannel('FEISHU', 'group-w10', `${capture.webhookURL}\n${capture.signSecret}`);
    const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType: 'PUSH_NOTIFICATION', version: 'w10-t4', granted: true });
    if (granted.status !== 200) throw new Error(`通知同意失败 ${granted.status}`);
    const policy = await ctx.admin.call('PUT', `/api/v1/relationships/${relationshipId}/proactive-policy`, {
        enabled: true, dailyLimit: 1, recentInteractionMinutes: 30, offlineCapable: true, allowedModes: ['COMPANION'],
    });
    if (policy.status !== 200) throw new Error(`主动策略失败 ${policy.status}`);
    const sql = (statement) => ctx.w10.psql(statement).trim();
    const insertFollowUp = (eventId, status) => {
        if (!/^[A-Za-z0-9_-]+$/.test(eventId)) throw new Error('事件号无效');
        const waiting = status === 'WAITING_HOST';
        sql(`INSERT INTO vc.follow_up(
            owner_user_id, id, relationship_id, body, status, normalization_status,
            event_id, deliverable, greeting_body, generation_outcome)
            VALUES (${owner}, nextval('vc.follow_up_id_seq'), ${relationshipId}, 'w10-topic-${eventId}',
            '${status}', 'none', '${eventId}', '${waiting ? 'NOT_DELIVERABLE' : 'DELIVERABLE'}',
            ${waiting ? 'NULL' : `'${GREETING}'`}, '${waiting ? 'WAITING_HOST' : 'BODY_READY'}');`);
    };
    const deliveries = (eventId) => JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object(
        'id', id, 'channel', channel, 'status', status, 'reason', coalesce(stopped_reason, '')) ORDER BY id), '[]'::json)
        FROM vc.notification_delivery WHERE owner_user_id=${owner} AND event_id='${eventId}';`) || '[]');
    const linkOf = (eventId) => sql(`SELECT link_status || ' ' || CASE WHEN st_delivered THEN 'delivered' ELSE 'open' END
        FROM vc.inbox_event WHERE owner_user_id=${owner} AND event_id='${eventId}';`);
    insertFollowUp('w10-body', 'BODY_READY');
    await poll(() => {
        const rows = deliveries('w10-body');
        return rows.length === 2 && rows.every((row) => row.status === 'accepted') && linkOf('w10-body') === 'present delivered';
    }, 'BODY_READY 未形成 inbox、ST ACK 和两渠道 accepted');
    const smtp = capture.smtpTexts.map(decodeCapturedMail);
    const feishu = capture.feishuTexts.slice();
    if (smtp.length !== 1 || feishu.length !== 1) throw new Error(`捕获数量 smtp=${smtp.length} feishu=${feishu.length}`);
    assertNotice(smtp[0], conversationId, {});
    assertNotice(feishu[0], conversationId, { feishu: true });
    const stale = await save(before, true);
    if (stale.status !== 409) throw new Error(`旧快照未被 F2 拒绝 ${stale.status}`);
    if (linkOf('w10-body') !== 'present delivered') throw new Error('旧快照拒绝后链接不再 present');
    const ids = deliveries('w10-body').map((row) => row.id).join(',');
    const current = await read();
    const kept = current.filter((row, index) => index === 0 || row?.extra?.vc_source?.inbox_event_id !== 'w10-body');
    if (kept.length === current.length) throw new Error('投影消息不在聊天里');
    if ((await save(kept)).status !== 200) throw new Error('删除投影消息失败');
    await reconcile();
    if (!linkOf('w10-body').startsWith('removed')) throw new Error('删除后链接不是 removed');
    if (deliveries('w10-body').map((row) => row.id).join(',') !== ids) throw new Error('删除投影消息后补投了');
    const chatCount = (await read()).length;
    insertFollowUp('w10-wait', 'WAITING_HOST');
    await poll(() => {
        const rows = deliveries('w10-wait');
        return rows.length === 2 && rows.every((row) => row.status === 'accepted');
    }, 'WAITING_HOST 两渠道未接受');
    const waited = await read();
    if (waited.length !== chatCount || waited.some((row) => row?.extra?.vc_source?.inbox_event_id === 'w10-wait')) {
        throw new Error('WAITING_HOST 写入了聊天');
    }
    for (const text of [...capture.smtpTexts.slice(1).map(decodeCapturedMail), ...capture.feishuTexts.slice(1)]) {
        assertNotice(text, conversationId, { waiting: true, feishu: capture.feishuTexts.slice(1).includes(text) });
    }
    const hour = new Date().getUTCHours();
    const pad = (value) => String(value).padStart(2, '0');
    const quiet = await ctx.admin.call('PUT', `/api/v1/relationships/${relationshipId}/proactive-policy`, {
        enabled: true, dailyLimit: 1, recentInteractionMinutes: 30, offlineCapable: true, allowedModes: ['COMPANION'],
        quietHoursStart: `${pad((hour - 2 + 24) % 24)}:00`,
        quietHoursEnd: `${pad((hour + 2) % 24)}:00`,
        quietHoursTimezone: 'UTC',
    });
    if (quiet.status !== 200) throw new Error(`quiet hours 策略失败 ${quiet.status}`);
    const smtpAtQuiet = capture.smtpTexts.length;
    const feishuAtQuiet = capture.feishuTexts.length;
    insertFollowUp('w10-quiet', 'BODY_READY');
    const quietStarted = Date.now();
    let quietRows = [];
    while (Date.now() - quietStarted < 8000) {
        if (capture.smtpTexts.length !== smtpAtQuiet || capture.feishuTexts.length !== feishuAtQuiet) throw new Error('quiet hours 内仍发送');
        quietRows = deliveries('w10-quiet');
        if (quietRows.length === 2 && quietRows.every((row) => row.status === 'pending')) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!(quietRows.length === 2 && quietRows.every((row) => row.status === 'pending'))) throw new Error('quiet hours 投递没有保持 pending');
    if (capture.smtpTexts.length !== smtpAtQuiet || capture.feishuTexts.length !== feishuAtQuiet) throw new Error('quiet hours 内仍发送');
    const withdrawn = await ctx.admin.call('PUT', '/api/v1/consents', {
        consentType: 'PUSH_NOTIFICATION', version: 'w10-t4', granted: false, currentPassword: ctx.secrets.password,
    });
    if (withdrawn.status !== 200) throw new Error(`撤回通知同意失败 ${withdrawn.status}`);
    await poll(() => deliveries('w10-quiet').length === 2 && deliveries('w10-quiet').every((row) => row.status === 'stopped' && row.reason === 'consent_withdrawn'), '撤回后未发送投递没有停止');
}
