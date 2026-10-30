#!/usr/bin/env python3
"""Voice ciphertext in the existing VCBAE1 archive; current rights gate every restore."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import urllib.parse

HERE=Path(__file__).resolve().parent
KEY=re.compile(r'^[1-9][0-9]{0,18}/[1-9][0-9]{0,18}/[1-9][0-9]{0,18}\.wav$')
MAX_OBJECT=34<<20


def load(name):
    spec=importlib.util.spec_from_file_location('vc_'+name.replace('-','_'),HERE/(name+'.py'))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PG=load('postgres-backup')
RIGHTS_SQL="""
/* vc_voice_rights */
SELECT COALESCE(jsonb_agg(jsonb_build_object('key',v.object_key,'chatIdentity',
 CASE WHEN v.purpose='chat' THEN split_part(v.message_ref,':',2) ELSE (
  SELECT c.st_chat_identity FROM vc.conversation c WHERE c.owner_user_id=v.owner_user_id AND c.relationship_id=v.relationship_id
  AND c.st_mode='COMPANION' AND NOT c.incognito AND c.st_source_state IS DISTINCT FROM 'DELETED' ORDER BY c.id DESC LIMIT 1) END)
 ORDER BY v.object_key),'[]'::jsonb)
FROM vc.voice_clip v JOIN vc.relationship r ON(r.owner_user_id,r.id)=(v.owner_user_id,v.relationship_id)
WHERE v.status='ready' AND v.purpose IN('chat','proactive') AND v.object_key IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vc.account_deletion_intent d WHERE d.account_id=v.owner_user_id)
 AND ((v.purpose='chat' AND EXISTS(
  SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
  WHERE s.owner_user_id=v.owner_user_id AND c.relationship_id=v.relationship_id AND s.source_ref=v.message_ref
   AND s.role='assistant' AND s.present AND s.settled AND c.st_source_state='PRESENT' AND s.content_cipher=v.text))
 OR(v.purpose='proactive' AND EXISTS(SELECT 1 FROM vc.proactive_message p
  WHERE p.owner_user_id=v.owner_user_id AND p.relationship_id=v.relationship_id AND 'proactive:'||p.id::text=v.message_ref
   AND p.status IN('READY','INBOX') AND p.body=v.text)))
"""


def valid_keys(keys):
    if not isinstance(keys,list) or any(not isinstance(key,str) or not KEY.fullmatch(key) for key in keys) or len(set(keys))!=len(keys):
        raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
    return set(keys)


def write_index(root,keys):
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=root/'index.json'
    if path.is_symlink():raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
    path.write_text(json.dumps({'version':1,'keys':sorted(keys)},separators=(',',':')))
    path.chmod(0o600)


def read_index(root):
    path=root/'index.json'
    if root.is_symlink() or path.is_symlink() or not path.is_file():raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
    value=json.loads(path.read_text())
    if value.get('version')!=1:raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
    return valid_keys(value.get('keys'))


def keys_from_rights(rows,state=None):
    if not isinstance(rows,list) or any(not isinstance(row,dict) or not KEY.fullmatch(row.get('key','')) for row in rows):raise RuntimeError('VOICE_RESTORE_RIGHTS_INVALID')
    tombs={row.get('id') for row in (state or {}).get('f2Tombstones',[])}
    tombs.update(row.get('chatIdentity') for row in (state or {}).get('conversations',[]))
    accounts={str(row.get('accountId')) for row in (state or {}).get('accounts',[])}
    return {row['key'] for row in rows if row['key'].split('/')[0] not in accounts and (not row.get('chatIdentity') or row['chatIdentity'] not in tombs)}


def current_keys(state=None):
    keys=keys_from_rights(PG.current_json(RIGHTS_SQL),state if state is not None else PG.load_state())
    manifest=os.environ.get('VC_ST_DELETION_MANIFEST','')
    if manifest:
        value=PG.deletion().load_manifest(manifest)
        if value and 'voiceRights' in value:
            rights=value['voiceRights']
            if not isinstance(rights,dict) or rights.get('version')!=1:raise RuntimeError('VOICE_RESTORE_RIGHTS_INVALID')
            keys &= valid_keys(rights.get('keys'))
    return keys


def storage_env():
    names=['VC_EXPORT_S3_ENDPOINT','VC_EXPORT_S3_ACCESS_KEY','VC_EXPORT_S3_SECRET_KEY','VC_EXPORT_S3_BUCKET']
    values={key:os.environ.get(key,'') for key in names}
    file=os.environ.get('VC_VOICE_S3_ENV_FILE','')
    if file:
        path=Path(file)
        if path.is_symlink() or not path.is_file() or path.stat().st_mode&0o077:raise RuntimeError('VOICE_S3_PRIVATE_CONFIG_REQUIRED')
        for line in path.read_text().splitlines():
            if '=' in line:
                key,value=line.split('=',1)
                if key in names:values[key]=value
    if not all(values.values()):raise RuntimeError('VOICE_S3_CONFIG_REQUIRED')
    parsed=urllib.parse.urlsplit(values['VC_EXPORT_S3_ENDPOINT'])
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:raise RuntimeError('VOICE_S3_CONFIG_INVALID')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',values['VC_EXPORT_S3_BUCKET']):raise RuntimeError('VOICE_S3_CONFIG_INVALID')
    return values


class Objects:
    def __enter__(self):
        try:return self.start()
        except BaseException:
            self.__exit__()
            raise

    def start(self):
        self.values=storage_env()
        self.container=os.environ.get('VC_VOICE_MINIO_CONTAINER','')
        if self.container and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',self.container):raise RuntimeError('VOICE_S3_CONFIG_INVALID')
        self.tmp=tempfile.TemporaryDirectory(prefix='vc-voice-s3-')
        self.local=Path(self.tmp.name)
        env=dict(os.environ);env.update(self.values);env.pop('MC_HOST_voice',None)
        if self.container:env['VC_EXPORT_S3_ENDPOINT']='http://127.0.0.1:9000'
        helper=HERE.parents[3]/'infra/db/backup/mc_alias_config.py'
        result=subprocess.run([sys.executable,str(helper),'voice',str(self.local),'--endpoint-env','VC_EXPORT_S3_ENDPOINT',
            '--access-key-env','VC_EXPORT_S3_ACCESS_KEY','--secret-key-env','VC_EXPORT_S3_SECRET_KEY'],env=env,capture_output=True)
        if result.returncode:self.tmp.cleanup();raise RuntimeError('VOICE_S3_CONFIG_INVALID')
        self.env=env
        self.prefix=['mc','--config-dir',str(self.local)]
        if self.container:
            # The existing pinned MinIO tools image is scratch (no shell/rm).
            # Reuse its mc in a temporary container and network namespace, as
            # the existing bucket bootstrap does; credentials are a private bind.
            result=subprocess.run(PG.deletion().docker_base()+['inspect','-f','{{.Image}}',self.container],capture_output=True,text=True)
            if result.returncode:raise RuntimeError('VOICE_S3_CONTAINER_UNAVAILABLE')
            self.copy_container='vc-voice-copy-'+self.local.name
            self.prefix=PG.deletion().docker_base()+['run','--rm','-i','--name',self.copy_container,
                '--label','com.vc.voice-backup=managed','--network','container:'+self.container,'--entrypoint','/bin/mc',
                '-e','MC_UPDATE=off','-v',str(self.local/'config.json')+':/mc-config/config.json:ro',
                result.stdout.strip(),'--config-dir','/mc-config']
        return self

    def __exit__(self,*_args):
        if getattr(self,'copy_container',''):
            subprocess.run(PG.deletion().docker_base()+['rm','-f','-v',self.copy_container],capture_output=True)
        if getattr(self,'tmp',None):self.tmp.cleanup()

    def get(self,key,destination):
        destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with destination.open('wb') as out:
            result=subprocess.run(self.prefix+['cat','voice/'+self.values['VC_EXPORT_S3_BUCKET']+'/'+key],stdout=out,stderr=subprocess.PIPE,env=self.env)
        if result.returncode or not 0<destination.stat().st_size<=MAX_OBJECT:raise RuntimeError('VOICE_S3_READ_FAILED')
        destination.chmod(0o600)

    def require_empty(self):
        result=subprocess.run(self.prefix+['ls','--recursive','--json','voice/'+self.values['VC_EXPORT_S3_BUCKET']],capture_output=True,env=self.env)
        if result.returncode or result.stdout.strip():raise RuntimeError('VOICE_RESTORE_EMPTY_BUCKET_REQUIRED')

    def put(self,key,source):
        data=source.read_bytes()
        command=self.prefix+['pipe','voice/'+self.values['VC_EXPORT_S3_BUCKET']+'/'+key]
        result=subprocess.run(command,input=data,capture_output=True,env=self.env)
        if result.returncode:raise RuntimeError('VOICE_S3_WRITE_FAILED')


def snapshot(destination):
    database=PG.backup_database()
    exists=PG.psql(database,"SELECT to_regclass('vc.voice_clip') IS NOT NULL",tuples=True).strip()
    if exists=='f':return
    if exists!='t':raise RuntimeError('VOICE_BACKUP_DATABASE_UNAVAILABLE')
    keys=keys_from_rights(PG.query_json(database,RIGHTS_SQL))
    root=Path(destination);write_index(root,keys)
    if keys:
        with Objects() as objects:
            for key in sorted(keys):objects.get(key,root/'objects'/key)
    print('VOICE included clips=%d; transient exports/previews excluded'%len(keys))


def filter_files(root,allowed):
    original=read_index(root)
    objects=root/'objects'
    if objects.is_symlink():raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
    kept=original & allowed
    for file in objects.rglob('*') if objects.exists() else []:
        if file.is_symlink():raise RuntimeError('VOICE_BACKUP_INDEX_INVALID')
        if file.is_file() and file.relative_to(objects).as_posix() not in kept:file.unlink()
    for key in kept:
        file=objects/key
        if not file.is_file() or not 0<file.stat().st_size<=MAX_OBJECT:raise RuntimeError('VOICE_BACKUP_OBJECT_MISSING')
    write_index(root,kept)
    return kept


def filter_database(database,root,state=None):
    try:
        allowed=read_index(root) & current_keys(state)
        encoded=PG.sql_literal(sorted(allowed))
        PG.psql(database,"DELETE FROM vc.voice_clip WHERE NOT (status='ready' AND purpose IN('chat','proactive') AND object_key IN(SELECT jsonb_array_elements_text("+encoded+"))); DELETE FROM vc.voice_object_cleanup;")
        kept=valid_keys(PG.query_json(database,"SELECT COALESCE(jsonb_agg(object_key),'[]'::jsonb) FROM vc.voice_clip WHERE status='ready'"))
        filter_files(root,kept)
        print('VOICE_RESTORE reconciled clips=%d'%len(kept))
    except Exception as error:
        raise RuntimeError('VOICE_RESTORE_RECONCILE_FAILED') from error


def import_objects(root,database):
    gate=root.parent/'restore-gate.json'
    if gate.exists():raise RuntimeError('VOICE_RESTORE_GATE_CLOSED')
    if not PG.IDENT.fullmatch(database) or not database.startswith('vc_restore_') or database==PG.backup_database():raise RuntimeError('VOICE_RESTORE_ISOLATED_DATABASE_REQUIRED')
    gate.write_text('{"blocked":true}\n');gate.chmod(0o600)
    state=PG.apply_deletions(database)
    filter_database(database,root,state)
    keys=read_index(root)
    with Objects() as objects:
        objects.require_empty()
        for key in sorted(keys):objects.put(key,root/'objects'/key)
    gate.unlink()
    print('VOICE_RESTORE imported clips=%d'%len(keys))


def main():
    os.umask(0o077)
    signal.signal(signal.SIGTERM,lambda *_args:sys.exit(1))
    mode=sys.argv[1];root=Path(sys.argv[2])
    if mode=='snapshot':snapshot(root)
    elif mode=='import' and len(sys.argv)==4:import_objects(root,sys.argv[3])
    else:raise RuntimeError('VOICE_BACKUP_USAGE')


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error)
        print(code if re.fullmatch(r'VOICE_[A-Z_]{1,90}',code) else 'VOICE_BACKUP_OR_RESTORE_FAILED',file=sys.stderr)
        sys.exit(1)
