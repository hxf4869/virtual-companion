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
    // UX-22 R5/R6：面板打开时不盖住标题栏按钮与输入区，也不与对话重叠；窄桌面对话让位时跳过不可见项。
    for (const selector of ['.vc-desk-character-toggle', '.vc-capsule [data-memory]', '.vc-capsule [data-more]', '#send_textarea', '#options_button']) {
        const el = document.querySelector(selector);
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!hit || !el.contains(hit)) throw Error(`角色面板盖住了 ${selector}`);
    }
    const chatBox = document.querySelector('.vc-shell-chat').getBoundingClientRect(), panelBox = panel.panel.getBoundingClientRect();
    if (chatBox.width && Math.min(chatBox.right, panelBox.right) - Math.max(chatBox.left, panelBox.left) > 1) throw Error('角色面板与对话重叠');
    const speaker = chatBox.width ? document.querySelector('#chat > .mes.vc-speaker') : null;
    if (speaker && speaker.querySelector('.avatar').offsetWidth !== 36) throw Error('角色消息头像不是 36');
    const tool = speaker?.querySelector('.vc-mes-tools > button');
    if (tool && Math.abs(tool.getBoundingClientRect().left + 9 - speaker.querySelector('.mes_block').getBoundingClientRect().left) > 1.5) throw Error('消息工具行没有与正文左缘对齐');
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
            for (let i = 0; i < 80; i++) {
                const target=document.querySelector(selector);if(!target)return;
                // 截图/录像单独验动效；交互断言推进已启动的有限关闭动画，不改业务状态或超时。
                for(const animation of target.closest('.vc-sheet')?.getAnimations()||[]){const frames=animation.effect.getKeyframes();if(frames[0]?.opacity==='1'&&frames.at(-1)?.opacity==='0'&&Number.isFinite(animation.effect.getTiming().iterations))animation.finish();}
                await new Promise(r => setTimeout(r, 25));
            }
            throw Error(`聊天编辑控件未关闭：${selector} ${JSON.stringify({alerts:[...document.querySelectorAll('.vc-alert')].map(n=>n.textContent),sheets:[...document.querySelectorAll('.vc-sheet')].map(n=>({opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform})),animations:document.getAnimations().map(a=>({name:a.animationName,state:a.playState,time:a.currentTime,duration:a.effect.getTiming().duration,target:a.effect.target?.className}))})}`);
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
        const previous=await fetchMemory(memoryId);if(previous.lifecycle!=='SUPERSEDED'||!previous.supersededByMemoryId||previous.supersededByMemoryId===memoryId)throw Error('纠正未产生替代身份');if((await fetchMemory(previous.supersededByMemoryId)).summary!==savedSummary)throw Error('纠正保存未读回');
    }
}
