"""Claude as a player, through the Claude API.

While "Claude plays" is set to play via the API, serve.py hands every saved board to
AutoPlayer.on_state(). When it's Claude's decision, AutoPlayer asks the Claude API for a move
in a background thread and writes it where the app picks moves up (the same move.json the
chat scripts write). The design docs go in the system prompt, so Claude knows the rules.

Settings (all optional except the key):
  API key     ANTHROPIC_API_KEY, or the file <CRADLE_DATA>/anthropic.key
  model       CRADLE_CLAUDE_MODEL (default claude-opus-5-5)
  effort      CRADLE_CLAUDE_EFFORT: low, medium, high, xhigh or max (default medium)

Also holds describe(), the text board that both this and the chat scripts (tools/) show Claude.
"""
import json
import os
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ["seed.md", "battlefield.md", "stats.md", "techniques.md", "paths.md", "traits.md"]
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "medium"
MAX_ATTEMPTS = 3
MAX_THOUGHTS = 12  # recent decisions kept per game for the app's thinking panel
# Dollars per million tokens: input, output, cache read, cache write (5-minute).
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20, 2.5),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}


# ---------------------------------------------------------------------------------------------
# The board as text


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
        area = p.get("area")
        if not area:
            where = ""
        elif area.get("shape") == "line":
            where = f", a {area['width']} m beam from ({area['from']['x']}, {area['from']['y']}) to ({area['to']['x']}, {area['to']['y']})"
        else:
            where = f", area {area['radius']} m around ({area['centre']['x']}, {area['centre']['y']}) [{area.get('aim')}]"
        if area and area.get("zone"):
            where += ", a zone that stays and pulses"
        lines.append(f"    winding up: {p['label']} ({p['madra']} madra{boost}{where}), lands t={p['lands']}")
    for z in f.get("zones", []):
        sh = z["shape"]
        where = f"beam ({sh['from']['x']}, {sh['from']['y']})-({sh['to']['x']}, {sh['to']['y']})" if "from" in sh else f"{sh['radius']} m around ({sh['centre']['x']}, {sh['centre']['y']})"
        lines.append(f"    zone: {z['name']}, {where}, until t={z['until']}" + (f", slows {round(z['slow'] * 100)}% inside" if z.get("slow") else ""))
    if f.get("at"):
        lines.append(f"    at ({f['at']['x']}, {f['at']['y']})")
    w = f.get("walk")
    if w:
        arr = f", arrives t={w['arrives']}" if w.get("arrives") not in (None, -1) else ""
        lines.append(f"    walking {w['course']} at {w['pace']} pace{arr}")
    if f.get("flight"):
        to = f["flight"]["to"]
        lines.append(f"    flying to ({to['x']}, {to['y']}), lands t={f['flight']['lands']}")
    if f.get("closingIn"):
        lines.append(f"    closing in to strike: it starts once it would land in reach (gives up t={f['closingIn']['givesUp']})")
    return "\n".join(lines)


def describe(s, served_version=None):
    """The board as text. Pass served_version to warn when the app tab runs older code."""
    out = [f"=== t={s['time']}  range {s['range']} ({s.get('gap', '?')} m)  decision {s['decision']}  (Claude plays {s['claudeSide']}) ==="]
    ar = s.get("arena")
    if ar:
        bd = ar.get("bands") or {}
        b = [bd.get("closeUpTo", 2), bd.get("midUpTo", 14)]
        obs = ", ".join(f"{o['name']} x {o['x']}-{o['x'] + o['w']}, y {o['y']}-{o['y'] + o['h']}" for o in ar["obstacles"])
        out.append(f"Arena {ar['name']}: {ar['width']} x {ar['height']} m (x right, y down). Close up to {b[0]} m, Mid up to {b[1]} m, Far beyond. Obstacles: {obs}")
        if s.get("lineBlockedBy"):
            out.append(f"The line between the fighters is blocked by a {s['lineBlockedBy']}: attacks can't land through it.")
    if served_version is not None and s.get("codeVersion") != served_version:
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
            if o.get("point") and not o["enabled"]:
                status = "  (give it a centre)" if o["point"].get("area") else "  (give it a destination)"
            out.append(f"  {o['key']}: {o['label']}{slider}{status}")
            if o.get("targets"):
                out.append("      can target: " + ", ".join(f"@{t['id']} {t['label']}" for t in o["targets"]))
            for line in o["preview"]:
                out.append(f"      {line}")
            if o.get("point"):
                if o["point"].get("area"):
                    out.append(f"      aim: @x:y (e.g. {o['key']} @20:12), or @them: the centre of a circle, or the direction of a beam")
                else:
                    out.append(f"      where to land: @x:y (e.g. {o['key']} @12:8), or @toward / @away")
                for way, w in (o["point"].get("ways") or {}).items():
                    status = "" if w["enabled"] else f" (unavailable: {w['reason']})"
                    out.append(f"      @{way}{status}: " + " / ".join(w["preview"][:2]))
    if s.get("reaction"):
        r = s["reaction"]
        a = r["attack"]
        out.append(
            f"Incoming: {r['attacker']}'s {a['name']}: {a['hits']} hit(s) of {a['damage']} {a.get('dtype', '')}"
            f"{', area (no roll)' if a['area'] else ''}, sharpness {a['sharpness']}"
        )
        if r.get("pulse"):
            pu = r["pulse"]
            broken = ", ".join(f"{x['name']} ({x['cost']})" for x in pu["breaks"]) or "nothing"
            out.append(f"  pulse of {pu['madra']} madra: cancels things costing up to {pu['madra'] / 2} -> breaks {broken}; 'block N' takes 1.5N off its strength")
        if r.get("construct"):
            cn = r["construct"]
            out.append(f"  aimed at {cn['name']} ({cn['hp']} HP): no dodge; 'block N' reinforces it")
        out.append(f"  take: {pct(r['take']['chance'])} to hit, {r['take']['damageEach']} damage after reduction (and any barrier)")
        d = r["dodge"]
        if d.get("available") is not False:
            st = d.get("sidestep")
            out.append(
                f"  dodge: sidestep {st['metres']} m, {'gets you out of it' if st['escapes'] else 'still inside'}; next turn +{d['delay']}" if st
                else f"  dodge: {pct(d['chance'])} to hit on every hit (+{d['bonus']} Defense), next turn +{d['delay']}"
            )
        b = r["block"]
        out.append(
            f"  block N: costs N madra and soaks {b['soakPerMadra']}N damage in all, across every hit (N up to {b['maxMadra']}; {b['zeroAt']} soaks everything), next turn +{b['delay']}"
        )
        out.append("  dodgeBlock N: both at once (the dodge's effect and time, plus the block; a sidestep that gets you out saves the block)")
        if r.get("effect") == "disrupt":
            out.append("  (no damage: if it hits, it breaks your wind-ups and stances)")
        rd = r.get("redirect") or {}
        if rd.get("shown"):
            out.append(f"  redirect: throw it back for {rd['cost']} madra" + ("" if rd.get("available") else " (not enough madra)"))
    if s.get("course"):
        c = s["course"]
        out.append(f"{c['after']} has just acted: {' '.join(c['did']) or '(see the log)'}")
        out.append(f"That would catch you as things stand. You can change course (you're {c['now']}): changing it pushes your next turn {c['delay']} later. Answer with key keep, or key course and a walk.")
        for way, w in c["ways"].items():
            status = "" if w["enabled"] else f" (unavailable: {w['reason']})"
            out.append(f"  {way}{status}: " + " / ".join(w["preview"]))
        out.append('  or any spot as walk "x:y"')
    if s.get("opportunity"):
        op = s["opportunity"]
        st = op["strike"]
        out.append(f"{op['mover']} is walking out of Close range. Strike as they go? Lands at once: {pct(st['chance'])} to hit, {st['damage']} damage;"
                   f" your next turn comes {st['delay']} later{' (breaks their wind-ups)' if st['interrupts'] else ''}.")
        out.append("  strike / let")
    return "\n".join(out)


# ---------------------------------------------------------------------------------------------
# The request

INSTRUCTIONS = """You are playing Cradle Duel, a dueling game set in Will Wight's Cradle, against a human. You control one fighter; play to win.

Each time your fighter has a decision, you get the board as text: both fighters, the shared initiative queue, the recent log, and what you're deciding: your options (on your turn), an incoming attack (a reaction), a chance to walk out of an area the opponent has just started, or a chance to strike an opponent leaving Close range. The numbers on the board and in each option's preview come from the game itself; trust them over anything in the design docs below. The docs explain the rules and the thinking behind them.

Answer every decision by calling make_move once. Each action has a key, an amount, a target and a walk:
- On your turn, the key is an option key from the Options list. amount is the slider value (e.g. madra to commit) when the option has a slider, else 0.
- target is for options that need one, and is what follows "@" on the board without the "@": a construct id ("c12"), a spot on the arena as "x:y" in metres ("12.5:8"), "toward" / "away" for a Launch, or "them" to aim an area at the opponent (a circle's centre, or a beam's direction). Leave it "" when there's nothing to aim.
- walk is your standing order for walking, which goes on while you do anything else and until you change it: "keep" (the order you already have), "stop", "toward" (close in: follow the opponent, stopping 1.5 m away), "hold:N" (keep N metres from the opponent wherever they go, closing or backing off as needed, e.g. "hold:10"), or a spot "x:y". Each option's preview assumes "keep". To just walk, give the order with a wait. A strike chosen out of reach closes in and starts once it would land in reach.
- In a reaction, the key is take, dodge, block (amount N), dodgeBlock (amount N), or redirect when it's shown; walk can change course at the same time (it pushes your next turn later).
- When the opponent starts an area that would catch you, you may change course: key "keep", or key "course" with the new walk.
- When the opponent walks out of Close range, you get the chance to strike as they go: the key is strike or let.
- You can send several actions in order, e.g. dropping a stance ("drop:burningCloak") and then striking.
- offerDraw or withdrawDraw can go alongside any move. A draw happens only when both sides offer.

An option marked unavailable can't be chosen. If your last move was rejected, the board says why under ERROR; pick something else.

Use the plan field for a short note to yourself (a sentence or two): what you're setting up, what you've learned about the opponent. You'll see it at your next decision. The app has a folded-away panel where your opponent can choose to read this note and a summary of your thinking; play as you would anyway.

The design docs follow."""

MOVE_TOOL = {
    "name": "make_move",
    "description": "Make your fighter's move for this decision: one or more actions, applied in order.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["actions", "plan"],
        "properties": {
            "actions": {
                "type": "array",
                "description": "The actions, in order.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["key", "amount", "target", "walk"],
                    "properties": {
                        "key": {"type": "string", "description": "An option key, a reaction (take, dodge, block, dodgeBlock, redirect), keep or course, strike or let, offerDraw or withdrawDraw."},
                        "amount": {"type": "number", "description": "Slider value or block size; 0 when there is none."},
                        "target": {"type": "string", "description": "Construct id, \"x:y\", toward or away (Launch), them, or \"\"."},
                        "walk": {"type": "string", "description": "Standing order for walking: keep, stop, toward, hold:N, or \"x:y\"."},
                    },
                },
            },
            "plan": {"type": "string", "description": "A short note to yourself for your next decisions."},
        },
    },
}


def system_blocks():
    docs = []
    for name in DOCS:
        path = ROOT / name
        if path.exists():
            docs.append(f"<doc name=\"{name}\">\n{path.read_text(encoding='utf-8')}\n</doc>")
    return [
        {"type": "text", "text": INSTRUCTIONS},
        # Stable across every decision, so it's cached: later decisions pay a tenth for it.
        {"type": "text", "text": "\n\n".join(docs), "cache_control": {"type": "ephemeral"}},
    ]


def cost_of(model, usage):
    prices = PRICES.get(model)
    if not prices:
        return None
    pin, pout, pread, pwrite = prices
    return (
        usage.input_tokens * pin
        + usage.output_tokens * pout
        + (usage.cache_read_input_tokens or 0) * pread
        + (usage.cache_creation_input_tokens or 0) * pwrite
    ) / 1e6


# ---------------------------------------------------------------------------------------------
# The player


class AutoPlayer:
    def __init__(self, data_dir, write_move):
        self.data_dir = Path(data_dir)
        self.write_move = write_move
        self.lock = threading.Lock()
        self.busy = None  # decision key being thought about
        self.latest = None  # the newest board, to look at again when a thought finishes
        self.tries = {}  # decision key -> {"attempts": n, "sent": move id or None}
        self.plans = {}  # game id -> Claude's note to itself
        self.thoughts = {}  # game id -> Claude's recent decisions: thinking summary, note and move
        self.spent = {}  # game id -> dollars so far
        self.error = ""
        self.client = None
        self.client_key = None

    # Settings are read each time, so adding the key file doesn't need a restart.
    def api_key(self):
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not key:
            try:
                key = (self.data_dir / "anthropic.key").read_text(encoding="utf-8").strip()
            except OSError:
                key = ""
        return key

    def model(self):
        return os.environ.get("CRADLE_CLAUDE_MODEL", "").strip() or DEFAULT_MODEL

    def effort(self):
        return os.environ.get("CRADLE_CLAUDE_EFFORT", "").strip() or DEFAULT_EFFORT

    def problem(self):
        """Why the API player can't play, or '' when it can."""
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return "The server is missing the anthropic package (pip install anthropic)."
        if not self.api_key():
            return f"The server has no Claude API key (set ANTHROPIC_API_KEY or put it in {self.data_dir / 'anthropic.key'})."
        return ""

    def status(self, game_id=None):
        problem = self.problem()
        spent = self.spent.get(game_id)
        return {
            "available": not problem,
            "problem": problem,
            "model": self.model(),
            "thinking": self.busy is not None,
            "error": self.error,
            "spent": None if spent is None else round(spent, 2),
            "thoughts": self.thoughts.get(game_id, []),
        }

    def on_state(self, s):
        """Look at a newly saved board; start thinking if it's Claude's decision."""
        with self.lock:
            self.latest = s
            if s.get("claudeVia") != "api" or not s.get("claudeToAct") or s.get("result"):
                return
            if self.busy or self.problem():
                return
            key = f"{s['gameId']}:{s['decision']}"
            tries = self.tries.get(key)
            if tries:
                # Try again only when the app took our last move and rejected it.
                rejected = tries["sent"] and s.get("error") and s.get("lastMoveId") == tries["sent"]
                if not rejected or tries["attempts"] >= MAX_ATTEMPTS:
                    if rejected:
                        self.error = "Claude couldn't find a valid move. Play this one yourself, or try again."
                    return
            else:
                tries = self.tries[key] = {"attempts": 0, "sent": None}
                if len(self.tries) > 500:
                    self.tries = {key: tries}
            tries["attempts"] += 1
            self.busy = key
            self.error = ""
        threading.Thread(target=self.think, args=(s, key, tries), daemon=True).start()

    def retry(self):
        """Forget the current decision's failed attempts and think again."""
        with self.lock:
            s = self.latest
            self.error = ""
            if s:
                self.tries.pop(f"{s['gameId']}:{s['decision']}", None)
        if s:
            self.on_state(s)

    def think(self, s, key, tries):
        try:
            actions, plan, thinking = self.ask(s)
            move = {"id": uuid.uuid4().hex, "gameId": s["gameId"], "decision": s["decision"], "actions": actions}
            # Record the thought before sending the move, so the app finds it when the move lands.
            recent = self.thoughts.setdefault(s["gameId"], [])
            recent.append({
                "decision": s["decision"],
                "time": s.get("time"),
                "kind": (s.get("prompt") or {}).get("kind"),
                "thinking": thinking,
                "plan": plan,
                "move": ", ".join(a["key"] + (f" {a['amount']:g}" if a["amount"] else "") + (f" @{a['target']}" if a["target"] else "") for a in actions),
            })
            del recent[:-MAX_THOUGHTS]
            if len(self.thoughts) > 20:
                self.thoughts = {s["gameId"]: recent}
            self.write_move(json.dumps(move).encode())
            tries["sent"] = move["id"]
            self.plans[s["gameId"]] = plan
        except Exception as e:  # noqa: BLE001 - anything that goes wrong is shown in the app
            self.error = explain(e)
            print(f"[claude] {key}: {self.error}", flush=True)
        finally:
            with self.lock:
                self.busy = None
                latest = self.latest
            if latest is not s:
                self.on_state(latest)

    def ask(self, s):
        import anthropic

        key = self.api_key()
        if self.client is None or self.client_key != key:
            self.client = anthropic.Anthropic(api_key=key)
            self.client_key = key
        board = describe(s)
        plan = self.plans.get(s["gameId"])
        if plan:
            board += f"\n\nYour note from your last decision: {plan}"
        messages = [{"role": "user", "content": board}]
        model = self.model()
        started = time.time()
        thinking = []
        for _ in range(2):
            response = self.client.beta.messages.create(
                model=model,
                max_tokens=16000,
                system=system_blocks(),
                tools=[MOVE_TOOL],
                messages=messages,
                output_config={"effort": self.effort()},
                # Summaries of Claude's thinking, shown folded away in the app. Without this the
                # model still thinks, but the API leaves the text out.
                thinking={"type": "adaptive", "display": "summarized"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            cost = cost_of(model, response.usage)
            if cost is not None:
                self.spent[s["gameId"]] = self.spent.get(s["gameId"], 0) + cost
            u = response.usage
            print(
                f"[claude] decision {s['decision']}: {time.time() - started:.0f}s, in {u.input_tokens} "
                f"(cache read {u.cache_read_input_tokens or 0}, write {u.cache_creation_input_tokens or 0}), "
                f"out {u.output_tokens}" + (f", ${cost:.3f}" if cost is not None else ""),
                flush=True,
            )
            if response.stop_reason == "refusal":
                raise RuntimeError("Claude declined to answer this one.")
            thinking += [b.thinking for b in response.content if b.type == "thinking" and b.thinking]
            call = next((b for b in response.content if b.type == "tool_use" and b.name == "make_move"), None)
            if call:
                return (*clean(call.input), "\n\n".join(thinking).strip())
            # No move: ask once more, keeping the reply so the history stays as it was.
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": "Please answer by calling make_move."},
            ]
        raise RuntimeError("Claude answered without making a move.")


def clean(move):
    actions = []
    for a in move.get("actions") or []:
        k = str(a.get("key", "")).strip()
        if not k:
            continue
        target = str(a.get("target") or "").strip().lstrip("@")
        actions.append({"key": k, "amount": float(a.get("amount") or 0), "target": target})
    if not actions:
        raise RuntimeError("Claude's move had no actions.")
    return actions, str(move.get("plan") or "")[:600]


def explain(e):
    import anthropic

    if isinstance(e, anthropic.AuthenticationError):
        return "The Claude API refused the key. Check the server's API key."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "The Claude API key isn't allowed to use this model."
    if isinstance(e, anthropic.RateLimitError):
        return "The Claude API is rate-limiting this key. Wait a moment and try again."
    if isinstance(e, anthropic.BadRequestError):
        return f"The Claude API rejected the request: {e.message}"
    if isinstance(e, anthropic.APIStatusError):
        return f"The Claude API had an error ({e.status_code}). Try again."
    if isinstance(e, anthropic.APIConnectionError):
        return "The server couldn't reach the Claude API. Try again."
    return str(e) or type(e).__name__
