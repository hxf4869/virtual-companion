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

export function createCallbackRunner({ baseURL, token, operationToken, stage, stagingDir, fetchImpl = fetch, counter = { value: 0 }, maxSteps = 12 }) {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || typeof token !== 'string' || token.length < 32 ||
        !operationToken || !['l1-extraction', 'l1-conflict-detection', 'l2-scene', 'l3-persona'].includes(stage)) throw new Error('MEMORYCORE_CALLBACK_CONFIG');
    return { async run(params) {
        const tools = Boolean(stagingDir);
        const messages = [{ role: 'system', content: (params.systemPrompt || '') + (tools ? '\n' + TOOL_INSTRUCTION : '') },
            { role: 'user', content: params.prompt }];
        const deadline = Date.now() + Math.min(params.timeoutMs || 180000, 180000);
        for (let step = 0; step < (tools ? maxSteps : 1); step++) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('MEMORYCORE_CALLBACK_TIMEOUT');
            let result;
            try {
                const response = await fetchImpl(url.origin + '/api/v1/service/memorycore/llm', {
                    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                    body: JSON.stringify({ operationToken, stage, callSequence: ++counter.value, messages }), signal: AbortSignal.timeout(remaining),
                });
                if (!response.ok) throw new Error();
                result = await response.json();
                if (typeof result.text !== 'string' || result.text.length > 200000) throw new Error();
            } catch { throw new Error('MEMORYCORE_CALLBACK_FAILED'); }
            if (!tools) return result.text;
            let action;
            try { action = JSON.parse(result.text); } catch { throw new Error('MEMORYCORE_TOOL_RESPONSE'); }
            if (!action.tool && typeof action.text === 'string') return action.text;
            const output = await fileTool(stagingDir, stage, action.tool);
            messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: JSON.stringify({ toolResult: output }) });
        }
        throw new Error('MEMORYCORE_TOOL_STEP_LIMIT');
    } };
}
