// Instrument only the disposable build copy. Production source and API stay
// untouched. These observations add no model input and perform no selection.
import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(text, pattern, replacement) {
    const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error('CM_OBSERVATION_PATCH_MISMATCH');
    return text.replace(pattern, replacement);
}

export function instrumentEvaluationBuild(context) {
    const goFile = path.join(context, 'backend/internal/store/postgres/st_memory.go');
    const nodeFile = path.join(context, 'integrations/sillytavern/server-plugin/virtual-companion/lib/memory-guard.js');
    let go = fs.readFileSync(goFile, 'utf8');
    if (go.includes('CMObservedMemoryIDs')) throw new Error('CM_OBSERVATION_PATCH_MISMATCH');
    go = replaceOnce(go, /\tObserve\s+RecallObserve\s+`json:"-"`/,
        '\tCMObservedMemoryIDs []string `json:"cmObservedMemoryIds,omitempty"`\n\tCMObservedRecallStats map[string]any `json:"cmObservedRecallStats,omitempty"`\n\tObserve RecallObserve `json:"-"`');
    go = replaceOnce(go, /\t\tout.Observe.RecallMs = int\(time.Since\(started\).Milliseconds\(\)\)/,
        '$&\n\t\tout.CMObservedRecallStats = map[string]any{"recallMs": out.Observe.RecallMs, "sourceMs": out.Observe.SourceMs, "engineMs": out.Observe.EngineMs, "stats": out.Observe}');
    go = replaceOnce(go, /\tstale, err := s\.oldMemorySources\(ctx, owner, refs, queryAt\)/,
        '\tfor _, memory := range memories { out.CMObservedMemoryIDs = append(out.CMObservedMemoryIDs, fmt.Sprint(memory.ID)) }\n\tstale, err := s.oldMemorySources(ctx, owner, refs, queryAt)');
    let node = fs.readFileSync(nodeFile, 'utf8');
    node = replaceOnce(node, /async function refreshMemorySlotBody\(\{ config, request, response, finalBody, signal, fetchImpl \}\) \{/,
        '$&\n    const cmStarted = performance.now();');
    node = replaceOnce(node, /    const slots = replaceMemorySlots\(finalBody, valid \? result\.block : '', request\.body\.vc_memory\.block\);/,
        "    response.setHeader('X-CM-Recall-Ids', JSON.stringify(result?.cmObservedMemoryIds || []));\n    response.setHeader('X-CM-Recall-Stats', JSON.stringify({ ...result?.cmObservedRecallStats, recheckMs: performance.now() - cmStarted }));\n    const slots = replaceMemorySlots(finalBody, valid ? result.block : '', request.body.vc_memory.block);");
    fs.writeFileSync(goFile, go);
    fs.writeFileSync(nodeFile, node);
}
