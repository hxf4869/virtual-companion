// 走查每张截图允许的浮层。上一步留下的抽屉、菜单或 sheet 不算当前步骤。

export function allowedOverlays(pageName) {
    if (pageName === 'chat-press') return ['menu'];
    if (pageName === 'settings') return ['sheet'];
    if (pageName === 'model-home' || pageName === 'model-provider') return ['model'];
    if (pageName === 'account') return ['dialog'];
    if (String(pageName).startsWith('tavern-')) return ['drawer'];
    return [];
}

export function unexpectedOverlays(names, allowed) {
    const allow = new Set(allowed || []);
    return [...names].filter((name) => !allow.has(name));
}
