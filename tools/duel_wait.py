"""Wait until it's Claude's decision in the running duel, then print the board and exit.

The app saves its state to .duel/state.json while "Claude plays" is set.
Usage: python tools/duel_wait.py [--timeout SECONDS] [--now] [--remote]
  --now      print the current board immediately, without waiting
  --remote   watch the hosted site instead (see tools/duelsync.py)
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent
DUEL = ROOT / ".duel"


from claude_player import describe  # noqa: E402
from duelsync import code_version, load_state, take_remote_flag  # noqa: E402

STATE = DUEL / "state.json"
HANDLED = DUEL / "handled"
REMOTE = None


def handled_key():
    try:
        return HANDLED.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    global REMOTE
    args = sys.argv[1:]
    REMOTE = take_remote_flag(args)
    timeout = 1800
    if "--timeout" in args:
        timeout = float(args[args.index("--timeout") + 1])
    if "--now" in args:
        s = load_state(REMOTE)
        print(describe(s, code_version(REMOTE)) if s else "No state yet. Is 'Claude plays' set in the app?")
        return
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = load_state(REMOTE)
        if s:
            key = f"{s['gameId']}:{s['decision']}"
            # When the app has Claude play through the API, the server answers; stay out of it.
            ours = s.get("claudeToAct") and s.get("claudeVia") != "api"
            if key != handled_key() and (s.get("result") or ours):
                if s.get("result"):
                    # Report a finished game once, then keep waiting for the next one.
                    HANDLED.write_text(key, encoding="utf-8")
                print(describe(s, code_version(REMOTE)))
                return
        time.sleep(1)
    print("Timed out waiting for Claude's turn.")


if __name__ == "__main__":
    main()
