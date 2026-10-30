// 保存进行中时宿主会直接放弃切角色。等到保存结束再切，并核对角色和聊天文件。

export async function openStCharacterChat(page, { avatar, file, switchMenu = true } = {}) {
    return page.evaluate(async ({ avatar: fileName, file: chatFile, switchMenu: menu }) => {
        const script = await import('/script.js');
        const index = script.characters.findIndex((item) => item.avatar === fileName);
        if (index < 0) throw new Error('合成卡不在角色列表');
        const deadline = Date.now() + 20000;
        let selected = false;
        while (Date.now() < deadline) {
            if (script.isChatSaving) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                continue;
            }
            await script.selectCharacterById(index, { switchMenu: menu });
            const current = window.SillyTavern?.getContext?.() || {};
            if (String(current.characterId) === String(index)) {
                selected = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!selected) throw new Error('没有切到目标角色');
        if (!chatFile) return { characterId: index, chatId: window.SillyTavern.getContext().chatId || '' };
        await script.openCharacterChat(chatFile);
        const opened = window.SillyTavern.getContext();
        if (String(opened.characterId) !== String(index)) throw new Error('打开聊天后角色变了');
        if (opened.chatId !== chatFile) throw new Error(`打开的聊天不是目标文件 ${opened.chatId || ''}`);
        return { characterId: index, chatId: opened.chatId || '' };
    }, { avatar, file, switchMenu });
}
