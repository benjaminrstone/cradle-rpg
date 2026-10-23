"""Server for Cradle Duel: the same file runs locally and on the hosted site.

- Serves the app (index.html, styles.css, src/*.js) with caching turned off, so edits show
  up on a normal reload. Nothing else in the folder is served.
- GET /api/version: a stamp that changes whenever the app's code changes, so an open tab can
  tell it needs a reload.
- The Claude sync, used while "Claude plays" is set:
    POST /api/state  the app saves the game state     GET /api/state  Claude's scripts read it
    POST /api/move   Claude's scripts send a move      GET /api/move   the app picks it up
- POST /api/fight: saves a finished fight's full log to fights/ as Markdown.

Settings (all optional; the defaults suit running it locally):
  port         first argument, or PORT (default 8123)
  CRADLE_DATA  where .duel/ and fights/ live (default: next to this file)
  sync key     CRADLE_SYNC_KEY, or the file <CRADLE_DATA>/sync.key. When set, the sync and
               fight endpoints need it in an X-Sync-Key header, so the public site can't
               read or drive anyone's game.
"""
import datetime
import functools
import hmac
import http.server
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("CRADLE_DATA") or ROOT)
DUEL = DATA / ".duel"
FIGHTS = DATA / "fights"
MAX_BODY = 2_000_000
STATIC = re.compile(r"^/(index\.html|styles\.css|src/[A-Za-z0-9_-]+\.js)?$")


def sync_key():
    key = os.environ.get("CRADLE_SYNC_KEY", "").strip()
    if not key:
        try:
            key = (DATA / "sync.key").read_text(encoding="utf-8").strip()
        except OSError:
            key = ""
    return key


def code_version():
    files = [ROOT / "index.html", ROOT / "styles.css", *sorted((ROOT / "src").glob("*.js"))]
    return str(max(f.stat().st_mtime_ns for f in files if f.exists()))


def write_atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, path)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_empty(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def route(self):
        return urlparse(self.path).path

    def authorized(self):
        key = sync_key()
        return not key or hmac.compare_digest(self.headers.get("X-Sync-Key", ""), key)

    def do_GET(self):
        path = self.route()
        if path == "/api/version":
            self.send_json(json.dumps({"version": code_version()}).encode())
            return
        if path in ("/api/state", "/api/move"):
            if not self.authorized():
                self.send_empty(401)
                return
            f = DUEL / ("state.json" if path == "/api/state" else "move.json")
            if not f.exists():
                self.send_empty(204)
                return
            self.send_json(f.read_bytes())
            return
        if not STATIC.match(path):
            self.send_empty(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if not STATIC.match(self.route()):
            self.send_empty(404)
            return
        super().do_HEAD()

    def do_POST(self):
        path = self.route()
        if path not in ("/api/state", "/api/move", "/api/fight"):
            self.send_empty(404)
            return
        if not self.authorized():
            self.send_empty(401)
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            self.send_empty(400)
            return
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except ValueError:
            self.send_empty(400)
            return
        if path == "/api/fight":
            save_fight(data)
        else:
            write_atomic(DUEL / ("state.json" if path == "/api/state" else "move.json"), body)
        self.send_empty(204)

    def log_message(self, fmt, *args):
        # Keep the console quiet about the app's frequent sync calls.
        if "/api/" in (self.path or ""):
            return
        super().log_message(fmt, *args)


def save_fight(data):
    """Write a finished fight to fights/<date>-<names>-<id>.md (once per game)."""
    FIGHTS.mkdir(parents=True, exist_ok=True)
    game_id = re.sub(r"[^a-z0-9]", "", str(data.get("gameId", "")).lower())[:12] or "fight"
    names = "-vs-".join(re.sub(r"[^a-z0-9]", "", f.get("name", "").lower()) for f in data.get("fighters", []))[:60]
    path = FIGHTS / f"{datetime.date.today().isoformat()}-{names}-{game_id}.md"
    if path.exists():
        return
    lines = [f"# {data.get('result', 'Fight')}", ""]
    lines.append(f"**Saved:** {datetime.datetime.now().isoformat(timespec='minutes')}  ")
    if data.get("claude"):
        lines.append(f"**Claude played:** {data['claude']}  ")
    lines.append(f"**Ended at:** t={round(float(data.get('time', 0)), 1)}")
    lines += ["", "| Fighter | Path | Health | Spirit | Madra |", "| --- | --- | --- | --- | --- |"]
    for f in data.get("fighters", []):
        lines.append(f"| {f.get('name')} | {f.get('path')} | {f.get('health')} | {f.get('spirit')} | {f.get('madra')} |")
    lines += ["", "## Full log", "", "```"] + [str(l) for l in data.get("log", [])] + ["```", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8123))
    handler = functools.partial(Handler, directory=str(ROOT))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
