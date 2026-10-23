"""Where Claude's duel scripts read the board and send moves.

Locally (the default) that's the .duel/ folder the dev server writes. With --remote it's the
hosted site over HTTPS, using the address and sync key in .duel/remote.json:
  {"url": "https://cradle.ben-stone.xyz", "key": "<the server's sync key>"}
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUEL = ROOT / ".duel"


def take_remote_flag(args):
    """Remove --remote from args; return the remote config, or None to work locally."""
    if "--remote" not in args:
        return None
    args.remove("--remote")
    try:
        cfg = json.loads((DUEL / "remote.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("--remote needs .duel/remote.json with the site's url and sync key.")
    cfg["url"] = cfg["url"].rstrip("/")
    return cfg


def _request(remote, path, body=None):
    req = urllib.request.Request(remote["url"] + path, data=body, method="POST" if body is not None else "GET")
    req.add_header("X-Sync-Key", remote.get("key", ""))
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


def load_state(remote=None):
    if remote is None:
        try:
            return json.loads((DUEL / "state.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
    try:
        status, body = _request(remote, "/api/state")
    except (urllib.error.URLError, OSError):
        return None
    if status == 401:
        sys.exit("The site refused the sync key in .duel/remote.json.")
    return json.loads(body) if status == 200 and body else None


def send_move(move, remote=None):
    body = json.dumps(move).encode()
    if remote is None:
        tmp = DUEL / "move.json.tmp"
        tmp.write_bytes(body)
        os.replace(tmp, DUEL / "move.json")
        return
    status, _ = _request(remote, "/api/move", body)
    if status != 204:
        sys.exit(f"The site didn't take the move (HTTP {status}).")


def code_version(remote=None):
    """The code version the server is serving now (same stamp as serve.py's /api/version)."""
    if remote is None:
        files = [ROOT / "index.html", ROOT / "styles.css", *sorted((ROOT / "src").glob("*.js"))]
        return str(max(f.stat().st_mtime_ns for f in files if f.exists()))
    try:
        status, body = _request(remote, "/api/version")
        return json.loads(body)["version"] if status == 200 else None
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        return None
