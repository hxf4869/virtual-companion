// UI-P01：只给原生聊天增加导航与身份摘要，不接管生成、消息 DOM 或卡内 iframe。
export function mountChatShell({ getContext, openModels }) {
    if (document.querySelector('#vc-chat-nav')) return;
    document.body.classList.add('vc-chat-shell');
    const nav = document.createElement('nav');
    nav.id = 'vc-chat-nav'; nav.setAttribute('aria-label', '陪伴导航');
    const identity = document.createElement('div'); identity.className = 'vc-chat-identity';
    const name = document.createElement('strong');
    const model = document.createElement('span'); model.className = 'vc-chat-model';
    identity.setAttribute('aria-live', 'polite');
    identity.append(name, model); nav.append(identity);
    function button(label, icon, action) {
        const b = document.createElement('button'); b.type = 'button';
        const i = document.createElement('i'); i.className = `fa-solid ${icon}`; i.setAttribute('aria-hidden', 'true');
        b.append(i, document.createTextNode(label)); b.addEventListener('click', action); nav.append(b);
    }
    button('聊天', 'fa-comments', () => document.querySelector('#send_textarea')?.focus());
    button('角色', 'fa-address-card', () => {
        const toggle = document.querySelector('#rightNavDrawerIcon');
        if (toggle?.classList.contains('closedIcon')) toggle.click();
        document.querySelector('#rm_button_characters')?.click();
    });
    button('模型设置', 'fa-microchip', openModels);
    document.body.append(nav);
    // 手机身份行受字体与视口影响，按实际导航高度为原生聊天留位置。
    const updateHeight = () => document.body.style.setProperty('--vc-chat-nav-height', `${nav.getBoundingClientRect().height}px`);
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(nav);
    const refresh = () => {
        const c = getContext();
        const group = c.groups?.find((g) => String(g.id) === String(c.groupId));
        name.textContent = group?.name || c.characters?.[c.characterId]?.name || '选择一位角色';
        name.title = name.textContent;
        // ST 按当前 source 解析模型，不读取其他协议留下的历史字段。
        const selectedModel = c.mainApi === 'openai' ? c.getChatCompletionModel() : null;
        model.textContent = selectedModel || '模型待配置';
        model.title = model.textContent;
    };
    const c = getContext();
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, refresh);
    c.eventSource.on(c.eventTypes.CHAT_COMPLETION_SETTINGS_READY, refresh);
    c.eventSource.on(c.eventTypes.SETTINGS_UPDATED, refresh);
    c.eventSource.on(c.eventTypes.OAI_PRESET_CHANGED_AFTER, refresh);
    refresh();
    updateHeight();
}
