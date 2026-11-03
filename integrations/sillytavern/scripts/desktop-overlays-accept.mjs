// DR-4：公共弹层的冻结视觉、真实焦点和连续缩窗；只用本机合成宿主。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { startPreview, settle } from './lib/ux11-preview.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-4');
const REFERENCES = ['shell.js', 'desktop/settings-shell.js', 'ui/menu.js', 'ui/sheet.js', 'ui/alert.js', 'consent.js', 'data-rights.js', 'desktop/base.css', 'account.css', 'settings-pages.css', 'vc-ui.css', 'consent.css', 'chat-compose.js', 'chat-view.js', 'chat-search.js', 'desktop/chat-search.css', 'desktop/chat.css', 'desktop/character-panel.js', 'desktop/status-card.js'];

export async function runDesktopOverlays({ captureReference = false, compareReference = false, checkOnly = false, alertOnly = false, consentOnly = false, modelOnly = false, chatOnly = false, chatWidgets = false } = {}) {
    chatOnly = chatOnly || chatWidgets;
    const out = chatWidgets ? path.join(ROOT, '.review-queue/DR-6') : OUT;
    const frames = chatWidgets ? path.join(out, 'ready') : out;
    const references = chatWidgets ? [...REFERENCES, 'chat-react.js', 'desktop/quick-switch.js', 'desktop/suggest.js', 'conversations.js', 'desktop/chat-compose.css', 'desktop/chat-react.css', 'voice-chat.js'] : REFERENCES;
    const preview = await startPreview(); let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-partial-raster', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'] });
        const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => {
            localStorage.clear(); localStorage.setItem('vc-reduced-motion', 'true');
            if (new URLSearchParams(location.search).get('sidebar') === 'open') localStorage.setItem('vc-sidebar', 'open');
        });
        const page = await context.newPage(); await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        if (captureReference) {
            await page.route('**/preview.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(out, 'reference/preview.js'), 'utf8') }));
            const refs = new Map(await Promise.all(references.map(async f => [f, await readFile(path.join(out, 'reference', f), 'utf8')])));
            // DR-7贴纸迁移新增了Sheet标题接口；历史DR-6回放须搭配同期贴纸模块。
            if (chatWidgets) refs.set('stickers.js', await readFile(path.join(ROOT, '.review-queue/DR-7/reference/stickers.js'), 'utf8'));
            await page.route('**/source/**', route => { const f = new URL(route.request().url()).pathname.split('/source/')[1]; return refs.has(f) ? route.fulfill({ contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript', body: refs.get(f) }) : route.continue(); });
        }
        async function open(width = 1440, theme = 'light', view = 'components', screen = '') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=${view}&screen=${screen}&theme=${theme}`); await settle(page);
            // 壳层会在700/2000/5000ms补取会话快照；旧96帧混有补取前后两种数据。
            // 保留旧帧不覆盖；新对照令冻结旧代码与候选都先完成同一批定时加载。
            if ((chatWidgets || compareReference && !captureReference && view === 'chat') && !checkOnly) {
                await page.clock.runFor(5100);
                // 使用双方真实公开刷新入口取得同一“当前会话已加载”状态，避免旧补取丢掉高亮。
                await page.evaluate(() => window.VC_CHAT_PREVIEW?.panel.refresh());
                await settle(page);
            }
        }
        async function setupReadFixture({ fail = false } = {}) {
            await page.evaluate(async ({ fail }) => {
                const ctx=window.VC_CHAT_PREVIEW.context, message=ctx.chat[6];
                ctx.chatMetadata.vc_f2={id:'00000000-0000-4000-8000-000000000021'};
                message.vc_message_id='00000000-0000-4000-8000-000000000022';
                message.extra={vc_source:{id:'00000000-0000-4000-8000-000000000023'}};
                const fetch=window.fetch;
                const response=(body,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
                window.DR_READ_POSTS=0;
                window.fetch=(url,init={})=>{
                    if(String(url).endsWith('/st/sources/reconcile'))return response({});
                    if(String(url).endsWith('/voice-clips')&&init.method==='POST'){window.DR_READ_POSTS++;return fail?response({code:'SYNTHETIC_FAILURE'},503):response({clipId:'701',status:'queued'});}
                    if(String(url).endsWith('/voice-clips/701'))return response({clipId:'701',status:'ready',durationMs:900});
                    return fetch(url,init);
                };
                const {voicePlayer}=await import('/source/voice.js');let playing=false;
                voicePlayer.toggle=async(_id,events)=>{playing=!playing;events.onState(playing);}; // 只替换媒体输出边界。
                const voice=await import('/source/voice-chat.js');
                voice.installChatVoice({getContext:()=>ctx,saveChat:ctx.saveChat,ready:Promise.resolve()});
                await voice.loadVoicePolicy(ctx);
            }, { fail });
            await page.locator('#chat > .mes[mesid="6"] [data-vc-act="read"]').waitFor({timeout:2000});
        }
        let shots = 0;
        async function snapshot(name, { normal = true } = {}) {
            await settle(page);
            await page.waitForFunction(() => [...document.querySelectorAll('.vc-sheet-pane')].every(el => getComputedStyle(el).opacity === '1' && el.getAnimations().every(a => a.playState === 'finished')));
            const data = await page.screenshot({ animations: 'disabled' });
            const approvedSelection = chatWidgets && name.startsWith('suggestions-');
            const referenceFolder = approvedSelection ? 'accepted-selection' : 'before';
            const target = path.join(frames, captureReference ? referenceFolder : 'after', `${name}.png`); await mkdir(path.dirname(target), { recursive: true });
            if (captureReference) {
                try { await writeFile(target, data, { flag: 'wx' }); }
                catch (e) { if (e.code !== 'EEXIST') throw e; assert.ok(PNG.sync.read(data).data.equals(PNG.sync.read(await readFile(target)).data), `${name} 参照不能覆盖`); }
            } else await writeFile(target, data);
            if (compareReference && normal) {
                // DR-6已把旧简化聊天样板换成真实生产挂载；公共壳层的聊天对照沿用其冻结旧实现。
                // DR-4的原before不覆盖，其他公共弹层仍逐像素使用原参照。
                const before = !chatWidgets && name.startsWith('chat-')
                    ? path.join(ROOT, '.review-queue/DR-6/ready/before')
                    : path.join(frames, name.startsWith('menu-') ? 'accepted-menu' : referenceFolder);
                const a = PNG.sync.read(data), b = PNG.sync.read(await readFile(path.join(before, `${name}.png`)));
                assert.ok(a.width === b.width && a.height === b.height && a.data.equals(b.data), `${name} 正常视觉发生差异`);
            }
            shots++;
        }
        if (!checkOnly && !alertOnly && !consentOnly && !modelOnly && !chatOnly) {
            for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
                await open(width, theme); await snapshot(`shell-${width}-${theme}`);
                await page.locator('[data-demo="menu"]').click();
                if (!captureReference) {
                    const rounding = await page.evaluate(() => {
                        const a = document.querySelector('[data-demo="menu"]').getBoundingClientRect(), m = document.querySelector('.vc-menu').getBoundingClientRect();
                        const oldX = Math.max(8, Math.min(a.left > innerWidth / 2 ? Math.min(innerWidth - 16, a.right) - m.width : Math.max(16, a.left), innerWidth - m.width - 8));
                        const oldY = Math.max(8, Math.min(a.bottom + 8, innerHeight - m.height - 8));
                        return { x: Math.abs(m.x - oldX), y: Math.abs(m.y - oldY), max: 0.5 / devicePixelRatio };
                    });
                    assert.ok(rounding.x <= rounding.max && rounding.y <= rounding.max, `菜单仅允许Owner已批准的半个物理像素取整：${JSON.stringify(rounding)}`);
                }
                await snapshot(`menu-${width}-${theme}`);
                await open(width, theme); await page.locator('[data-demo="confirm"]').click(); await snapshot(`alert-${width}-${theme}`);
                await open(width, theme); await page.locator('[data-demo="edit"]').click(); await snapshot(`sheet-${width}-${theme}`);
                await page.evaluate(() => { const body = document.createElement('p'); body.textContent = '合成下一层'; window.VC_SAMPLE_SHEET.push({ title: '下一层', body }); });
                await snapshot(`sheet-layer-${width}-${theme}`);
            }
            for (const theme of ['light', 'dark']) for (const width of [1440, 864]) { await open(width, theme, 'settings', 'account'); await snapshot(`settings-${width}-${theme}`); }
        }
        if (!checkOnly && !alertOnly && !modelOnly && !chatOnly) {
            for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
                await open(width, theme);
                await page.evaluate(async () => { const { mountConsentGate } = await import('/source/consent.js'); window.DR_CONSENT = await mountConsentGate({ listConsents: async () => [], captureSession: async () => ({}), recordConsent: async () => { throw { kind: 'forbidden' }; }, reauth: async () => {} }); });
                await page.waitForFunction(() => document.querySelector('[data-vc-consent]')?.sheet);
                await snapshot(`consent-${width}-${theme}`);
                await page.locator('[data-consent-toggle="AI_CONTENT_NOTICE"]').click(); await snapshot(`consent-expanded-${width}-${theme}`);
                await page.locator('[data-consent-accept]').click(); await page.locator('[data-consent-reauth]').waitFor(); await snapshot(`consent-reauth-${width}-${theme}`);
            }
        }
        if (!checkOnly && !alertOnly && !modelOnly && !consentOnly) {
            for (const width of [1440, 864]) for (const theme of ['light', 'dark']) { await open(width, theme, 'chat'); await snapshot(`chat-${width}-${theme}`); }
        }
        if (!checkOnly && chatWidgets) {
            for (const width of [1440, 864]) for (const theme of ['light', 'dark']) {
                const visit = async () => { await open(width, theme, 'chat'); await page.waitForFunction(() => document.querySelector('#vc-emoji-btn')); };
                await visit(); await page.locator('.vc-desk-search-toggle').click();
                await page.locator('.vc-chat-search input').fill('围巾');
                await page.waitForFunction(() => document.querySelector('.vc-chat-search-count').textContent === '1 / 1');
                await snapshot(`search-${width}-${theme}`);
                await visit(); await page.keyboard.press('Control+k'); await page.locator('.vc-quick-input').waitFor({timeout:2000});
                await snapshot(`quick-${width}-${theme}`); await page.locator('.vc-quick-input').fill('没有这个合成会话');
                await snapshot(`quick-empty-${width}-${theme}`);
                await visit(); await page.evaluate(() => window.VC_CHAT_PREVIEW.chatView.openMemoryInspector(document.querySelector('[data-memory]')));
                await page.locator('#vc-memory-inspector [data-memory-id]').first().waitFor({timeout:2000});
                await snapshot(`inspector-${width}-${theme}`);
                await page.locator('#vc-memory-inspector .vc-segment button').last().click(); await snapshot(`inspector-all-${width}-${theme}`);
                await page.locator('#vc-memory-inspector [data-memory-id] button').first().click();
                await page.locator('#vc-memory-inspector textarea').waitFor({timeout:2000}); await snapshot(`inspector-edit-${width}-${theme}`);
                await visit(); await page.locator('#vc-emoji-btn').click(); await page.locator('#vc-emoji-panel').waitFor({timeout:2000});
                await snapshot(`emoji-${width}-${theme}`); await page.locator('.vc-emoji-search').fill('笑');
                await snapshot(`emoji-search-${width}-${theme}`);
                await page.locator('.vc-emoji-search').fill(''); await page.locator('.vc-emoji-segment button').last().click();
                await snapshot(`stickers-${width}-${theme}`);
                await visit(); await page.locator('#vc-emoji-btn').click(); await page.locator('#vc-emoji-panel').waitFor({timeout:2000});
                await page.locator('.vc-emoji-cell').first().hover(); await page.locator('.vc-emoji-zoom:not([hidden])').waitFor();
                await snapshot(`emoji-zoom-${width}-${theme}`);
                await visit(); await page.locator('#chat > .mes[mesid="6"]').hover();
                await page.locator('#vc-react-bar:not([hidden])').waitFor(); await snapshot(`reactions-${width}-${theme}`);
                await visit(); await page.locator('.vc-desk-character-toggle').click();
                await page.locator('.vc-desk-recalled-actions button').first().waitFor({timeout:2000});
                await snapshot(`character-panel-${width}-${theme}`);
                await page.locator('.vc-desk-recalled-actions button').first().click(); await page.locator('.vc-desk-memory-editor textarea').waitFor({timeout:2000});
                await snapshot(`character-edit-${width}-${theme}`);
                await visit(); await page.locator('[data-who-avatar]').click(); await page.locator('#vc-status-card').waitFor({timeout:2000});
                await snapshot(`status-card-${width}-${theme}`);
                await visit(); await page.evaluate(async()=>{
                    const ctx=window.VC_CHAT_PREVIEW.context, last=ctx.chat.length-1, mes=document.querySelector(`#chat > .mes[mesid="${last}"]`);
                    ctx.chat[last].is_user=false;mes.setAttribute('is_user','false');
                    ctx.chatMetadata.vc_suggestions={mesid:last,items:['好呀，晚点聊','想看看那张照片','周六下午怎么样？']};
                    await ctx.eventSource.emit('CHAT_CHANGED');
                }); await page.locator('.vc-suggest-chip').first().waitFor({timeout:2000});
                // Owner已确认刷新后保留高亮。仅旧实现回放时通过原公开刷新入口取得原皮肤的选中态；
                // 保存独立accepted-selection，不覆盖旧before，也不为候选补选中状态。
                if (captureReference) await page.evaluate(() => window.VC_CHAT_PREVIEW.panel.refresh());
                await snapshot(`suggestions-${width}-${theme}`);
                await visit(); await page.locator('#chat > .mes').last().click({button:'right'});
                await page.getByRole('menuitem', {name:'引用',exact:true}).click(); await page.locator('#vc-quote-bar').waitFor({timeout:2000});
                await snapshot(`quote-${width}-${theme}`);
                await visit(); await page.evaluate(() => { window.VC_CHAT_PREVIEW.context.chat[1].extra={vc_reactions:['❤️','👍']}; window.VC_CHAT_PREVIEW.context.eventSource.emit('CHARACTER_MESSAGE_RENDERED',1); });
                await page.locator('.vc-react-badge').first().waitFor({timeout:2000}); await page.locator('#chat > .mes[mesid="1"]').scrollIntoViewIfNeeded();
                await page.locator('#chat').evaluate(el => el.dispatchEvent(new Event('scroll')));
                await page.waitForFunction(() => document.querySelector('#vc-date-chip.is-on') && getComputedStyle(document.querySelector('#vc-date-chip')).opacity === '1');
                await snapshot(`reaction-${width}-${theme}`);
                await visit(); await page.evaluate(async () => {
                    document.body.setAttribute('data-generating','true');
                    await window.VC_CHAT_PREVIEW.context.eventSource.emit('GENERATION_STARTED','normal',{},false);
                    window.toastr.error('Generation failed','Error');
                    document.body.setAttribute('data-generating','false');
                    await window.VC_CHAT_PREVIEW.context.eventSource.emit('GENERATION_ENDED');
                });
                await page.locator('.vc-send-retry').waitFor({timeout:2000}); await snapshot(`send-failure-${width}-${theme}`);
                await visit(); await page.evaluate(() => {
                    const mes=document.querySelector('#chat > .mes[mesid="7"]');
                    const counter=document.createElement('span');counter.className='swipes-counter';counter.textContent='1/2';mes.querySelector('.mes_block').append(counter);
                    window.VC_CHAT_PREVIEW.chatView.refresh();
                });
                await page.locator('[data-vc-pager]').waitFor({timeout:2000}); await snapshot(`pager-${width}-${theme}`);
                await visit(); await setupReadFixture(); const read=page.locator('#chat > .mes[mesid="6"] [data-vc-act="read"]');
                await page.locator('#chat > .mes[mesid="6"]').hover(); await snapshot(`read-idle-${width}-${theme}`);
                await page.evaluate(async()=>{
                    const voice=await import('/source/voice-chat.js'),fetch=window.fetch;
                    window.fetch=(url,init={})=>String(url).endsWith('/voice/engines')?new Promise(resolve=>{window.DR_READ_RESUME=async()=>resolve(await fetch(url,init));}):fetch(url,init);
                    voice.invalidateVoicePolicy();
                });
                await read.click(); await page.waitForFunction(()=>document.querySelector('#chat > .mes[mesid="6"] [data-vc-act="read"]').disabled);
                await snapshot(`read-busy-${width}-${theme}`);
                await page.evaluate(()=>window.DR_READ_RESUME());
                await page.waitForFunction(()=>document.querySelector('#chat > .mes[mesid="6"] [data-vc-act="read"]').getAttribute('aria-pressed')==='true');
                await snapshot(`read-playing-${width}-${theme}`);
                await visit(); await setupReadFixture({fail:true});
                await page.locator('#chat > .mes[mesid="6"]').hover();
                await page.locator('#chat > .mes[mesid="6"] [data-vc-act="read"]').click();
                await page.waitForFunction(()=>document.querySelector('#chat > .mes[mesid="6"] [data-vc-act="read"]').title==='没有完成，请重试。');
                await snapshot(`read-failed-${width}-${theme}`);


            }
        }
        if (!captureReference && !consentOnly && !modelOnly && !chatOnly) {
            if (!alertOnly) {
                await open(1440, 'light', 'chat');
                await page.evaluate(async () => { const { popMenu } = await import('/source/ui/menu.js'); window.DR_MENU = popMenu(document.querySelector('[data-more]'), [{ label: '第一项' }, { label: '第二项' }]); });
                await page.locator('.vc-menu').waitFor();
                for (const width of [1280, 1180, 1179, 1024, 1023, 864, 768, 744, 1440]) {
                    await page.setViewportSize({ width, height: 900 });
                    await page.waitForFunction(() => { const m = document.querySelector('.vc-menu')?.getBoundingClientRect(); const a = document.querySelector('[data-more]')?.getBoundingClientRect(); return m && a && m.right <= innerWidth - 7 && m.left >= 7 && Math.min(Math.abs(m.left - a.left), Math.abs(m.right - a.right)) <= 16; }, null, { timeout: 1500 });
                    const anchor = await page.locator('[data-more]').boundingBox(), menu = await page.locator('.vc-menu').boundingBox();
                    assert.ok(Math.min(Math.abs(menu.x - anchor.x), Math.abs(menu.x + menu.width - anchor.x - anchor.width)) <= 16, `菜单持续锚定 ${width}`);
                }
                await page.keyboard.press('End'); await page.keyboard.press('Tab');
                await page.locator('.vc-menu').waitFor({ state: 'detached' });
                await page.locator('[data-more]').click(); await page.locator('.vc-menu').waitFor();
                await page.keyboard.press('Home'); await page.keyboard.press('Shift+Tab');
                await page.locator('.vc-menu').waitFor({ state: 'detached' });
                await page.locator('[data-more]').click(); await page.locator('.vc-menu').waitFor();
                await page.keyboard.press('Escape'); await page.locator('.vc-menu').waitFor({ state: 'detached' });
                assert.equal(await page.locator('[data-more]').evaluate(el => el === document.activeElement), true, 'Escape归还锚点焦点');
                await open(390); await page.locator('[data-demo="edit"]').click();
                await page.locator('.vc-sheet input').fill('未保存的合成名称'); await page.keyboard.press('Escape');
                await page.locator('[data-vc-cancel]').click(); await page.locator('.vc-alert').waitFor({ state: 'detached' });
                assert.equal(await page.locator('.vc-sheet input').inputValue(), '未保存的合成名称');
                await page.keyboard.press('Escape'); await page.locator('[data-vc-ok]').click(); await page.locator('.vc-sheet').waitFor({ state: 'detached' });
                assert.equal(await page.locator('[data-demo="edit"]').evaluate(el => el === document.activeElement), true);
                await open(1440, 'light', 'model', 'home');
                await page.keyboard.press('Escape');
                await page.locator('.vcms-overlay').waitFor({ state: 'hidden', timeout: 1500 });
            }
            await open(1440);
            await page.evaluate(async () => { const { mountDataRights } = await import('/source/data-rights.js'); window.DR_ACCOUNT = mountDataRights(); window.DR_ACCOUNT.open(); });
            await page.locator('[data-vc-account-go="delete"]').click(); await page.locator('[data-delete] button[type="submit"]').click(); await page.locator('.vc-alert').waitFor();
            const geometry = await page.locator('.vc-alert').evaluate(el => { const a = el.getBoundingClientRect(), c = el.querySelector('.vc-alert-copy').getBoundingClientRect(), i = el.querySelector('.vc-alert-icon').getBoundingClientRect(); return { width: a.width, copyWidth: c.width, copyLeft: c.left, iconRight: i.right, iconWidth: i.width }; });
            assert.ok(geometry.copyWidth > geometry.width / 2 && geometry.iconWidth === 40 && geometry.copyLeft >= geometry.iconRight, `账户确认框按既有图标/文案两列排版：${JSON.stringify(geometry)}`);
            await snapshot('account-alert-fixed', { normal: false });
            await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.evaluate(() => new Promise(requestAnimationFrame));
            assert.equal(await page.locator('[data-vc-cancel]').evaluate(el => el === document.activeElement), true, `嵌套确认焦点不离开弹层：${await page.evaluate(() => document.activeElement.outerHTML.slice(0,500))}`);
            await page.keyboard.press('Escape'); await page.locator('.vc-alert').waitFor({ state: 'detached' });
            assert.equal(await page.locator('.vc-data-dialog').isVisible(), true, '只关闭最上层确认');
            await page.evaluate(() => window.DR_ACCOUNT.destroy());
            await open(390);
            await page.evaluate(async () => { const { mountDataRights } = await import('/source/data-rights.js'); window.DR_MOBILE_ACCOUNT = mountDataRights(); });
            const settingsButton = page.locator('.vc-shell-page.is-on [data-settings]');
            await settingsButton.click();
            await page.locator('.vc-sheet [data-action="data"]').evaluate(el => { el.focus(); window.DR_MOBILE_ACCOUNT.open(el); });
            await page.locator('.vc-data-dialog[open]').waitFor(); await page.keyboard.press('Escape');
            await page.locator('.vc-data-dialog[open]').waitFor({ state: 'detached', timeout: 1500 });
            assert.equal(await page.locator('.vc-sheet').isVisible(), true, '账户返回只恢复原设置sheet');
            await page.waitForFunction(() => document.querySelector('.vc-sheet [data-action="data"]') === document.activeElement);
            await page.keyboard.press('Escape'); await page.locator('.vc-sheet').waitFor({ state: 'detached' });
            await settingsButton.click(); await page.locator('.vc-sheet [data-action="data"]').evaluate(el => { el.focus(); window.DR_MOBILE_ACCOUNT.open(el); });
            await page.locator('.vc-data-dialog[open]').waitFor(); await page.setViewportSize({ width: 1440, height: 900 });
            await page.locator('.vc-sheet').waitFor({ state: 'detached' });
            assert.equal(await page.locator('.vc-data-dialog[open]').isVisible(), true, '切回桌面移除旧设置sheet，独立账户页继续显示');
            await page.evaluate(() => window.DR_MOBILE_ACCOUNT.destroy());
        }
        if (!captureReference && chatWidgets) {
            await open(1440, 'light', 'chat');
            await page.clock.runFor(5100);
            const currentConversations = () => page.locator('.vc-convo[aria-current="true"]').evaluateAll(rows => rows.map(row => row.dataset.relationshipId));
            assert.deepEqual(await currentConversations(), ['11'], '定时补取后仍高亮当前会话');
            await page.evaluate(() => window.VC_CHAT_PREVIEW.context.eventSource.emit('CHAT_CHANGED'));
            await page.clock.runFor(5100);
            assert.deepEqual(await currentConversations(), ['11'], '同一会话刷新不丢高亮');
            await page.evaluate(async () => {
                const ctx = window.VC_CHAT_PREVIEW.context;
                ctx.chatMetadata.vc_binding.relationshipId = '12';
                await ctx.eventSource.emit('CHAT_CHANGED');
            });
            await page.clock.runFor(5100);
            assert.deepEqual(await currentConversations(), ['12'], '宿主切会话后仅当前绑定高亮');
            for (const width of [1180, 1179, 1024, 864, 768, 744, 1440]) {
                await page.setViewportSize({width,height:900}); await settle(page);
                assert.deepEqual(await currentConversations(), ['12'], `窗口和侧栏收展保留选中 ${width}`);
                assert.equal(await page.locator('.vc-sidebar').evaluate(el => el.classList.contains('is-collapsed')), width < 1180);
            }
            // 现有桌面样式隐藏手动按钮；另验真实支持的窄窗展开偏好，不暴露新控件。
            await page.setViewportSize({width:864,height:900});
            await page.goto(`${preview.url}frame.html?view=chat&theme=light&sidebar=open`); await settle(page);
            await page.clock.runFor(5100);
            assert.equal(await page.locator('.vc-sidebar').evaluate(el => el.classList.contains('is-collapsed')), false);
            assert.deepEqual(await currentConversations(), ['11'], '既有展开偏好也保留当前会话高亮');
            await page.evaluate(async () => {
                const ctx = window.VC_CHAT_PREVIEW.context;
                ctx.chatMetadata.vc_binding.relationshipId = '';
                await ctx.eventSource.emit('CHAT_CHANGED');
            });
            await page.clock.runFor(5100);
            assert.deepEqual(await currentConversations(), [], '无绑定时不残留旧高亮');
            const characterLayers = [];
            await open(1440, 'light', 'chat'); await page.locator('.vc-desk-character-toggle').click();
            await page.locator('.vc-desk-recalled-actions button').nth(1).click(); await page.locator('.vc-alert').waitFor();
            await page.evaluate(() => window.VC_CHAT_PREVIEW.panel.destroy()); characterLayers.push(await page.locator('.vc-alert').count());
            await open(1440, 'light', 'chat'); await page.locator('.vc-desk-character-toggle').click();
            await page.evaluate(() => {
                const fetch = window.fetch; window.DR_CHARACTER_READS = [];
                window.fetch = (url, init = {}) => /\/memories\/\d+$/.test(String(url)) && (!init.method || init.method === 'GET') ? new Promise(resolve => window.DR_CHARACTER_READS.push(async () => resolve(await fetch(url, init)))) : fetch(url, init);
                const edit = document.querySelector('.vc-desk-recalled-actions button'); edit.click(); edit.click();
            });
            await page.waitForFunction(() => window.DR_CHARACTER_READS.length === 2);
            await page.evaluate(() => window.DR_CHARACTER_READS[1]()); await page.locator('.vc-desk-memory-editor').waitFor();
            await page.evaluate(() => window.DR_CHARACTER_READS[0]()); await settle(page);
            characterLayers.push(await page.locator('.vc-desk-memory-editor').count());
            assert.deepEqual(characterLayers, [0, 1], '删除确认随角色面板卸载；迟到的同一记忆请求不得重复开编辑层');
            await open(1440, 'light', 'chat'); await page.locator('.vc-desk-character-toggle').click();
            await page.locator('.vc-desk-recalled-actions button').first().click(); await page.locator('.vc-desk-memory-editor').waitFor();
            await page.evaluate(() => window.VC_CHAT_PREVIEW.panel.destroy());
            assert.equal(await page.locator('.vc-desk-memory-editor').count(), 0, '销毁角色面板同步卸载纠正弹层');
            await open(1440, 'light', 'chat');
            await page.locator('#chat > .mes[mesid="6"]').hover(); await page.locator('#vc-react-bar:not([hidden])').waitFor();
            await page.locator('#vc-react-bar button').first().focus(); await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('#vc-react-bar button').nth(1).evaluate(el => el === document.activeElement), true, `开源Toolbar管理方向键焦点：${await page.evaluate(() => ({active:document.activeElement.outerHTML,hidden:document.querySelector('#vc-react-bar').hidden,buttons:[...document.querySelectorAll('#vc-react-bar button')].map(e=>e.tabIndex)})) .then(JSON.stringify)}`);
            await open(1440, 'light', 'chat'); await page.locator('#vc-emoji-btn').click();
            await page.locator('.vc-emoji-search').waitFor();
            await page.evaluate(() => { window.DR_EMOJI_INPUT = document.querySelector('.vc-emoji-search'); window.DR_COMPOSER = document.querySelector('#send_textarea'); });
            await page.locator('.vc-emoji-search').fill('笑'); await page.locator('.vc-emoji-cell').first().click();
            assert.equal(await page.evaluate(() => document.querySelector('#send_textarea') === window.DR_COMPOSER && document.activeElement === window.DR_COMPOSER && window.DR_COMPOSER.value.length > 0), true, '表情插入原生输入框并归还焦点');
            assert.equal(await page.evaluate(() => document.querySelector('.vc-emoji-search') === window.DR_EMOJI_INPUT && window.DR_EMOJI_INPUT.value === '笑'), true, '连续选择保留搜索节点和查询');
            await page.keyboard.press('Escape'); await page.locator('#vc-emoji-panel').waitFor({state:'detached'});
            assert.equal(await page.locator('#vc-emoji-btn').evaluate(el => el === document.activeElement), true);
            await page.locator('#vc-emoji-btn').click(); await page.locator('.vc-emoji-search').waitFor();
            await page.locator('#vc-emoji-btn').click(); await page.locator('#vc-emoji-panel').waitFor({state:'detached'});
            await page.locator('#vc-emoji-btn').click(); await page.locator('.vc-emoji-search').waitFor();
            await page.evaluate(() => window.VC_CHAT_PREVIEW.context.eventSource.emit('CHAT_CHANGED'));
            await page.locator('#vc-emoji-panel').waitFor({state:'detached'});
            assert.equal(await page.locator('[data-vc-overlay-root]').count(), 0, '切会话卸载表情弹层root');
            await open(1440, 'light', 'chat');
            await page.evaluate(() => {
                window.DR_CHAT_NODES = [document.querySelector('#chat .mes'), document.querySelector('#chat .mes_text'), document.querySelector('#send_textarea')];
                window.DR_SWITCH_CLICKS = [];
                document.addEventListener('click', event => { const row = event.target.closest('.vc-convo[data-relationship-id]'); if (row) window.DR_SWITCH_CLICKS.push(row.dataset.relationshipId); }, true);
            });
            await page.locator('.vc-desk-search-toggle').click();
            const field = page.locator('.vc-chat-search input'); await field.fill('围巾');
            await page.waitForFunction(() => document.querySelector('.vc-chat-search-count').textContent === '1 / 1');
            await page.evaluate(() => { window.DR_CHAT_SEARCH = document.activeElement; });
            await field.fill('围'); await field.press('Enter');
            assert.equal(await page.evaluate(() => window.DR_CHAT_SEARCH === document.activeElement && window.DR_CHAT_SEARCH === document.querySelector('.vc-chat-search input')), true);
            await page.keyboard.press('Escape'); await page.locator('.vc-chat-search').waitFor({state:'hidden'});
            const composer = page.locator('#send_textarea'); await composer.focus();
            await page.keyboard.press('Control+k'); const input = page.locator('.vc-quick-input'); await input.waitFor({timeout:2000});
            await page.evaluate(() => { window.DR_QUICK_INPUT = document.querySelector('.vc-quick-input'); });
            await input.fill('林舟'); await page.waitForFunction(() => document.querySelectorAll('.vc-quick-row').length === 1);
            await input.fill(''); await page.waitForFunction(() => document.querySelectorAll('.vc-quick-row').length === 2);
            assert.equal(await page.evaluate(() => window.DR_QUICK_INPUT === document.activeElement), true, '筛选保留原输入和焦点');
            await page.keyboard.press('ArrowUp');
            assert.match(await page.locator('.vc-quick-row[aria-selected="true"]').textContent(), /林舟/);
            await page.keyboard.press('Enter'); await page.locator('#vc-quick-switch').waitFor({state:'detached',timeout:2000});
            assert.deepEqual(await page.evaluate(() => window.DR_SWITCH_CLICKS), ['12'], '库的Enter只点击原会话入口一次');
            await composer.focus(); await page.keyboard.press('Control+k'); await input.waitFor({timeout:2000});
            for (const width of [1024, 864, 768, 744, 864, 1440]) {
                await page.setViewportSize({width,height:width===864?390:900}); await settle(page);
                assert.equal(await page.evaluate(() => window.DR_QUICK_INPUT.isConnected), false, '上次关闭的字段已释放');
                await page.locator('.vc-quick-row').last().click({trial:true});
            }
            await page.keyboard.press('Escape'); await page.locator('#vc-quick-switch').waitFor({state:'detached',timeout:2000});
            await page.waitForFunction(() => document.querySelector('#send_textarea') === document.activeElement);
            assert.equal(await page.evaluate(() => window.DR_CHAT_NODES[0] === document.querySelector('#chat .mes') && window.DR_CHAT_NODES[1] === document.querySelector('#chat .mes_text') && window.DR_CHAT_NODES[2] === document.querySelector('#send_textarea')), true, '搜索和切换控件保留原生消息/正文/输入');
            await page.evaluate(async () => {
                const {openSheet} = await import('/source/ui/sheet.js'); const body = document.createElement('input'); body.setAttribute('aria-label','合成父层输入');
                window.DR_QUICK_PARENT = openSheet({title:'合成父层',body}); body.focus();
            });
            await page.keyboard.press('Control+k'); await input.waitFor({timeout:2000});
            await page.waitForFunction(() => document.querySelector('.vc-quick-input') === document.activeElement);
            await page.evaluate(() => window.DR_QUICK_PARENT.dismiss());
            assert.equal(await page.locator('#vc-quick-switch,.vc-sheet,.vc-scrim').count(), 0, '快速切换作为临时子层随父层同步销毁');
            await open(1440, 'light', 'chat');
            await page.evaluate(() => window.VC_CHAT_PREVIEW.chatView.openMemoryInspector(document.querySelector('[data-memory]')));
            const inspector = page.locator('#vc-memory-inspector');
            await inspector.locator('[data-memory-id] button').first().click();
            const draft = inspector.locator('textarea'); await draft.waitFor({timeout:2000}); await draft.focus();
            await page.evaluate(() => { window.DR_INSPECTOR_FIELD = document.activeElement; });
            await draft.fill('合成连续纠正');
            assert.equal(await page.evaluate(() => window.DR_INSPECTOR_FIELD.isConnected && window.DR_INSPECTOR_FIELD === document.activeElement), true, '记忆检视输入不能重建字段或丢失焦点');
            await draft.fill(''); assert.equal(await draft.inputValue(), '', '空草稿不能被原摘要回填');
            await draft.fill('合成连续纠正');
            await page.evaluate(() => { window.VC_PREVIEW_DELAY = 200; });
            await inspector.getByRole('button', {name:'保存',exact:true}).click();
            assert.equal(await draft.isDisabled(), true, '保存等待锁定原草稿');
            await draft.waitFor({state:'detached',timeout:2000});
            await page.evaluate(() => { window.VC_PREVIEW_DELAY=0; });
            await page.evaluate(() => { const ctx=window.VC_CHAT_PREVIEW.context;ctx.chatMetadata.vc_binding.relationshipId='12';ctx.chatId='synthetic-other-chat';return ctx.eventSource.emit('CHAT_CHANGED'); });
            assert.equal(await inspector.count(), 0, '切聊天关闭旧作用域的临时检视');
            await open(1440, 'light', 'chat');
            await page.evaluate(() => window.VC_CHAT_PREVIEW.chatView.openMemoryInspector(document.querySelector('[data-memory]')));
            await page.evaluate(() => {
                const fetch=window.fetch;let held=false;
                window.fetch=(url,init={})=>{
                    if(!held&&(!init.method||init.method==='GET')&&/\/memories\/\d+$/.test(String(url))){held=true;return new Promise(resolve=>{window.DR_INSPECTOR_RESUME=async()=>resolve(await fetch(url,init));});}
                    return fetch(url,init);
                };
            });
            await inspector.locator('[data-memory-id] button').first().click();
            await page.waitForFunction(() => typeof window.DR_INSPECTOR_RESUME === 'function');
            await page.locator('#vc-memory-rail > header').getByRole('button',{name:'完成',exact:true}).click();
            await page.evaluate(() => window.DR_INSPECTOR_RESUME()); await settle(page);
            await page.evaluate(() => window.VC_CHAT_PREVIEW.chatView.openMemoryInspector(document.querySelector('[data-memory]')));
            await inspector.locator('[data-memory-id]').first().waitFor({timeout:2000});
            assert.equal(await inspector.locator('textarea').count(), 0, '关闭后的详情响应不能在重新打开时自动开始纠正');
            await open(1440, 'light', 'chat');
            await page.evaluate(async () => {
                const ctx=window.VC_CHAT_PREVIEW.context;
                const voice=await import('/source/voice-chat.js');
                window.DR_READ_SAVES=0;
                voice.installChatVoice({getContext:()=>ctx,saveChat:async()=>{window.DR_READ_SAVES++;},ready:Promise.resolve()});
                await voice.loadVoicePolicy(ctx);
                const fetch=window.fetch;
                window.fetch=(url,init={})=>String(url).endsWith('/voice/engines')?new Promise(resolve=>{window.DR_READ_RESUME=async()=>resolve(await fetch(url,init));}):fetch(url,init);
                voice.invalidateVoicePolicy();
                const {readMessageAloud}=await import('/source/chat-view.js'), mes=document.querySelector('#chat > .mes[mesid="1"]');
                window.DR_READ_RUNS=[readMessageAloud(mes),readMessageAloud(mes)];
            });
            await page.waitForFunction(()=>typeof window.DR_READ_RESUME==='function');
            await page.evaluate(() => window.VC_CHAT_PREVIEW.chatView.refresh());
            const read = page.locator('#chat > .mes[mesid="1"] [data-vc-act="read"]');
            assert.equal(await read.isDisabled(), true);
            await page.evaluate(async()=>{await window.DR_READ_RESUME();await Promise.all(window.DR_READ_RUNS);});
            assert.equal(await page.evaluate(()=>window.DR_READ_SAVES),1,'同一朗读动作等待时不可重入');
            assert.equal(await read.isDisabled(),false);
            assert.equal(await read.getAttribute('aria-label'),'朗读');
            await open(1440, 'light', 'chat'); await setupReadFixture();
            await page.evaluate(async()=>{
                const voice=await import('/source/voice-chat.js'),fetch=window.fetch;let held=false;
                window.fetch=(url,init={})=>{
                    if(!held&&String(url).endsWith('/voice/engines')){held=true;return new Promise(resolve=>{window.DR_READ_RESUME=async()=>resolve(await fetch(url,init));});}
                    return fetch(url,init);
                };
                voice.invalidateVoicePolicy();
                const {readMessageAloud}=await import('/source/chat-view.js');
                window.DR_READ_RUN=readMessageAloud(document.querySelector('#chat > .mes[mesid="6"]'));
            });
            await page.waitForFunction(()=>typeof window.DR_READ_RESUME==='function');
            await page.evaluate(async()=>{
                const {previewRelationships}=await import('/fixtures.js'), original=previewRelationships.find(row=>row.relationshipId==='11');
                previewRelationships.push({...structuredClone(original),relationshipId:'13',displayName:'合成另一实例'});
                const ctx=window.VC_CHAT_PREVIEW.context;ctx.chatMetadata.vc_binding.relationshipId='13';
                await ctx.eventSource.emit('CHAT_CHANGED');
                await window.DR_READ_RESUME();await window.DR_READ_RUN;
            });
            assert.equal(await page.evaluate(()=>window.DR_READ_POSTS),0,'同一聊天重绑角色后，旧朗读不得继续排队');
            await page.waitForFunction(()=>{const el=document.querySelector('#chat > .mes[mesid="6"] [data-vc-act="read"]');return el&&!el.disabled;});




        }
        if (!captureReference && chatOnly) {
            await open(1440, 'light', 'chat');
            await page.evaluate(() => { window.DR_NATIVE_MESSAGE = document.querySelector('#chat .mes'); window.DR_NATIVE_TEXT = document.querySelector('#chat .mes_text'); window.DR_SEARCH_TOGGLE = document.querySelector('.vc-desk-search-toggle'); });
            for (const width of [1280, 1024, 864, 1440]) {
                await page.setViewportSize({ width, height: 900 }); await settle(page);
                assert.equal(await page.evaluate(() => window.DR_NATIVE_MESSAGE === document.querySelector('#chat .mes') && window.DR_NATIVE_TEXT === document.querySelector('#chat .mes_text') && window.DR_SEARCH_TOGGLE === document.querySelector('.vc-desk-search-toggle') && window.DR_SEARCH_TOGGLE.isConnected), true, '重绘壳层保留ST消息/原文/扩展按钮节点');
            }
            await page.locator('.vc-desk-search-toggle').click(); await page.locator('.vc-chat-search input').fill('围巾');
            await page.waitForFunction(() => document.querySelector('.vc-chat-search-count')?.textContent === '1 / 1');
            assert.equal(await page.locator('.vc-chat-search').isVisible(), true);
            await page.keyboard.press('Escape'); await page.locator('.vc-chat-search').waitFor({ state: 'hidden' });
            assert.equal(await page.locator('.vc-desk-search-toggle').evaluate(el => el === document.activeElement), true);
        }
        if (modelOnly) {
            await open(1440, 'light', 'model', 'home'); await page.keyboard.press('Escape'); await page.locator('.vcms-overlay').waitFor({ state: 'hidden', timeout: 1500 });
            await open(1440, 'light', 'settings', 'model'); await page.locator('[data-action="select-provider"]').first().click(); await page.locator('#vcms-f-display').fill('待销毁的草稿');
            await page.evaluate(() => { window.DR_RETIRED_MODEL_SAVE = document.querySelector('#vcms-save'); window.VC_SETTINGS_PREVIEW.destroy(); });
            assert.equal(await page.evaluate(() => window.VC_SETTINGS_PREVIEW.model.isOpen()), false, '销毁设置壳同步卸载模型视图，不能另开脏草稿确认');
            assert.equal(await page.locator('.vc-alert').count(), 0);
            await page.evaluate(() => window.DR_RETIRED_MODEL_SAVE.click());
            assert.equal(await page.evaluate(() => window.__previewRequests.filter(row => row.method === 'PUT' && row.path.includes('/admin/providers/')).length), 0, `旧模型保存动作已解绑：${JSON.stringify(await page.evaluate(() => window.__previewRequests.filter(row => row.method === 'PUT' && row.path.includes('/admin/providers/'))))}`);
            await open(864, 'light', 'voice', 'global'); await page.setViewportSize({ width: 864, height: 390 });
            await page.locator('[data-voice-field="dailyChatLimit"]').fill('61');
            await page.locator('.vc-sheet summary').filter({ hasText: '心情语速' }).click();
            const last = page.locator('.vc-sheet input[type="number"]').last(); await last.scrollIntoViewIfNeeded();
            const fieldBox = await last.boundingBox(), saveBox = await page.locator('.vc-sheet-done').boundingBox();
            assert.ok(fieldBox && fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= 390, '短窗口长表单底部字段可达');
            assert.ok(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 390, '滚动长表单后保存仍在窗口内');
            await page.locator('.vc-sheet-done').click({ trial: true });
            await page.keyboard.press('Escape'); await page.locator('[data-vc-ok]').click(); await page.locator('.vc-sheet').waitFor({ state: 'detached' });
        }
        if (!captureReference) assert.deepEqual(errors, [], '公共壳层/弹层无脚本错误');
        const scope = captureReference ? '冻结旧视觉' : modelOnly ? '模型Esc/销毁/短窗长表单' : consentOnly ? '首次同意视觉' : alertOnly ? '账户确认/嵌套/共享ST返回与缩窗' : chatOnly ? '聊天壳视觉/宿主节点/搜索/缩窗' : '连续锚定/键盘/嵌套/卸载';
        console.log(`[dr-overlays] ${captureReference ? 'REFERENCE' : 'PASS'}：${shots} 张；${scope}`);
    } finally { await browser?.close(); await preview.close(); }
}
export const desktopOverlaysScene = { id: 'dr-overlays', title: 'DR-4 公共外壳与弹层', needs: ['browser'], default: false, run: () => runDesktopOverlays() };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopOverlays({ captureReference: process.argv.includes('--capture-reference'), compareReference: process.argv.includes('--compare-reference'), checkOnly: process.argv.includes('--check-only'), alertOnly: process.argv.includes('--check-alert'), consentOnly: process.argv.includes('--consent-only'), modelOnly: process.argv.includes('--check-model'), chatOnly: process.argv.includes('--chat-only'), chatWidgets: process.argv.includes('--chat-widgets') });
