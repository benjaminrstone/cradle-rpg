---
name: prod-ops
description: Check, roll back, or debug the hosted Cradle Duel site (cradle.ben-stone.xyz on Ben's EC2 box, shared with shattered-lands and Foundry), or play Ben there through the Claude sync. Deploys are automatic on push to main. Use for production status, deploy failures, server logs, rollback, or the sync key.
---

# Production ops: Cradle Duel on Ben's EC2 box

| | |
| --- | --- |
| site | https://cradle.ben-stone.xyz |
| pm2 name | `cradle` (python3 `serve.py 3010`) |
| port | 3010, behind nginx (`/etc/nginx/sites-enabled/cradle`, certbot TLS) |
| release | `/srv/cradle/current/` (previous release in `/srv/cradle/previous/`) |
| data | `/srv/cradle/data/`: `.duel/` (Claude sync), `fights/` (saved fights), `sync.key` |

- SSH alias `sl` reaches the box. Use the Bash tool for ssh.
- **Read-only checks: run freely.** Anything that changes the box (sudo, nginx, files outside a deploy): give Ben a paste block.
- The same box runs shattered-lands (3000, 3001) and Foundry. Don't touch their pm2 apps or nginx sites.

## Deploys

A push to `main` touching the app (`index.html`, `styles.css`, `src/**`, `serve.py`, `ecosystem.config.cjs`, the workflow) runs `.github/workflows/deploy.yml`: it checks every module parses, ships a tarball, swaps it in as `current/`, reloads pm2 and polls `127.0.0.1:3010`. A failed health check restores `previous/`. Docs-only pushes don't deploy. Re-run by hand: `gh workflow run deploy.yml`; check with `gh run list --workflow=deploy.yml --limit 3`.

Secrets on the repo: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` (the same values as shattered-lands').

## Status checks (read-only)

```bash
ssh sl 'pm2 describe cradle | head -20'
ssh sl 'pm2 logs cradle --lines 40 --nostream'
curl -sS -o /dev/null -w '%{http_code}\n' https://cradle.ben-stone.xyz/
curl -sS https://cradle.ben-stone.xyz/api/version
```

## Rollback (paste block for Ben)

```bash
ssh sl 'cd /srv/cradle && mv current broken && mv previous current && pm2 restart cradle'
```

## Playing Ben on the hosted site

The sync endpoints need the key in `/srv/cradle/data/sync.key`. Locally, `.duel/remote.json` (gitignored) holds `{"url": "https://cradle.ben-stone.xyz", "key": "..."}`. Add `--remote` to the duel scripts:

```bash
python tools/duel_wait.py --remote --timeout 3600
python tools/duel_move.py --remote strike
```

In the browser, the app asks for the key the first time Ben sets "Claude plays", and remembers it.
