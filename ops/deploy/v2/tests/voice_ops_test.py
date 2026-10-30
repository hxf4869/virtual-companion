import importlib.util
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('voice_ops', Path(__file__).resolve().parents[1] / 'lib' / 'voice-ops.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VoiceOpsTests(unittest.TestCase):
    def test_disabled_is_noop(self):
        module.prepare({}, {}, lambda *args, **kwargs: self.fail('disabled engine touched Docker'))

    def test_private_network_and_restart_without_inference_changes(self):
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, '{"Networks":{"synthetic-private":{}},"Ports":{"8000/tcp":[{"HostIp":"127.0.0.1"}]}}')
        module.prepare({'VC_VOICE_NETWORK': 'synthetic-private', 'VC_VOICE_KOKORO_CONTAINER': 'synthetic-engine'}, {'VC_TTS_KOKORO_URL': 'http://synthetic-engine:8000/v1'}, run)
        self.assertEqual(calls[-1], ['docker', 'update', '--restart', 'unless-stopped', 'synthetic-engine'])
        self.assertFalse(any(word in ['--threads', '--steps', '--model'] for argv in calls for word in argv))

    def test_public_binding_fails_before_restart(self):
        def run(argv, **kwargs):
            self.assertEqual(argv[1], 'inspect')
            return subprocess.CompletedProcess(argv, 0, '{"Networks":{"synthetic-private":{}},"Ports":{"8000/tcp":[{"HostIp":"0.0.0.0"}]}}')
        with self.assertRaisesRegex(ValueError, '非回环'):
            module.prepare({'VC_VOICE_NETWORK': 'synthetic-private', 'VC_VOICE_KOKORO_CONTAINER': 'synthetic-engine'}, {'VC_TTS_KOKORO_URL': 'http://synthetic-engine:8000/v1'}, run)


if __name__ == '__main__':
    unittest.main()
