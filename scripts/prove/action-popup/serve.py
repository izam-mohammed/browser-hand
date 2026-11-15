# Proof only: takes the proof extension's POST /event on 127.0.0.1:8791 and
# appends each one as a JSON line to the file named on the command line.
# See scripts/prove/action-popup.sh.
import http.server
import json
import sys
import threading

OUT = sys.argv[1]
LOCK = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/event":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        with LOCK, open(OUT, "a") as f:
            f.write(json.dumps(body) + "\n")
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()

    def log_message(self, *_):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8791), Handler).serve_forever()
