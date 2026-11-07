// SX-8 synthetic protocol acceptance through the actual ST + Go runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { write as cardPng } from '../upstream/SillyTavern/src/character-card-parser.js';
import { createF2Client } from '../extension/vc-model-settings/f2-logic.js';
import { waitFor } from './managed-lib.mjs';

const api = '/api/plugins/virtual-companion/go/api/v1/chats';
function check(value, step) { if (!value) throw new Error(`SX8 ${step}`); }

async function run(ctx) {
    const { st, origin, vcCsrf, signal } = ctx.sx7Chat;
    const root = path.join(ctx.w05.dataRoot, ctx.secrets.sx7Chat.handle);
    const characterRef = 'sx8-synthetic-character';
    const avatar = 'sx8-synthetic.png';
    await fs.mkdir(path.join(root, 'characters'), { recursive: true });
    const png = await fs.readFile(new URL('../upstream/SillyTavern/public/img/ai4.png', import.meta.url));
    await fs.writeFile(path.join(root, 'characters', avatar), cardPng(png, JSON.stringify({ spec: 'chara_card_v2', data: { name: 'SX8 synthetic', extensions: { vc_character_ref: characterRef } } })), { mode: 0o600 });
    await st.ensureCsrf();
    const call = async (method, target, body, status = 200) => {
        const response = await st.call(method, target, body, { origin, vcCsrf, signal });
        check(response.status === status, `protocol status ${response.status} expected ${status}`);
        return response;
    };
    const file = 'sx8-native-' + randomUUID();
    const sourcePath = `chats/${avatar.replace(/\.png$/, '')}/${file}.jsonl`;
    const drafts = [];
    const f2 = createF2Client({ uuid: randomUUID, getAuthorityEpoch: () => '2', onConflict: (draft, error) => drafts.push({ draft, code: error.code }) });
    const chat = [{ chat_metadata: {} }, { mes: 'synthetic initial', is_user: true, extra: { no_memory: true } }];
    f2.loaded(sourcePath, chat[0].chat_metadata);
    let sent;
    const send = async serialized => {
        sent = JSON.parse(serialized);
        const result = await st.call('POST', '/api/chats/save', sent, { origin, vcCsrf, signal });
        return Response.json(result.json, { status: result.status });
    };
    const first = await f2.save(sourcePath, { avatar_url: avatar, file_name: file, chat }, { live: true, send });
    check(first.vc_f2.revision === 1 && first.vc_f2.id === chat[0].chat_metadata.vc_f2.id && chat[1].vc_message_id && chat[1].extra.vc_source.id, 'native same-ID/+1 and canonical identities');
    const replay = await call('POST', '/api/chats/save', sent);
    check(replay.json.vc_f2.revision === 1, 'native exact request replay must not increment');
    const renamed = file + '-renamed';
    const rename = await call('POST', '/api/chats/rename', { avatar_url: avatar, original_file: file+'.jsonl', renamed_file: renamed+'.jsonl', vc_f2: first.vc_f2, vc_request_id: randomUUID(), vc_authority_epoch: '2' });
    check(rename.json.vc_f2.revision === 2, 'native rename single increment');
    const opened = (await call('POST', '/api/chats/get', { avatar_url: avatar, file_name: file })).json;
    check(opened[0].chat_metadata.vc_f2.id === first.vc_f2.id && opened[0].chat_metadata.vc_f2.revision === 2, 'old filename alias resolves current identity');
    const chatId = first.vc_f2.id;
    await call('POST', `${api}/${chatId}/messages`, { requestId: randomUUID(), authorityEpoch: '2', messages: [{ clientMessageId: randomUUID(), data: { mes: 'synthetic unrelated tail', is_user: true, extra: { no_memory: true } } }] }, 201);
    f2.loaded(sourcePath, opened[0].chat_metadata);
    opened[1].mes = 'synthetic serialized local draft';
    let conflict = false;
    try { await f2.save(sourcePath, { avatar_url: avatar, file_name: file, chat: opened }, { live: true, send }); }
    catch (error) { conflict = error.code === 'REVISION_CONFLICT'; }
    check(conflict && drafts.length === 1 && drafts[0].draft.includes('synthetic serialized local draft') && drafts[0].code === 'REVISION_CONFLICT', 'GO unrelated tail 409 retains frozen draft');
    const latest = (await call('POST', '/api/chats/get', { avatar_url: avatar, file_name: file })).json;
    check(latest.length === 3 && latest[1].mes === 'synthetic initial' && latest[2].mes === 'synthetic unrelated tail', 'conflicting save must not overwrite committed content');
    const child = structuredClone(latest);
    child[0].chat_metadata = f2.branchMetadata(latest[0].chat_metadata);
    const forkId = child[0].chat_metadata.vc_f2.id;
    const fork = await call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file+'-fork', chat: child, vc_authority_epoch: '2', vc_request_id: randomUUID() });
    check(fork.json.vc_f2.id === forkId && fork.json.vc_f2.revision === 1 && fork.json.chat[1].vc_message_id !== latest[1].vc_message_id && fork.json.chat[0].chat_metadata.vc_branch_root === latest[0].chat_metadata.vc_branch_root, 'native fork remaps identities and preserves branch');

    const old = randomUUID(), oldCandidate = randomUUID(), requestId = randomUUID();
    const raw = `{"extension":{"oldReference":"${old}"},"huge":900719925474099312345,"chat_metadata":{"variables":{"stage":7},"vc_f2":{"id":"${old}","revision":999}}}\n` +
        `{"mes":"synthetic imported","is_user":true,"vc_message_id":"${oldCandidate}","swipes":["synthetic imported","synthetic alternate"],"swipe_id":0,"variables":[{"trust":1},{"trust":2}],"extra":{"no_memory":true}}\n`;
    const form = content => {
        const upload = new FormData();
        upload.append('file', new Blob([content], { type: 'application/x-ndjson' }), 'ignored.jsonl');
        for (const [key, value] of Object.entries({ requestId, authorityEpoch: '2', kind: 'SINGLE', characterRef, mode: 'COMPANION' })) upload.append(key, value);
        return upload;
    };
    const acceptance = (await call('POST', api+'/imports', form(raw), 202)).json;
    const status = await waitFor(async () => {
        const result = (await call('GET', '/api/plugins/virtual-companion/go'+acceptance.statusUrl)).json;
        if (result.status === 'FAILED') throw new Error('SX8 public import failed');
        return result.status === 'DONE' ? result : null;
    }, { timeoutMs: 30000, label: 'SX8 public import' });
    check(status.chatId && status.chatId !== old && status.validatedMessages === 1 && status.validatedCandidates === 2 && status.unresolvedExtensionReferences >= 1, 'public import checkpoint counts/identity');
    const exportResponse = await call('GET', `${api}/${status.chatId}/export`);
    check(exportResponse.text.includes('900719925474099312345') && exportResponse.text.includes('synthetic alternate') && exportResponse.text.includes('"trust":2'), 'JSONL export unknown numbers/all swipes/variables');
    const again = (await call('POST', api+'/imports', form(raw), 202)).json;
    check(again.importId === acceptance.importId && again.status === 'PENDING', 'same import returns original acceptance');
    const badForm = form(raw+'invalid-final-line'); badForm.set('requestId', randomUUID());
    const bad = (await call('POST', api+'/imports', badForm, 202)).json;
    const failure = await waitFor(async () => {
        const result = (await call('GET', '/api/plugins/virtual-companion/go'+bad.statusUrl)).json;
        return result.status === 'FAILED' ? result : null;
    }, { timeoutMs: 30000, label: 'SX8 invalid final line' });
    check(failure.chatId === null && failure.issues.some(issue => issue.line === 3 && issue.reason === 'INVALID_JSON'), 'bad last line publishes no chat');
    check(!await fs.stat(path.join(root, sourcePath)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), 'GO native must not touch old JSONL');
}

export const sx8ChatTransferScene = { id: 'sx8-chat-transfer', title: 'SX8 真实Go native别名/fork/尾追加409留稿及异步JSONL导入导出', needs: ['go', 'stack'], default: false, run };
