// RQ-1: ST has already counted media/tools and applied its hard context budget.
// Keep a saved history boundary until it no longer fits, then retain 2/3 of
// the available history budget (the hard ceiling is 1.5 times that target).
export const HISTORY_EVENT = 'vc-chat-history-ready';

export function chunkHistory({ messages, chatCompletion, type }, context) {
    if (context.groupId || context.chatMetadata?.vc_binding?.mode !== 'COMPANION'
        || ['quiet', 'impersonate'].includes(type)) return;
    const history = chatCompletion.getMessages().collection.find((item) => item?.identifier === 'chatHistory')?.collection;
    if (!history?.length) return;
    const source = messages.filter((item) => !item.injected);
    const sourceIndex = new Map(source.map((item, index) => [item, index]));
    const invocationIndex = new Map();
    source.forEach((item, index) => item.invocations?.forEach((call) => invocationIndex.set(call.id, index)));
    const rows = history.flatMap((item) => {
        const match = /^(?:toolCall-)?chatHistory-(\d+)$/.exec(item.identifier);
        const index = match ? sourceIndex.get(messages[Number(match[1]) - 1]) : invocationIndex.get(item.identifier);
        return index === undefined ? [] : [{ item, index, tokens: item.getTokens() }];
    });
    if (!rows.length) return;
    const saved = context.chatMetadata.vc_history_window;
    let start = saved && saved.count <= source.length && Number.isInteger(saved.start)
        && saved.start >= 0 && saved.start < source.length ? saved.start : 0;
    const nativeStart = Math.min(...rows.map((row) => row.index));
    if (nativeStart > start) {
        const total = rows.reduce((sum, row) => sum + row.tokens, 0);
        const target = Math.floor((total + chatCompletion.tokenBudget) / 1.5);
        let remaining = total;
        const tokensByIndex = new Map();
        for (const row of rows) tokensByIndex.set(row.index, (tokensByIndex.get(row.index) || 0) + row.tokens);
        start = nativeStart;
        const lastUser = source.findLastIndex((item) => item.role === 'user');
        for (let index = nativeStart; index < lastUser; index++) {
            if (remaining <= target && source[index]?.role === 'user') { start = index; break; }
            remaining -= tokensByIndex.get(index) || 0;
            if (source[index + 1]?.role === 'user') start = index + 1;
        }
    }
    for (const row of rows) {
        if (row.index >= start) continue;
        history.splice(history.indexOf(row.item), 1);
        chatCompletion.increaseTokenBudgetBy(row.tokens);
    }
    // The normal native chat save persists this with the generated reply.
    // Saving here would race the already-captured F2 revision / memory snapshot.
    context.chatMetadata.vc_history_window = { start, count: source.length };
}

export function installHistoryWindow(getContext) {
    getContext().eventSource.on(HISTORY_EVENT, (event) => chunkHistory(event, getContext()));
}
