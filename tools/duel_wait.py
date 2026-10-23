"""Wait until it's Claude's decision in the running duel, then print the board and exit.

The app saves its state to .duel/state.json while "Claude plays" is set.
Usage: python tools/duel_wait.py [--timeout SECONDS] [--now] [--remote]
  --now      print the current board immediately, without waiting
  --remote   watch the hosted site instead (see tools/duelsync.py)
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
DUEL = ROOT / ".duel"


from duelsync import code_version, load_state, take_remote_flag  # noqa: E402

STATE = DUEL / "state.json"
HANDLED = DUEL / "handled"
REMOTE = None


def handled_key():
    try:
        return HANDLED.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def pct(p):
    return f"{round(p * 100)}%"


def fighter_line(f):
    lines = [
        f"{f['name']} ({f['path']}): health {f['health']}/{f['maxHealth']}, spirit {f['spirit']}/{f['maxSpirit']}, "
        f"madra {f['madra']}/{f['maxMadra']}, speed {f['speed']}, next turn t={f['nextTurn']}, "
        f"interrupt threshold {f['threshold']} (stances {f.get('stanceThreshold', '?')}), weapon {f['weapon'] or 'none'}"
    ]
    for s in f["stances"]:
        nxt = f", next at t={s['nextBuildUp']}" if s.get("nextBuildUp") is not None else ""
        lines.append(f"    stance: {s['name']} (build-up {s['buildUp']}{nxt}, upkeep {s['upkeep']}/tick)")
    for c in f.get("constructs", []):
        stars = f", {c['stars']} stars left" if c.get("stars") is not None else ""
        lines.append(f"    construct {c['id']}: {c['name']} ({c['hp']} HP{stars})")
    for p in f.get("windups", []):
        boost = f", boosted +{p['boost']}" if p.get("boost") else ""
        lines.append(f"    winding up: {p['label']} ({p['madra']} madra{boost}), lands t={p['lands']}")
    if f["moving"]:
        lines.append(f"    moving {f['moving']['dir']}, arrives t={f['moving']['arrives']}")
    return "\n".join(lines)


def describe(s):
    out = [f"=== t={s['time']}  range {s['range']}  decision {s['decision']}  (Claude plays {s['claudeSide']}) ==="]
    if s.get("codeVersion") != code_version(REMOTE):
        out.append("WARNING: the app tab is running old code; ask the user to reload (Ctrl+Shift+R).")
    if s.get("result"):
        out.append(f"FIGHT OVER: {s['result']}")
    for f in s["fighters"]:
        out.append(fighter_line(f))
    out.append("Queue: " + " | ".join(f"t={q['time']} {q['label']}" for q in s["queue"]))
    out.append("Recent log:")
    out.extend("    " + l for l in s["log"])
    if s.get("drawOffers"):
        out.append("Draw offered by: " + ", ".join(s["drawOffers"]) + " (draw happens when both offer)")
    if s.get("error"):
        out.append(f"ERROR: {s['error']}")
    p = s.get("prompt")
    if p:
        out.append(f"Prompt: {p['kind']} for {p['fighter']}")
    if s.get("options"):
        out.append("Options (key: label):")
        for o in s["options"]:
            slider = ""
            if o["slider"]:
                sl = o["slider"]
                slider = f" [{sl['label']} {sl['min']}-{sl['max']}, preview at {sl['previewAt']}]"
            status = f"  (unavailable: {o['reason']})" if not o["enabled"] else f"  (warning: {o['warning']})" if o.get("warning") else ""
            out.append(f"  {o['key']}: {o['label']}{slider}{status}")
            if o.get("targets"):
                out.append("      can target: " + ", ".join(f"@{t['id']} {t['label']}" for t in o["targets"]))
            for line in o["preview"]:
                out.append(f"      {line}")
    if s.get("reaction"):
        r = s["reaction"]
        a = r["attack"]
        out.append(
            f"Incoming: {r['attacker']}'s {a['name']}: {a['hits']} hit(s) of {a['damage']} {a.get('dtype', '')}"
            f"{', pure madra (blocks cost double)' if a.get('pure') else ''}"
            f"{', area (no roll)' if a['area'] else ''}, sharpness {a['sharpness']}"
        )
        if r.get("pulse"):
            pu = r["pulse"]
            broken = ", ".join(f"{x['name']} ({x['cost']})" for x in pu["breaks"]) or "nothing"
            out.append(f"  pulse of {pu['madra']} madra: cancels things costing up to {pu['madra'] / 2} -> breaks {broken}; 'block N' takes 1.5N off its strength")
        if r.get("construct"):
            cn = r["construct"]
            out.append(f"  aimed at {cn['name']} ({cn['hp']} HP): no dodge; 'block N' reinforces it")
        out.append(f"  take: {pct(r['take']['chance'])} to hit, {r['take']['damageEach']} damage each after reduction")
        d = r["dodge"]
        if d.get("available") is not False:
            out.append(
            f"  dodge: area damage -{pct(d['reduction'])}, next turn +{d['delay']}" if a["area"]
            else f"  dodge: {' / '.join(pct(c) for c in d.get('chances') or [d['chance']])} to hit per hit (+{' / +'.join(str(b) for b in d.get('bonuses') or [d['bonus']])} Defense, tapering), next turn +{d['delay']}"
        )
        b = r["block"]
        out.append(
            f"  block N: -1.5N damage per hit, costs N x {b['factor']} madra, N up to {b['maxBase']}, next turn +{b['delay']}"
        )
        out.append("  dodgeBlock N: both at once (the dodge's effect and time, plus the block)")
        if r.get("effect") == "disrupt":
            out.append("  (no damage: if it hits, it breaks your wind-ups and stances)")
        rd = r.get("redirect") or {}
        if rd.get("shown"):
            out.append(f"  redirect: throw it back for {rd['cost']} madra" + ("" if rd.get("available") else " (not enough madra)"))
    return "\n".join(out)


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
        print(describe(s) if s else "No state yet. Is 'Claude plays' set in the app?")
        return
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = load_state(REMOTE)
        if s:
            key = f"{s['gameId']}:{s['decision']}"
            if key != handled_key() and (s.get("result") or s.get("claudeToAct")):
                if s.get("result"):
                    # Report a finished game once, then keep waiting for the next one.
                    HANDLED.write_text(key, encoding="utf-8")
                print(describe(s))
                return
        time.sleep(1)
    print("Timed out waiting for Claude's turn.")


if __name__ == "__main__":
    main()
