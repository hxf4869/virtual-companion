// 会话列表与角色页共用的纯查询。
export function instancesFrom(relationships) {
    return (Array.isArray(relationships) ? relationships : [])
        .filter((row) => row?.personaRef === 'st-character')
        .map((row) => ({
            relationshipId: String(row.relationshipId),
            name: row.companionName || '未命名实例',
        }));
}

export function safeImageUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^data:image\/(png|jpeg|webp|gif)([;,].*)?$/i.test(raw)) return raw;
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '';
}
