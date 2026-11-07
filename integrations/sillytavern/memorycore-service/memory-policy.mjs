import { extractionWindowPrompt } from './extraction-window.mjs';

// RQ-2: deterministic admission for pure transient states, not a general fact classifier.
const SINGLE_SOURCE_TIME = '相对日期只按下方来源时间换算结果写成具体日期，不使用本次任务的运行时间；结果不明确时保留待澄清，不编日期。';
export const EXTRACTION_RULES = `只保留今后仍有用的事实。今天累、困、饿等会过去的状态不记；长期疾病、持续习惯和重要事件照常记。\n${SINGLE_SOURCE_TIME}\n用户更正旧事实时用 update 取代对应旧记忆，不把互相矛盾的说法并列成当前事实；旧版由已有修订历史保留。`;
const STATE = /累|困|饿|疲惫|疲倦|口渴/u;
const ONLY_STATE = /^(?:用户(?:（[^）]*）)?|我)?(?:今天|现在|此刻|这会儿|刚才|今晚)?(?:感觉|觉得|有点|特别|很|太|又|也|了|累|困|饿|疲惫|疲倦|口渴|想睡觉|想休息|想吃饭|想早点睡|需要休息|[、和，而且。！!\s])+$/u;

export function prepareMemoryFact(memory, sourceTime) {
    if (STATE.test(memory.content) && ONLY_STATE.test(memory.content)) return null;
    const {sourceExpression,eventDate,normalizationStatus}=sourceTime || {};
    if (['normalized','explicit_date'].includes(normalizationStatus) && /^\d{4}-\d{2}-\d{2}$/.test(eventDate || '')
        && typeof sourceExpression==='string' && sourceExpression && memory.content.includes(sourceExpression)) {
        return {...memory,content:memory.content.replaceAll(sourceExpression,eventDate),metadata:{...memory.metadata,eventDate}};
    }
    return memory;
}

export function extractionRunner(runner, sourceTime, primarySourceId, sourceTimes) {
    const rules = sourceTimes === undefined ? EXTRACTION_RULES : EXTRACTION_RULES.replace(SINGLE_SOURCE_TIME,
        '相对日期先保留原词。每条事实只按实际引用的最近一条用户来源的换算结果理解日期，助手和未引用的消息不提供时钟。结果不明确时保留待澄清，不编日期。');
    const timing = sourceTimes === undefined ? '来源时间换算结果（数据）：' + JSON.stringify(sourceTime || null)
        : '按用户来源 ID 给出的时间换算结果（数据）：' + JSON.stringify(sourceTimes);
    return {run(params){return runner.run(params.taskId==='l1-extraction'
        ? {...params,systemPrompt:(params.systemPrompt || '')+'\n'+rules+'\n'+timing
            +(primarySourceId ? extractionWindowPrompt(primarySourceId) : '')} : params);}};
}
