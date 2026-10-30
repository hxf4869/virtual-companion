import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('voice backup denies invalid keys, applies current account/chat tombs and filters ciphertext files',()=>{
    const helper=fileURLToPath(new URL('../scripts/lib/voice-backup.py',import.meta.url));
    const result=spawnSync('python3',['-c',`
import importlib.util,sys,tempfile,json,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('voice',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class VoiceBackup(unittest.TestCase):
 def test_rights(self):
  rows=[{'key':'41/2/3.wav','chatIdentity':'keep'},{'key':'41/2/4.wav','chatIdentity':'gone'},{'key':'42/2/5.wav','chatIdentity':'keep'}]
  self.assertEqual(m.keys_from_rights(rows,{'accounts':[{'accountId':'42'}],'f2Tombstones':[{'id':'gone'}]}),{'41/2/3.wav'})
  for value in [['../clip'],['41/2/3.wav','41/2/3.wav'],['exports/41/x.json'],None]:
   with self.assertRaises(RuntimeError):m.valid_keys(value)
 def test_filter_files(self):
  with tempfile.TemporaryDirectory(prefix='vc-voice-unit-') as tmp:
   root=Path(tmp);keys={'41/2/3.wav','41/2/4.wav'};m.write_index(root,keys)
   for key in keys:
    file=root/'objects'/key;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'encrypted-synthetic-audio')
   self.assertEqual(m.filter_files(root,{'41/2/3.wav'}),{'41/2/3.wav'})
   self.assertFalse((root/'objects/41/2/4.wav').exists())
   (root/'objects/41/2/3.wav').unlink()
   with self.assertRaises(RuntimeError):m.filter_files(root,{'41/2/3.wav'})
 def test_import_guard(self):
  with tempfile.TemporaryDirectory(prefix='vc-voice-unit-') as tmp:
   root=Path(tmp)/'_voice';m.write_index(root,[])
   gate=root.parent/'restore-gate.json';gate.write_text('{"blocked":true}')
   with self.assertRaisesRegex(RuntimeError,'GATE_CLOSED'):m.import_objects(root,'vc_restore_fixture')
   gate.unlink()
   with self.assertRaisesRegex(RuntimeError,'ISOLATED_DATABASE'):m.import_objects(root,'vc')
 def test_full_audio_cipher_size(self):
  with tempfile.TemporaryDirectory(prefix='vc-voice-size-') as tmp:
   root=Path(tmp);key='41/2/3.wav';m.write_index(root,[key]);file=root/'objects'/key;file.parent.mkdir(parents=True)
   size=4*((32*1024*1024+12+16+2)//3)+58
   with file.open('wb') as out:out.truncate(size)
   self.assertEqual(m.filter_files(root,{key}),{key})
   with file.open('ab') as out:out.write(b'x')
   with self.assertRaises(RuntimeError):m.filter_files(root,{key})
unittest.main(argv=['voice-backup'],verbosity=1)
`,helper],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
});
