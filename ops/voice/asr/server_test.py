import importlib.util
import io
from pathlib import Path
import unittest
import wave

spec=importlib.util.spec_from_file_location('asr_server',Path(__file__).with_name('server.py'))
server=importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class InputTests(unittest.TestCase):
    def body(self, channels=1, seconds=1):
        raw=io.BytesIO()
        with wave.open(raw,'wb') as wav:
            wav.setnchannels(channels);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(bytes(16000*2*channels*seconds))
        return b'--synthetic\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n'+raw.getvalue()+b'\r\n--synthetic--\r\n'

    def test_valid(self):
        self.assertEqual(len(server.read_audio(self.body(),'multipart/form-data; boundary=synthetic')),32000)

    def test_stereo_and_oversize(self):
        for channels,seconds in [(2,1),(1,61)]:
            with self.assertRaises(ValueError):server.read_audio(self.body(channels,seconds),'multipart/form-data; boundary=synthetic')

if __name__=='__main__':unittest.main()
