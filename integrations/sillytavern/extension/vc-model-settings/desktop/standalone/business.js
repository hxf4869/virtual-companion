// 现有业务页的ST数据端口；不启动原生页面，不维护另一份角色/聊天存储。
export async function ensureCharacterReferences(client, context) {
    for (const card of context.characters) {
        if (card.data?.extensions?.vc_character_ref) continue;
        // 创建实例需要持久角色引用；沿现有merge字段，不回写整卡或改写其他扩展。
        const ref = crypto.randomUUID();
        await client.post('/api/characters/merge-attributes', { avatar: card.avatar, data: { extensions: { vc_character_ref: ref } } });
        card.data ||= {}; card.data.extensions ||= {}; card.data.extensions.vc_character_ref = ref;
    }
}

export async function importDesktopCharacter(client, context, { name, bytes, format }) {
    const form = new FormData(), headers = new Headers(client.headers()); headers.delete('Content-Type');
    const kind = format === 'png' ? 'png' : 'json';
    form.append('file_type', kind);
    form.append('avatar', new File([bytes], name || `card.${kind}`, { type: kind === 'png' ? 'image/png' : 'application/json' }));
    const response = await fetch('/api/characters/import', { method: 'POST', credentials: 'same-origin', headers, body: form });
    if (!response.ok) throw new Error('import failed');
    const result = await response.json(), avatar = String(result.file_name).replace(/\.png$/, '') + '.png';
    const activeAvatar=context.characters[context.characterId]?.avatar;
    const cards = await client.characters();
    context.characters.splice(0, context.characters.length, ...cards);
    context.characterId=context.characters.findIndex(card=>card.avatar===activeAvatar);
    await ensureCharacterReferences(client, context);
    const card = context.characters.find(card => card.avatar === avatar);
    if (!card) throw new Error('import failed');
    return { characterRef: card.data.extensions.vc_character_ref, name: card.name,
        description: card.description || card.data.description || '', worldName: card.data.character_book?.name || card.data.extensions.world || '' };
}

export function resolveDesktopConversation(rows, target) {
    const matches = rows.filter(row => (!target.relationshipId || String(row.chat_metadata?.vc_binding?.relationshipId) === String(target.relationshipId))
        && (!target.conversationId || String(row.chat_metadata?.vc_binding?.conversationId) === String(target.conversationId))
        && (!target.chatIdentity || row.chat_metadata?.vc_f2?.id === target.chatIdentity)
        && (!target.file || String(row.file_id || row.file_name).replace(/\.jsonl$/, '') === String(target.file).replace(/\.jsonl$/, ''))
        && (!target.avatar || row.avatar === target.avatar));
    const row = matches[0];
    return row ? { ...target, avatar: row.avatar, file: String(row.file_id || row.file_name).replace(/\.jsonl$/, ''),
        relationshipId: String(row.chat_metadata.vc_binding.relationshipId), chatIdentity: row.chat_metadata.vc_f2?.id } : null;
}
