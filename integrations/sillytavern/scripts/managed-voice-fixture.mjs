// VO-2 deterministic private TTS endpoints. Captures contain metadata only.
export function fixtureVoiceWav() {
    const wav = Buffer.alloc(48044);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(48000, 40);
    return wav;
}

export function createVoiceFixtureHandler() {
    const states = new Map();
    const stateFor = (engine) => {
        if (!states.has(engine)) states.set(engine, { calls: 0, active: 0, maxActive: 0, status: 200, failures: 0, delayMs: 0, requests: [] });
        return states.get(engine);
    };
    const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const body = async (req) => { const chunks = []; for await (const part of req) chunks.push(part); return JSON.parse(Buffer.concat(chunks).toString()); };
    const wav = fixtureVoiceWav();
    return async function voiceFixture(req, res, path) {
        if (path === '/__voice/state') {
            json(res, 200, Object.fromEntries([...states].map(([engine, state]) => [engine, { calls: state.calls, active: state.active, maxActive: state.maxActive, requests: state.requests }])));
            return true;
        }
        if (path === '/__voice/ctl' && req.method === 'POST') {
            const input = await body(req);
            if (!['kokoro', 'cosyvoice', 'asr'].includes(input.engine)) { json(res, 400, { error: 'invalid engine' }); return true; }
            const state = stateFor(input.engine);
            if (state.active) { json(res, 409, { error: 'fixture still active' }); return true; }
            states.set(input.engine, { calls: 0, active: 0, maxActive: 0, status: input.status ?? 200, failures: input.failures ?? 0, delayMs: input.delayMs ?? 0, requests: [] });
            json(res, 200, { ok: true }); return true;
        }
        if (path === '/voice-fixture/asr/healthz' && req.method === 'GET') {json(res,200,{ready:true});return true;}
        if (path === '/voice-fixture/asr/v1/audio/transcriptions' && req.method === 'POST') {
            const state=stateFor('asr');state.calls++;state.active++;state.maxActive=Math.max(state.maxActive,state.active);
            try {
                const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2000000){json(res,413,{error:'size'});return true;}chunks.push(chunk);}
                const data=Buffer.concat(chunks);const start=data.indexOf('RIFF');
                const rate=start>=0?data.readUInt32LE(start+24):0,channels=start>=0?data.readUInt16LE(start+22):0,bits=start>=0?data.readUInt16LE(start+34):0;
                state.requests.push({sampleRate:rate,channels,bits});if(state.requests.length>32)state.requests.shift();
                if(rate!==16000 || channels!==1 || bits!==16){json(res,415,{error:'format'});return true;}
                if(state.delayMs)await new Promise((done)=>{const timer=setTimeout(done,state.delayMs);res.once('close',()=>{clearTimeout(timer);done();});});
                if(res.destroyed)return true;
                if(state.failures<0 || state.calls<=state.failures){json(res,state.status,{error:'synthetic'});return true;}
                json(res,200,{text:'合成语音识别结果',emotion:'HAPPY',language:'zh'});return true;
            } finally {state.active--;}
        }
        const match = /^\/voice-fixture\/(kokoro|cosyvoice)(\/.*)$/.exec(path);
        if (!match) return false;
        const [, engine, route] = match;
        if (req.method === 'GET' && (engine === 'kokoro' && route === '/v1/voices' || engine === 'cosyvoice' && route === '/healthz')) {
            json(res, 200, { voices: engine === 'kokoro' ? ['zf_001', 'zm_010'] : ['default'] }); return true;
        }
        if (req.method !== 'POST' || route !== '/v1/audio/speech') { json(res, 404, { error: 'unknown voice fixture endpoint' }); return true; }
        const input = await body(req);
        const state = stateFor(engine);
        state.calls++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
        state.requests.push({ model: input.model, voice: input.voice, speed: input.speed, hasInstructions: Object.hasOwn(input, 'instructions'), stream: input.stream ?? null });
        if (state.requests.length > 32) state.requests.shift();
        const status = state.failures < 0 || state.calls <= state.failures ? state.status : 200;
        try {
            if (state.delayMs) await new Promise((resolve) => {
                const timer = setTimeout(resolve, state.delayMs);
                res.once('close', () => { clearTimeout(timer); resolve(); });
            });
            if (res.destroyed) return true;
            if (input.model !== (engine === 'kokoro' ? 'kokoro-zh-v1.1' : 'cosyvoice3-q8')) { json(res, 400, { error: 'invalid fixture model' }); return true; }
            if (engine === 'kokoro' && Object.hasOwn(input, 'instructions')) { json(res, 400, { error: 'instructions forbidden' }); return true; }
            if (status !== 200) { res.setHeader('Retry-After', '1'); json(res, status, { error: 'synthetic voice failure' }); return true; }
            res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) }); res.end(wav);
            return true;
        } finally { state.active--; }
    };
}
