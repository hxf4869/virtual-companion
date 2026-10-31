// W06 uses the existing managed harness: synthetic accounts, ST/Go/PG only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createStClient } from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
const expect = (r,status,label) => { assert.equal(r.status,status,`${label}: HTTP ${r.status} (${r.json?.code||'native'})`); return r.json; };
export async function sceneSourceNative(ctx) {
    const st = createStClient({ baseUrl:ctx.w05.stBase, expectedIdentity:ctx.secrets.session,
        extraCookies:`vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const card = await importSyntheticCard(st,'W06 合成来源');
    let file=`W06-${crypto.randomUUID()}`;
    const token={id:crypto.randomUUID(),revision:0};
    const chat=[{chat_metadata:{vc_f2:token}},{name:'合成用户',is_user:true,mes:'我喜欢乌龙茶',extra:{vc_source:{settled:true}}}];
    prepareSourceIdentities(chat,{settled:true});
    const save=(rows)=>st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:file,chat:rows});
    const read=async()=>expect(await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:file}),200,'读回 JSONL');
    expect(await save(chat),200,'初始保存');
    const binding=expect(await ctx.admin.call('POST','/api/v1/st/bindings',{chatIdentity:token.id,characterRef:crypto.randomUUID(),mode:'COMPANION',displayName:'来源合成验证'}),200,'绑定');
    const reconcile=async()=>expect(await ctx.admin.call('POST','/api/v1/st/sources/reconcile',{chatIdentities:[token.id]}),200,'服务端持久来源对账')[0];
    assert.equal((await reconcile()).state,'PRESENT');
    const initial=await read();
    assert.match(initial[1].vc_message_id,/^[0-9a-f-]{36}$/);
    const candidate=initial[1].extra.vc_source;
    const ref=`st:${token.id}:${initial[1].vc_message_id}:${candidate.id}:${candidate.revision}:1`;
    const memoryPath=`/api/v1/relationships/${binding.relationshipId}/memories/candidates`;
    const body={scope:'RELATIONSHIP',conversationId:binding.conversationId,summary:'喜欢乌龙茶',evidence:[ref]};
    expect(await ctx.admin.call('POST',memoryPath,body),200,'已保存且已结算来源可提炼');
    initial[1].mes='我现在喜欢红茶';
    expect(await save(initial),200,'保存编辑且故意不发浏览器通知');
    // The write path itself reconciles; the old captured extraction must fail.
    expect(await ctx.admin.call('POST',memoryPath,{...body,summary:'迟到的旧提取'}),400,'旧提取提交不能复活');
    const edited=await read();
    assert.equal(edited[1].vc_message_id,initial[1].vc_message_id);
    assert.equal(edited[1].extra.vc_source.id,candidate.id);
    assert.equal(edited[1].extra.vc_source.revision,candidate.revision+1);
    const next=`${file}-renamed`;
    const renamed=expect(await st.call('POST','/api/chats/rename',{avatar_url:card.avatar,original_file:`${file}.jsonl`,renamed_file:`${next}.jsonl`,vc_f2:edited[0].chat_metadata.vc_f2}),200,'改名');
    file=next;
    assert.equal(renamed.vc_f2.id,token.id);
    assert.equal((await reconcile()).state,'PRESENT');
    // Simulate an unavailable on-disk source inside the disposable harness only.
    const sourcePath=path.join(ctx.w05.dataRoot,'default-user','chats',card.avatar.replace(/\.png$/,''),`${file}.jsonl`);
    const pausedPath=`${sourcePath}.w06-unavailable`;
    await fs.rename(sourcePath,pausedPath);
    try { assert.equal((await reconcile()).state,'UNAVAILABLE'); }
    finally { await fs.rename(pausedPath,sourcePath); }
    assert.equal((await reconcile()).state,'PRESENT','read recovery must not permanently delete sources');
    const current=await read();
    expect(await st.call('POST','/api/chats/delete',{avatar_url:card.avatar,chatfile:`${file}.jsonl`,vc_f2:current[0].chat_metadata.vc_f2}),200,'删除原文');
    assert.equal((await reconcile()).state,'DELETED');
    expect(await ctx.admin.call('POST',memoryPath,body),400,'删除后旧结果拒绝');
    return { cases:['B02','R01','R03','R04','R05'], lateWritesRejected:true, unavailableRecovered:true, renameIdentityPreserved:true };
}

async function poll(test, label, timeout = 30000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline) { if(await test())return; await new Promise((resolve)=>setTimeout(resolve,150)); }
    throw new Error(`等待超时：${label}`);
}
function assertNoCredential(text,ctx){
    for(const key of [ctx.secrets.serviceToken,ctx.secrets.restKey,ctx.secrets.password,ctx.secrets.session.vcSession,ctx.secrets.session.vcCsrf]) assert.equal(text.includes(key),false,'普通副本不得包含凭据值');
}
export async function sceneRightsBrowser(ctx){
    expect(await ctx.admin.call('POST','/api/v1/st/bindings',{
        chatIdentity:crypto.randomUUID(),characterRef:crypto.randomUUID(),mode:'COMPANION',displayName:'数据权利合成前置',
    }),200,'数据权利场景的已初始化陪伴前置');
    const {chromium}=await import('playwright-core');
    const browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
    try{
        const bc=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
        await pinVcUi(bc, 'on');
        await bc.addCookies([{name:'vc_session',value:ctx.secrets.session.vcSession,url:ctx.w05.stBase},{name:'vc_csrf',value:ctx.secrets.session.vcCsrf,url:ctx.w05.stBase}]);
        const page=await bc.newPage();const errors=[];page.on('pageerror',()=>errors.push('pageerror'));
        await page.goto(ctx.w05.stBase,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.SillyTavern?.getContext?.()?.eventSource);
        await page.waitForSelector('#vc_data_menu_button',{state:'attached'});
        const onboarding=page.locator('dialog[open].popup').filter({has:page.locator('.onboarding')});
        if(await onboarding.count()){await onboarding.locator('textarea').fill('合成验收用户');await onboarding.locator('.popup-button-ok').click();await onboarding.waitFor({state:'hidden'});}
        await page.waitForSelector('#preloader',{state:'hidden'});
        // Use the current settings flow, including its sensitive-action reauthentication.
        await page.getByRole('button',{name:'设置',exact:true}).click();
        await page.locator('.vc-settings-form [data-action="data"]').click();
        await page.locator('.vc-data-dialog[open]').waitFor();
        await page.screenshot({path:path.join(ctx.artifactsDir,'D05-data-desktop.png')});
        await page.setViewportSize({width:390,height:844});
        await page.locator('[data-vc-account-go="delete"]').click();
        assert.equal(await page.evaluate(()=>document.querySelector('.vc-data-dialog').scrollWidth<=innerWidth),true,'手机不能横向溢出');
        await page.screenshot({path:path.join(ctx.artifactsDir,'D05-data-mobile.png')});
        await page.locator('[data-vc-account-back]').click();
        await page.locator('[data-vc-account-go="export"]').click();
        await page.locator('[data-export]').click();
        await page.locator('[data-reauth-password]').fill(ctx.secrets.password);
        await page.locator('[data-reauth] button[type=submit]').click();
        await page.waitForFunction(() => !document.querySelector('[data-download]').hidden || /未生成|未完成|暂不可用/.test(document.querySelector('[data-export-status]').textContent), null, {timeout:60000});
        assert.equal(await page.locator('[data-download]').isVisible(),true,`导出未完成：${await page.locator('[data-export-status]').textContent()}`);
        const downloading=page.waitForEvent('download');await page.locator('[data-download]').click();
        const saved=await downloading;const file=await saved.path();assert.ok(file,'真实下载应产生文件');
        const text=await fs.readFile(file,'utf8');assertNoCredential(text,ctx);
        const copy=JSON.parse(text);assert.equal(typeof copy.exportId,'string');assert.ok(copy.generatedAt&&copy.expiresAt&&copy.aiContentNotice);assert.ok(Array.isArray(copy.reminders)&&Array.isArray(copy.consents));assert.equal(copy.snapshotMode,'PER_FILE_AND_QUERY');assert.equal(copy.v2.st.state,'COMPLETE');
        assert.ok(copy.v2.domains.some((d)=>d.system==='ST_PRIVATE_CONTENT'&&d.state==='COMPLETE'));
        assert.equal(errors.length,0,'数据页面不得出现未捕获错误');
        return {cases:['D02','D05'],desktop:true,mobile:true,oneTimeDownload:true,privateFiles:copy.v2.st.fileCount};
    }finally{await browser.close();}
}
export async function sceneRightsNative(ctx){
    const {createGoAdminClient}=await import('./managed-lib.mjs');
    const session=ctx.secrets.rightsSession;
    const admin=createGoAdminClient({baseUrl:ctx.w05.goBase,origin:ctx.w05.stBase,session});
    const st=createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:session,extraCookies:`vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}`});
    const card=await importSyntheticCard(st,'W06 删除范围');const root=path.join(ctx.w05.dataRoot,ctx.w06.handle);
    const token={id:crypto.randomUUID(),revision:0};const rows=[{chat_metadata:{vc_f2:token}},{mes:'仅属于合成数据权利账号',is_user:true,extra:{}}];prepareSourceIdentities(rows,{settled:true});
    expect(await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:'rights',chat:rows}),200,'待删除原文');
    // An unreadable private symlink prevents a complete export. The existing
    // persistent task must resume after the source becomes readable.
    const badFile=path.join(root,'w06-unreadable-link');await fs.symlink(path.dirname(root),badFile);
    let issued;
    try{
        issued=expect(await admin.call('POST','/api/v1/exports',{currentPassword:ctx.secrets.password}),200,'提交导出');
        await poll(async()=>{const status=expect(await admin.call('GET',`/api/v1/exports/${issued.exportId}`),200,'导出状态');return status.status==='PENDING'&&status.errorMessage==='ST_UNAVAILABLE';},'导出保留原任务等待ST');
    }finally{await fs.rm(badFile,{force:true});}
    ctx.w06.wakeExport(issued.exportId);
    await poll(async()=>expect(await admin.call('GET',`/api/v1/exports/${issued.exportId}`),200,'重试导出状态').status==='READY','同一导出恢复完成');
    const copied=expect(await admin.call('GET',issued.downloadUrl),200,'一次性私有副本');
    assert.equal(copied.exportId,issued.exportId);assert.ok(copied.generatedAt&&copied.expiresAt&&copied.aiContentNotice);assert.ok(Array.isArray(copied.reminders)&&Array.isArray(copied.consents));
    assert.equal(copied.v2.st.handle,ctx.w06.handle);assertNoCredential(JSON.stringify(copied),ctx);
    assert.notEqual((await admin.call('GET',issued.downloadUrl)).status,200,'同一下载链接不可重复使用');
    // Freeze/delete cannot follow a substituted user-root link. The durable
    // intent stays pending, blocks new writes, and resumes without a new request.
    const held=`${root}.w06-held`;await fs.rename(root,held);await fs.symlink(held,root);
    try{
        const pending=expect(await admin.call('DELETE','/api/v1/auth/account',{currentPassword:ctx.secrets.password}),202,'ST清理未确认');
        assert.deepEqual(pending.pendingDomains,['ST']);
        expect(await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:'rights',chat:rows}),409,'删除期间拒绝新保存');
        expect(await ctx.admin.call('GET','/api/v1/auth/session'),200,'其他账号仍可用');
    }finally{await fs.rm(root,{force:true});await fs.rename(held,root);}
    await poll(async()=>{try{return JSON.parse(await fs.readFile(path.join(ctx.w05.dataRoot,'_vc_accounts',`${ctx.w06.accountId}.json`),'utf8')).state==='DELETED';}catch{return false;}},'后台恢复ST清理',60000);
    await poll(async()=>(await admin.call('GET','/api/v1/auth/session')).status===401,'后台完成Go账号清理',60000);
    await assert.rejects(fs.access(root),'私有原文和备份应已清除');
    expect(await ctx.admin.call('GET','/api/v1/auth/session'),200,'删除不可影响另一账号');
    return {cases:['D03','D04'],sameExportResumed:true,deletionResumed:true,otherOwnerPreserved:true};
}

export const sourceNativeScene = {
    id: 'source-native',
    title: 'W06 ST→Go持久来源、漏报、迟到结果、读取故障和删除',
    needs: ['go', 'stack'],
    default: false,
    run: sceneSourceNative,
};

export const rightsBrowserScene = {
    id: 'rights-browser',
    title: 'W06 D02/D05 原生数据权利页面、一次性下载与手机布局',
    needs: ['go', 'stack'],
    default: false,
    run: sceneRightsBrowser,
};

export const rightsNativeScene = {
    id: 'rights-native',
    title: 'W06 D03/D04 离线重试与独立合成账号删号',
    needs: ['go', 'stack'],
    default: false,
    run: sceneRightsNative,
};
export const scenes = [sourceNativeScene, rightsBrowserScene, rightsNativeScene];
