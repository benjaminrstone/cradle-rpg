"""Send Claude's move to the running duel. The app picks it up within a second.

Usage:
  python tools/duel_move.py strike
  python tools/duel_move.py dragonsBreath 12
  python tools/duel_move.py drop:burningCloak , strike     (several actions, comma-separated)
  python tools/duel_move.py block 4                        (reactions: take, dodge, block N, dodgeBlock N)
  python tools/duel_move.py offerDraw , wait 2               (offerDraw / withdrawDraw can go with any move)
  python tools/duel_move.py hollowSpear 10 @c12              (aim a single-target attack at a construct)
  python tools/duel_move.py redirect                         (Hollow King's Mantle reaction)
  python tools/duel_move.py --remote strike                  (play on the hosted site; see tools/duelsync.py)
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from duelsync import DUEL, load_state, send_move, take_remote_flag  # noqa: E402


def parse(args):
    # Actions are separated by commas, whether or not the commas are separate arguments:
    # `drop:hollowArmor , dropStars 1`, `drop:hollowArmor, dropStars 1` and one quoted string all work.
    actions = []
    for chunk in " ".join(args).split(","):
        current = chunk.split()
        if not current:
            continue
        target = next((c[1:] for c in current if c.startswith("@")), "")
        plain = [c for c in current if not c.startswith("@")]
        amount = float(plain[1]) if len(plain) > 1 else 0
        actions.append({"key": plain[0], "amount": amount, "target": target})
    return actions


def main():
    args = sys.argv[1:]
    remote = take_remote_flag(args)
    actions = parse(args)
    if not actions:
        print(__doc__)
        sys.exit(1)
    state = load_state(remote)
    if not state or not state.get("claudeToAct"):
        print("It isn't Claude's decision right now; move not sent.")
        sys.exit(1)
    move = {"id": uuid.uuid4().hex, "gameId": state["gameId"], "decision": state["decision"], "actions": actions}
    send_move(move, remote)
    (DUEL / "handled").write_text(f"{state['gameId']}:{state['decision']}", encoding="utf-8")
    print(f"Sent for decision {state['decision']}: " + ", ".join(
        a["key"] + (f" {a['amount']:g}" if a["amount"] else "") + (f" @{a['target']}" if a["target"] else "") for a in actions))


if __name__ == "__main__":
    main()
