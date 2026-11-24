import hmac
import json
import os
import pathlib
import queue
import re
import socketserver
import threading
from http.server import BaseHTTPRequestHandler
from engine import Engine, ControlError, ROOT

os.umask(0o077)
engine = Engine(recover=True)
jobs = queue.Queue(maxsize=10)
mutation_lock = threading.RLock()
socket_path = pathlib.Path('/run/open-harness/control.sock')

def worker():
    while True:
        args = jobs.get()
        try:
            engine.perform(*args)
        finally:
            jobs.task_done()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self):
        expected = 'Bearer '+engine.env['PLATFORM_CONTROL_KEY']
        if not hmac.compare_digest(self.headers.get('Authorization',''), expected):
            return self.reply(403, {'code': 'CONTROL_FORBIDDEN'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 16384:
                raise ControlError('INVALID_INPUT', 400)
            body = json.loads(self.rfile.read(size)) if size else {}
            if self.command != 'GET':
                if not isinstance(body, dict) or not re.fullmatch(r'[\w-]{1,100}', body.get('actor','')) or not isinstance(body.get('reason'),str) or not 8 <= len(body['reason']) <= 300:
                    raise ControlError('INVALID_INPUT', 400)
                if jobs.full():
                    raise ControlError('QUEUE_FULL', 409)
            path = self.path.strip('/').split('/')
            if self.command == 'GET' and path == ['organizations']:
                return self.reply(200, engine.organizations())
            if self.command == 'GET' and path == ['audit']:
                return self.reply(200, engine.audits())
            if self.command == 'POST' and path == ['organizations']:
                row = engine.create(body)
                jobs.put_nowait((row['slug'], 'create', body['actor'], body['reason']))
                return self.reply(202, row)
            if len(path) >= 3 and path[0] == 'organizations':
                slug, action = path[1:3]
                row = engine.get(slug)
                if self.command == 'GET' and len(path) == 3 and action == 'members':
                    return self.reply(200, engine.members(slug))
                if self.command == 'PATCH' and len(path) == 4 and action == 'members':
                    return self.reply(200, engine.member(slug, path[3], body))
                if self.command == 'POST' and len(path) == 3 and action in ['suspend','resume','retry','upgrade']:
                    if row['existing'] or row['status'] == 'provisioning':
                        raise ControlError('ORGANIZATION_BUSY_OR_PROTECTED')
                    if action == 'resume' and row['status'] != 'suspended' or action == 'retry' and row['status'] != 'failed':
                        raise ControlError('INVALID_STATE')
                    engine.state(slug, 'provisioning')
                    engine.audit(body['actor'], action, slug, body['reason'], 'queued')
                    jobs.put_nowait((slug, action, body['actor'], body['reason']))
                    return self.reply(202, engine.get(slug))
            raise ControlError('NOT_FOUND', 404)
        except ControlError as error:
            return self.reply(error.status, {'code': error.code})
        except Exception:
            return self.reply(503, {'code': 'CONTROL_UNAVAILABLE'})

    def handle_request(self):
        with mutation_lock:
            return self.dispatch()

    do_GET = handle_request
    do_POST = handle_request
    do_PATCH = handle_request

class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

socket_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
socket_path.unlink(missing_ok=True)
server = Server(str(socket_path), Handler)
os.chown(socket_path, 0, 1000)
os.chmod(socket_path, 0o660)
for row in engine.organizations():
    if not row['existing'] and (engine.tenant(row['slug'])/'compose.json').exists():
        try:
            engine.network('oh-'+row['slug'])
        except Exception:
            engine.state(row['slug'], 'failed', 'NETWORK_ISOLATION_FAILED')
threading.Thread(target=worker, daemon=True).start()
server.serve_forever()
