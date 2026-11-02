// UX-28/31/32/33: synthetic managed data only. No browser or external notifications.
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { providerCatalogSpec } from './lib/accept-scene-helpers.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const BACKGROUND_SAMPLING = Object.freeze({ temperature: 0.3, topP: 0.8 });
const samplingOf = capture => ({ temperature: capture.body?.temperature, topP: capture.body?.top_p });

export function assertBackgroundSampling(samples) {
    const failed = Object.entries(samples).filter(([, calls]) => !calls.length || calls.some(call =>
        call.temperature !== BACKGROUND_SAMPLING.temperature || call.topP !== BACKGROUND_SAMPLING.topP)).map(([kind]) => kind);
    check(failed.length === 0, `background profile sampling mismatch: ${failed.join(', ')} (expected temperature=0.3, top_p=0.8)`);
}

function check(ok, label) { if (!ok) throw new Error(`UX24: ${label}`); }
function response(r, label, status = 200) {
    check(r.status === status, `${label}: HTTP ${r.status}, expected ${status}`);
    return r.json; // Never include response bodies or credentials in failure artifacts.
}
function id(value) {
    const text = String(value);
    check(/^[1-9][0-9]{0,18}$/.test(text), 'invalid synthetic ID');
    return text;
}
export function assertSuggestions(body, expected) {
    const items = body?.suggestions;
    check(Array.isArray(items) && items.length <= 3 && items.every(s => typeof s === 'string' && [...s].length > 0 && [...s].length <= 20), 'suggestion shape');
    check(JSON.stringify(items) === JSON.stringify(expected), 'suggestion fixture mismatch');
}

export async function verifySuggestions(ctx, relationshipId, model) {
    const sampling = [];
    const request = () => ctx.admin.call('POST', `/api/v1/relationships/${relationshipId}/reply-suggestions`, {
        messages: [{ role: 'character', text: '合成角色问候' }],
    });
    try {
        for (const [directive, expected] of [
            [{ text: '["好呀","慢慢说"]' }, ['好呀', '慢慢说']],
            [{ text: '[]' }, []],
            [{ error: { status: 500, message: 'synthetic failure' } }, []],
        ]) {
            await ctx.fixtureHttp.setOverride(model, directive);
            const since = (await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
            assertSuggestions(response(await request(), 'suggestions'), expected);
            const captures = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
            const requests = captures.filter(c => c.model === model);
            check(requests.length > 0, 'suggestion request did not reach fixture');
            sampling.push(...requests.map(samplingOf));
        }
    } finally { await ctx.fixtureHttp.setOverride(model, null); }
    return sampling;
}

// Scheduler runs every 30s. Allow 90s for the first page, then observe another
// 35s after its arrival. Use a safe local day so this observation cannot cross midnight.
export function diarySchedule(now = new Date()) {
    const shanghai = new Date(now.getTime() + 8 * 3600000);
    const nearMidnight = shanghai.getUTCHours() === 23 && shanghai.getUTCMinutes() >= 55;
    const offset = nearMidnight ? 0 : 8;
    const local = new Date(now.getTime() + offset * 3600000);
    const clock = minutes => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    return {
        day: local.toISOString().slice(0, 10), sourceTimestamp: now.toISOString(),
        quietHoursTimezone: nearMidnight ? 'UTC' : 'Asia/Shanghai',
        quietHoursStart: clock(minute + 60), quietHoursEnd: clock(minute + 540),
    };
}

export function assertDiaryOnce(before, current, calls) {
    check(before.pages === 0 && current.pages === 1, 'diary must create exactly one page');
    check(current.attempts === before.attempts + 1, 'diary must make exactly one model attempt');
    check(calls === 1, 'diary must reach fixture exactly once');
    check(Number.isFinite(current.cooldownUntil) && current.cooldownUntil > 0, 'diary attempt cooldown missing');
}

async function verifyDiary(ctx, { st, card, owner, relation, characterRef, policy }) {
    const schedule = diarySchedule();
    const base = `/api/v1/relationships/${relation}`;
    const marker = `ux24-diary-${crypto.randomUUID()}`;
    const body = '今天一起整理书签，我觉得这样慢慢待着也很好。';
    const moments = ['整理书签'];
    const stats = () => JSON.parse(ctx.w10.psql(`SELECT json_build_object(
        'pages', (SELECT count(*) FROM vc.diary_entry WHERE owner_user_id=${owner} AND relationship_id=${relation} AND day=DATE '${schedule.day}'),
        'attempts', (SELECT count(*) FROM vc.model_cost_reservation WHERE owner_user_id=${owner}
            AND provider_id='ux24-synthetic' AND model_id='ux24-background' AND provider_attempt_id LIKE 'proactive-${relation}-%-b'),
        'cooldownUntil', (SELECT extract(epoch FROM until_at)::double precision FROM vc.proactive_cooldown
            WHERE owner_user_id=${owner} AND relationship_id=${relation} AND cooldown_key='diary:attempt'));
    `).trim());
    const before = stats();
    check(before.pages === 0 && before.cooldownUntil === null, 'diary already attempted before synthetic setup');
    const since = (await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
    await ctx.fixtureHttp.setOverride('ux24-background', { text: JSON.stringify({ body, moments }) });
    const { dailyLimit, recentInteractionMinutes, offlineCapable, allowedModes, checkInAfterMinutes } = policy;
    response(await ctx.admin.call('PUT', `${base}/proactive-policy`, {
        enabled: false, mode: 'OFF', dailyLimit, recentInteractionMinutes, offlineCapable, allowedModes, checkInAfterMinutes,
        quietHoursStart: schedule.quietHoursStart, quietHoursEnd: schedule.quietHoursEnd, quietHoursTimezone: schedule.quietHoursTimezone,
    }), 'diary due policy');
    // New conversation, same synthetic relationship: no rewriting old source identity/time,
    // and no race with the reminder inbox delivery saving the earlier chat file.
    const token = { id: crypto.randomUUID(), revision: 0 };
    const rows = [{ chat_metadata: { vc_f2: token } },
        { name: '合成用户', is_user: true, mes: `今天整理了蓝色书签。${marker}`, send_date: schedule.sourceTimestamp, extra: {} }];
    prepareSourceIdentities(rows, { settled: true, sourceTimezone: schedule.quietHoursTimezone });
    response(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: marker, chat: rows }), 'save today diary source');
    const binding = response(await ctx.admin.call('POST', '/api/v1/st/bindings', {
        chatIdentity: token.id, characterRef, relationshipId: relation,
        mode: 'COMPANION', displayName: 'UX24 diary synthetic',
    }), 'bind today diary chat');
    check(binding.relationshipId === relation, 'diary binding changed relationship');
    response(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [token.id] }), 'reconcile today diary source');
    const conversation = id(binding.conversationId);
    check(ctx.w10.psql(`SELECT count(*) FROM vc.st_message_source s JOIN vc.conversation c
        ON c.owner_user_id=s.owner_user_id AND c.id=s.conversation_id
        WHERE s.owner_user_id=${owner} AND c.id=${conversation} AND c.relationship_id=${relation}
        AND c.st_mode='COMPANION' AND NOT c.incognito AND s.present AND NOT s.suppressed AND s.role='user'
        AND (s.source_timestamp AT TIME ZONE '${schedule.quietHoursTimezone}')::date=DATE '${schedule.day}';`).trim() === '1',
    'today non-incognito user source not persisted');
    const readMonth = async () => response(await ctx.admin.call('GET', `${base}/diary?month=${schedule.day.slice(0, 7)}`), 'diary month').items;
    const requests = async () => (await ctx.fixtureHttp.captures({ protocol: 'chat', since }))
        .filter(c => c.model === 'ux24-background' && JSON.stringify(c.body).includes('<vc-chat-day>') && JSON.stringify(c.body).includes(marker));
    let entry;
    await waitFor(async () => {
        entry = (await readMonth()).find(e => e.day === schedule.day);
        return Boolean(entry);
    }, { timeoutMs: 90000, intervalMs: 1000, label: 'UX24 real managed scheduler diary generation' });
    check(entry.relationshipId === relation && entry.body === body && JSON.stringify(entry.moments) === JSON.stringify(moments), 'generated diary month content mismatch');
    const entryId = id(entry.entryId);
    const single = response(await ctx.admin.call('GET', `/api/v1/diary/${entryId}`), 'generated diary single entry');
    check(single.entryId === entryId && single.day === schedule.day && single.body === body && JSON.stringify(single.moments) === JSON.stringify(moments), 'generated diary single entry mismatch');
    assertDiaryOnce(before, stats(), (await requests()).length);
    // Observe another complete 30s scheduler interval plus 5s slack. Counts include
    // model attempts, not just the unique page constraint (which could hide retries).
    await delay(35000);
    const entries = (await readMonth()).filter(e => e.day === schedule.day);
    check(entries.length === 1 && entries[0].entryId === entryId && entries[0].body === body, 'diary changed across scheduler interval');
    assertDiaryOnce(before, stats(), (await requests()).length);
    return { sampling: (await requests()).map(samplingOf), generated: true, monthAndEntryRead: true, singleModelAttempt: true, repeatObservationMs: 35000,
        generationTimeoutMs: 90000, incognitoExclusion: 'infra/db/tests/309_ux24_targets.sql (not run here)' };
}

export async function sceneUx24Backend(ctx) {
    await reauthForWrite(ctx);
    const owner = id(ctx.w05.ownerId), second = id(ctx.w05.secondId);
    check(owner !== second, 'owner isolation requires two owners');
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const at = time => `${day}T${time}+08:00`;
    const spec = providerCatalogSpec(ctx.secrets.fixtureKey)[0];
    // Dedicated fixture model avoids changing hl-proactive's response overrides.
    const provider = 'ux24-synthetic'; // This scene owns both ux24-* fixture overrides.
    const models = [
        { ...spec.models[0], profileKey: 'background', modelId: 'ux24-background',
            capabilities: { ...spec.models[0].capabilities, temperature: 'DECLARED', topP: 'DECLARED' },
            generationParams: { ...BACKGROUND_SAMPLING } },
        { ...spec.models[0], profileKey: 'memory', modelId: 'ux24-memory', contextWindowTokens: 32768, maxOutputTokens: 4096,
            capabilities: { ...spec.models[0].capabilities, temperature: 'DECLARED' } },
    ];
    response(await ctx.admin.saveProvider(provider, { displayName: 'UX24 synthetic', protocol: spec.protocol,
        baseUrl: spec.baseUrl, credential: spec.credential, state: 'ENABLED', models }), 'save fixture provider');
    const purposes = response(await ctx.admin.listPurposes(), 'purposes');
    const originals = purposes.filter(p => ['BACKGROUND_GREETINGS', 'MEMORY_EXTRACTION_DEDUP_SUMMARY'].includes(p.purpose));
    check(originals.length === 2, 'required purposes missing');
    const local = response(await ctx.admin.call('GET', '/api/v1/admin/local-models'), 'local models');
    let relation;
    try {
        for (const p of originals) response(await ctx.admin.savePurpose(p.purpose, { providerId: provider,
            profileKey: p.purpose === 'BACKGROUND_GREETINGS' ? 'background' : 'memory', state: 'ENABLED', expectedRevision: p.revision }), 'bind fixture purpose');
        response(await ctx.admin.call('PUT', '/api/v1/admin/local-models/rerank', { enabled: false, expectedRevision: local.rerank.revision }), 'disable optional rerank');
        // Same local embedding prerequisite as memory-browser; never pull/start a model here.
        const tags = await fetch('http://127.0.0.1:11438/api/tags', { signal: AbortSignal.timeout(5000) });
        check(tags.ok, 'local embedding unavailable');
        const embedding = (await tags.json()).models?.find(m => m.name === 'qwen3-embedding:0.6b');
        check(embedding, 'existing local embedding model required');
        const config = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
        check([200, 404].includes(config.status), 'read embedding config');
        response(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', { model: embedding.name, artifactVersion: embedding.digest,
            dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2',
            state: 'ENABLED', expectedRevision: config.status === 200 ? config.json.revision : 0 }), 'configure local embedding');
        const fact = '合成用户喜欢收集紫色玻璃书签。';
        const otherFact = '合成用户周末喜欢拼木质模型。';
        const sourceBody = fact + otherFact;
        await ctx.fixtureHttp.setOverride('ux24-memory', { memorycoreDocuments: [{ content: fact }, { content: otherFact }] });
        const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
            extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
        const card = await importSyntheticCard(st, 'UX24 synthetic');
        const file = `ux24-${crypto.randomUUID()}`, token = { id: crypto.randomUUID(), revision: 0 };
        const rows = [{ chat_metadata: { vc_f2: token } },
            { name: '合成用户', is_user: true, mes: sourceBody, send_date: at('09:00:00'), extra: {} }];
        prepareSourceIdentities(rows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
        response(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }), 'save synthetic chat');
        const binding = response(await ctx.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: token.id,
            characterRef: crypto.randomUUID(), mode: 'COMPANION', displayName: 'UX24 synthetic' }), 'bind chat');
        relation = id(binding.relationshipId);
        const base = `/api/v1/relationships/${relation}`;
        // Disable unsolicited proactive messages; explicit reminders still run before that gate.
        const policy = response(await ctx.admin.call('GET', `${base}/proactive-policy`), 'read proactive policy');
        const { dailyLimit, recentInteractionMinutes, offlineCapable, allowedModes,
            quietHoursStart, quietHoursEnd, quietHoursTimezone, checkInAfterMinutes } = policy;
        response(await ctx.admin.call('PUT', `${base}/proactive-policy`, { enabled: false, dailyLimit, recentInteractionMinutes,
            offlineCapable, allowedModes, quietHoursStart, quietHoursEnd, quietHoursTimezone, mode: 'OFF', checkInAfterMinutes }), 'disable proactive');
        response(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [token.id] }), 'reconcile chat');
        const readToken = async () => response(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file }), 'read chat')[0].chat_metadata.vc_f2;
        const recall = async () => {
            const current = await readToken();
            return response(await ctx.admin.call('POST', '/api/v1/st/memory/recall', {
                chatIdentity: current.id, revision: current.revision, enabled: true, budgetTokens: 1024,
            }), 'recall');
        };
        await recall(); // Existing source reconciliation/recall path queues production extraction.
        let published;
        await waitFor(async () => {
            const memories = response(await ctx.admin.call('GET', `${base}/memories`), 'list memories');
            published = memories.filter(m => [fact, otherFact].includes(m.summary) && m.recallEligible && m.lifecycle === 'ACTIVE');
            return new Set(published.map(m => m.summary)).size === 2;
        }, { timeoutMs: 90000, label: 'UX24 synthetic memory publication' });
        const beforePin = await recall();
        const memory = published.find(m => m.memoryId !== beforePin.memoryIds[0]);
        check(memory, 'need a memory outside the recall head to prove pin priority');
        const memoryId = id(memory.memoryId);
        check(response(await ctx.admin.call('PUT', `/api/v1/memories/${memoryId}/pin`, {}), 'pin').pinnedAt, 'pin not persisted');
        const recalled = await recall();
        check(recalled.memoryIds[0] === memoryId && recalled.block.includes(memory.summary), 'pinned memory missing from recall head');
        check(response(await ctx.admin.call('DELETE', `/api/v1/memories/${memoryId}/pin`), 'unpin').pinnedAt === null, 'unpin not persisted');

        const snapshot = { chatFile: file, mesId: 1, role: 'user', messageAt: at('09:00:00'), body: sourceBody };
        const favorite = response(await ctx.admin.call('POST', `${base}/favorites`, snapshot), 'create favorite');
        const favoriteId = id(favorite.favoriteId);
        check(favorite.body === sourceBody && favorite.chatFile === file && favorite.mesId === 1, 'favorite snapshot/source mismatch');
        check(response(await ctx.admin.call('GET', `${base}/favorites`), 'list favorites').items.some(f => f.favoriteId === favoriteId && f.body === sourceBody), 'favorite absent');
        // Foreign rows are seeded in the disposable PG, then accessed through the real owner API.
        const foreign = JSON.parse(ctx.w10.psql(`WITH r AS (
            INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES (${second},nextval('vc.relationship_id_seq'),'ux24-synthetic',false) RETURNING id
        ), f AS (INSERT INTO vc.favorite(owner_user_id,relationship_id,chat_file,mes_id,role,body)
            SELECT ${second},id,'ux24-synthetic',1,'user','synthetic foreign snapshot' FROM r RETURNING id,relationship_id)
            SELECT json_build_object('relationship',relationship_id::text,'favorite',id::text) FROM f;`).trim());
        const foreignRel = id(foreign.relationship), foreignFavorite = id(foreign.favorite);
        response(await ctx.admin.call('GET', `/api/v1/relationships/${foreignRel}/favorites`), 'foreign favorite list', 404);
        response(await ctx.admin.call('DELETE', `/api/v1/favorites/${foreignFavorite}`), 'foreign favorite delete', 404);
        check(ctx.w10.psql(`SELECT count(*) FROM vc.favorite WHERE owner_user_id=${second} AND id=${foreignFavorite};`).trim() === '1', 'foreign delete changed row');
        response(await ctx.admin.call('DELETE', `/api/v1/favorites/${favoriteId}`), 'delete favorite');
        check(response(await ctx.admin.call('GET', `${base}/favorites`), 'list after delete').items.length === 0, 'favorite survived delete');

        const suggestionsSampling = await verifySuggestions(ctx, relation, 'ux24-background');
        await ctx.fixtureHttp.setOverride('ux24-background', { text: '之前约好提醒你，现在到时间啦' });
        const createReminder = async (time, text) => response(await ctx.admin.call('POST', `${base}/reminders`, { text, remindAt: at(time), recurrence: 'NONE' }), 'create reminder');
        const due = await createReminder('10:00:00', '合成提醒一');
        const cancelled = await createReminder('11:00:00', '合成提醒二');
        id(due.reminderId); id(cancelled.reminderId);
        const active = response(await ctx.admin.call('GET', `${base}/reminders`), 'list reminders');
        check(active.length === 2 && active.every(r => r.status === 'ACTIVE'), 'active reminders mismatch');
        const runAt = async time => response(await ctx.admin.call('POST', `${base}/proactive-run`, { now: at(time) }), 'synthetic proactive pass');
        const inbox = async () => response(await ctx.admin.call('GET', '/api/v1/inbox'), 'inbox').filter(r => r.relationshipId === relation);
        await runAt('09:59:00'); check((await inbox()).length === 0, 'reminder delivered early');
        const delivered = await runAt('10:00:00');
        check(delivered.outcome === 'INBOX' && delivered.eventId, 'due reminder not delivered');
        check((await inbox()).length === 1, 'due reminder inbox count');
        await runAt('10:01:00'); check((await inbox()).length === 1, 'reminder delivered twice');
        response(await ctx.admin.call('DELETE', `/api/v1/reminders/${cancelled.reminderId}`), 'cancel reminder');
        await runAt('11:00:00'); check((await inbox()).length === 1, 'cancelled reminder delivered');
        check(response(await ctx.admin.call('GET', `${base}/reminders`), 'remaining reminders').length === 0, 'consumed/cancelled reminder remains active');
        const diary = await verifyDiary(ctx, { st, card, owner, relation, characterRef: binding.characterRef, policy });
        // Defer only sampling assertions so one RED run observes both real call paths.
        // Retain scalar sampling fields only, never request bodies in results/errors.
        assertBackgroundSampling({ suggestions: suggestionsSampling, diary: diary.sampling });
        ctx.results.ux24Backend = { memoryPinRecall: true, favorites: true, favoriteOwnerIsolation: true,
            suggestionsSuccessEmptyFailure: true, reminderDueCancelNoDuplicate: true, diary };
    } finally {
        for (const model of ['ux24-background', 'ux24-memory']) await ctx.fixtureHttp.setOverride(model, null);
        const current = response(await ctx.admin.listPurposes(), 'restore purposes');
        for (const p of originals) response(await ctx.admin.savePurpose(p.purpose, { providerId: p.providerId,
            profileKey: p.profileKey, state: p.state, expectedRevision: current.find(row => row.purpose === p.purpose).revision }), 'restore purpose');
        const latest = response(await ctx.admin.call('GET', '/api/v1/admin/local-models'), 'restore rerank read');
        response(await ctx.admin.call('PUT', '/api/v1/admin/local-models/rerank', { enabled: local.rerank.enabled,
            expectedRevision: latest.rerank.revision }), 'restore rerank');
    }
}

export const ux24BackendScene = {
    id: 'ux24-backend', title: 'UX24 后端：pin 召回、收藏隔离、提醒、建议回复与调度日记',
    needs: ['go', 'stack', 'fixture'], default: false, run: sceneUx24Backend,
};
