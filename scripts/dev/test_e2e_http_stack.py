"""Real HTTP launcher lifecycle and OS-identity tests; Docker is stubbed."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

LAUNCHER = Path(__file__).with_name("e2e-stack.sh").resolve()
ENGINE = r"""import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['ENGINE_CALLS'],'a') as f:f.write(json.dumps(args)+chr(10))
cmd=args[0]
if cmd=='capture':
 p=Path(args[args.index('--out')+1]);p.write_text(json.dumps({'containers':[],'volumes':[],'networks':[]}))
elif cmd=='record-built':Path(args[args.index('--out')+1]).write_text('{}')
elif cmd=='cleanup':
 Path(args[args.index('--leftovers-out')+1]).write_text('{}')
 raise SystemExit(int(os.environ.get('ENGINE_STATUS','0')))
else:raise SystemExit(98)
"""
DRIVER = r"""source "$LAUNCHER" || exit
[ -z "${VC_DOMAIN+x}" ] || exit 92
RESOURCES="$ENGINE_STUB"
python3 - "$PATHS_OUT" "$RUN_DIR" "$CAPTURE" "$BUILT_IMAGES" "$CREATING" "$GO_BINARY" "$MINIO_MC_CONFIG_FILE" <<'PY_PATHS'
import json,sys
json.dump(dict(zip(('run','capture','built','marker','binary','config'),sys.argv[2:])),open(sys.argv[1],'w'))
PY_PATHS
if [ "$CASE_EXISTING" = 1 ]; then
  if write_state; then exit 81; fi
  exit 0
fi
write_state || exit
mkdir -p "$E2E_SECRET_DIR"
printf 'synthetic' >"$GO_BINARY"
printf 'synthetic' >"$MINIO_MC_CONFIG_FILE"
for suffix in .auth.json .shared-chat.json .shared-memory.json .shared-admin.json; do
  printf '{}' >"$E2E_STACK_STATE_FILE$suffix"
done
if [ "$CASE_CREATING" = 1 ]; then touch "$CREATING"; write_state || exit; fi
if [ "${CASE_PRESERVE:-0}" = 1 ]; then touch "$RUN_DIR/.preserve-stack"; fi
cp "$E2E_STACK_STATE_FILE" "$STATE_OBSERVED"
exit "$CASE_INCOMING"
"""
class HttpLifecycleTest(unittest.TestCase):
    def environment(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        (base/'bin').mkdir()
        docker = base/'bin/docker'
        docker.write_text('#!/bin/sh'+chr(10)+'exit 97'+chr(10))
        docker.chmod(0o700)
        stub = base/'engine.py'
        stub.write_text(ENGINE)
        env = {k:v for k,v in os.environ.items() if not k.startswith(('VC_','E2E_'))}
        env.update(PATH=str(base/'bin')+os.pathsep+env['PATH'], TMPDIR=str(base),
                   LAUNCHER=str(LAUNCHER), ENGINE_STUB=str(stub), ENGINE_CALLS=str(base/'calls.jsonl'),
                   ENGINE_STATUS='0', PATHS_OUT=str(base/'paths.json'), STATE_OBSERVED=str(base/'observed.json'),
                   E2E_STACK_STATE_FILE=str(base/'state.json'), E2E_HTTP_SOURCE_ONLY='1',
                   E2E_DOCKER_CONTEXT='orbstack', E2E_STACK_KEEP='0', E2E_RELEASE_MODE='full',
                   CASE_CREATING='1', CASE_INCOMING='0', CASE_EXISTING='0', VC_DOMAIN='inherited.example.invalid')
        return base, env

    def run_case(self, *, engine=0, incoming=0, keep=False, creating=True, existing=False, preserve=False):
        base, env = self.environment()
        env.update(ENGINE_STATUS=str(engine), CASE_INCOMING=str(incoming),
                   E2E_STACK_KEEP='1' if keep else '0', CASE_CREATING='1' if creating else '0',
                   CASE_EXISTING='1' if existing else '0', CASE_PRESERVE='1' if preserve else '0')
        if existing:
            (base/'state.json').write_text('existing state must survive')
            (base/'state.json.auth.json').write_text('existing auth must survive')
        p = subprocess.run(['bash','-c',DRIVER],env=env,capture_output=True,text=True,timeout=25)
        paths = json.loads((base/'paths.json').read_text()) if (base/'paths.json').exists() else {}
        calls = [json.loads(line) for line in (base/'calls.jsonl').read_text().splitlines()] if (base/'calls.jsonl').exists() else []
        return p, base, paths, calls

    def test_receipt_cleanup_success_keeps_receipts_and_removes_session_state(self):
        p, base, paths, calls = self.run_case()
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual([a[0] for a in calls],['capture','record-built','cleanup'])
        self.assertEqual(calls[-1][-2:],['--deadline-seconds','90'])
        self.assertTrue(Path(paths['capture']).exists())
        self.assertTrue(Path(paths['built']).exists())
        for name in ('state.json','state.json.auth.json','state.json.shared-chat.json'):
            self.assertFalse((base/name).exists(),name)
        self.assertFalse(Path(paths['binary']).exists())
        self.assertFalse(Path(paths['config']).exists())

    def test_cleanup_failure_preserves_recovery_state_but_removes_sessions(self):
        p, base, paths, _ = self.run_case(engine=1)
        self.assertEqual(p.returncode,1,p.stderr)
        self.assertTrue((base/'state.json').exists())
        self.assertTrue(Path(paths['marker']).exists())
        self.assertTrue(Path(paths['capture']).exists())
        self.assertFalse((base/'state.json.auth.json').exists())

    def test_incoming_failure_is_preserved_after_successful_cleanup(self):
        p, _, _, _ = self.run_case(incoming=7)
        self.assertEqual(p.returncode,7,p.stderr)

    def test_keep_mode_runs_no_cleanup_and_keeps_state_and_sessions(self):
        p, base, paths, calls = self.run_case(keep=True)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(calls,[])
        for name in ('state.json','state.json.auth.json','state.json.shared-chat.json'):
            self.assertTrue((base/name).exists(),name)
        self.assertTrue(Path(paths['binary']).exists())

    def test_pending_synthetic_restoration_preserves_the_entire_stack(self):
        p, base, paths, calls = self.run_case(preserve=True, incoming=9)
        self.assertEqual(p.returncode,9,p.stderr)
        self.assertEqual(calls,[])
        self.assertTrue((base/'state.json').exists())
        self.assertTrue((base/'state.json.auth.json').exists())
        self.assertTrue(Path(paths['binary']).exists())

    def test_pre_creation_exit_never_calls_resource_engine(self):
        p, base, _, calls = self.run_case(creating=False)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(calls,[])
        self.assertFalse((base/'state.json').exists())
        state=json.loads((base/'observed.json').read_text())
        self.assertEqual((state['version'],state['stackKind'],state['container']),(4,'http',None))
        self.assertFalse(state['creating'])

    def test_existing_state_and_auth_cannot_be_overwritten_or_removed(self):
        p, base, _, calls = self.run_case(existing=True)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(calls,[])
        self.assertEqual((base/'state.json').read_text(),'existing state must survive')
        self.assertEqual((base/'state.json.auth.json').read_text(),'existing auth must survive')

    def test_context_is_rejected_before_any_daemon_request(self):
        _, env = self.environment()
        env['E2E_DOCKER_CONTEXT']='foreign-context'
        p=subprocess.run(['bash','-c','source "$LAUNCHER"'],env=env,capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,1,p.stderr)
        self.assertIn('orbstack',p.stderr)

    def process_case(self, correct):
        _, env = self.environment()
        env['CORRECT_IDENTITY']='1' if correct else '0'
        driver=r"""source "$LAUNCHER" || exit
set -m
sleep 60 >/dev/null 2>&1 < /dev/null &
probe_pid=$!
set +m
start="$(process_start "$probe_pid")"
if [ "$CORRECT_IDENTITY" != 1 ]; then start='wrong kernel start time'; fi
terminate_group "$probe_pid" "$start"
rc=$?
if [ "$CORRECT_IDENTITY" = 1 ]; then
  if [ "$rc" != 0 ] || kill -0 "$probe_pid" 2>/dev/null; then
    kill -TERM -- "-$probe_pid" 2>/dev/null || true
    wait "$probe_pid" 2>/dev/null || true
    exit 83
  fi
else
  if [ "$rc" = 0 ] || ! kill -0 "$probe_pid" 2>/dev/null; then exit 84; fi
  kill -TERM -- "-$probe_pid"
  wait "$probe_pid" 2>/dev/null || true
fi
exit 0
"""
        return subprocess.run(['bash','-c',driver],env=env,capture_output=True,text=True,timeout=15)

    def test_kernel_identity_match_terminates_own_child_group(self):
        p=self.process_case(True)
        self.assertEqual(p.returncode,0,p.stderr)

    def test_kernel_identity_mismatch_preserves_child_until_test_owner_stops_it(self):
        p=self.process_case(False)
        self.assertEqual(p.returncode,0,p.stderr)

if __name__=='__main__':unittest.main()
