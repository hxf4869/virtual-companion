import assert from 'node:assert/strict';
import test from 'node:test';
import { chatVoiceGuidance, planChatVoice, spokenText, waitForVoiceClip } from '../extension/vc-model-settings/voice-chat.js';

const assistant = (mes = '你好<voice/>', extra = {}) => ({ mes, extra, is_user: false });
const user = (mes = '早呀', extra = {}) => ({ mes, extra, is_user: true });
const plan = (chat, frequency = 'STANDARD') => planChatVoice({ chat, available: true, relationship: { voiceFrequency: frequency } });

test('模型标记按 10/6/3 条间隔限制；点名与语音输入越过间隔，每轮仍最多一条', () => {
    for (const [frequency, gap] of [['LOW', 10], ['STANDARD', 6], ['HIGH', 3]]) {
        const rows = [user(), assistant('先前语音', { vc_voice_attempt: { sent: true } })];
        for (let i = 0; i < gap - 2; i++) rows.push(user(), assistant('文字'));
        assert.equal(plan([...rows, user(), assistant()], frequency).reason, 'frequency');
        rows.push(user(), assistant('文字'));
        assert.equal(plan([...rows, user(), assistant()], frequency).send, true);
        assert.equal(plan([...rows, user('想听你的声音'), assistant('一句话')], frequency).send, true);
        assert.equal(plan([...rows, user('转写', { vc_voice_input: { durationMs: 1000 } }), assistant('一句话')], frequency).send, true);
    }
    assert.equal(plan([user('用语音'), assistant('第一条', { vc_voice_attempt: { sent: true } }), assistant()]).reason, 'turn');
    assert.equal(plan([user('用语音'), assistant()], 'OFF').send, false);
});

test('长解释、未标记、严肃求助不主动发语音，清洗不改原文', () => {
    const original = '你好～😊（挥手）*抱抱*<sticker tag="开心"/><voice/>';
    assert.equal(spokenText(original), '你好，');
    assert.equal(original.includes('<voice/>'), true);
    assert.equal(plan([user(), assistant('说明'.repeat(41) + '<voice/>')]).reason, 'long');
    assert.equal(plan([user(), assistant('纯文字')]).reason, 'unmarked');
    assert.equal(plan([user('我想自杀'), assistant()]).reason, 'serious');
    assert.equal(plan([user(), assistant('😊<voice/>')]).reason, 'empty');
});

test('提示词只在能力开启时加入，语音输入要求本轮语音', async () => {
    const context = { chat: [user('转写', { vc_voice_input: { durationMs: 20 } })] };
    assert.equal(await chatVoiceGuidance(context, async () => ({ available: false })), '');
    assert.match(await chatVoiceGuidance(context, async () => ({ available: true, relationship: {} })), /本轮请用语音/);
});

test('15 秒回落使用独立截止计时，迟到结果不能推翻文字；失败立即回落', async () => {
    let late;
    const pending = waitForVoiceClip('1', { timeoutMs: 15, fetchClip: () => new Promise((done) => { late = done; }) });
    assert.equal(await pending, null);
    late({ clipId: '1', status: 'ready' });
    assert.equal(await pending, null);
    assert.equal(await waitForVoiceClip('1', { fetchClip: async () => ({ status: 'failed' }) }), null);
    assert.equal((await waitForVoiceClip('1', { fetchClip: async () => ({ status: 'ready', clipId: '1' }) })).clipId, '1');
});
