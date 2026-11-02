import assert from 'node:assert/strict';

// 真实浏览器加载器回归：第二主题仅存在于合成路由，不登记到产品，不写用户偏好。
export async function checkDesktopThemes(page, sourceBase = '/scripts/extensions/third-party/vc-model-settings') {
    const routePattern = '**/__ux35-theme-test/*.css';
    const css = name => `
html[data-vc-layout="desktop"][data-vc-theme-id="${name}"] body.vc-ui { --vc-raised: rgb(240, 230, 200); --vc-bub-r: 22px; }
html[data-vc-layout="desktop"][data-vc-theme-id="${name}"][data-vc-theme="dark"] body.vc-ui { --vc-raised: rgb(30, 20, 10); }
@media(prefers-color-scheme:dark) { html[data-vc-layout="desktop"][data-vc-theme-id="${name}"]:not([data-vc-theme]) body.vc-ui { --vc-raised: rgb(30, 20, 10); } }
`;
    await page.route(routePattern, async route => {
        const name = new URL(route.request().url()).pathname.split('/').pop().replace('.css', '');
        if (name === 'slow') await new Promise(resolve => setTimeout(resolve, 100));
        await route.fulfill({ status: name === 'missing' ? 404 : 200, contentType: 'text/css', body: name === 'missing' ? '' : css(name) });
    });
    try {
        await page.evaluate(async base => {
            const { mountDesktopTheme } = await import(`${base}/desktop/theme.js`);
            const frame = document.createElement('iframe');
            frame.style.cssText = 'position:absolute;left:-10000px;width:1024px;height:768px';
            document.body.append(frame);
            const doc = frame.contentDocument;
            doc.open(); doc.write('<html data-vc-layout="desktop" data-vc-theme="light"><head></head><body class="vc-ui"><section id="theme-test-shell" data-destination="memory" data-chat="closed"></section></body></html>'); doc.close();
            const link = doc.createElement('link');link.rel='stylesheet';link.href=`${base}/desktop/base.css`;
            await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;doc.head.append(link);});
            const chatStyle = doc.createElement('link');chatStyle.rel='stylesheet';chatStyle.href=`${base}/desktop/chat.css`;
            await new Promise((resolve,reject)=>{chatStyle.onload=resolve;chatStyle.onerror=reject;doc.head.append(chatStyle);});
            const shell = doc.querySelector('#theme-test-shell');
            const prefs = { global: 'aurora', characters: {} };
            const storage = { getItem: () => JSON.stringify(prefs) };
            const registry = [{id:'aurora', variants:{bubble:'grouped'}}, ...['paper','ink','missing','slow'].map(id=>({id,css:new URL(`/__ux35-theme-test/${id}.css`,location.href).href,variants:{bubble:id==='ink'?'rounded':'grouped'}}))];
            const controller = mountDesktopTheme({shell,document:doc,storage,registry,getContext:()=>({chatMetadata:{vc_binding:{characterRef:'synthetic-character'}}})});
            await controller.ready;
            window.__ux35 = {frame,doc,shell,prefs,controller};
        }, sourceBase);
        const state = () => page.evaluate(() => {
            const {doc} = window.__ux35;
            return { id:doc.documentElement.dataset.vcThemeId, variant:doc.documentElement.dataset.vcVariantBubble,
                raised:doc.defaultView.getComputedStyle(doc.body).getPropertyValue('--vc-raised').trim(),
                sheets:doc.querySelectorAll('[data-vc-theme-sheet]').length };
        });
        assert.equal((await state()).id,'aurora');
        await page.evaluate(async()=>{const t=window.__ux35;t.prefs.global='paper';await t.controller.refresh();});
        assert.deepEqual(await state(),{id:'paper',variant:'grouped',raised:'rgb(240, 230, 200)',sheets:1});
        await page.evaluate(()=>window.__ux35.doc.documentElement.dataset.vcTheme='dark');
        assert.equal((await state()).raised,'rgb(30, 20, 10)');
        await page.emulateMedia({colorScheme:'dark'});
        await page.evaluate(()=>window.__ux35.doc.documentElement.removeAttribute('data-vc-theme'));
        assert.equal((await state()).raised,'rgb(30, 20, 10)','自动深色与显式深色一致');
        await page.emulateMedia({colorScheme:'light'});
        assert.equal((await state()).raised,'rgb(240, 230, 200)');
        await page.evaluate(async()=>{const t=window.__ux35;t.prefs.characters['synthetic-character']='ink';t.shell.dataset.destination='chat';t.shell.dataset.chat='open';await new Promise(requestAnimationFrame);await t.controller.refresh();});
        assert.equal((await state()).id,'ink');assert.equal((await state()).variant,'rounded');
        assert.equal(await page.evaluate(()=>{const d=window.__ux35.doc;return d.defaultView.getComputedStyle(d.body).getPropertyValue('--vc-bub-join').trim();}),'22px','圆角变体实际应用到气泡连接角');
        await page.evaluate(async()=>{const t=window.__ux35;t.shell.dataset.destination='memory';await new Promise(requestAnimationFrame);await t.controller.refresh();});
        assert.equal((await state()).id,'paper','离开角色对话恢复全局主题');
        const failed=await page.evaluate(async()=>{const t=window.__ux35;t.prefs.global='missing';return t.controller.refresh();});
        assert.equal(failed,false);assert.equal((await state()).id,'paper','CSS 加载失败保留当前主题');
        await page.evaluate(async()=>{const t=window.__ux35;t.prefs.global='slow';const first=t.controller.refresh();t.prefs.global='ink';await t.controller.refresh();await first;});
        assert.equal((await state()).id,'ink');assert.equal((await state()).sheets,1,'快速切换只保留最后选定主题');
        await page.evaluate(async()=>{const t=window.__ux35;t.frame.style.width='390px';t.doc.documentElement.dataset.vcLayout='mobile';await new Promise(requestAnimationFrame);await t.controller.refresh();});
        assert.equal((await state()).id,undefined,'手机不带桌面主题属性');
    } finally {
        await page.evaluate(()=>{window.__ux35?.controller.destroy();window.__ux35?.frame.remove();delete window.__ux35;});
        await page.emulateMedia({colorScheme:null});
        await page.unroute(routePattern);
    }
}
