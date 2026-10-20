# Proof only: serves page/ on 127.0.0.1:8790 (the browser reaches it as
# localhost too), records every request for /blocked.html with its query,
# and writes the extension's POST /report, with those hits, to the file
# named on the command line. See scripts/prove/site-rules.sh.
import http.server
import json
import os
import sys
import threading
import urllib.parse

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page")
OUT = sys.argv[1]
HITS = []
LOCK = threading.Lock()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PAGE, **kwargs)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/blocked.html":
            q = dict(urllib.parse.parse_qsl(url.query))
            with LOCK:
                HITS.append({"tab": q.get("tab"), "via": q.get("via")})
        super().do_GET()

    def do_POST(self):
        if self.path != "/report":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        with LOCK:
            body["hits"] = list(HITS)
        with open(OUT, "w") as f:
            json.dump(body, f)
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()

    def log_message(self, *_):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8790), Handler).serve_forever()
