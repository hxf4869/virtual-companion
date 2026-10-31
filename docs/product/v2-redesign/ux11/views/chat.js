export const scenarios = [{ key: 'chat', params: {} }, { key: 'chat-collapsed', params: { panel: 'closed' } }, ...['empty','loading','error','long'].map(state => ({ key: `chat-${state}`, params: { state } }))];
export async function mount({ shell, source, params, context, desktop }) {
    const unavailable = ['empty','loading','error'].includes(params.get('state'));
    if (!unavailable) await shell.openConversation({ relationshipId: '11', name: context.name2, instanceName: '日常' });
    // 手机/基线只走原版生产挂载。桌面不在生产加载链里。
    if (source.startsWith('/baseline/') || innerWidth < 744) return;
    if (unavailable) return;
    const { mountChatView } = await import(`${source}/chat-view.js`);
    mountChatView({ getContext: () => context });
    const { fetchRelationships } = await import(`${source}/api.js`);
    const { installVoiceInput } = await import(`${source}/voice-input.js`);
    void fetchRelationships().then(rows => {
        const current = rows.find(row => String(row.relationshipId) === context.chatMetadata.vc_binding.relationshipId);
        if (current) context.chatMetadata.vc_binding.mode = current.mode;
        installVoiceInput({ getContext: () => context });
    }).catch(() => {}); // 无可用关系时沿用原版隐藏录音入口。
    const { mountCharacterPanel } = await import(`${source}/desktop/character-panel.js`);
    const panel = mountCharacterPanel({ shell, getContext: () => context, aurora: desktop });
    if (params.get('panel') === 'closed') panel.setOpen(false, false);
    if (innerWidth < 1180) shell.dataset.list = 'hidden';
    for (const row of shell.querySelectorAll('.vc-convo')) row.setAttribute('data-vc-light', '');
    window.VC_CHAT_PREVIEW = { panel };
}
export async function check({ params, source }) {
    if (innerWidth < 744) return;
    const chat = document.getElementById('chat'), sheld = document.getElementById('sheld');
    if (chat.parentElement !== sheld || !document.querySelector('#send_form #send_textarea')) throw Error('宿主聊天结构被改动');
    if (getComputedStyle(chat).overflowY !== 'auto') throw Error('宿主聊天滚动容器改变');
    if (['empty','loading','error'].includes(params.get('state'))) return;
    const { panel } = window.VC_CHAT_PREVIEW;
    panel.setOpen(true, false);
    if (panel.toggle.getAttribute('aria-expanded') !== 'true' || panel.panel.hidden) throw Error('角色面板未展开');
    panel.panel.querySelector('.vc-desk-character-close').click();
    if (!panel.panel.hidden || document.activeElement !== panel.toggle) throw Error('角色面板关闭焦点未归还');
    panel.setOpen(true, false);
    const correct = panel.panel.querySelector('.vc-desk-recalled-actions button');
    if (correct) {
        const wait = async selector => {
            for (let i = 0; i < 80; i++) { const element = document.querySelector(selector); if (element) return element; await new Promise(r => setTimeout(r, 25)); }
            throw Error(`聊天编辑控件未出现：${selector}`);
        };
        const waitRemoved = async selector => {
            for (let i = 0; i < 80; i++) { if (!document.querySelector(selector)) return; await new Promise(r => setTimeout(r, 25)); }
            throw Error(`聊天编辑控件未关闭：${selector}`);
        };
        correct.click(); const form = await wait('.vc-desk-memory-editor');
        const input = form.querySelector('textarea'); input.value += '（草稿）'; input.dispatchEvent(new Event('input', { bubbles: true }));
        form.querySelector('button[type="button"]').click();
        await wait('.vc-alert');
        if (document.activeElement.textContent !== '继续编辑') throw Error('纠正退出确认默认焦点错误');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await waitRemoved('.vc-alert');
        if (!input.value.endsWith('（草稿）')) throw Error('Esc 丢失纠正草稿');
        form.querySelector('button[type="button"]').click();
        (await wait('.vc-alert')).querySelector('[data-vc-ok]').click();
        await waitRemoved('.vc-desk-memory-editor');
        const nextCorrect = panel.panel.querySelector('.vc-desk-recalled-actions button');
        const memoryId = nextCorrect.closest('[data-memory-id]').dataset.memoryId;
        nextCorrect.click();
        const savedForm = await wait('.vc-desk-memory-editor');
        const savedInput = savedForm.querySelector('textarea'), save = savedForm.querySelector('[type="submit"]');
        savedInput.value += '（已纠正）'; savedInput.dispatchEvent(new Event('input', { bubbles: true }));
        const savedSummary = savedInput.value;
        window.VC_PREVIEW_DELAY = 200;
        const width = save.getBoundingClientRect().width; save.click();
        if (!savedInput.disabled || !save.disabled || save.textContent !== '保存中…' || save.getBoundingClientRect().width !== width) throw Error('纠正保存等待态错误');
        await waitRemoved('.vc-desk-memory-editor');
        window.VC_PREVIEW_DELAY = 0;
        const { fetchMemory } = await import(`${source}/api.js`);
        if ((await fetchMemory(memoryId)).summary !== savedSummary) throw Error('纠正保存未读回');
    }
}
