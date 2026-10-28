import fs from 'node:fs/promises';
import path from 'node:path';

const TOOL_INSTRUCTION = `Return only JSON. To use a file tool return {"tool":{"name":"read_file"|"write_to_file"|"list_files"|"delete_file","path":"relative path","content":"for writes"}}. To finish return {"text":"final response"}. Only supplied staging files are accessible. No shell, network, or other tools.`;

// Neither model responses nor upstream workspaceDir/storage can select a root.
async function fileTool(stagingDir, stage, tool) {
    const rel = tool?.path;
    if (typeof rel !== 'string' || rel.includes('\\') || rel.includes('..') || path.isAbsolute(rel) ||
        !(rel === 'scene_blocks' || /^scene_blocks\/[\p{L}\p{N} _.-]+\.md$/u.test(rel) || rel === 'persona.md')) throw new Error('MEMORYCORE_TOOL_PATH');
    const writing = ['write_to_file', 'delete_file'].includes(tool.name);
    if (writing && (stage === 'l3-persona' ? rel !== 'persona.md' : !rel.startsWith('scene_blocks/'))) throw new Error('MEMORYCORE_TOOL_PATH');
    const target = path.join(stagingDir, rel);
    for (const item of [stagingDir, path.dirname(target), target]) {
        try { if ((await fs.lstat(item)).isSymbolicLink()) throw new Error('MEMORYCORE_TOOL_PATH'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (tool.name === 'write_to_file') {
        if (typeof tool.content !== 'string' || tool.content.length > 100000) throw new Error('MEMORYCORE_TOOL_SIZE');
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, tool.content, { mode: 0o600 }); return 'written';
    }
    if (tool.name === 'read_file') return (await fs.readFile(target, 'utf8')).slice(0, 100000);
    if (tool.name === 'list_files' && rel === 'scene_blocks') return JSON.stringify((await fs.readdir(target)).filter(x => x.endsWith('.md')));
    if (tool.name === 'delete_file') { await fs.rm(target, { force: true }); return 'deleted'; }
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
