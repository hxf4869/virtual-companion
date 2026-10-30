// VO-12: real encrypted archive + isolated PostgreSQL and ciphertext object restore.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { voiceCall, voiceControl } from './voice-accept-lib.mjs';

const SCRIPTS=path.dirname(fileURLToPath(import.meta.url));
const VOICE=path.join(SCRIPTS,'lib/voice-backup.py');

export async function sceneVoiceBackup(ctx) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'vc-voice-backup-'));
    fs.chmodSync(root,0o700);
    const pg=process.env.VC_W03_PG_CONTAINER||'vc-w03-managed-pg';
    const minio=process.env.VC_W03_MINIO_CONTAINER||'vc-w03-managed-minio';
    const data=path.join(root,'data');
    const archive=path.join(root,'backup','voice.vcbae1');
    const manifest=path.join(root,'current','deletion-manifest.json');
    const restored=path.join(root,'restored');
    const pass=crypto.randomBytes(24).toString('hex');
    const env={...process.env,VC_ST_BACKUP_PASSPHRASE:pass,VC_MEMORYCORE_DATA_ROOT:path.join(root,'no-engine'),
        VC_BACKUP_PG_CONTAINER:pg,VC_BACKUP_PG_USER:'postgres',VC_BACKUP_PG_DATABASE:'vc',
        VC_ST_PG_CONTAINER:pg,VC_ST_PG_USER:'postgres',VC_ST_PG_DATABASE:'vc',VC_ST_CURRENT_DATA_ROOT:data,VC_ST_DELETION_MANIFEST:manifest,
        VC_VOICE_MINIO_CONTAINER:minio,VC_EXPORT_S3_ENDPOINT:ctx.secrets.s3.endpoint,VC_EXPORT_S3_ACCESS_KEY:ctx.secrets.s3.accessKey,
        VC_EXPORT_S3_SECRET_KEY:ctx.secrets.s3.secretKey,VC_EXPORT_S3_BUCKET:ctx.secrets.s3.bucket};
    for(const key of ['VC_BACKUP_PG_DSN','VC_ST_DATABASE_URL','VC_ST_BACKUP_PASSPHRASE_FILE','VC_VOICE_S3_ENV_FILE','VC_VOICE_BACKUP_INDEX'])delete env[key];
    const run=(bin,args,extra={})=>{
        const result=spawnSync(bin,args,{encoding:'utf8',env:{...env,...extra},timeout:90000,maxBuffer:4<<20});
        // Fixed diagnostic only: SQL, source paths and secret-bearing child output stay private.
        if(result.status!==0)throw new Error(`voice backup ${path.basename(bin)} failed (${result.status}; ${result.stderr?.match(/^VOICE_[A-Z_]+$/m)?.[0]||'BACKUP_STEP_FAILED'})`);
        for(const secret of [pass,ctx.secrets.s3.accessKey,ctx.secrets.s3.secretKey])assert.ok(!`${result.stdout}${result.stderr}`.includes(secret),'backup output excludes credentials');
        return result.stdout;
    };
    const python=(body,extra={})=>run('python3',['-c',`import importlib.util,sys\ns=importlib.util.spec_from_file_location('voice',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${body}`,VOICE],extra);
    let database='';
    try {
        fs.mkdirSync(path.join(data,'default-user/chats'),{recursive:true});
        fs.writeFileSync(path.join(data,'cookie-secret.txt'),'SYNTHETIC_COOKIE\n',{mode:0o600});
        const st=createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:ctx.secrets.session,
            extraCookies:`vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`});
        const card=await importSyntheticCard(st,'VO-12 fixture');
        let settings=await voiceCall(ctx,'GET','/api/v1/voice/settings');
        const {revision,updatedAt,...values}=settings;
        await voiceCall(ctx,'PUT','/api/v1/voice/settings',{...values,kokoroEnabled:true,dailyChatLimit:60,expectedRevision:revision});
        await voiceControl('kokoro');
        const sources=[];
        for(const kind of ['kept','edited','tombstoned']) {
            const identity=crypto.randomUUID(),file=`VO12-${crypto.randomUUID()}`;
            const rows=[{chat_metadata:{vc_f2:{id:identity,revision:0}}},
                {name:card.name,is_user:false,mes:'合成语音备份验收。',extra:{},send_date:new Date().toISOString()}];
            prepareSourceIdentities(rows,{settled:true,sourceTimezone:'Asia/Shanghai'});
            assert.equal((await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:file,chat:rows,force:false})).status,200);
            const binding=await voiceCall(ctx,'POST','/api/v1/st/bindings',{chatIdentity:identity,characterRef:crypto.randomUUID(),mode:'COMPANION',displayName:'VO-12 fixture'});
            const relationshipId=String(binding.relationshipId);
            await voiceCall(ctx,'POST','/api/v1/st/sources/reconcile',{chatIdentities:[identity]});
            const ref=`stmsg:${identity}:${rows[1].vc_message_id}:${rows[1].extra.vc_source.id}`;
            const clip=await voiceCall(ctx,'POST',`/api/v1/relationships/${relationshipId}/voice-clips`,{messageRef:ref,text:rows[1].mes,purpose:'chat'},202);
            await waitFor(async()=> (await voiceCall(ctx,'GET',`/api/v1/voice-clips/${clip.clipId}`)).status==='ready',{label:'backup source voice ready',timeoutMs:15000});
            const relative=`chats/${card.name}/${file}.jsonl`;
            fs.mkdirSync(path.dirname(path.join(data,'default-user',relative)),{recursive:true});
            fs.writeFileSync(path.join(data,'default-user',relative),rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
            sources.push({kind,identity,file,rows,relationshipId,relative,key:`${ctx.w05.ownerId}/${relationshipId}/${clip.clipId}.wav`});
        }
        const preview=await voiceCall(ctx,'POST','/api/v1/voice/preview',{relationshipId:sources[0].relationshipId,engine:'kokoro',voice:'zf_001',speed:1.23},202);
        await waitFor(async()=> (await voiceCall(ctx,'GET',`/api/v1/voice-clips/${preview.clipId}`)).status==='ready',{label:'backup excluded preview ready',timeoutMs:15000});
        run('bash',[path.join(SCRIPTS,'backup.sh'),data,'-',archive]);
        assert.equal(fs.statSync(archive).mode&0o777,0o600);
        assert.equal(fs.readFileSync(archive).subarray(0,7).toString(),'VCBAE1\n');
        const rights=JSON.parse(fs.readFileSync(manifest)).voiceRights.keys;
        assert.ok(sources.every(source=>rights.includes(source.key)),'backup retains current chat voices');
        assert.ok(!rights.some(key=>key.endsWith(`/${preview.clipId}.wav`)),'preview excluded');
        assert.ok(rights.every(key=>/^[1-9]\d*\/[1-9]\d*\/[1-9]\d*\.wav$/.test(key)),'transient exports excluded');

        const edited=sources[1];
        const current=await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:edited.file});
        current.json[1].mes='合成修改后的文字。';
        assert.equal((await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:edited.file,chat:current.json,force:false})).status,200);
        await voiceCall(ctx,'POST','/api/v1/st/sources/reconcile',{chatIdentities:[edited.identity]});
        const tomb=sources[2];
        fs.mkdirSync(path.join(data,'default-user/.vc-f2'),{recursive:true});
        fs.writeFileSync(path.join(data,'default-user/.vc-f2',`${tomb.identity}.json`),JSON.stringify({state:'deleted',id:tomb.identity,path:tomb.relative,revision:1}),{mode:0o600});
        const blocked=path.join(root,'blocked');
        const denied=spawnSync('bash',[path.join(SCRIPTS,'restore.sh'),archive,blocked],{env:{...env,VC_ST_PG_CONTAINER:'vc-voice-unreachable'},encoding:'utf8',timeout:90000});
        assert.equal(denied.status,5,'unavailable current rights reject restore');
        assert.equal(JSON.parse(fs.readFileSync(path.join(blocked,'restore-gate.json'))).blocked,true);
        const start=Date.now();
        const output=run('bash',[path.join(SCRIPTS,'restore.sh'),archive,restored]);
        database=/RESTORED_DATABASE name=(vc_restore_[a-zA-Z0-9_]+)/.exec(output)?.[1]||'';
        assert.ok(database,'restore creates isolated database');
        assert.equal(fs.existsSync(path.join(restored,'restore-gate.json')),false);
        const index=JSON.parse(fs.readFileSync(path.join(restored,'_voice/index.json'))).keys;
        assert.ok(index.includes(sources[0].key),'valid voice retained');
        assert.ok(!index.includes(edited.key)&&!index.includes(tomb.key),'latest source edit and ST tomb deny old objects');
        for(const source of sources.slice(1))assert.equal(fs.existsSync(path.join(restored,'_voice/objects',source.key)),false);
        const bucket=`voice-restore-${crypto.randomBytes(6).toString('hex')}`;
        const target={VC_EXPORT_S3_BUCKET:bucket};
        python(`with m.Objects() as objects:\n r=m.subprocess.run(objects.prefix+['mb','voice/'+objects.values['VC_EXPORT_S3_BUCKET']],capture_output=True,env=objects.env)\n assert r.returncode==0`,target);
        run('python3',[VOICE,'import',path.join(restored,'_voice'),database],target);
        assert.equal(fs.existsSync(path.join(restored,'restore-gate.json')),false);
        // Compare actual encrypted object bytes, not a checksum or metadata-only assertion.
        const expected=path.join(restored,'_voice/objects',sources[0].key),actual=path.join(root,'restored-object');
        python(`with m.Objects() as objects:objects.get(${JSON.stringify(sources[0].key)},m.Path(${JSON.stringify(actual)}))`,target);
        assert.ok(fs.readFileSync(expected).equals(fs.readFileSync(actual)),'ciphertext bytes survive encrypted archive and isolated object import');
        assert.equal(run('docker',['exec',pg,'psql','-U','postgres','-d',database,'-XAtqc',`SELECT count(*) FROM vc.voice_clip WHERE object_key='${edited.key}' OR object_key='${tomb.key}'`]).trim(),'0','removed clip rows do not resurrect');
        ctx.results.voiceBackup={encrypted:true,isolatedDatabase:true,isolatedBucket:true,currentRights:true,restoreMs:Date.now()-start};
    } finally {
        if(database)run('docker',['exec',pg,'psql','-U','postgres','-d','postgres','-Xqc',`DROP DATABASE ${database} WITH (FORCE)`]);
        fs.rmSync(root,{recursive:true,force:true});
    }
}
export const voiceBackupScene={id:'voice-backup',title:'VO-12 加密音频备份、隔离恢复与最新删除门禁',needs:['go','stack','fixture'],default:false,run:sceneVoiceBackup};
