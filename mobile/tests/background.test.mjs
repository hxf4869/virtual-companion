import test from 'node:test';import assert from 'node:assert/strict';
import {backgroundFile,backgroundUrl,backgroundThumbnail,prepareBackgroundUpload,BACKGROUND_FIELD} from '../src/theme/background.mjs';
import {createServer,ServerError} from '../src/engine/server.mjs';

test('手机背景只读取同源库文件；导入卡中的路径与外部 URL 不作为背景',()=>{
 assert.equal(BACKGROUND_FIELD,'vc_mobile_background');assert.equal(backgroundFile('风景 01.jpg'),'风景 01.jpg');assert.equal(backgroundUrl('风景 01.jpg'),'/backgrounds/%E9%A3%8E%E6%99%AF%2001.jpg');
 assert.equal(backgroundThumbnail('风景 01.jpg'),'/thumbnail?type=bg&file=%E9%A3%8E%E6%99%AF%2001.jpg');
 assert.equal(backgroundUrl('forest.jpg','https://vc.example.test'),'https://vc.example.test/backgrounds/forest.jpg');
 assert.equal(backgroundThumbnail('forest.jpg','https://vc.example.test'),'https://vc.example.test/thumbnail?type=bg&file=forest.jpg');
 for(const invalid of [null,{},'../x.jpg','x/y.jpg','x\\y.jpg','https://example.test/x.jpg','\u0000.png'])assert.equal(backgroundUrl(invalid),'');
});
test('上传先验证图片，再赋独立文件名；失败不写入库，解码资源释放',async()=>{
 let closed=0;const source=new File(['image'],'existing.png',{type:'image/png'});
 const prepared=await prepareBackgroundUpload(source,{id:()=> 'unique',decode:async()=>({close(){closed++;}})});assert.equal(prepared.name,'mobile-unique.png');assert.equal(prepared.type,source.type);assert.equal(prepared.size,source.size);assert.equal(closed,1);
 await assert.rejects(prepareBackgroundUpload(new File(['text'],'a.txt',{type:'text/plain'})));
 await assert.rejects(prepareBackgroundUpload({size:33*1024*1024,type:'image/png'}));
 await assert.rejects(prepareBackgroundUpload(source,{decode:async()=>{throw Error('broken');}}));
});
test('背景读取、上传与角色偏好经现有 ST 身份边界，失败不会当作已保存',async()=>{
 const calls=[];let fail=false;
 const server=createServer({fetchImpl:async(path,init={})=>{
  calls.push({path,init});if(path==='/auth/api/session')return Response.json({accountId:'42',sessionId:'7'});if(path==='/csrf-token')return Response.json({token:'csrf'});
  if(path==='/api/backgrounds/all')return Response.json({images:[{filename:'forest.jpg'}],config:{width:160,height:90}});
  if(path==='/api/backgrounds/upload')return new Response('mobile-upload.png');
  if(path==='/api/characters/merge-attributes')return new Response(fail?'failed':'OK',{status:fail?500:200});throw Error('unexpected route');
 }});
 assert.deepEqual(await server.backgrounds(),['forest.jpg']);assert.equal(await server.uploadBackground(new File(['image'],'mobile-upload.png',{type:'image/png'})),'mobile-upload.png');
 await server.saveCharacterBackground('role.png','forest.jpg');const write=calls.find(c=>c.path==='/api/characters/merge-attributes');assert.deepEqual(JSON.parse(write.init.body),{avatar:'role.png',data:{extensions:{vc_mobile_background:'forest.jpg'}}});assert.equal(write.init.headers['x-vc-expected-account-id'],'42');
 const upload=calls.find(c=>c.path==='/api/backgrounds/upload');assert.equal(upload.init.headers['Content-Type'],undefined);assert.equal(upload.init.body.get('avatar').name,'mobile-upload.png');assert.equal(upload.init.headers['X-CSRF-Token'],'csrf');
 fail=true;await assert.rejects(server.saveCharacterBackground('role.png',''),e=>e instanceof ServerError&&e.status===500);
});
test('401/409 后旧角色页重试背景写入仍固定原身份，不采用另一账号',async()=>{
 for(const status of [401,409]){
  let account='A',first=true;const writes=[],identities=[];
  const server=createServer({fetchImpl:async(path,init={})=>{
   if(path==='/auth/api/session'){identities.push(account);return Response.json({accountId:account,sessionId:`session-${account}`});}
   if(path==='/csrf-token')return Response.json({token:'csrf'});
   if(path==='/api/characters/all')return Response.json([{avatar:'same.png'}]);
   if(path==='/api/characters/merge-attributes'){
    if(first){first=false;return new Response('',{status});}
    if(init.headers['x-vc-expected-account-id']!==account)return new Response('',{status:409});
    writes.push(account);return new Response('OK');
   }
   throw Error('unexpected route');
  }});
  await server.characters();await assert.rejects(server.saveCharacterBackground('same.png','forest.jpg'));
  account='B';await assert.rejects(server.saveCharacterBackground('same.png','forest.jpg'),error=>error.status===409&&error.kind==='context-changed');
  assert.deepEqual(writes,[]);assert.deepEqual(identities,['A']);
 }
});
