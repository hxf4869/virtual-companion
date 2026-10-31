// HL-PROACTIVE 受管场景：CLOSE_FRIEND 在模拟时间下生成主动消息，并验证安静时段、每日上限、未回复上限和「在开会」暂停。
import crypto from 'node:crypto';
import { createStClient } from './managed-lib.mjs';
import { providerCatalogSpec } from './lib/accept-scene-helpers.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const decimalId = /^[1-9][0-9]{0,18}$/;
const SENTENCE = '有一阵没聊，想来跟你说句话';
const MOOD_LINE = '今天心情不错，话有点多';
const UNANSWERED = '对方上一条还没回你，可能在忙。你可以带一点点小情绪，比如假装不在意或者小声嘀咕，但别质问、别抱怨太多，轻一点。';

function policyBody(dailyLimit, checkInAfterMinutes = 120) {
    return {
        enabled: true,
        dailyLimit,
        recentInteractionMinutes: 0,
        offlineCapable: true,
        allowedModes: ['COMPANION'],
        quietHoursStart: '23:00',
        quietHoursEnd: '08:00',
        quietHoursTimezone: 'Asia/Shanghai',
        mode: 'CLOSE_FRIEND',
        checkInAfterMinutes,
    };
}

export async function sceneHlProactive(ctx) {
    // Keep the simulated conversation ahead of the real scheduler clock. Its
    // normal social-gap/throttle gates then isolate the forced clock passes.
    const baseDay=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const at=(days,time)=>{const d=new Date(`${baseDay}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return `${d.toISOString().slice(0,10)}T${time}+08:00`;};
    const owner = String(ctx.w05.ownerId);
    if (!decimalId.test(owner)) throw new Error('账号编号无效');
    const spec = providerCatalogSpec(ctx.secrets.fixtureKey)[0];
    const saved = await ctx.admin.saveProvider(spec.providerId, {
        displayName: spec.displayName, protocol: spec.protocol, baseUrl: spec.baseUrl,
        credential: spec.credential, state: spec.state, models: spec.models,
    });
    if (saved.status !== 200) throw new Error(`保存模型失败 ${saved.status} ${saved.text.slice(0, 200)}`);
    ctx.w10.psql(`INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
        VALUES ('vc03m-chat', 'vc03m-chat', 1, 0.001, 0.002, true)
        ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;`);
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`用途列表失败 ${purposes.status}`);
    const greetings = purposes.json.find((row) => row.purpose === 'BACKGROUND_GREETINGS');
    if (!greetings) throw new Error('BACKGROUND_GREETINGS 缺失');
    const bound = await ctx.admin.savePurpose('BACKGROUND_GREETINGS', {
        providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: greetings.revision,
    });
    if (bound.status !== 200) throw new Error(`绑定主动模型失败 ${bound.status} ${bound.text.slice(0, 200)}`);

    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const card = await importSyntheticCard(st, 'HL 主动');
    const file = `HL-${crypto.randomUUID()}`;
    const token = { id: crypto.randomUUID(), revision: 0 };
    const save = (rows, force = false) => st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows, force });
    const read = async () => {
        const result = await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file });
        if (result.status !== 200 || !Array.isArray(result.json)) throw new Error(`读回聊天失败 ${result.status}`);
        return result.json;
    };
    const chat = [{ chat_metadata: { vc_f2: token } }, { name: '合成用户', is_user: true, mes: '昨天还好', send_date: at(-2,'10:00:00'), extra: {} }];
    prepareSourceIdentities(chat, { settled: true, sourceTimezone: 'Asia/Shanghai' });
    if ((await save(chat)).status !== 200) throw new Error('初始保存失败');
    const binding = await ctx.admin.call('POST', '/api/v1/st/bindings', {
        chatIdentity: token.id, characterRef: crypto.randomUUID(), mode: 'COMPANION', displayName: 'HL主动',
    });
    if (binding.status !== 200) throw new Error(`绑定失败 ${binding.status} ${binding.text.slice(0, 200)}`);
    const relationshipId = String(binding.json.relationshipId);
    if (!decimalId.test(relationshipId)) throw new Error('关系编号无效');

    // VO-1: the contract-only migration must preserve existing host binding
    // and proactive behavior while installing owner-isolated voice storage.
    const voiceContract = JSON.parse(ctx.w10.psql(`SELECT json_build_object(
        'tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'vc' AND c.relname IN ('voice_clip', 'voice_settings')
              AND c.relrowsecurity AND c.relforcerowsecurity),
        'defaults', (SELECT kokoro_voice IS NULL AND cosy_voice IS NULL
            AND voice_speed = 1.0 AND voice_frequency IS NULL AND proactive_voice
            FROM vc.relationship WHERE owner_user_id = ${owner} AND id = ${relationshipId})
    )::text;`).trim());
    if (voiceContract.tables !== 2 || voiceContract.defaults !== true) {
        throw new Error('VO-1 语音存储隔离或关系默认值不符');
    }

    const reconcile = async () => {
        const current = (await read())[0]?.chat_metadata?.vc_f2;
        const result = await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [current?.id || token.id] });
        if (result.status !== 200 || result.json?.[0]?.state !== 'PRESENT') throw new Error(`对账失败 ${result.status}`);
        return (await read())[0].chat_metadata.vc_f2;
    };
    const speak = async (text, sendDate) => {
        const rows = await read();
        rows.push({ name: '合成用户', is_user: true, mes: text, send_date: sendDate, extra: {} });
        prepareSourceIdentities(rows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
        const savedChat = await save(rows);
        if (savedChat.status !== 200) throw new Error(`追加消息失败 ${savedChat.status}`);
        const current = await reconcile();
        const recall = await ctx.admin.call('POST', '/api/v1/st/memory/recall', {
            chatIdentity: current.id, revision: current.revision, enabled: true, budgetTokens: 1024,
        });
        if (recall.status !== 200) throw new Error(`召回失败 ${recall.status} ${recall.text.slice(0, 240)}`);
    };
    const putPolicy = async (dailyLimit, checkIn = 120) => {
        const result = await ctx.admin.call('PUT', `/api/v1/relationships/${relationshipId}/proactive-policy`, policyBody(dailyLimit, checkIn));
        if (result.status !== 200) throw new Error(`策略保存失败 ${result.status} ${result.text.slice(0, 240)}`);
        return result.json;
    };
    const runAt = async (iso) => {
        const result = await ctx.admin.call('POST', `/api/v1/relationships/${relationshipId}/proactive-run`, { now: iso });
        if (result.status !== 200) throw new Error(`主动推进 ${iso} HTTP ${result.status} ${result.text.slice(0, 300)}`);
        return result.json;
    };
    const expectGate = (result, reason, label) => {
        if (result.outcome !== 'GATED' || result.reason !== reason) {
            throw new Error(`${label}：得到 ${result.outcome}/${result.reason || ''}，期望 GATED/${reason}`);
        }
    };
    const inboxMine = async () => {
        const listed = await ctx.admin.call('GET', '/api/v1/inbox');
        if (listed.status !== 200 || !Array.isArray(listed.json)) throw new Error(`收件箱失败 ${listed.status}`);
        return listed.json.filter((row) => row.relationshipId === relationshipId && row.body === SENTENCE);
    };

    const created = await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/proactive-policy`);
    if (created.status !== 200) throw new Error(`读取默认策略失败 ${created.status}`);
    const defaults = created.json;
    if (defaults.mode !== 'CLOSE_FRIEND' || defaults.checkInAfterMinutes !== 720 || defaults.dailyLimit !== 3
        || defaults.enabled !== true || defaults.offlineCapable !== false
        || defaults.quietHoursStart !== '23:00' || defaults.quietHoursEnd !== '08:00'
        || defaults.quietHoursTimezone !== 'Asia/Shanghai') {
        throw new Error(`新关系默认策略不符 ${JSON.stringify(defaults)}`);
    }
    const rejected = await ctx.admin.call('PUT', `/api/v1/relationships/${relationshipId}/proactive-policy`, policyBody(3, 119));
    if (rejected.status !== 400) throw new Error(`check-in 119 应拒绝，得到 ${rejected.status}`);
    await putPolicy(3, 120);
    await reconcile();
    await speak('昨天还好', at(-2,'10:00:00'));

    expectGate(await runAt(at(-1,'23:30:00')), 'QUIET', '安静时段');
    await speak('我在开会', at(0,'09:00:00'));
    const busy = await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/companion-state`);
    if (busy.status !== 200 || !busy.json?.busyUntil) throw new Error(`开会后应有忙碌截止 ${busy.status} ${busy.text.slice(0, 240)}`);
    expectGate(await runAt(at(0,'10:00:00')), 'BUSY', '开会暂停');

    await speak('我回来了', at(-2,'18:00:00'));
    const clear = await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/companion-state`);
    if (clear.status !== 200 || clear.json?.busyUntil) throw new Error(`回来后忙碌应结束 ${clear.text.slice(0, 240)}`);
    ctx.w10.psql(`INSERT INTO vc.companion_daily_mood(owner_user_id, relationship_id, local_date, tier, vibe, line, redrawn)
        SELECT ${owner}, ${relationshipId}, d, 'WANT_TO_CHAT', '开心', '今天心情不错，话有点多', true
          FROM (SELECT DATE '${baseDay}' AS d UNION SELECT (timezone('Asia/Shanghai', clock_timestamp()))::date) days
        ON CONFLICT (owner_user_id, relationship_id, local_date) DO UPDATE
          SET tier = EXCLUDED.tier, vibe = EXCLUDED.vibe, line = EXCLUDED.line, redrawn = true;`);
    const state = await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/companion-state`);
    if (state.status !== 200 || state.json?.mood?.tier !== 'WANT_TO_CHAT' || state.json?.mood?.vibe !== '开心' || state.json?.mood?.line !== MOOD_LINE) {
        throw new Error(`今日心情不符 ${state.text.slice(0, 300)}`);
    }
    const emotion = state.json.emotion || {};
    for (const key of ['closeness', 'mood', 'energy']) {
        if (!Number.isInteger(emotion[key]) || emotion[key] < 0 || emotion[key] > 100) throw new Error(`情绪 ${key} 超出 0-100`);
    }
    if (!emotion.line) throw new Error('情绪状态句缺失');

    const pendingTopic='周末旅行路线还没聊完，回头接着说';
    await speak(pendingTopic,at(-2,'18:10:00'));
    if(ctx.w10.psql(`SELECT open_topic_source_ref IS NOT NULL FROM vc.companion_affect WHERE owner_user_id=${owner} AND relationship_id=${relationshipId};`).trim()!=='t')throw Error('RQ-10 explicit topic was not persisted');

    await putPolicy(1, 120);
    const planned = await runAt(at(0,'10:00:00'));
    if (planned.outcome !== 'READY' || !['good_morning', 'cold_hello'].includes(planned.reason)) {
        throw new Error(`第一条应预生成问候，得到 ${planned.outcome}/${planned.reason || ''}`);
    }
    const delivered = await runAt(at(0,'10:20:00'));
    if (delivered.outcome !== 'INBOX' || !delivered.eventId) throw new Error(`到点应进入收件箱，得到 ${JSON.stringify(delivered)}`);
    if ((await inboxMine()).length !== 1) throw new Error('收件箱里没有这条主动消息');
    expectGate(await runAt(at(0,'13:00:00')), 'DAILY_LIMIT', '每日上限');

    await putPolicy(3, 120);
    const second = await runAt(at(0,'13:00:00'));
    if (second.outcome !== 'READY' || second.reason !== 'continue_topic') {
        throw new Error(`第二条应延续已记录话题，得到 ${second.outcome}/${second.reason || ''}`);
    }
    const captures = await ctx.fixtureHttp.captures({ protocol: 'chat' });
    const blob = JSON.stringify(captures);
    if (!blob.includes(UNANSWERED)) throw new Error('未回复一次的预生成提示里没有指定文案');
    if (!blob.includes('0.2')) throw new Error('判断请求没有使用温度 0.2');
    const secondIn = await runAt(at(0,'13:20:00'));
    if (secondIn.outcome !== 'INBOX') throw new Error(`第二条到点应进入收件箱，得到 ${secondIn.outcome}/${secondIn.reason || ''}`);
    if ((await inboxMine()).length !== 2) throw new Error('收件箱主动消息不是两条');
    expectGate(await runAt(at(0,'13:40:00')), 'UNANSWERED', '未回复上限');
    if ((await inboxMine()).length !== 2) throw new Error('达到未回复上限后又投了一条');

    const changedRows=await read();
    const topicRow=changedRows.find(row=>row.is_user && row.mes===pendingTopic);
    topicRow.extra.no_memory=true;
    prepareSourceIdentities(changedRows,{settled:true,sourceTimezone:'Asia/Shanghai'});
    const optOutSaved=await save(changedRows);
    if(optOutSaved.status!==200)throw Error(`RQ-10 source opt-out save failed HTTP ${optOutSaved.status} ${optOutSaved.json?.error?.code || optOutSaved.json?.code || ''}`);
    await speak('我回来了',at(0,'13:45:00'));
    const since=(await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
    // Allow the full 120-minute interaction gap while staying before the
    // greeting cluster's six-hour cooldown expires. At 16:00 a fresh greeting
    // is also valid.
    const withoutTopic=await runAt(at(0,'15:50:00'));
    if(withoutTopic.outcome!=='READY' || withoutTopic.reason!=='share_day')throw Error(`RQ-10 source opt-out expected READY/share_day, got ${withoutTopic.outcome}/${withoutTopic.reason || ''}`);
    const after=await ctx.fixtureHttp.captures({protocol:'chat',since});
    if(JSON.stringify(after).includes('上次有个话题还没说完，见下方已记录话题'))throw Error('RQ-10 opted-out source leaked into continuation prompt');
    if(JSON.stringify(after).includes('<vc-open-topic>'))throw Error('RQ-10 opted-out source remained in topic data');
    await speak('旅行安排已经解决了，不聊这个了',at(0,'16:10:00'));
    if(ctx.w10.psql(`SELECT open_topic_source_ref IS NULL FROM vc.companion_affect WHERE owner_user_id=${owner} AND relationship_id=${relationshipId};`).trim()!=='t')throw Error('RQ-10 resolution did not clear pending topic');
    ctx.results.rq10Topic={persisted:true,continued:true,optedOutSourceExcluded:true,resolved:true};
}

export const hlProactiveScene = {
    id: 'hl-proactive',
    title: 'HL 主动引擎：密友模式、安静时段、上限与开会暂停',
    needs: ['go', 'stack', 'fixture'],
    default: false,
    run: sceneHlProactive,
};
