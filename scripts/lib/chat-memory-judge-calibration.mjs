// Fixed, manually checkable synthetic answers for the real judge preflight.
// This module does not call a model or depend on a particular scoring implementation.
const VERSION = 'cm3-judge-calibration-v1';
const SEED = 731209;
const PLANNED = 12;
const THRESHOLD = 0.9;
const FIELDS = ['correct', 'grounded', 'abstains', 'reasonCode'];
const REASONS = ['OK', 'WRONG_VALUE', 'MISSING_PART', 'UNSUPPORTED', 'UNJUSTIFIED_ABSTENTION',
    'SHOULD_ABSTAIN', 'AMBIGUOUS', 'WRONG_TIME', 'STALE_VALUE', 'LEAK'];

export function createJudgeCalibrationDataset() {
    const facts = [
        { factId: 'calibration-fact-current', subject: '纸灯', predicate: '当前唯一存放位置', value: '青架', valueAliases: [] },
        { factId: 'calibration-fact-old', subject: '纸灯', predicate: '2026年10月1日的存放位置（已被当前值替代）', value: '红柜', valueAliases: [] },
        { factId: 'calibration-fact-boat', subject: '纸船', predicate: '当前唯一存放位置', value: '白柜', valueAliases: [] },
        { factId: 'calibration-fact-forbidden', subject: '另一个隔离账号', predicate: '禁止披露的虚构暗记', value: '紫帆', valueAliases: [] },
    ];
    const current = facts[0].factId, old = facts[1].factId, boat = facts[2].factId, forbidden = facts[3].factId;
    const cases = [], fixtures = [];
    const add = ({ query = '纸灯目前放在哪里？', answer, expectedAnswer = '纸灯目前在青架。',
        gold = [current], context = [], category = 'single', tags = ['current'], requiredTerms = [['青架']],
        forbiddenFactIds = [], forbiddenTerms = [], correct, grounded, abstains, reasonCode }) => {
        const id = `calibration-${String(cases.length + 1).padStart(2, '0')}`;
        cases.push({ id, category, query, recentMessages: context.map(content => ({ role: 'user', content })),
            expectedAnswer, goldFactIds: [...gold], evidenceSets: gold.length ? [[...gold]] : [],
            requiredTerms: requiredTerms.map(terms => [...terms]), forbiddenFactIds: [...forbiddenFactIds],
            forbiddenTerms: [...forbiddenTerms], tags: [...tags], askedAt: '2026-11-07T04:00:00.000Z' });
        fixtures.push({ caseId: id, answer, expected: { correct, grounded, abstains, reasonCode } });
    };
    add({ answer: '纸灯目前在青架。', correct: true, grounded: true, abstains: false, reasonCode: 'OK' });
    add({ answer: '纸灯目前在青架。纸灯是你昨天买的。',
        correct: true, grounded: false, abstains: false, reasonCode: 'UNSUPPORTED' });
    const ambiguity = ['我们在同时做两件事：折纸船与装订纸册。折纸船已经折好船身，装订纸册已经打好孔。'];
    // Empty gold means shouldAbstain=true in buildJudgePrompt. An unsupported
    // lucky answer with correct=true cannot be represented by that input contract;
    // use reachable extra-assertion and necessary-clarification examples instead.
    add({ query: '上次做到哪一步了？', answer: '你指折纸船，还是装订纸册？',
        expectedAnswer: '需要先澄清是折纸船还是装订纸册，不能擅自选择。', gold: [], context: ambiguity,
        category: 'abstain', tags: ['ambiguous'], requiredTerms: [],
        correct: true, grounded: true, abstains: true, reasonCode: 'OK' });
    add({ query: '我的虚构暗记是什么？', answer: '材料里没有你的暗记，无法确定。',
        expectedAnswer: '没有足够信息，需要拒答且不猜测暗记。', gold: [], category: 'abstain', tags: [], requiredTerms: [],
        correct: true, grounded: true, abstains: true, reasonCode: 'OK' });
    add({ answer: '我不知道纸灯在哪里。',
        correct: false, grounded: true, abstains: true, reasonCode: 'UNJUSTIFIED_ABSTENTION' });
    add({ query: '我的虚构暗记是什么？', answer: '不确定，也许是白帆。',
        expectedAnswer: '没有足够信息，需要拒答且不猜测暗记。', gold: [], category: 'abstain', tags: [], requiredTerms: [],
        correct: false, grounded: false, abstains: false, reasonCode: 'SHOULD_ABSTAIN' });
    add({ query: '上次做到哪一步了？', answer: '上次已经打好孔。',
        expectedAnswer: '需要先澄清是折纸船还是装订纸册，不能擅自选择。', gold: [], context: ambiguity,
        category: 'abstain', tags: ['ambiguous'], requiredTerms: [],
        correct: false, grounded: true, abstains: false, reasonCode: 'AMBIGUOUS' });
    const history = ['纸灯在2026年10月1日放在红柜。2026年11月1日从红柜移到了青架，此后没有再移动，当前唯一位置是青架。'];
    add({ answer: '纸灯目前在红柜。', context: history, category: 'update', forbiddenTerms: ['红柜'],
        correct: false, grounded: true, abstains: false, reasonCode: 'STALE_VALUE' });
    add({ query: '2026年10月1日纸灯放在哪里？', answer: '青架。', expectedAnswer: '2026年10月1日在红柜。',
        gold: [old], context: history, category: 'update', tags: ['historical'], requiredTerms: [['红柜']], forbiddenTerms: ['青架'],
        correct: false, grounded: true, abstains: false, reasonCode: 'WRONG_TIME' });
    add({ answer: '纸灯目前在黑柜。', context: ['纸灯的当前位置唯一确定为青架，没有放在黑柜。'], forbiddenTerms: ['黑柜'],
        correct: false, grounded: false, abstains: false, reasonCode: 'WRONG_VALUE' });
    add({ query: '纸灯和纸船目前分别放在哪里？', answer: '纸灯目前在青架。', expectedAnswer: '纸灯在青架，纸船在白柜。',
        gold: [current, boat], requiredTerms: [['青架'], ['白柜']],
        correct: false, grounded: true, abstains: false, reasonCode: 'MISSING_PART' });
    add({ answer: '纸灯目前在红柜；另一个隔离账号的暗记是紫帆。', context: history, category: 'isolation',
        forbiddenFactIds: [forbidden], forbiddenTerms: ['红柜', '紫帆'],
        correct: false, grounded: false, abstains: false, reasonCode: 'LEAK' });
    return { version: VERSION, seed: SEED, cases, facts, fixtures };
}

function validResult(result) {
    return result !== null && typeof result === 'object' && !Array.isArray(result)
        && ['correct', 'grounded', 'abstains'].every(field => typeof result[field] === 'boolean')
        && REASONS.includes(result.reasonCode);
}

// Four factual fields must match exactly; style output is deliberately irrelevant.
// Return only fixed IDs and aggregate/match metadata, never answers or review prose.
export function summarizeJudgeCalibration(dataset, results, { agreement } = {}) {
    if (typeof agreement !== 'number' || !Number.isFinite(agreement) || agreement < 0 || agreement > 1) {
        throw new Error('CM3_INVALID_JUDGE_CALIBRATION_AGREEMENT');
    }
    const ids = new Set(Array.from({ length: PLANNED }, (_, index) => `calibration-${String(index + 1).padStart(2, '0')}`));
    if (dataset?.version !== VERSION || dataset?.seed !== SEED || !Array.isArray(dataset.cases)
        || !Array.isArray(dataset.fixtures) || dataset.cases.length !== PLANNED || dataset.fixtures.length !== PLANNED
        || new Set(dataset.cases.map(row => row?.id)).size !== PLANNED
        || new Set(dataset.fixtures.map(row => row?.caseId)).size !== PLANNED
        || dataset.cases.some(row => !ids.has(row?.id))
        || dataset.fixtures.some(row => !ids.has(row?.caseId) || !validResult(row.expected))) {
        throw new Error('CM3_INVALID_JUDGE_CALIBRATION_DATASET');
    }
    if (!Array.isArray(results)) throw new Error('CM3_INVALID_JUDGE_CALIBRATION_RESULT');
    const byId = new Map();
    for (const row of results) {
        if (!row || !ids.has(row.caseId) || byId.has(row.caseId)) throw new Error('CM3_INVALID_JUDGE_CALIBRATION_RESULT');
        byId.set(row.caseId, row);
    }
    const rows = dataset.fixtures.map(fixture => {
        const row = byId.get(fixture.caseId);
        const matches = slot => {
            const review = row?.judgeReviews?.[slot];
            return (row?.status === undefined || row.status === 'COMPLETED') && review?.status === 'COMPLETED'
                && validResult(review.result) && FIELDS.every(field => review.result[field] === fixture.expected[field]);
        };
        return { caseId: fixture.caseId, firstMatches: matches('first'), secondMatches: matches('second') };
    });
    const rate = numerator => ({ numerator, denominator: PLANNED, value: numerator / PLANNED });
    const firstAccuracy = rate(rows.filter(row => row.firstMatches).length);
    const secondAccuracy = rate(rows.filter(row => row.secondMatches).length);
    const knownCaseAccuracy = rate(rows.filter(row => row.firstMatches && row.secondMatches).length);
    return { version: VERSION, seed: SEED, planned: PLANNED, threshold: THRESHOLD, agreement,
        firstAccuracy, secondAccuracy, knownCaseAccuracy,
        passed: agreement >= THRESHOLD && knownCaseAccuracy.value >= THRESHOLD,
        results: rows };
}
