import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocolFixtureServer } from '../scripts/managed-protocol-provider.mjs';

test('voice fixture returns fixed PCM WAV and captures metadata without input', async (t) => {
    const fixture = await createProtocolFixtureServer();
    t.after(() => fixture.api.close());
    const voices = await (await fetch(`${fixture.url}/voice-fixture/kokoro/v1/voices`)).json();
    assert.deepEqual(voices.voices, ['zf_001', 'zm_010']);
    const payload = { model: 'kokoro-zh-v1.1', input: 'PRIVATE_FIXTURE_INPUT', voice: 'zf_001', speed: 1, response_format: 'wav' };
    const speech = () => fetch(`${fixture.url}/voice-fixture/kokoro/v1/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const response = await speech();
    assert.equal(response.status, 200);
    const wav = Buffer.from(await response.arrayBuffer());
    assert.equal(wav.length, 48044); assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt16LE(34), 16);
    const state = await (await fetch(`${fixture.url}/__voice/state`)).json();
    assert.equal(state.kokoro.calls, 1); assert.equal(state.kokoro.maxActive, 1);
    assert.ok(!JSON.stringify(state).includes('PRIVATE_FIXTURE_INPUT'));
    const control = await fetch(`${fixture.url}/__voice/ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'kokoro', status: 429, failures: 1 }) });
    assert.equal(control.status, 200);
    const busy = await speech(); assert.equal(busy.status, 429); assert.equal(busy.headers.get('retry-after'), '1'); await busy.arrayBuffer();
    const recovered = await speech(); assert.equal(recovered.status, 200); await recovered.arrayBuffer();
});
