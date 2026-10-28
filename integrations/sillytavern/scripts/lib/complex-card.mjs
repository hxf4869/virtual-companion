// 原创 C04/C05 卡。变量由锁定 MVU 解析；iframe 只读取其所在消息的真实变量。
import { cardV2, bookEntry, worldBook } from './fixtures.mjs';

export const statusPanel = `\`\`\`html
<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:12px;color:#eff3fa;background:#1c222c;font:16px/1.6 system-ui,sans-serif}h3{font-size:16px;margin:0 0 8px}dl{display:flex;flex-wrap:wrap;gap:8px 24px;margin:0}dt{font-size:14px;color:#b7c1d2}dd{margin:0}button{margin-top:12px;min-height:44px;border:1px solid #394453;border-radius:8px;background:#252d39;color:#eff3fa;font:inherit;padding:8px 12px}button:focus-visible{outline:2px solid #9ab9ff}p{margin:8px 0 0;color:#b7c1d2}
</style></head><body><h3>蓝窗书店</h3><dl><div><dt>信任</dt><dd id="trust">读取中</dd></div><div><dt>场景</dt><dd id="scene">读取中</dd></div><div><dt>已聊旅行笔记</dt><dd id="discussed">读取中</dd></div></dl><button id="read-state" type="button">查看当前状态</button><p id="notice" role="status"></p><script>
async function readState(){await waitGlobalInitialized('Mvu');const d=Mvu.getMvuData({type:'message',message_id:getCurrentMessageId()});const value=k=>{const v=d.stat_data?.[k];return Array.isArray(v)?v[0]:v};document.querySelector('#trust').textContent=String(value('trust'));document.querySelector('#scene').textContent=String(value('scene'));document.querySelector('#discussed').textContent=String(value('discussed_book'));document.querySelector('#notice').textContent='已刷新';}
document.querySelector('#read-state').addEventListener('click',()=>readState());readState();
</script></body></html>
\`\`\``;

export function complexReply(trust) {
    return `【固定回复】澄夏翻开了旅行笔记，与你聊起书中那座海边小镇。\n<UpdateVariable>\n_.set('trust', ${trust});\n_.set('discussed_book', true);\n</UpdateVariable>`;
}

export function complexCard(name, bookName) {
    const regex = (id, findRegex, replaceString) => ({ id, scriptName: id, findRegex, replaceString, trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null });
    return cardV2({ name, description: '原创成年店员{{char}}经营蓝窗书店，与{{user}}简短交谈。',
        first_mes: '欢迎来到蓝窗书店。想读读这本旅行笔记吗？\n<StatusPlaceHolderImpl/>',
        alternate_greetings: ['窗外下着小雨。澄夏把旅行笔记放在桌上。\n<StatusPlaceHolderImpl/>'],
        book: worldBook(bookName, [
            bookEntry({ id: 0, comment: '[InitVar]书店状态', content: JSON.stringify({ trust: [10, '信任度'], scene: ['bookshop', '地点'], discussed_book: [false, '已讨论旅行笔记'] }) }),
            bookEntry({ id: 1, keys: ['书店', '旅行笔记'], comment: '公开设定', content: 'VC04_BOOK 蓝窗书店有一本虚构的旅行笔记。' }),
            bookEntry({ id: 2, constant: true, comment: '讨论后的公开说明', content: "<% const v=getvar('stat_data.discussed_book',{defaults:false}); if ((Array.isArray(v)?v[0]:v)===true) { %>VC04_EJS_DISCUSS 已聊过旅行笔记，可以继续谈书中的海边小镇。<% } %>" }),
        ], { token_budget: 1200 }),
        extensions: {
            regex_scripts: [regex('vc04-hide-update', '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gi', ''), regex('vc04-status', '/<StatusPlaceHolderImpl\\/>/g', statusPanel)],
            tavern_helper: { scripts: [{ type: 'script', enabled: true, id: 'vc04-mvu', name: 'MVU（锁定自托管）', content: "import '/user/files/mvu-bundle-d03b7dc8.js'", info: '仅随 AI 输出更新，不启用额外模型调用。编辑最后一条回复后，点击“重新处理变量”；编辑更早楼层需使用 MVU 回放楼层功能。', button: { enabled: true, buttons: [{ name: '重新处理变量', visible: true }] }, data: {}, export_with: { data: true, button: true } }], variables: {} },
        },
    });
}
