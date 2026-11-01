"""UX-11 合成样板，只监听 loopback；不代理业务接口，不读取配置。"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
EXT = REPO / 'integrations/sillytavern/extension/vc-model-settings'
BASELINE = '14b67677'  # UX-12 前的提交；Owner §2.1 要求。

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        baseline = path.startswith('/baseline/source/')
        source = baseline or path.startswith('/source/')
        prefix = '/baseline/source/' if baseline else '/source/'
        base = EXT if source else ROOT
        relative = path[len(prefix):] if source else path.lstrip('/') or 'index.html'
        target = (base / relative).resolve()
        if not target.is_relative_to(base) or target.suffix not in {'.html','.js','.mjs','.css','.svg','.png','.webp','.jpg'}:
            self.send_error(404); return
        if baseline:
            try:
                data = subprocess.check_output(['git','show',f'{BASELINE}:{target.relative_to(REPO)}'],cwd=REPO,stderr=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                self.send_error(404); return
        elif target.is_file():
            data = target.read_bytes()
        else:
            self.send_error(404); return
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(target)))
        # 检查上下文只存活一轮，候选固定；日常样板仍实时读文件。
        self.send_header('Cache-Control','private, max-age=600' if self.headers.get('X-VC-Check') == 'ux11' else 'no-store')
        self.send_header('Vary','X-VC-Check')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(data)

    def do_HEAD(self): self.do_GET()

    def log_message(self,*args): pass

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=18795);args=parser.parse_args()
    ThreadingHTTPServer.request_queue_size=64
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'http://127.0.0.1:{server.server_port}/',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
