// VO-2: real Go/PostgreSQL/MinIO, with deterministic private HTTP TTS only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

export async function sceneVoiceBackend(ctx) {
    const call = async (method, path, body, expected = 200) => {
        const response = await ctx.admin.call(method, path, body);
        if (response.status !== expected) throw new Error(`voice API ${method}: expected ${expected}, received ${response.status}`);
        return response.json;
    };
    const fixtureBase = `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}`;
    const fixtureState = async () => (await fetch(`${fixtureBase}/__voice/state`)).json();
    const control = async (engine, plan = {}) => {
        await waitFor(async () => (await fixtureState())[engine]?.active === 0 || !(await fixtureState())[engine], { label: 'voice fixture idle', timeoutMs: 5000 });
        const response = await fetch(`${fixtureBase}/__voice/ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine, ...plan }) });
        assert.equal(response.status, 200, 'fixture control');
    };
    const ready = (id, expected = 'ready') => waitFor(async () => {
        const clip = await call('GET', `/api/v1/voice-clips/${id}`);
        if (clip.status === expected) return clip;
        if (['ready', 'failed', 'expired'].includes(clip.status)) throw new Error('unexpected terminal voice state');
        return false;
    }, { label: 'voice completion', timeoutMs: 15000, intervalMs: 80 });
    let settings = await call('GET', '/api/v1/voice/settings');
    assert.equal(settings.revision, 0, 'virtual settings revision');
    const saveSettings = async (changes = {}) => {
        const { revision, updatedAt, ...values } = settings;
        settings = await call('PUT', '/api/v1/voice/settings', { ...values, ...changes, expectedRevision: revision });
        return settings;
    };
    const original = { ...settings };
    await saveSettings();
    const { revision, updatedAt, ...originalValues } = original;
    const conflict = await call('PUT', '/api/v1/voice/settings', { ...originalValues, expectedRevision: 0 }, 409);
    assert.equal(conflict.code, 'REVISION_CONFLICT', 'stale settings conflict');
    assert.equal((await call('GET', '/api/v1/voice/settings')).revision, 1, 'settings readback');
    const engines = await call('GET', '/api/v1/voice/engines');
    assert.equal(engines.tts.length, 2);
    assert.ok(engines.tts.every((engine) => engine.configured && engine.healthy && engine.enabled));
    assert.ok(!JSON.stringify(engines).includes('127.0.0.1'), 'private engine URL hidden');
    assert.equal(engines.asr.enabled, false, 'ASR stays outside VO-2');

    let nativeAudioHeaders = null;
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        fetchImpl: async (url, init) => {
            const audioRequest = String(url).includes('/api/plugins/virtual-companion/go/api/v1/voice-clips/') && String(url).endsWith('/audio');
            const response = await fetch(url, audioRequest ? { ...init, headers: { ...init.headers, Range: 'bytes=0-3' } } : init);
            if (audioRequest) nativeAudioHeaders = { contentRange: response.headers.get('content-range') };
            return response;
        },
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const card = await importSyntheticCard(st, 'VO-2 fixture');
    const file = `VO2-${crypto.randomUUID()}`;
    const token = { id: crypto.randomUUID(), revision: 0 };
    const sourceText = 'VO2_SYNTHETIC_SOURCE';
    const rows = [{ chat_metadata: { vc_f2: token } },
        { name: 'fixture user', is_user: true, mes: 'VO2_SYNTHETIC_INPUT', send_date: new Date().toISOString(), extra: {} },
        { name: card.name, is_user: false, mes: sourceText, send_date: new Date().toISOString(), extra: {} }];
    prepareSourceIdentities(rows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
    const save = async (chat) => {
        const response = await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat, force: false });
        assert.equal(response.status, 200, 'save synthetic source');
    };
    await save(rows);
    const binding = await call('POST', '/api/v1/st/bindings', { chatIdentity: token.id, characterRef: crypto.randomUUID(), mode: 'COMPANION', displayName: 'VO-2 fixture' });
    const relationshipId = String(binding.relationshipId);
    const owner = String(ctx.w05.ownerId);
    assert.match(relationshipId, /^[1-9][0-9]{0,18}$/); assert.match(owner, /^[1-9][0-9]{0,18}$/);
    await call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [token.id] });
    const source = ctx.w10.psql(`SELECT s.source_ref FROM vc.st_message_source s JOIN vc.conversation c
        ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
        WHERE c.owner_user_id=${owner} AND c.relationship_id=${relationshipId} AND s.role='assistant' AND s.present;`).trim();
    assert.ok(source.startsWith('st:'), 'authoritative source reference');
    let relationship = (await call('GET', '/api/v1/relationships')).find((row) => String(row.relationshipId) === relationshipId);
    const preferences = Object.fromEntries(['replyLength', 'initiative', 'humor', 'advicePref', 'remindersAllowed', 'memoryShareScope', 'avoidTopics', 'gender', 'avatarRef'].map((key) => [key, relationship[key]]));
    relationship = await call('PATCH', `/api/v1/relationships/${relationshipId}`, { ...preferences, kokoroVoice: 'zm_010', cosyVoice: null, speed: 1.1, voiceFrequency: 'STANDARD', proactiveVoice: true });
    assert.equal(relationship.kokoroVoice, 'zm_010'); assert.equal(relationship.speed, 1.1);
    const [created, duplicate] = await Promise.all([0, 1].map(() => call('POST', `/api/v1/relationships/${relationshipId}/voice-clips`, { messageRef: source, text: sourceText, purpose: 'chat' }, 202)));
    assert.equal(created.clipId, duplicate.clipId, 'idempotent message request');
    const clip = await ready(created.clipId);
    assert.equal(clip.durationMs, 1000); assert.equal(clip.voice, 'zm_010');
    assert.equal((await fixtureState()).kokoro.calls, 1, 'concurrent duplicate submits synthesize once');
    assert.ok(!Object.hasOwn(clip, 'objectKey'), 'private object key hidden');
    await call('POST', `/api/v1/relationships/${relationshipId}/voice-clips`, { messageRef: source, text: 'TAMPERED_FIXTURE', purpose: 'chat' }, 400);
    const audio = (id, range, anonymous = false) => fetch(`${ctx.w05.goBase}/api/v1/voice-clips/${id}/audio`, {
        headers: { ...(anonymous ? {} : { Cookie: `vc_session=${ctx.secrets.session.vcSession}` }), ...(range ? { Range: range } : {}) },
    });
    let response = await audio(created.clipId, 'bytes=0-3');
    assert.equal(response.status, 206); assert.equal(await response.text(), 'RIFF');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const bridged = await st.call('GET', `/api/plugins/virtual-companion/go/api/v1/voice-clips/${created.clipId}/audio`);
    assert.equal(bridged.status, 206, 'native host bridge audio');
    assert.equal(nativeAudioHeaders.contentRange, 'bytes 0-3/48044');
    assert.equal(bridged.text, 'RIFF');
    response = await audio(created.clipId, 'bytes=-4');
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 4);
    assert.equal((await audio(created.clipId, 'bytes=999999-')).status, 416);
    assert.equal((await audio(created.clipId, '', true)).status, 401);
    const preview = (engine = 'kokoro') => call('POST', '/api/v1/voice/preview', { relationshipId, engine, voice: engine === 'kokoro' ? 'zf_001' : 'default', speed: 1 }, 202);
    await saveSettings({ kokoroEnabled: false });
    const disabledDuplicate = await call('POST', `/api/v1/relationships/${relationshipId}/voice-clips`, { messageRef: source, text: sourceText, purpose: 'chat' }, 202);
    assert.equal(disabledDuplicate.clipId, created.clipId, 'engine switch does not break idempotency');
    await call('POST', '/api/v1/voice/preview', { relationshipId, engine: 'kokoro', voice: 'zf_001' }, 503);
    await saveSettings({ kokoroEnabled: true });

    for (const [status, errorKind] of [[400, 'bad_request'], [500, 'upstream_error']]) {
        await control('kokoro', { status, failures: -1 });
        const failed = await ready((await preview()).clipId, 'failed');
        assert.equal(failed.errorKind, errorKind, 'nonretryable failure class');
        assert.equal((await fixtureState()).kokoro.calls, 1, 'non-429 does not retry');
    }
    await control('kokoro', { status: 429, failures: 1 });
    await ready((await preview()).clipId);
    assert.equal((await fixtureState()).kokoro.calls, 2, 'one busy response then recovery');
    await control('kokoro', { status: 429, failures: -1 });
    assert.equal((await ready((await preview()).clipId, 'failed')).errorKind, 'rate_limited');
    assert.equal((await fixtureState()).kokoro.calls, 4, 'at most three retries');
    await saveSettings({ kokoroTimeoutSeconds: 1 });
    await control('kokoro', { delayMs: 1800 });
    assert.equal((await ready((await preview()).clipId, 'failed')).errorKind, 'timeout');
    assert.equal((await fixtureState()).kokoro.calls, 1, 'timeout is not retried');
    await control('kokoro', { delayMs: 60 });
    const concurrent = await Promise.all([preview(), preview(), preview()]);
    await Promise.all(concurrent.map((queued) => ready(queued.clipId)));
    const kokoState = (await fixtureState()).kokoro;
    assert.equal(kokoState.calls, 3); assert.equal(kokoState.maxActive, 1, 'Kokoro serialized');
    assert.ok(kokoState.requests.every((request) => !request.hasInstructions), 'Kokoro instructions excluded');
    await control('cosyvoice');
    await ready((await preview('cosyvoice')).clipId);
    const cosyState = (await fixtureState()).cosyvoice;
    assert.equal(cosyState.maxActive, 1);
    assert.ok(cosyState.requests.every((request) => request.model === 'cosyvoice3-q8' && request.hasInstructions && request.stream === false), 'CosyVoice request contract');

    // A real persisted source edit removes access before object cleanup.
    const currentChat = await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file });
    assert.equal(currentChat.status, 200, 'read current source revision');
    const edited = currentChat.json;
    edited[2].mes = 'VO2_SYNTHETIC_EDIT';
    prepareSourceIdentities(edited, { settled: true, sourceTimezone: 'Asia/Shanghai' });
    await save(edited);
    await call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [token.id] });
    await call('GET', `/api/v1/voice-clips/${created.clipId}`, undefined, 404);
    assert.equal((await audio(created.clipId)).status, 404, 'edited source audio unavailable');
    await waitFor(() => ctx.w10.psql(`SELECT count(*) FROM vc.voice_object_cleanup WHERE object_key='${owner}/${relationshipId}/${created.clipId}.wav';`).trim() === '0', { label: 'voice MinIO cleanup consumed', timeoutMs: 10000 });
    await saveSettings({ dailyChatLimit: 0 });
    const freshSource = ctx.w10.psql(`SELECT s.source_ref FROM vc.st_message_source s JOIN vc.conversation c
        ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
        WHERE c.owner_user_id=${owner} AND c.relationship_id=${relationshipId} AND s.role='assistant' AND s.present;`).trim();
    await call('POST', `/api/v1/relationships/${relationshipId}/voice-clips`, { messageRef: freshSource, text: edited[2].mes, purpose: 'chat' }, 429);
    // Previews remain available with chat quota zero.
    await control('kokoro');
    const lastPreview = await preview(); await ready(lastPreview.clipId);
    await call('DELETE', `/api/v1/relationships/${relationshipId}`);
    assert.equal((await audio(lastPreview.clipId)).status, 404, 'relationship cascade removes audio access');
    await waitFor(() => ctx.w10.psql(`SELECT count(*) FROM vc.voice_object_cleanup WHERE object_key='${owner}/${relationshipId}/${lastPreview.clipId}.wav';`).trim() === '0', { label: 'relationship audio cleanup consumed', timeoutMs: 10000 });
}

export const voiceBackendScene = {
    id: 'voice-backend',
    title: 'VO-2 语音后端：队列、失败回落、设置与私有音频',
    needs: ['go', 'stack', 'fixture'],
    default: false,
    run: sceneVoiceBackend,
};
