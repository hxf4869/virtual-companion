export const scenarios = [{ key: 'chat', params: {} }, { key: 'chat-collapsed', params: { panel: 'closed' } }, ...['empty','loading','error','long'].map(state => ({ key: `chat-${state}`, params: { state } }))];
export async function mount({ shell, source, params, context, desktop }) {
    const unavailable = ['empty','loading','error'].includes(params.get('state'));
    if (!unavailable) await shell.openConversation({ relationshipId: '11', name: context.name2, instanceName: '日常' });
    // 手机/基线只走原版生产挂载。桌面不在生产加载链里。
    if (source.startsWith('/baseline/') || innerWidth < 744) return;
    if (unavailable) return;
    seedTimeline(context, params);
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
// UX-23：合成时间线（昨天 / 今天、成组、一条图片消息、末条为用户消息），send_date 取自 context.chat。每行 [用户, 今天, 时, 分, 文本, 是否 HTML]。
function seedTimeline(context, params) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const now = new Date();
    const at = (days, hour, minute) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, minute).getTime();
    const photo = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7a977"/><stop offset="1" stop-color="#8f7bd8"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/></svg>');
    const script = [
        [0, 0, 22, 14, '早呀～'], [0, 0, 22, 14, '今天降温了，出门记得带围巾'],
        [1, 0, 22, 16, '收到！'], [1, 0, 22, 17, '你今天干嘛'],
        [0, 1, 8, 2, '好呀！我查了一下，周六下午人少一点。'], [0, 1, 8, 2, '在整理上次拍的照片'], [0, 1, 8, 3, '有一张晚霞超好看，等下发你'],
        [0, 1, 8, 4, `<img src="${photo}" alt="晚霞" width="240">`, true],
        [1, 1, 8, 10, '好的！期待～'], [1, 1, 8, 10, '周六几点方便？'],
    ];
    const rows = script.map(([user, today, hour, minute, text, html], index) => ({
        index, user: Boolean(user), name: user ? context.name1 : context.name2,
        text: params.get('state') === 'long' && !html ? text.repeat(24) : text, html: Boolean(html),
        sent: at(today ? 0 : 1, hour, minute),
    }));
    context.chat = rows.map((row) => ({ name: row.name, is_user: row.user, is_system: false, mes: row.text, send_date: new Date(row.sent).toISOString() }));
    chat.replaceChildren(...rows.map((row) => {
        const mes = document.createElement('div');
        mes.className = 'mes';
        mes.setAttribute('mesid', String(row.index));
        mes.setAttribute('is_user', String(row.user));
        mes.setAttribute('ch_name', row.name);
        mes.innerHTML = '<div class="mesAvatarWrapper"><div class="avatar"></div></div><div class="mes_block"><div class="ch_name"><span class="name_text"></span></div><div class="mes_text"></div></div>';
        mes.querySelector('.name_text').textContent = row.name;
        const text = mes.querySelector('.mes_text');
        if (row.html) text.innerHTML = row.text; else text.textContent = row.text;
        return mes;
    }));
}
const chatVisible = () => document.querySelector('.vc-shell-chat').getBoundingClientRect().width > 0;
export async function check({ params, source }) {
    if (innerWidth < 744) return;
    const chat = document.getElementById('chat'), sheld = document.getElementById('sheld');
    if (chat.parentElement !== sheld || !document.querySelector('#send_form #send_textarea')) throw Error('宿主聊天结构被改动');
    if (getComputedStyle(chat).overflowY !== 'auto') throw Error('宿主聊天滚动容器改变');
    if (['empty','loading','error'].includes(params.get('state'))) return;
    const { panel } = window.VC_CHAT_PREVIEW;
    // UX-23：桌面无偏好时按气泡；分组 / 胶囊 / 时间只写 data-vc-*，不往 #chat 插节点。
    if (!document.body.classList.contains('vc-reply-bubble')) throw Error('桌面默认不是气泡');
    const rows = [...document.querySelectorAll('#chat > .mes')];
    if (document.querySelector('#chat').children.length !== rows.length) throw Error('#chat 里出现了非 .mes 节点');
    if (rows.some((mes) => mes.querySelector('.mes_text').children.length > 1 && !mes.querySelector('.mes_text img'))) throw Error('.mes_text 子树被改动');
    const pills = rows.filter((mes) => mes.hasAttribute('data-vc-gap'));
    if (pills.length !== 2 || !pills[0].dataset.vcGap.startsWith('昨天 22:14') || !pills[1].dataset.vcGap.startsWith('今天 08:02')) throw Error(`日期胶囊 ${JSON.stringify(pills.map((mes) => mes.dataset.vcGap))}`);
    const posOf = (index) => rows[index].dataset.vcPos;
    if ([0, 1, 4, 5, 6].map(posOf).join() !== 'start,end,start,mid,end') throw Error(`成组 ${[0, 1, 4, 5, 6].map(posOf)}`);
    if (rows[7].dataset.vcPos || !rows[7].classList.contains('vc-rich')) throw Error('图片消息应按铺开呈现');
    if (!rows[9].dataset.vcFoot.endsWith('· 已发送') || rows.filter((mes) => mes.dataset.vcFoot?.includes('已发送')).length !== 1) throw Error('「已发送」只在最后一条用户消息组尾');
    if (chatVisible()) {
        // 角色单段回复的气泡画在 .mes_text（推理胶囊、语音条在气泡外）；用户与分段回复仍是 .mes_block / .vc-seg。
        const bubble = (mes) => mes.querySelector(mes.classList.contains('vc-segmented') ? '.vc-seg' : mes.getAttribute('is_user') === 'true' ? '.mes_block' : '.mes_text');
        const radius = (mes) => ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((corner) => getComputedStyle(bubble(mes))[`border${corner}Radius`]).join(' ');
        if (radius(rows[0]) !== '18px 18px 18px 6px' || radius(rows[1]) !== '6px 18px 18px 18px') throw Error(`角色气泡圆角 ${radius(rows[0])} / ${radius(rows[1])}`);
        if (radius(rows[8]) !== '18px 18px 6px 18px') throw Error(`用户气泡圆角 ${radius(rows[8])}`);
        const gapBetween = (a, b) => bubble(rows[b]).getBoundingClientRect().top - bubble(rows[a]).getBoundingClientRect().bottom;
        if (gapBetween(4, 5) !== 4) throw Error(`组内间距 ${gapBetween(4, 5)}`);
        const tailAvatar = rows[1].querySelector('.avatar'), midAvatar = rows[0].querySelector('.avatar');
        if (tailAvatar.offsetWidth !== 32 || midAvatar.offsetWidth !== 0) throw Error('头像只在组末气泡旁，宽 32');
        const width = bubble(rows[4]).getBoundingClientRect().width;
        if (width > 540 + 1) throw Error(`气泡宽度 ${width}`);
        if (getComputedStyle(bubble(rows[8])).backgroundColor === getComputedStyle(bubble(rows[4])).backgroundColor) throw Error('用户气泡应为强调色');
        if (getComputedStyle(rows[1], '::after').content !== '"22:14"') throw Error(`组尾时间 ${getComputedStyle(rows[1], '::after').content}`);
        if (getComputedStyle(rows[0], '::after').opacity !== '0') throw Error('组内时间应只在悬停时显示');
    }
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
    // UX-23 P1-6：对话宽 ≥560（≥1028）时并排；更窄时面板是浮层，对话不消失、面板不越过标题栏与输入区。
    if (!chatBox.width) throw Error('角色面板打开后对话消失');
    if (innerWidth >= 1028 && (chatBox.width < 560 || Math.min(chatBox.right, panelBox.right) - Math.max(chatBox.left, panelBox.left) > 1)) throw Error('角色面板与对话重叠或对话小于 560');
    if (innerWidth < 1028) {
        const navBottom = document.querySelector('.vc-shell-chat > .vc-navbar').getBoundingClientRect().bottom, formTop = document.querySelector('#send_form').getBoundingClientRect().top;
        if (panelBox.top < navBottom - 1 || panelBox.bottom > formTop + 1) throw Error(`浮层面板越过标题栏或输入区 ${JSON.stringify({ top: panelBox.top, navBottom, bottom: panelBox.bottom, formTop })}`);
    }
    const speaker = document.querySelector('#chat > .mes[data-vc-tail]:not([is_user="true"]):not(.vc-rich)');
    if (speaker && speaker.querySelector('.avatar').offsetWidth !== 32) throw Error('角色消息头像不是 32');
    const tool = speaker?.querySelector('.vc-mes-tools > button');
    if (tool && tool.getBoundingClientRect().left < speaker.querySelector('.mes_block').getBoundingClientRect().right - 1) throw Error('消息工具行应贴在气泡外侧');
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
