// This cache is exclusively for generated CM-3 dataset answers. Never pass
// real conversations, prompts, credentials or configuration into this API.
import { CASE_CATEGORIES, FORGET_STAGES } from './chat-memory-dataset.mjs';

const CASE_ID = new RegExp(`^(?:${CASE_CATEGORIES.join('|')})-(?:0[1-9]|1[0-9]|20)$`);
const ANSWER_BYTES = 4 * 1024 * 1024;
export const MAX_SYNTHETIC_RESPONSES = 300;

function exactFields(value, fields) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

export function syntheticAnswerIdentity({ round, attempt, dataset } = {}) {
    if (!/^round-[a-z0-9-]{1,80}$/.test(round || '') || !Number.isSafeInteger(attempt) || attempt < 1
        || !/^cm3-core-v[1-9][0-9]*-mulberry32$/.test(dataset?.version || '')
        || !Number.isInteger(dataset?.seed) || dataset.seed < 0 || dataset.seed > 0xffffffff
        || !/^[a-f0-9]{64}$/.test(dataset?.hashes?.dataset || '')) throw new Error('SYNTHETIC_ANSWERS_IDENTITY');
    return { round, attempt, dataset: { version: dataset.version, seed: dataset.seed, hashes: { dataset: dataset.hashes.dataset } } };
}

export function assertSyntheticAnswerIdentity(value, identity) {
    if (value?.round !== identity.round || value?.attempt !== identity.attempt
        || value?.dataset?.version !== identity.dataset.version || value?.dataset?.seed !== identity.dataset.seed
        || value?.dataset?.hashes?.dataset !== identity.dataset.hashes.dataset) throw new Error('SYNTHETIC_ANSWERS_IDENTITY');
}

export function validateSyntheticAnswer(response) {
    if (!exactFields(response, ['caseId', 'stage', 'control', 'answer'])
        || typeof response.caseId !== 'string' || !CASE_ID.test(response.caseId)
        || (response.stage !== null && !FORGET_STAGES.includes(response.stage))
        || ![null, 'memory-off', 'gold-evidence'].includes(response.control)
        || typeof response.answer !== 'string' || Buffer.byteLength(response.answer) > ANSWER_BYTES) {
        throw new Error('SYNTHETIC_ANSWER_INVALID');
    }
    return { caseId: response.caseId, stage: response.stage, control: response.control, answer: response.answer };
}

export function syntheticAnswerKey(response) {
    return JSON.stringify([response.caseId, response.stage, response.control]);
}

export function validateSyntheticAnswers(value, identity) {
    if (!exactFields(value, ['schemaVersion', 'round', 'attempt', 'dataset', 'responses']) || value.schemaVersion !== 1
        || !exactFields(value.dataset, ['version', 'seed', 'hashes']) || !exactFields(value.dataset.hashes, ['dataset'])
        || !Array.isArray(value.responses)) throw new Error('SYNTHETIC_ANSWERS_INVALID');
    assertSyntheticAnswerIdentity(value, identity);
    if (value.responses.length > MAX_SYNTHETIC_RESPONSES) throw new Error('SYNTHETIC_ANSWERS_LIMIT');
    const seen = new Set();
    for (const response of value.responses) {
        validateSyntheticAnswer(response);
        const key = syntheticAnswerKey(response);
        if (seen.has(key)) throw new Error('SYNTHETIC_ANSWER_DUPLICATE');
        seen.add(key);
    }
    return value;
}

export function createSyntheticAnswerStore(artifacts, options) {
    const identity = syntheticAnswerIdentity(options);
    return {
        save: response => artifacts.saveSyntheticAnswer(identity, response),
        read: () => artifacts.readSyntheticAnswers(identity),
    };
}
