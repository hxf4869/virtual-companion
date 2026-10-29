// 创建陪伴实例后的打开计划。没有聊天文件名时不猜测；已有不同 vc_f2 的当前会话不覆盖。
export function planOpenCreatedChat({
    characters = [],
    characterRef = '',
    chatIdentity = '',
    chats = [],
    currentMetadata = null,
} = {}) {
    const characterIndex = characters.findIndex((item) => item?.data?.extensions?.vc_character_ref === characterRef);
    const match = Array.isArray(chats)
        ? chats.find((chat) => chat?.metadata?.vc_f2?.id === chatIdentity && typeof chat.file === 'string')
        : null;
    const file = match?.file || '';
    const writeToken = !file && characterIndex >= 0 && Boolean(chatIdentity) && !currentMetadata?.vc_f2;
    return { characterIndex, file, writeToken };
}
