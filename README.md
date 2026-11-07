# Cradle Duel

A dueling game set in Will Wight's Cradle, played on a shared initiative timeline, with a browser app to play it.

- **Design:** `seed.md` (the overview), `battlefield.md`, `stats.md`, `techniques.md`, `paths.md`, `traits.md`.
- **App:** `index.html`, `styles.css`, `src/` (vanilla ES modules, no build step), served by `serve.py`. `claude_player.py` lets Claude play through the API.
- **Hosted at** https://cradle.ben-stone.xyz. Pushes to `main` that touch the app deploy automatically (`.github/workflows/deploy.yml`; ops notes in `.claude/skills/prod-ops/`).

## Run it locally

```bash
python serve.py 8123
```

Then open http://localhost:8123. Fights, builds and custom Paths are saved in the browser.

## Regression check

```bash
node tests/regress.mjs
```

Plays a few hundred seeded random fights and checks every preview, projection, reaction and resulting state against `tests/baseline.json`. A refactor should leave it matching; after an intended rule change, rerun with `--update` to save a new baseline (and `--dump DIR` on the old and new code to diff exactly what changed).

## Playing against Claude

Set "Claude plays" in the app, and pick how:

- **via the API:** the server asks the Claude API for each move, so no chat is needed. It needs `pip install anthropic` and a Claude API key, either in `ANTHROPIC_API_KEY` or in the file `anthropic.key` next to `serve.py` (`<CRADLE_DATA>/anthropic.key` on the hosted site). It uses Claude Opus 5.5 at medium effort; set `CRADLE_CLAUDE_MODEL` or `CRADLE_CLAUDE_EFFORT` to change that. The app shows what each fight has cost so far, and a folded "Claude's thinking" panel holds a summary of Claude's thinking, its note to itself, and its move for each recent decision.
- **via a chat:** Claude reads the board and sends moves with `tools/duel_wait.py` and `tools/duel_move.py` (add `--remote` to play on the hosted site; see `tools/duelsync.py`).
