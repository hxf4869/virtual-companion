"""UX-10 本地静态样板。仅合成浏览器数据，无业务代理与写入入口。"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
EXT = REPO / 'integrations/sillytavern/extension/vc-model-settings'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        source = path.startswith('/source/')
        base = EXT if source else ROOT
        relative = path[len('/source/'):] if source else path.lstrip('/') or 'index.html'
        target = (base / relative).resolve()
        if not target.is_relative_to(base) or not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        if source and target.name == 'page.js':
            anchor = '    mounted = controller;\n    return controller;'
            value = data.decode()
            if value.count(anchor) != 1:
                self.send_error(500, 'preview source anchor changed')
                return
            data = value.replace(anchor, '    controller.__preview = { state, render };\n' + anchor).encode()
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(target)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18794)
    args = parser.parse_args()
    ThreadingHTTPServer.request_queue_size = 64
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
