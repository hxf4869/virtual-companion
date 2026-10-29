import fs from 'node:fs/promises';
import path from 'node:path';

const TOOL_INSTRUCTION = `Return only JSON. To use a file tool return {"tool":{"name":"read_file"|"write_to_file"|"list_files"|"delete_file"|"read"|"write"|"edit","path":"scene filename or scene_blocks/<name>.md","content":"for writes","edits":[{"oldText":"unique text","newText":"replacement"}]}}. For L2, path is a scene filename or scene_blocks/<name>.md. For L3, only persona.md may be written. To finish return {"text":"final response"}. Only supplied staging files are accessible. No shell, network, or other tools.`;
const BARE_MD = /^[\p{L}\p{N} _.-]+\.md$/u;
const SCENE_MD = /^scene_blocks\/[\p{L}\p{N} _.-]+\.md$/u;

function replaceOnce(text, oldText, next) {
    if (typeof oldText !== 'string' || oldText.length === 0 || typeof next !== 'string') throw new Error('MEMORYCORE_TOOL_EDIT');
    const at = text.indexOf(oldText);
    if (at < 0 || text.indexOf(oldText, at + 1) !== -1) throw new Error('MEMORYCORE_TOOL_EDIT');
    return text.slice(0, at) + next + text.slice(at + oldText.length);
}

// Neither model responses nor upstream workspaceDir/storage can select a root.
// L2 bare filenames are the scene workspace names from the upstream prompt.
async function fileTool(stagingDir, stage, tool) {
    let name = tool?.name;
    if (name === 'read') name = 'read_file';
    else if (name === 'write') name = 'write_to_file';
    let rel = tool?.path;
    if (typeof rel !== 'string' || rel.includes('\\') || rel.includes('..') || path.isAbsolute(rel)) throw new Error('MEMORYCORE_TOOL_PATH');
    if (stage === 'l2-scene' && rel !== 'persona.md' && BARE_MD.test(rel)) rel = `scene_blocks/${rel}`;
    if (!(rel === 'scene_blocks' || SCENE_MD.test(rel) || rel === 'persona.md')) throw new Error('MEMORYCORE_TOOL_PATH');
    const writing = name === 'write_to_file' || name === 'delete_file' || name === 'edit';
    if (writing && (stage === 'l3-persona' ? rel !== 'persona.md' : !rel.startsWith('scene_blocks/'))) throw new Error('MEMORYCORE_TOOL_PATH');
    const target = path.join(stagingDir, rel);
    for (const item of [stagingDir, path.dirname(target), target]) {
        try { if ((await fs.lstat(item)).isSymbolicLink()) throw new Error('MEMORYCORE_TOOL_PATH'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (name === 'write_to_file') {
        if (typeof tool.content !== 'string' || tool.content.length > 100000) throw new Error('MEMORYCORE_TOOL_SIZE');
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, tool.content, { mode: 0o600 }); return 'written';
    }
    if (name === 'edit') {
        if (!Array.isArray(tool.edits) || tool.edits.length === 0) throw new Error('MEMORYCORE_TOOL_EDIT');
        let text;
        try { text = await fs.readFile(target, 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') throw new Error('MEMORYCORE_TOOL_EDIT'); throw error; }
        if (text.length > 100000) throw new Error('MEMORYCORE_TOOL_SIZE');
        for (const edit of tool.edits) text = replaceOnce(text, edit?.oldText, edit?.newText);
        if (text.length > 100000) throw new Error('MEMORYCORE_TOOL_SIZE');
        await fs.writeFile(target, text, { mode: 0o600 }); return 'edited';
    }
    if (name === 'read_file') return (await fs.readFile(target, 'utf8')).slice(0, 100000);
    if (name === 'list_files' && rel === 'scene_blocks') {
        let names;
        try { names = await fs.readdir(target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
        return JSON.stringify(names.filter(x => x.endsWith('.md')));
    }
    if (name === 'delete_file') { await fs.rm(target, { force: true }); return 'deleted'; }
    throw new Error('MEMORYCORE_TOOL_NOT_ALLOWED');
}

function stripModelWrappers(text) {
    const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fenced = withoutThink.match(/^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i);
    return (fenced ? fenced[1] : withoutThink).trim();
}
function isModelAction(action) {
    return Boolean(action) && typeof action === 'object' && !Array.isArray(action) && (action.tool || typeof action.text === 'string');
}
function balancedObjectEnd(text, start) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
            continue;
        }
        if (c === '"') { quoted = true; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            if (--depth === 0) return i + 1;
        }
    }
    return -1;
}
// Real replies are not pure JSON. Accept a whole object after removing reasoning
// and a json fence, then the first balanced object that is itself a tool or finish.
// Anything else is the final reply. Tool paths stay on the strict fileTool path.
function parseModelAction(text) {
    try {
        const whole = JSON.parse(stripModelWrappers(text));
        if (isModelAction(whole)) return whole;
    } catch { /* prefix or prose */ }
    const stripped = stripModelWrappers(text);
    for (let i = 0; i < stripped.length; i++) {
        if (stripped[i] !== '{') continue;
        const end = balancedObjectEnd(stripped, i);
        if (end < 0) continue;
        try {
            const action = JSON.parse(stripped.slice(i, end));
            if (isModelAction(action)) return action;
        } catch { /* keep scanning */ }
        if (end > i) i = end - 1;
    }
    return { text };
}
async function callbackFailureCode(response) {
    try {
        const payload = await response.json();
        const code = payload && payload.code;
        if (typeof code === 'string' && code.length <= 64 && /^MEMORYCORE_[A-Z0-9_]+$/.test(code)) return code;
    } catch { /* generic closed code */ }
    return 'MEMORYCORE_CALLBACK_FAILED';
}
// Five and a half minutes covers reasoning effort max and still finishes
// inside the six-minute extract lease. The previous three-minute cap cancelled
// the call before the provider budget did.
export const CALL_DEADLINE_CAP_MS = 330000;

const resumes = new Map();

export function rememberCallbackResume(token, calls, onSettle) {
    if (typeof token !== 'string' || token.length === 0) return;
    const stored = Array.isArray(calls) ? calls.filter(item => item && typeof item === 'object').map(item => ({ ...item })) : [];
    resumes.set(token, { calls: stored, onSettle: typeof onSettle === 'function' ? onSettle : null });
}

export function callbackResumeCalls(token) {
    const found = resumes.get(token);
    return found ? found.calls.map(item => ({ ...item })) : [];
}

export function forgetCallbackResume(token) {
    resumes.delete(token);
}

export function createCallbackRunner({ baseURL, token, operationToken, stage, stagingDir, fetchImpl = fetch, counter = { value: 0 }, maxSteps = 12 }) {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || typeof token !== 'string' || token.length < 32 ||
        !operationToken || !['l1-extraction', 'l1-conflict-detection', 'l2-scene', 'l3-persona'].includes(stage)) throw new Error('MEMORYCORE_CALLBACK_CONFIG');
    return { async run(params) {
        const tools = Boolean(stagingDir);
        const messages = [{ role: 'system', content: (params.systemPrompt || '') + (tools ? '\n' + TOOL_INSTRUCTION : '') },
            { role: 'user', content: params.prompt }];
        const deadline = Date.now() + Math.min(params.timeoutMs || CALL_DEADLINE_CAP_MS, CALL_DEADLINE_CAP_MS);
        const journal = !tools ? resumes.get(operationToken) : null;
        const prior = journal ? journal.calls.findLast(item => !item.stage || item.stage === stage) : null;
        if (prior?.status === 'ok' && typeof prior.text === 'string') {
            if (Number.isInteger(prior.sequence)) counter.value = Math.max(counter.value, prior.sequence);
            return prior.text;
        }
        for (let step = 0; step < (tools ? maxSteps : 1); step++) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('MEMORYCORE_CALLBACK_TIMEOUT');
            let sequence;
            if (!tools && prior?.status === 'timeout' && Number.isInteger(prior.sequence) && prior.sequence >= 1) {
                sequence = prior.sequence;
                counter.value = Math.max(counter.value, sequence);
            } else sequence = ++counter.value;
            const note = async (status, text) => {
                if (!journal) return;
                const entry = { sequence, stage, status, ...(typeof text === 'string' ? { text } : {}) };
                const at = journal.calls.findIndex(item => item.stage === stage && item.sequence === sequence && item.status === 'timeout');
                if (at >= 0) journal.calls[at] = entry;
                else journal.calls.push(entry);
                if (journal.onSettle) await journal.onSettle(journal.calls);
            };
            let response;
            try {
                response = await fetchImpl(url.origin + '/api/v1/service/memorycore/llm', {
                    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                    body: JSON.stringify({ operationToken, stage, callSequence: sequence, messages }), signal: AbortSignal.timeout(remaining),
                });
            } catch (error) {
                const name = error && error.name;
                if (name === 'AbortError' || name === 'TimeoutError') {
                    await note('timeout');
                    throw new Error('MEMORYCORE_CALLBACK_TIMEOUT');
                }
                throw new Error('MEMORYCORE_CALLBACK_FAILED');
            }
            if (!response.ok) {
                const code = await callbackFailureCode(response);
                if (!tools && code === 'MEMORYCORE_UPSTREAM_TIMEOUT') await note('timeout');
                throw new Error(code);
            }
            let result;
            try {
                result = await response.json();
            } catch { throw new Error('MEMORYCORE_CALLBACK_FAILED'); }
            if (typeof result.text !== 'string' || result.text.length > 200000) throw new Error('MEMORYCORE_CALLBACK_FAILED');
            if (!tools) {
                await note('ok', result.text);
                return result.text;
            }
            const action = parseModelAction(result.text);
            if (!action.tool && typeof action.text === 'string') return action.text;
            const output = await fileTool(stagingDir, stage, action.tool);
            messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: JSON.stringify({ toolResult: output }) });
        }
        throw new Error('MEMORYCORE_TOOL_STEP_LIMIT');
    } };
}
