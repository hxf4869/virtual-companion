"""Single-inference, memory-only SenseVoice endpoint. No access/request logging."""
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import re
import threading
import wave

MAX_BYTES = 60 * 16000 * 2 + 4096
MAX_UPLOAD = MAX_BYTES + 65536
BUSY = threading.BoundedSemaphore(1)
RECOGNIZER = None


def read_audio(payload, content_type):
    message = BytesParser(policy=default).parsebytes(b'Content-Type: ' + content_type.encode('ascii') + b'\r\nMIME-Version: 1.0\r\n\r\n' + payload)
    parts = list(message.iter_parts())
    if not message.is_multipart() or len(parts) != 1 or parts[0].get_param('name', header='content-disposition') != 'file':
        raise ValueError('multipart')
    raw = parts[0].get_payload(decode=True)
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('size')
    with wave.open(io.BytesIO(raw), 'rb') as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or wav.getcomptype() != 'NONE' or not 0 < wav.getnframes() <= 60 * 16000:
            raise ValueError('format')
        pcm = wav.readframes(wav.getnframes())
        if len(pcm) != wav.getnframes() * 2:
            raise ValueError('truncated')
        return pcm


def transcribe(pcm):
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    stream = RECOGNIZER.create_stream()
    stream.accept_waveform(16000, samples)
    RECOGNIZER.decode_stream(stream)
    result = stream.result
    clean = lambda value: str(value).replace('<|', '').replace('|>', '')
    emotion = clean(getattr(result, 'emotion', '')).upper()
    language = clean(getattr(result, 'lang', ''))
    text = re.sub(r'<\|[^>]+\|>', '', result.text).strip()
    if not text or len(text) > 4000:
        raise ValueError('empty')
    return {'text': text, 'emotion': emotion if emotion in ('HAPPY', 'SAD', 'ANGRY', 'NEUTRAL') else '',
            'language': language if language in ('zh', 'en', 'ja', 'ko', 'yue') else ''}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.respond(200 if self.path == '/healthz' and RECOGNIZER is not None else 404, {'ready': RECOGNIZER is not None})

    def do_POST(self):
        if self.path != '/v1/audio/transcriptions':
            self.respond(404, {'error': 'not_found'})
            return
        if not BUSY.acquire(blocking=False):
            self.respond(429, {'error': 'busy'})
            return
        try:
            self.connection.settimeout(130)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_UPLOAD:
                self.respond(413, {'error': 'size'})
                return
            pcm = read_audio(self.rfile.read(length), self.headers.get('Content-Type', ''))
            result = transcribe(pcm)
            self.respond(200, result)
        except (ValueError, wave.Error, EOFError):
            self.respond(400, {'error': 'invalid_audio'})
        except Exception:
            self.respond(500, {'error': 'recognition_failed'})
        finally:
            BUSY.release()


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, *_args):
        pass


if __name__ == '__main__':
    import sherpa_onnx
    RECOGNIZER = sherpa_onnx.OfflineRecognizer.from_sense_voice(model='/models/model.int8.onnx', tokens='/models/tokens.txt', use_itn=True, num_threads=1, debug=False)
    Server(('0.0.0.0', 8000), Handler).serve_forever()
