#!/usr/bin/env python3
"""Offline MemoryCore snapshot and current-Go-rights restore gate for backup.sh."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

RIGHTS_SQL = """
SELECT jsonb_build_object('version',1,'capturedAt',clock_timestamp(),'owners',COALESCE((
 SELECT jsonb_object_agg(a.id::text,jsonb_build_object(
 'deleted',EXISTS(SELECT 1 FROM vc.account_deletion_intent d WHERE d.account_id=a.id),
 'recordIds',COALESCE((SELECT jsonb_agg(m.engine_record_id) FROM vc.memory_item m WHERE m.owner_user_id=a.id
 AND m.engine_record_id IS NOT NULL AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL
 AND m.status='ACCEPTED' AND NOT EXISTS(SELECT 1 FROM vc.memory_evidence e
 WHERE e.owner_user_id=a.id AND e.memory_item_id=m.id AND NOT EXISTS(
 SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE s.owner_user_id=a.id AND s.source_ref=e.source_ref AND s.present AND s.settled AND s.eligible AND NOT s.suppressed AND NOT c.incognito AND c.st_source_state='PRESENT'))),'[]'::jsonb),
 'sourceIds',COALESCE((SELECT jsonb_agg('source-'||s.id||'-'||s.source_revision||'-'||s.source_generation)
 FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE s.owner_user_id=a.id AND s.present AND s.settled AND s.eligible AND NOT s.suppressed AND NOT c.incognito AND c.st_source_state='PRESENT'),'[]'::jsonb),
 'suppressedSources',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',s.id::text,'sourceRef',s.source_ref,'suppressed',s.suppressed,'present',s.present))
 FROM vc.st_message_source s WHERE s.owner_user_id=a.id AND (s.suppressed OR NOT s.present)),'[]'::jsonb)
 )) FROM vc.identity_account a),'{}'::jsonb),
 'deletions',COALESCE((SELECT jsonb_agg(jsonb_build_object('ownerId',account_id::text,'status',status,'requestedAt',requested_at)) FROM vc.account_deletion_intent),'[]'::jsonb));
"""

def rights():
    connection = os.environ.get('VC_MEMORYCORE_DATABASE_URL')
    container = os.environ.get('VC_MEMORYCORE_PG_CONTAINER')
    if bool(connection) == bool(container):
        raise RuntimeError('MEMORYCORE_CURRENT_GO_DATABASE_REQUIRED')
    env = dict(os.environ)
    if connection:
        env['PGDATABASE'] = connection
        command = ['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    else:
        command = ['docker', '--context', 'orbstack', 'exec', '-i', container, 'psql',
                   '-U', os.environ.get('VC_MEMORYCORE_PG_USER', 'postgres'),
                   '-d', os.environ.get('VC_MEMORYCORE_PG_DATABASE', 'vc'),
                   '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    result = subprocess.run(command, input=RIGHTS_SQL, text=True, env=env, capture_output=True)
    if result.returncode:
        raise RuntimeError('MEMORYCORE_GO_RIGHTS_UNAVAILABLE')
    value = json.loads(result.stdout)
    if value.get('version') != 1 or not isinstance(value.get('owners'), dict):
        raise RuntimeError('MEMORYCORE_GO_RIGHTS_INVALID')
    return value


def lock(root):
    file = root / 'runtime.lock'
    for _ in range(2):
        try:
            fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, str(os.getpid()).encode()); os.close(fd)
            return file
        except FileExistsError:
            try:
                pid = int(file.read_text())
                if pid <= 0: raise ValueError()
                os.kill(pid, 0)
            except ProcessLookupError:
                file.unlink()
                continue
            except (ValueError, PermissionError):
                pass
            raise RuntimeError('MEMORYCORE_STOP_SERVICE_BEFORE_BACKUP')
    raise RuntimeError('MEMORYCORE_BACKUP_LOCK_FAILED')


def snapshot(root, destination, current):
    root, destination = Path(root), Path(destination)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('MEMORYCORE_DATA_ROOT_INVALID')
    held = lock(root)
    try:
        destination.mkdir(mode=0o700, parents=True)
        for source in root.rglob('*'):
            rel = source.relative_to(root)
            if rel.as_posix() == 'runtime.lock' or source.name.endswith(('-wal', '-shm')):
                continue
            if source.is_symlink(): raise RuntimeError('MEMORYCORE_SYMLINK_REJECTED')
            target = destination / rel
            if source.is_dir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            elif source.is_file():
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if source.name == 'vectors.db':
                    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as src, sqlite3.connect(target) as dst:
                        src.backup(dst)
                else:
                    shutil.copyfile(source, target)
                target.chmod(0o600)
        (destination / 'go-rights.json').write_text(json.dumps(current))
        (destination / 'go-rights.json').chmod(0o600)
    finally:
        held.unlink()


def restore_gate(root, current):
    root = Path(root)
    # This manifest comes from the current authoritative Go database, never the
    # archive. Engine opening applies it before any read, export or proposal.
    pending = root / 'restore-pending.json'
    pending.write_text(json.dumps(current)); pending.chmod(0o600)
    (root / 'runtime.lock').unlink(missing_ok=True)


def main():
    os.umask(0o077)
    mode, root = sys.argv[1:3]
    current = rights()
    if mode == 'snapshot': snapshot(root, sys.argv[3], current)
    elif mode == 'restore': restore_gate(root, current)
    else: raise RuntimeError('MEMORYCORE_BACKUP_MODE_INVALID')

if __name__ == '__main__':
    try: main()
    except Exception:
        # Database connection strings, stored content and paths stay private.
        print('MEMORYCORE_BACKUP_OR_RESTORE_FAILED', file=sys.stderr)
        sys.exit(1)
