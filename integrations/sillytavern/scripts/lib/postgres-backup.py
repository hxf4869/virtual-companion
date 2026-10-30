#!/usr/bin/env python3
"""Dump or restore PostgreSQL for the V2 manual backup.

The dump is pg_dump custom format. A password never goes on a command line:
DSN passwords are written to a 0600 PGPASSFILE, and container dumps run inside
the database container. Restore creates a new database and does not replace
the database named in the snapshot.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.parse

IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$')
CONTAINER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')
BIGINT = 9223372036854775807
DELETION = None


def fail(code):
    raise RuntimeError(code)


def sanitize(text):
    text = re.sub(r'[A-Za-z][A-Za-z0-9+.-]*://\S+', '://redacted', text)
    text = re.sub(r'(?i)(password\s*=\s*)\S+', r'\1redacted', text)
    return text.replace('\n', ' ')[:400]


def deletion():
    global DELETION
    if DELETION is None:
        path = Path(__file__).with_name('deletion-state.py')
        spec = importlib.util.spec_from_file_location('vc_deletion_state', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        DELETION = module
    return DELETION


def quote_ident(name):
    if not IDENT.fullmatch(name):
        fail('PG_IDENTIFIER')
    return '"' + name + '"'


def require_ident(value, code):
    if not IDENT.fullmatch(value or ''):
        fail(code)
    return value


def backup_mode():
    dsn = os.environ.get('VC_BACKUP_PG_DSN', '')
    container = os.environ.get('VC_BACKUP_PG_CONTAINER', '')
    if bool(dsn) == bool(container):
        fail('PG_TARGET_UNSET')
    if container and not CONTAINER.fullmatch(container):
        fail('PG_CONTAINER_NAME')
    return dsn, container


def backup_user():
    return require_ident(os.environ.get('VC_BACKUP_PG_USER', 'postgres'), 'PG_USER')


def backup_database():
    dsn, container = backup_mode()
    if container:
        return require_ident(os.environ.get('VC_BACKUP_PG_DATABASE', 'vc'), 'PG_DATABASE_NAME')
    parsed = urllib.parse.urlparse(dsn)
    database = urllib.parse.unquote(parsed.path.lstrip('/'))
    return require_ident(database, 'PG_DATABASE_NAME')


def child_env():
    return deletion().scrubbed_env()


def run(cmd, env, data=None, text=False):
    result = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode != 0:
        fail('PG_COMMAND ' + sanitize(result.stderr.decode('utf-8', 'replace')))
    if text:
        return result.stdout.decode()
    return result.stdout


def psql_command(database, tuples):
    dsn, container = backup_mode()
    flags = ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        flags[2:2] = ['-A', '-t']
    if container:
        if shutil.which('docker') is None:
            fail('PG_DOCKER_MISSING')
        return deletion().docker_base() + ['exec', '-i', container, 'psql', '-U', backup_user(), '-d', database, *flags], child_env(), ''
    if shutil.which('psql') is None:
        fail('PG_CLIENT_MISSING')
    env = child_env()
    cleanup = deletion().assign_libpq(env, dsn)
    env['PGDATABASE'] = database
    return ['psql', *flags], env, cleanup


def psql(database, sql, tuples=False):
    command, env, cleanup = psql_command(database, tuples)
    try:
        return run(command, env, data=sql.encode(), text=True)
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


def query_json(database, sql):
    text = psql(database, sql, tuples=True).strip()
    if not text:
        fail('PG_QUERY_EMPTY')
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        fail('PG_QUERY_INVALID')


def current_mode():
    url = os.environ.get('VC_ST_DATABASE_URL', '')
    container = os.environ.get('VC_ST_PG_CONTAINER', '')
    if bool(url) == bool(container):
        fail('DELETION_STATE_UNAVAILABLE')
    return url, container


def current_psql(sql, tuples=False):
    url, container = current_mode()
    flags = ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        flags[2:2] = ['-A', '-t']
    env = child_env()
    cleanup = ''
    try:
        if container:
            if not CONTAINER.fullmatch(container) or shutil.which('docker') is None:
                fail('DELETION_STATE_UNAVAILABLE')
            user = require_ident(os.environ.get('VC_ST_PG_USER', 'postgres'), 'PG_USER')
            database = require_ident(os.environ.get('VC_ST_PG_DATABASE', 'vc'), 'PG_DATABASE_NAME')
            command = deletion().docker_base() + ['exec', '-i', container, 'psql', '-U', user, '-d', database, *flags]
        elif url.startswith(('postgres://', 'postgresql://')):
            if shutil.which('psql') is None:
                fail('PG_CLIENT_MISSING')
            cleanup = deletion().assign_libpq(env, url)
            command = ['psql', *flags]
        else:
            fail('DELETION_STATE_UNAVAILABLE')
        return run(command, env, data=sql.encode(), text=True)
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


def current_json(sql):
    text = current_psql(sql, tuples=True).strip()
    if not text:
        fail('PG_QUERY_EMPTY')
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        fail('PG_QUERY_INVALID')


def dump(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)
    database = backup_database()
    dump_path = out / 'db.dump'
    dsn, container = backup_mode()
    env = child_env()
    cleanup = ''
    try:
        if container:
            if shutil.which('docker') is None:
                fail('PG_DOCKER_MISSING')
            command = deletion().docker_base() + [
                'exec', '-i', container, 'pg_dump', '-U', backup_user(), '-d', database, '-Fc', '-w']
        else:
            if shutil.which('pg_dump') is None:
                fail('PG_CLIENT_MISSING')
            cleanup = deletion().assign_libpq(env, dsn)
            command = ['pg_dump', '-Fc', '-w']
        with dump_path.open('wb') as handle:
            result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.PIPE, env=env)
        if result.returncode != 0:
            dump_path.unlink(missing_ok=True)
            fail('PG_DUMP_FAILED ' + sanitize(result.stderr.decode('utf-8', 'replace')))
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)
    raw = dump_path.read_bytes()
    if not raw.startswith(b'PGDMP'):
        dump_path.unlink(missing_ok=True)
        fail('PG_DUMP_INVALID')
    os.chmod(dump_path, 0o600)
    meta = out / 'source.json'
    meta.write_text(json.dumps({'version': 1, 'format': 'pg_dump-Fc', 'database': database}, separators=(',', ':')) + '\n')
    os.chmod(meta, 0o600)
    print(f'POSTGRESQL included format=pg_dump-Fc database={database}', flush=True)


def observe_gate(path):
    file = Path(path)
    if file.is_symlink() or not file.is_file():
        fail('PG_RESTORE_GATE')
    raw = file.read_bytes()
    try:
        document = json.loads(raw.decode())
    except (UnicodeError, json.JSONDecodeError):
        fail('PG_RESTORE_GATE')
    if not isinstance(document, dict) or document.get('blocked') is not True:
        fail('PG_RESTORE_GATE')
    print('RESTORE_GATE_OBSERVED blocked=true sha256=' + hashlib.sha256(raw).hexdigest(), flush=True)


def read_meta(directory):
    root = Path(directory)
    dump_path = root / 'db.dump'
    meta_path = root / 'source.json'
    if dump_path.is_symlink() or meta_path.is_symlink() or not dump_path.is_file() or not meta_path.is_file():
        fail('PG_DUMP_MISSING')
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        fail('PG_DUMP_INVALID')
    if not isinstance(meta, dict) or meta.get('version') != 1 or meta.get('format') != 'pg_dump-Fc':
        fail('PG_DUMP_INVALID')
    database = meta.get('database')
    if not IDENT.fullmatch(database or ''):
        fail('PG_DATABASE_NAME')
    if dump_path.read_bytes()[:5] != b'PGDMP':
        fail('PG_DUMP_INVALID')
    return database, dump_path


def new_database_name(source):
    for _ in range(5):
        name = 'vc_restore_' + time.strftime('%Y%m%d%H%M%S', time.gmtime()) + '_' + secrets.token_hex(4)
        if name == source or not IDENT.fullmatch(name):
            continue
        count = psql('postgres', f"SELECT count(*) FROM pg_database WHERE datname = '{name}'", tuples=True).strip()
        if count == '0':
            return name
    fail('PG_RESTORE_TARGET')


def drop_database(name, source):
    if name == source or not name.startswith('vc_restore_') or not IDENT.fullmatch(name):
        fail('PG_RESTORE_TARGET')
    try:
        psql('postgres', f'DROP DATABASE IF EXISTS {name} WITH (FORCE)')
    except RuntimeError:
        psql('postgres', f'DROP DATABASE IF EXISTS {name}')


def pg_restore(database, dump_path):
    """Custom-format archives must be seekable, so a pipe is not a restore input."""
    dsn, container = backup_mode()
    env = child_env()
    cleanup = ''
    remote = ''
    try:
        if container:
            remote = '/tmp/vc-pg-restore-' + secrets.token_hex(8) + '.dump'
            base = deletion().docker_base()
            copied = subprocess.run(
                base + ['cp', str(dump_path), container + ':' + remote],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            if copied.returncode != 0:
                fail('PG_RESTORE_FAILED ' + sanitize(copied.stderr.decode('utf-8', 'replace')))
            user = backup_user()
            owned = subprocess.run(
                base + ['exec', '-u', 'root', container, 'chown', user + ':' + user, remote],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            if owned.returncode != 0:
                fail('PG_RESTORE_FAILED ' + sanitize(owned.stderr.decode('utf-8', 'replace')))
            mode = subprocess.run(
                base + ['exec', '-u', 'root', container, 'chmod', '600', remote],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            if mode.returncode != 0:
                fail('PG_RESTORE_FAILED ' + sanitize(mode.stderr.decode('utf-8', 'replace')))
            command = base + [
                'exec', container, 'pg_restore', '-U', user, '-d', database, '-w',
                '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', remote]
        else:
            if shutil.which('pg_restore') is None:
                fail('PG_CLIENT_MISSING')
            cleanup = deletion().assign_libpq(env, dsn)
            command = [
                'pg_restore', '-d', database, '-w', '--exit-on-error', '--single-transaction',
                '--no-owner', '--no-acl', str(dump_path)]
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        if result.returncode != 0:
            fail('PG_RESTORE_FAILED ' + sanitize(result.stderr.decode('utf-8', 'replace')))
    finally:
        if remote:
            subprocess.run(
                deletion().docker_base() + ['exec', '-u', 'root', container, 'rm', '-f', remote],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


def parse_id(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    if not re.fullmatch(r'[1-9][0-9]{0,18}', text):
        return None
    number = int(text)
    if number > BIGINT:
        return None
    return number


def id_pairs(rows, fields):
    found = []
    seen = set()
    for row in rows or []:
        if not isinstance(row, dict):
            fail('PG_DELETION_INVALID')
        values = []
        for field in fields:
            number = parse_id(row.get(field))
            if number is None:
                fail('PG_DELETION_INVALID')
            values.append(number)
        key = tuple(values)
        if key not in seen:
            seen.add(key)
            found.append(key)
    return found


def where_in(alias, columns, keys):
    if len(columns) == 1:
        return alias + '.' + quote_ident(columns[0]) + ' IN (' + ','.join(str(key[0]) for key in keys) + ')'
    qualified = ','.join(alias + '.' + quote_ident(column) for column in columns)
    values = ','.join('(' + ','.join(str(part) for part in key) + ')' for key in keys)
    return '(' + qualified + ') IN (VALUES ' + values + ')'


def regclass(schema, table):
    # A dotted identifier is a column reference. The cast needs a string literal.
    if not IDENT.fullmatch(schema) or not IDENT.fullmatch(table):
        fail('PG_IDENTIFIER')
    return "'" + schema + '.' + table + "'"


def foreign_children(database, schema, table):
    sql = f"""
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'schema', n.nspname,
  'table', c.relname,
  'childCols', (
     SELECT jsonb_agg(a.attname ORDER BY ck.ord)
     FROM unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ck.attnum),
  'parentCols', (
     SELECT jsonb_agg(af.attname ORDER BY fk.ord)
     FROM unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord)
     JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = fk.attnum)
)), '[]'::jsonb)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'f' AND con.confrelid = {regclass(schema, table)}::regclass
"""
    rows = query_json(database, sql)
    cleaned = []
    for row in rows:
        if not IDENT.fullmatch(row.get('schema') or '') or not IDENT.fullmatch(row.get('table') or ''):
            fail('PG_IDENTIFIER')
        if not isinstance(row.get('childCols'), list) or not isinstance(row.get('parentCols'), list):
            fail('PG_FK_SHAPE')
        if len(row['childCols']) != len(row['parentCols']) or not row['childCols']:
            fail('PG_FK_SHAPE')
        cleaned.append(row)
    return cleaned


def primary_key(database, schema, table):
    sql = f"""
SELECT COALESCE((
  SELECT jsonb_agg(a.attname ORDER BY k.ord)
  FROM pg_index i
  JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON k.attnum > 0
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = {regclass(schema, table)}::regclass AND i.indisprimary
), '[]'::jsonb)
"""
    columns = query_json(database, sql)
    if not isinstance(columns, list) or not columns or any(not IDENT.fullmatch(column) for column in columns):
        fail('PG_FK_SHAPE')
    return columns


def child_keys(database, parent_schema, parent_table, parent_columns, parent_keys, parent_fk, child_schema, child_table, child_fk, child_pk):
    array = 'jsonb_build_array(' + ','.join('c.' + quote_ident(column) for column in child_pk) + ')'
    parent_select = ','.join('p.' + quote_ident(column) for column in parent_fk)
    child_match = ','.join('c.' + quote_ident(column) for column in child_fk)
    sql = f"""
SELECT COALESCE(jsonb_agg({array}), '[]'::jsonb)
FROM {quote_ident(child_schema)}.{quote_ident(child_table)} AS c
WHERE ({child_match}) IN (
  SELECT {parent_select}
  FROM {quote_ident(parent_schema)}.{quote_ident(parent_table)} AS p
  WHERE {where_in('p', parent_columns, parent_keys)}
)
"""
    if len(child_fk) == 1:
        sql = f"""
SELECT COALESCE(jsonb_agg({array}), '[]'::jsonb)
FROM {quote_ident(child_schema)}.{quote_ident(child_table)} AS c
WHERE c.{quote_ident(child_fk[0])} IN (
  SELECT p.{quote_ident(parent_fk[0])}
  FROM {quote_ident(parent_schema)}.{quote_ident(parent_table)} AS p
  WHERE {where_in('p', parent_columns, parent_keys)}
)
"""
    rows = query_json(database, sql)
    return [tuple(int(part) for part in row) for row in rows]


def force_delete(database, schema, table, columns, keys, depth=0, seen=None):
    keys = list(dict.fromkeys(tuple(key) for key in keys))
    if not keys:
        return
    if depth > 8:
        fail('PG_FK_DEPTH')
    if seen is None:
        seen = set()
    token = (schema, table, tuple(keys))
    if token in seen:
        return
    seen.add(token)
    for child in foreign_children(database, schema, table):
        child_pk = primary_key(database, child['schema'], child['table'])
        if not child_pk:
            matched = ','.join('c.' + quote_ident(column) for column in child['childCols'])
            selected = ','.join('p.' + quote_ident(column) for column in child['parentCols'])
            psql(database, f"""
DELETE FROM {quote_ident(child['schema'])}.{quote_ident(child['table'])} AS c
WHERE ({matched}) IN (
  SELECT {selected} FROM {quote_ident(schema)}.{quote_ident(table)} AS p
  WHERE {where_in('p', columns, keys)})
""")
            continue
        found = child_keys(
            database, schema, table, columns, keys, child['parentCols'],
            child['schema'], child['table'], child['childCols'], child_pk)
        force_delete(database, child['schema'], child['table'], child_pk, found, depth + 1, seen)
    psql(database, f"DELETE FROM {quote_ident(schema)}.{quote_ident(table)} AS t WHERE {where_in('t', columns, keys)}")


def sql_literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, separators=(',', ':')).replace("'", "''") + "'::jsonb"
    fail('PG_INTENT_SHAPE')


def copy_intents(database, account_ids):
    if not account_ids:
        return
    exists = current_psql("SELECT CASE WHEN to_regclass('vc.account_deletion_intent') IS NULL THEN 'f' ELSE 't' END", tuples=True).strip()
    if exists != 't':
        fail('PG_INTENT_MISSING')
    ids = ','.join(str(item) for item in account_ids)
    rows = current_json(
        'SELECT COALESCE(jsonb_agg(to_jsonb(d)), \'[]\'::jsonb) '
        f'FROM vc.account_deletion_intent AS d WHERE d.account_id IN ({ids})')
    if not rows:
        return
    columns = query_json(
        database,
        "SELECT COALESCE(jsonb_agg(column_name ORDER BY ordinal_position), '[]'::jsonb) "
        "FROM information_schema.columns WHERE table_schema = 'vc' AND table_name = 'account_deletion_intent'")
    for row in rows:
        if not isinstance(row, dict):
            fail('PG_INTENT_SHAPE')
        names = [column for column in columns if column in row and IDENT.fullmatch(column)]
        if 'account_id' not in names:
            fail('PG_INTENT_SHAPE')
        listed = ','.join(quote_ident(name) for name in names)
        values = ','.join(sql_literal(row[name]) for name in names)
        psql(database, f'INSERT INTO vc.account_deletion_intent ({listed}) VALUES ({values}) ON CONFLICT (account_id) DO NOTHING')


def load_state():
    module = deletion()
    sources = [module.query_database()]
    current = os.environ.get('VC_ST_CURRENT_DATA_ROOT', '')
    if current:
        sources.append(module.read_tree(current))
    manifest = os.environ.get('VC_ST_DELETION_MANIFEST', '')
    if manifest:
        loaded = module.load_manifest(manifest)
        if loaded is not None:
            sources.append(loaded)
    return module.union(sources)


def relationships_left(database, pairs):
    if not pairs:
        return []
    values = ','.join('(' + str(owner) + ',' + str(ident) + ')' for owner, ident in pairs)
    rows = query_json(database, f"""
SELECT COALESCE(jsonb_agg(jsonb_build_array(r.owner_user_id, r.id)), '[]'::jsonb)
FROM vc.relationship AS r
WHERE (r.owner_user_id, r.id) IN (VALUES {values})
  AND NOT EXISTS (
    SELECT 1 FROM vc.conversation AS c
    WHERE c.owner_user_id = r.owner_user_id AND c.relationship_id = r.id)
""")
    return [tuple(int(part) for part in row) for row in rows]


def apply_deletions(database):
    state = load_state()
    accounts = id_pairs(state.get('accounts'), ('accountId',))
    conversations = id_pairs(state.get('conversations'), ('ownerId', 'conversationId'))
    relationships = id_pairs(state.get('relationships'), ('ownerId', 'relationshipId'))
    memories = id_pairs(state.get('memories'), ('ownerId', 'memoryId'))
    removed_accounts = {item[0] for item in accounts}
    force_delete(database, 'vc', 'memory_item', ['owner_user_id', 'id'], memories)
    force_delete(database, 'vc', 'conversation', ['owner_user_id', 'id'], conversations)
    kept_relationships = [(owner, ident) for owner, ident in relationships if owner not in removed_accounts]
    force_delete(database, 'vc', 'relationship', ['owner_user_id', 'id'], relationships_left(database, kept_relationships))
    force_delete(database, 'vc', 'vc_user', ['id'], accounts)
    copy_intents(database, [item[0] for item in accounts])
    print(
        'PG_DELETION accounts=%d relationships=%d conversations=%d memories=%d'
        % (len(accounts), len(relationships), len(conversations), len(memories)),
        flush=True,
    )
    return state


def restore(directory, gate):
    observe_gate(gate)
    source, dump_path = read_meta(directory)
    name = new_database_name(source)
    created = ''
    try:
        psql('postgres', f'CREATE DATABASE {name}')
        created = name
        pg_restore(name, dump_path)
        state=apply_deletions(name)
        voice_root=Path(directory).parent/'_voice'
        if voice_root.exists():
            spec=importlib.util.spec_from_file_location('vc_voice_backup',Path(__file__).with_name('voice-backup.py'))
            voice=importlib.util.module_from_spec(spec);spec.loader.exec_module(voice)
            voice.filter_database(name,voice_root,state)
    except Exception:
        if created:
            try:
                drop_database(created, source)
            except Exception as drop_error:
                print('PG_DROP_FAILED ' + sanitize(str(drop_error)), file=sys.stderr)
        raise
    print(f'RESTORED_DATABASE name={name} source={source} switched=false', flush=True)


def main():
    os.umask(0o077)
    if len(sys.argv) < 3:
        fail('PG_USAGE')
    mode = sys.argv[1]
    if mode == 'dump' and len(sys.argv) == 3:
        dump(sys.argv[2])
    elif mode == 'restore' and len(sys.argv) == 4:
        restore(sys.argv[2], sys.argv[3])
    else:
        fail('PG_USAGE')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        text = str(exc)
        if not text.startswith(('PG_', 'DELETION_')):
            text = 'PG_FAILED ' + sanitize(text)
        else:
            text = sanitize(text)
        print(text, file=sys.stderr)
        sys.exit(1)
