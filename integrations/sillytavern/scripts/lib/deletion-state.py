#!/usr/bin/env python3
"""Current deletion state for an isolated ST restore.

The authoritative inputs are the live database, the live data root's account
files and F2 tombstones, and a sidecar manifest written beside backups. The
manifest is not inside the archive and is never written back to PostgreSQL.
A deletion present in any of those sources is applied to the restore target.
Allowlists are intersected, so a rolled-back database cannot widen access.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

DELETION_SQL = """
/* vc_deletion_manifest */
SELECT jsonb_build_object(
 'version',1,
 'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'accountId',d.account_id::text,
   'handle',COALESCE(d.st_handle,a.st_handle,''),
   'status',d.status,
   'stStatus',d.st_status))
   FROM vc.account_deletion_intent d
   LEFT JOIN vc.identity_account a ON a.id=d.account_id),'[]'::jsonb),
 'conversations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'ownerId',c.owner_user_id::text,
   'conversationId',c.id::text,
   'relationshipId',c.relationship_id::text,
   'chatIdentity',COALESCE(c.st_chat_identity,''),
   'location',COALESCE(c.st_location,''),
   'characterRef',COALESCE(r.st_character_ref,''),
   'handle',COALESCE(a.st_handle,'')))
   FROM vc.conversation c
   LEFT JOIN vc.relationship r ON (r.owner_user_id,r.id)=(c.owner_user_id,c.relationship_id)
   LEFT JOIN vc.identity_account a ON a.id=c.owner_user_id
   WHERE c.st_source_state='DELETED'),'[]'::jsonb),
 'relationships',COALESCE((SELECT jsonb_agg(x) FROM (
   SELECT DISTINCT jsonb_build_object(
     'ownerId',c.owner_user_id::text,
     'relationshipId',c.relationship_id::text,
     'characterRef',COALESCE(r.st_character_ref,''),
     'handle',COALESCE(a.st_handle,'')) AS x
   FROM vc.conversation c
   LEFT JOIN vc.relationship r ON (r.owner_user_id,r.id)=(c.owner_user_id,c.relationship_id)
   LEFT JOIN vc.identity_account a ON a.id=c.owner_user_id
   WHERE c.st_source_state='DELETED' AND c.relationship_id IS NOT NULL) s),'[]'::jsonb),
 'memories',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'ownerId',m.owner_user_id::text,
   'memoryId',m.id::text,
   'relationshipId',COALESCE(m.relationship_id::text,'')))
   FROM vc.memory_item m
   WHERE m.deleted_at IS NOT NULL),'[]'::jsonb));
"""

HANDLE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
ACCOUNT = re.compile(r'^[1-9][0-9]{0,18}$')
CARD = re.compile(r'^[A-Za-z0-9._-]{1,128}$')
F2_ID = re.compile(r'^[0-9a-fA-F-]{36}$')


def fail(code):
    raise RuntimeError(code)


def pgpass_escape(value):
    return value.replace('\\', '\\\\').replace(':', '\\:')


def scrubbed_env():
    env = dict(os.environ)
    for key in ('PGPASSWORD', 'VC_ST_DATABASE_URL', 'VC_BACKUP_PG_DSN'):
        env.pop(key, None)
    return env


def assign_libpq(env, url):
    """Apply a libpq URL to env. A password is written to a new 0600 PGPASSFILE."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('postgres', 'postgresql'):
        fail('DELETION_STATE_UNAVAILABLE')
    directory = ''
    try:
        if parsed.password is not None:
            directory = tempfile.mkdtemp(prefix='vc-pgpass-')
            os.chmod(directory, 0o700)
            path = os.path.join(directory, 'pgpass')
            host = parsed.hostname or '*'
            port = '*' if parsed.port is None else str(parsed.port)
            user = urllib.parse.unquote(parsed.username or '*')
            password = urllib.parse.unquote(parsed.password)
            line = ':'.join((
                pgpass_escape(host), pgpass_escape(port), '*',
                pgpass_escape(user), pgpass_escape(password),
            )) + '\n'
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.write(descriptor, line.encode())
            os.close(descriptor)
            env['PGPASSFILE'] = path
        if parsed.hostname:
            env['PGHOST'] = parsed.hostname
        if parsed.port:
            env['PGPORT'] = str(parsed.port)
        if parsed.username:
            env['PGUSER'] = urllib.parse.unquote(parsed.username)
        database = urllib.parse.unquote(parsed.path.lstrip('/'))
        if database:
            env['PGDATABASE'] = database
        sslmode = urllib.parse.parse_qs(parsed.query).get('sslmode')
        if sslmode:
            env['PGSSLMODE'] = sslmode[0]
        return directory
    except Exception:
        if directory:
            shutil.rmtree(directory, ignore_errors=True)
        raise


def docker_base():
    command = ['docker']
    context = os.environ.get('VC_DOCKER_CONTEXT', '')
    if context:
        command.extend(['--context', context])
    return command


def query_database():
    url = os.environ.get('VC_ST_DATABASE_URL', '')
    container = os.environ.get('VC_ST_PG_CONTAINER', '')
    if bool(url) == bool(container):
        fail('DELETION_STATE_UNAVAILABLE')
    env = scrubbed_env()
    cleanup = ''
    try:
        if url.startswith(('postgres://', 'postgresql://')):
            cleanup = assign_libpq(env, url)
            command = ['psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1']
        elif url:
            env['PGDATABASE'] = url
            command = ['psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1']
        else:
            command = docker_base() + ['exec', '-i', container, 'psql',
                       '-U', os.environ.get('VC_ST_PG_USER', 'postgres'),
                       '-d', os.environ.get('VC_ST_PG_DATABASE', 'vc'),
                       '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1']
        result = subprocess.run(command, input=DELETION_SQL, text=True, env=env, capture_output=True)
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)
    if result.returncode or not result.stdout.strip():
        fail('DELETION_STATE_UNAVAILABLE')
    return parse_deletion(result.stdout)


def parse_deletion(raw):
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        fail('DELETION_STATE_INVALID')
    if not isinstance(value, dict) or value.get('version') != 1:
        fail('DELETION_STATE_INVALID')
    for key in ('accounts', 'conversations', 'relationships', 'f2Tombstones', 'memories'):
        if key in value and not isinstance(value[key], list):
            fail('DELETION_STATE_INVALID')
    return value


def safe_parts(value):
    if not isinstance(value, str) or not value or value.startswith(('/', '\\')) or '\\' in value:
        return None
    parts = value.split('/')
    if any(part in ('', '.', '..') for part in parts):
        return None
    return parts


def read_tree(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        fail('DELETION_STATE_INVALID')
    accounts, tombs = [], []
    listed = root / '_vc_accounts'
    if listed.is_symlink():
        fail('DELETION_STATE_INVALID')
    if listed.is_dir():
        for file in sorted(listed.glob('*.json')):
            if file.is_symlink() or not file.is_file() or not ACCOUNT.fullmatch(file.stem):
                continue
            try:
                doc = json.loads(file.read_text())
            except (OSError, json.JSONDecodeError):
                fail('DELETION_STATE_INVALID')
            if not isinstance(doc, dict) or doc.get('state') not in ('DELETING', 'DELETED'):
                continue
            handle = doc.get('handle') if isinstance(doc.get('handle'), str) else ''
            accounts.append({
                'accountId': file.stem,
                'handle': handle,
                'status': 'COMPLETED' if doc.get('state') == 'DELETED' else 'REQUESTED',
                'stStatus': 'COMPLETED' if doc.get('state') == 'DELETED' else 'PENDING',
            })
    for user in sorted(root.iterdir(), key=lambda item: item.name):
        if user.is_symlink() or not user.is_dir() or not HANDLE.fullmatch(user.name):
            continue
        state = user / '.vc-f2'
        if state.is_symlink():
            fail('DELETION_STATE_INVALID')
        if not state.is_dir():
            continue
        for file in sorted(state.glob('*.json')):
            if file.is_symlink() or not file.is_file():
                continue
            try:
                doc = json.loads(file.read_text())
            except (OSError, json.JSONDecodeError):
                fail('DELETION_STATE_INVALID')
            if not isinstance(doc, dict) or doc.get('state') != 'deleted':
                continue
            if not isinstance(doc.get('id'), str) or not isinstance(doc.get('path'), str):
                continue
            revision = doc.get('revision') if isinstance(doc.get('revision'), int) and doc.get('revision') >= 1 else 1
            tombs.append({'handle': user.name, 'id': doc['id'], 'path': doc['path'], 'revision': revision})
    return {'version': 1, 'accounts': accounts, 'conversations': [], 'relationships': [], 'f2Tombstones': tombs}


def load_manifest(path):
    file = Path(path)
    if not file.exists():
        return None
    if file.is_symlink() or not file.is_file():
        fail('DELETION_STATE_INVALID')
    try:
        value = parse_deletion(file.read_text())
    except OSError:
        fail('DELETION_STATE_INVALID')
    rights = value.get('engineRights')
    if rights is not None and (not isinstance(rights, dict) or rights.get('version') != 1 or not isinstance(rights.get('owners'), dict)):
        fail('DELETION_STATE_INVALID')
    voice=value.get('voiceRights')
    if voice is not None and (not isinstance(voice,dict) or voice.get('version')!=1 or not isinstance(voice.get('keys'),list)):
        fail('DELETION_STATE_INVALID')
    return value


def union(parts):
    accounts, conversations, relationships, tombs, memories = [], [], [], [], []
    seen = set()

    def add(bucket, key, row):
        if key in seen:
            return
        seen.add(key)
        bucket.append(row)

    for part in parts:
        for row in part.get('accounts') or []:
            if isinstance(row, dict):
                add(accounts, ('a', str(row.get('accountId') or ''), row.get('handle') or ''), row)
        for row in part.get('conversations') or []:
            if isinstance(row, dict):
                add(conversations, ('c', row.get('handle') or '', row.get('location') or '', row.get('chatIdentity') or ''), row)
        for row in part.get('relationships') or []:
            if isinstance(row, dict):
                add(relationships, ('r', row.get('handle') or '', str(row.get('relationshipId') or ''), row.get('characterRef') or ''), row)
        for row in part.get('f2Tombstones') or []:
            if isinstance(row, dict):
                add(tombs, ('f', row.get('handle') or '', row.get('id') or '', row.get('path') or ''), row)
        for row in part.get('memories') or []:
            if isinstance(row, dict):
                add(memories, ('m', str(row.get('ownerId') or ''), str(row.get('memoryId') or '')), row)
    return {
        'version': 1, 'accounts': accounts, 'conversations': conversations,
        'relationships': relationships, 'f2Tombstones': tombs, 'memories': memories,
    }


def isolate(target, parts):
    src = target.joinpath(*parts)
    try:
        src.relative_to(target)
    except ValueError:
        fail('DELETION_APPLY_FAILED')
    if src.is_symlink():
        src.unlink()
        return True
    if not src.exists():
        return False
    # The target is an isolated restore copy: deleted content is removed, not parked.
    if src.is_dir():
        shutil.rmtree(src)
    else:
        src.unlink()
    return True


def write_json(path, value):
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.is_symlink():
        fail('DELETION_APPLY_FAILED')
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':')))
    temporary.chmod(0o600)
    os.replace(temporary, path)
    path.chmod(0o600)


def isolate_backups(target, handle, base):
    backup = target / handle / 'backups'
    if backup.is_symlink() or not backup.is_dir():
        return 0
    found = []
    for directory, dirnames, filenames in os.walk(backup, followlinks=False):
        dirnames[:] = [name for name in dirnames if not (Path(directory) / name).is_symlink()]
        if base in filenames:
            found.append(Path(directory) / base)
    count = 0
    for file in found:
        if isolate(target, file.relative_to(target).parts):
            count += 1
    return count


def apply_state(target, state):
    chats = characters = accounts = 0
    removed_handles = set()
    for row in state['accounts']:
        handle = row.get('handle') or ''
        if not HANDLE.fullmatch(handle):
            continue
        if isolate(target, (handle,)):
            accounts += 1
            removed_handles.add(handle)
        account_id = str(row.get('accountId') or '')
        if ACCOUNT.fullmatch(account_id):
            write_json(target / '_vc_accounts' / f'{account_id}.json', {
                'ownerAccountId': account_id, 'handle': handle, 'state': 'DELETED',
            })
    tombs = {}
    for row in state['f2Tombstones']:
        handle, ident, location = row.get('handle') or '', row.get('id') or '', row.get('path') or ''
        parts = safe_parts(location)
        if HANDLE.fullmatch(handle) and F2_ID.fullmatch(ident) and parts:
            revision = row.get('revision') if isinstance(row.get('revision'), int) and row.get('revision') >= 1 else 1
            tombs[(handle, ident)] = {'id': ident, 'state': 'deleted', 'path': location, 'revision': revision}
            if handle not in removed_handles and isolate(target, (handle, *parts)):
                chats += 1
            if handle not in removed_handles:
                chats += isolate_backups(target, handle, parts[-1])
    for row in state['conversations']:
        handle, location = row.get('handle') or '', row.get('location') or ''
        parts = safe_parts(location)
        ident = row.get('chatIdentity') or ''
        if HANDLE.fullmatch(handle) and F2_ID.fullmatch(ident) and parts and (handle, ident) not in tombs:
            tombs[(handle, ident)] = {'id': ident, 'state': 'deleted', 'path': location, 'revision': 1}
        if not HANDLE.fullmatch(handle) or not parts or handle in removed_handles:
            continue
        if isolate(target, (handle, *parts)):
            chats += 1
        chats += isolate_backups(target, handle, parts[-1])
    for row in state['relationships']:
        handle, card = row.get('handle') or '', row.get('characterRef') or ''
        if not HANDLE.fullmatch(handle) or not CARD.fullmatch(card) or card in ('.', '..') or handle in removed_handles:
            continue
        for name in (card, f'{card}.png', f'{card}.json'):
            if isolate(target, (handle, 'characters', name)):
                characters += 1
    for (handle, ident), tomb in tombs.items():
        user = target / handle
        if handle in removed_handles or user.is_symlink() or not user.is_dir():
            continue
        write_json(user / '.vc-f2' / f'{ident}.json', tomb)
    return chats, characters, accounts


def same_source(left, right):
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def tighten(pending, rights):
    if not isinstance(pending, dict) or pending.get('version') != 1 or not isinstance(pending.get('owners'), dict):
        fail('DELETION_STATE_INVALID')
    if not isinstance(pending.get('deletions'), list) or not isinstance(rights.get('deletions'), list):
        fail('DELETION_STATE_INVALID')
    owners = {}
    for owner, current in pending['owners'].items():
        exported = rights['owners'].get(owner)
        if not isinstance(current, dict):
            fail('DELETION_STATE_INVALID')
        if exported is None:
            owners[owner] = current
            continue
        if not isinstance(exported, dict):
            fail('DELETION_STATE_INVALID')
        if current.get('deleted') is True or exported.get('deleted') is True:
            owners[owner] = {'deleted': True, 'recordIds': [], 'sourceIds': [], 'suppressedSources': []}
            continue
        if not isinstance(current.get('recordIds'), list) or not isinstance(current.get('sourceIds'), list):
            fail('DELETION_STATE_INVALID')
        if not isinstance(exported.get('recordIds'), list) or not isinstance(exported.get('sourceIds'), list):
            fail('DELETION_STATE_INVALID')
        suppressed = []
        for row in list(current.get('suppressedSources') or []) + list(exported.get('suppressedSources') or []):
            if isinstance(row, dict) and not any(same_source(row, have) for have in suppressed):
                suppressed.append(row)
        owners[owner] = {
            'deleted': False,
            'recordIds': [item for item in current['recordIds'] if item in exported['recordIds']],
            'sourceIds': [item for item in current['sourceIds'] if item in exported['sourceIds']],
            'suppressedSources': suppressed,
        }
    deletions = []
    for row in list(pending['deletions']) + list(rights['deletions']):
        if not any(same_source(row, have) for have in deletions):
            deletions.append(row)
    pending['owners'] = owners
    pending['deletions'] = deletions
    return pending


def publish_manifest(path, state, rights):
    path = Path(path)
    if path.parent.is_symlink():
        fail('DELETION_STATE_INVALID')
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    body = {
        'version': 1,
        'accounts': state.get('accounts') or [],
        'conversations': state.get('conversations') or [],
        'relationships': state.get('relationships') or [],
        'f2Tombstones': state.get('f2Tombstones') or [],
        'memories': state.get('memories') or [],
        'retention': {'expiresAt': None, 'reason': 'V2-OWNER-PROTECTION'},
    }
    if rights is not None:
        body['engineRights'] = rights
    voice_index=os.environ.get('VC_VOICE_BACKUP_INDEX','')
    if voice_index:
        file=Path(voice_index)
        if file.is_symlink() or not file.is_file():fail('DELETION_STATE_INVALID')
        voice=json.loads(file.read_text())
        if voice.get('version')!=1 or not isinstance(voice.get('keys'),list):fail('DELETION_STATE_INVALID')
        body['voiceRights']=voice
    write_json(path, body)


def export_manifest(path, data_root, rights_file):
    state = query_database()
    tree = read_tree(data_root)
    merged = union([state, tree])
    rights = None
    if rights_file:
        file = Path(rights_file)
        if file.is_symlink() or not file.is_file():
            fail('DELETION_STATE_INVALID')
        try:
            rights = json.loads(file.read_text())
        except (OSError, json.JSONDecodeError):
            fail('DELETION_STATE_INVALID')
        if not isinstance(rights, dict) or rights.get('version') != 1 or not isinstance(rights.get('owners'), dict):
            fail('DELETION_STATE_INVALID')
    manifest = Path(path).resolve()
    root = Path(data_root).resolve()
    if manifest == root or root in manifest.parents:
        fail('DELETION_STATE_INVALID')
    publish_manifest(manifest, merged, rights)


def apply_target(target):
    target = Path(target)
    if target.is_symlink() or not target.is_dir():
        fail('DELETION_APPLY_FAILED')
    sources = [query_database()]
    current = os.environ.get('VC_ST_CURRENT_DATA_ROOT', '')
    if current:
        current_path = Path(current)
        if current_path.resolve() == target.resolve():
            fail('DELETION_APPLY_FAILED')
        sources.append(read_tree(current_path))
    manifest_path = os.environ.get('VC_ST_DELETION_MANIFEST', '')
    manifest = load_manifest(manifest_path) if manifest_path else None
    if manifest is not None:
        sources.append(manifest)
    state = union(sources)
    chats, characters, accounts = apply_state(target, state)
    pending = target / '_memorycore' / 'restore-pending.json'
    if manifest and isinstance(manifest.get('engineRights'), dict) and pending.exists():
        if pending.is_symlink():
            fail('DELETION_APPLY_FAILED')
        try:
            current_rights = json.loads(pending.read_text())
        except (OSError, json.JSONDecodeError):
            fail('DELETION_STATE_INVALID')
        write_json(pending, tighten(current_rights, manifest['engineRights']))
    print(f'DELETION_RECONCILE chats={chats} characters={characters} accounts={accounts}')


def main():
    os.umask(0o077)
    mode = sys.argv[1]
    if mode == 'export':
        rights = sys.argv[4] if len(sys.argv) > 4 else ''
        export_manifest(sys.argv[2], sys.argv[3], rights)
    elif mode == 'apply':
        apply_target(sys.argv[2])
    else:
        fail('DELETION_APPLY_FAILED')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        code = str(exc)
        if not code.startswith('DELETION_'):
            code = 'DELETION_APPLY_FAILED'
        print(code, file=sys.stderr)
        sys.exit(1)
