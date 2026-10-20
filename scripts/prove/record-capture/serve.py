# Proof only: serves page/ on 127.0.0.1:8765 and writes the extension's
# POST /report to the file named on the command line.
# See scripts/prove/record-capture.sh.
import http.server
import os
import sys

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page")
OUT = sys.argv[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PAGE, **kwargs)

    def do_POST(self):
        if self.path != "/report":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        with open(OUT, "wb") as f:
            f.write(body)
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()

    def log_message(self, *_):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
