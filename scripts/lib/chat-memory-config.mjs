// Read only the existing local model catalog and its private decryption config.
// No business conversations, old agents.txt loader, or repository config.txt.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CATALOG_SQL = `BEGIN READ ONLY;
SELECT json_build_object(
    'bindings',(SELECT json_agg(json_build_object('purpose',purpose,'providerId',provider_id,'profileKey',profile_key,'revision',revision,'state',state))
        FROM vc.model_purpose_binding WHERE purpose IN ('FOREGROUND_CHAT','MEMORY_EXTRACTION_DEDUP_SUMMARY')),
    'profiles',(SELECT json_agg(json_build_object('providerId',p.provider_id,'profileKey',m.profile_key,'revision',p.revision,
        'protocol',p.protocol,'baseUrl',p.base_url,'credentialCipher',p.credential_cipher,'providerState',p.state,
        'state',m.state,'modelId',m.model_id,'contextWindowTokens',m.context_window_tokens,'maxOutputTokens',m.max_output_tokens,
        'generationParams',m.generation_params,'pricing',m.pricing,'capabilities',m.capabilities))
        FROM vc.provider_config p JOIN vc.provider_model m ON m.provider_id=p.provider_id));
ROLLBACK;`;

function parsePrivateEnvironment(text) {
    const allowed = new Set(['VC_CRYPTO_REST_KEY', 'VC_CRYPTO_REST_KEY_ID', 'VC_CRYPTO_REST_KEY_VERSION',
        'VC_CRYPTO_PREVIOUS_REST_KEY', 'VC_CRYPTO_PREVIOUS_REST_KEY_ID', 'VC_CRYPTO_PREVIOUS_REST_KEY_VERSION']);
    const values = {};
    for (const line of text.split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at < 1) continue;
        const key = line.slice(0, at);
        if (allowed.has(key)) values[key] = line.slice(at + 1).trim();
    }
    return values;
}

function decrypt(cipher, env) {
    const match = /^enc2:([a-z][a-z0-9-]{0,31}):([1-9][0-9]*):([A-Za-z0-9+/]+=*)$/.exec(cipher || '');
    if (!match) throw new Error('CONFIG_NOT_READY');
    const slot = `${match[1]}:${match[2]}`;
    const currentSlot = `${env.VC_CRYPTO_REST_KEY_ID || 'default'}:${env.VC_CRYPTO_REST_KEY_VERSION || '1'}`;
    const previousSlot = `${env.VC_CRYPTO_PREVIOUS_REST_KEY_ID || env.VC_CRYPTO_REST_KEY_ID || 'default'}:${env.VC_CRYPTO_PREVIOUS_REST_KEY_VERSION || Number(env.VC_CRYPTO_REST_KEY_VERSION || 1) - 1}`;
    const material = slot === currentSlot ? env.VC_CRYPTO_REST_KEY : slot === previousSlot ? env.VC_CRYPTO_PREVIOUS_REST_KEY : null;
    if (!material) throw new Error('CONFIG_NOT_READY');
    const key = Buffer.from(material, 'base64'), payload = Buffer.from(match[3], 'base64');
    try {
        if (key.length !== 32 || payload.length < 29) throw new Error('CONFIG_NOT_READY');
        const decoder = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
        decoder.setAuthTag(payload.subarray(-16));
        const plain = Buffer.concat([decoder.update(payload.subarray(12, -16)), decoder.final()]);
        try { return plain.toString('utf8'); } finally { plain.fill(0); }
    } finally { key.fill(0); payload.fill(0); }
}

// Exported for deterministic config tests; private data never enters manifest.
export function selectEvaluationProfiles(catalog, { mode = 'cny', ownerTokenOnly = false } = {}) {
    if (!['cny', 'tokens'].includes(mode) || (mode === 'tokens' && !ownerTokenOnly)) throw new Error('CONFIG_NOT_READY');
    const profiles = catalog?.profiles?.filter(row => row.state === 'ENABLED' && row.providerState === 'ENABLED') || [];
    const bound = purpose => {
        const binding = catalog?.bindings?.find(row => row.purpose === purpose && row.state === 'ENABLED');
        const profile = binding && profiles.find(row => row.providerId === binding.providerId && row.profileKey === binding.profileKey);
        if (!profile) throw new Error('CONFIG_NOT_READY');
        return { ...profile, bindingRevision: binding.revision };
    };
    const foreground = bound('FOREGROUND_CHAT'), extraction = bound('MEMORY_EXTRACTION_DEDUP_SUMMARY');
    const priced = profile => profile.pricing?.currency && profile.pricing?.inputPerMillionTokens != null && profile.pricing?.outputPerMillionTokens != null;
    const judge = profiles.find(row => row.modelId !== foreground.modelId && priced(row))
        || profiles.find(row => row.modelId === foreground.modelId && priced(row))
        || (mode === 'tokens' ? foreground : null);
    if (!judge || (mode === 'cny' && ![foreground, extraction, judge].every(priced))) throw new Error('CONFIG_NOT_READY');
    const roles = { foreground, extraction, judge }, routes = [];
    const assignments = Object.fromEntries(Object.entries(roles).map(([role, profile]) => {
        let index = routes.findIndex(row => row.providerId === profile.providerId && row.profileKey === profile.profileKey);
        if (index < 0) { index = routes.length; routes.push(profile); }
        return [role, index];
    }));
    const publicProfile = row => ({ modelId: row.modelId, protocol: row.protocol, revision: row.revision,
        bindingRevision: row.bindingRevision ?? 0, contextWindowTokens: row.contextWindowTokens, maxOutputTokens: row.maxOutputTokens,
        generationParams: Object.fromEntries(['temperature', 'topP', 'reasoningEffort'].map(key => [key, row.generationParams?.[key] ?? null])),
        priceConfigured: Boolean(priced(row)) });
    return { routes, assignments, manifest: { configRef: 'local-catalog', mode, assignments,
        judgeSharesModel: judge.modelId === foreground.modelId, profiles: routes.map(publicProfile) } };
}

export async function loadEvaluationConfiguration({ ref, mode = 'cny', ownerTokenOnly = false,
    localDirectory = path.join(os.homedir(), '.virtual-companion-local'), quoteFile,
    readCatalog = () => JSON.parse(execFileSync('docker', ['--context', 'orbstack', 'exec', '-i', 'vc-local-dev-db-1',
        'sh', '-c', 'psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { input: CATALOG_SQL, encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['pipe', 'pipe', 'pipe'] }).trim()) } = {}) {
    if (ref !== 'local-catalog') throw new Error('CONFIG_NOT_READY');
    try {
        const catalog = await readCatalog();
        const quotes = quoteFile ? JSON.parse(await fs.readFile(quoteFile, 'utf8')) : [];
        if (!Array.isArray(quotes)) throw new Error('CONFIG_NOT_READY');
        for (const profile of catalog.profiles || []) {
            const quote = quotes.find(row => row.providerId === profile.providerId && row.profileKey === profile.profileKey);
            if (quote) {
                profile.pricing = { ...profile.pricing, ...quote.pricing };
                profile.billableOutputCapIncludesReasoning = quote.billableOutputCapIncludesReasoning === true;
            }
        }
        const selected = selectEvaluationProfiles(catalog, { mode, ownerTokenOnly });
        const secretFile = path.join(localDirectory, 'runtime.env');
        const stat = await fs.lstat(secretFile);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128 * 1024) throw new Error('CONFIG_NOT_READY');
        const env = parsePrivateEnvironment(await fs.readFile(secretFile, 'utf8'));
        const routes = selected.routes.map(row => {
            const url = new URL(row.baseUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('CONFIG_NOT_READY');
            return { modelId: row.modelId, protocol: row.protocol, baseUrl: row.baseUrl,
                credential: decrypt(row.credentialCipher, env), revision: row.revision, bindingRevision: row.bindingRevision ?? 0,
                contextWindowTokens: row.contextWindowTokens, maxOutputTokens: row.maxOutputTokens,
                generationParams: row.generationParams, capabilities: row.capabilities,
                pricing: row.pricing,
                billableOutputCapIncludesReasoning: row.billableOutputCapIncludesReasoning === true };
        });
        for (const key of Object.keys(env)) delete env[key];
        if (routes.some(route => !route.credential)) throw new Error('CONFIG_NOT_READY');
        return { routes, assignments: selected.assignments, manifest: selected.manifest };
    } catch { throw new Error('CONFIG_NOT_READY'); }
}
