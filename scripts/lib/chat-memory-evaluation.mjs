import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoundArtifacts } from './chat-memory-artifacts.mjs';
import { createRoundBudget } from './chat-memory-budget.mjs';
import { loadEvaluationConfiguration } from './chat-memory-config.mjs';

export const QUALITY_ROOT = fileURLToPath(new URL('../../integrations/sillytavern/.local/chat-memory-quality', import.meta.url));

// Config-only preflight never opens a provider socket. This is also the
// boundary the real runner uses before giving local route tokens to its stack.
export async function preflightEvaluation({ round, configRef, mode = 'cny', ownerTokenOnly = false, quoteFile,
    root = QUALITY_ROOT, maxCalls = 6000 } = {}) {
    const artifacts = await createRoundArtifacts(root, { round });
    let budget;
    try {
        const config = await loadEvaluationConfiguration({ ref: configRef, mode, ownerTokenOnly, quoteFile });
        budget = await createRoundBudget({ file: path.join(artifacts.dir, 'budget.json'), round, profiles: config.routes,
            mode, ownerTokenOnly, maxCalls });
        const report = { schemaVersion: 1, status: 'READY', preflightOnly: true, config: config.manifest,
            modelCalls: 0, actualCostCny: 0, budget: budget.snapshot() };
        await artifacts.write('manifest.json', report);
        return report;
    } catch (error) {
        const code = ['CONFIG_NOT_READY', 'BUDGET_STOP', 'BUDGET_LOCKED', 'BUDGET_SNAPSHOT_MISMATCH'].includes(error.message)
            ? error.message : 'EVALUATION_PREFLIGHT_FAILED';
        await artifacts.write('manifest.json', { schemaVersion: 1, status: code, preflightOnly: true, modelCalls: 0, actualCostCny: 0 });
        throw new Error(code);
    } finally { try { await budget?.close(); } finally { await artifacts.close(); } }
}
