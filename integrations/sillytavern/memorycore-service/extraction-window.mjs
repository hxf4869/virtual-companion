const fail = () => { throw new Error('MEMORYCORE_PRIMARY_SOURCE'); };

export function savedExtractionInput(operation) {
    const request = operation.request;
    if (!request?.messages?.length || request.recordId) return {};
    // Return only replay keys and request clock metadata. Go reconstructs
    // roles and text from its verified mirror and checks marked timestamps.
    return { extractionInput: { messages: request.messages.map(({ id, timestamp, timestampFallback, sourceTime }) => ({
        id, timestamp, ...(typeof timestampFallback === 'boolean' ? { timestampFallback } : {}),
        ...(sourceTime ? { hasSourceTime: true } : {}),
    })),
        ...(Object.hasOwn(request, 'primarySourceId') ? { primarySourceId: request.primarySourceId } : {}) } };
}

export function extractionPrimary(messages, primarySourceId) {
    const primary = messages.at(-1);
    if ((primary.role || 'user') !== 'user' || (primarySourceId !== undefined && primary.id !== primarySourceId) ||
        messages.some(m => !['user', 'assistant'].includes(m.role || 'user')) || new Set(messages.map(m => m.id)).size !== messages.length) fail();
    return primary;
}

export function citedWindowUser(record, messages) {
    const cited = record.source_message_ids;
    if (Array.isArray(cited)) return messages.findLast(m => (m.role || 'user') === 'user' && cited.includes(m.id));
}

export function requireUserEvidence(record, messages, primary, legacy = false) {
    // Legacy singleton prepares had one unambiguous source. Contextual output
    // must cite a verified user message before any old evidence is inherited.
    const cited = record.source_message_ids;
    if (legacy && messages.length === 1 && (cited === undefined || (Array.isArray(cited) && cited.length === 0))) {
        return { cited: [primary.id], primarySourceId: primary.id };
    }
    if (!Array.isArray(cited) || cited.some(id => !messages.some(m => m.id === id))) fail();
    const user = citedWindowUser(record, messages);
    if (!user) fail();
    return { cited: [...new Set(cited)], primarySourceId: user.id };
}

export function extractionWindowPrompt(primarySourceId) {
    return `\n近期消息只用于理解当前用户消息的指代与确认。只提取当前用户明确陈述、纠正或确认的持久事实，不重复提取更早的独立事实。助手的问题、建议、猜测和自述都不是用户事实；用户没有明确确认时不得采信。source_message_ids 必须包含真正支持该事实的用户来源 ID，引用了其他用户陈述或助手澄清时也包含相应来源 ID。当前用户主来源 ID（数据）：${JSON.stringify(primarySourceId)}`;
}
