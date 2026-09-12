# Setup — Local Development Environment

Everything needed to get this project's toolchain running, and the non-obvious
problems that cost time the first time round.

## Current environment

| Component | Value |
|---|---|
| n8n | 2.35.7, global npm install (`/c/nvm4w/nodejs/n8n`) |
| n8n data | `~/.n8n/database.sqlite` |
| n8n URL | `http://127.0.0.1:5678` |
| Node.js | v22.23.2 |
| n8n-mcp | 2.84.4, global npm install |
| OS | Windows 11 Home |

## Starting n8n

```powershell
cd "C:\Users\Muhammad Waleed\Desktop\Axiolyn Lead Automation"
powershell -ExecutionPolicy Bypass -File .\scripts\start-n8n.ps1
```

Runs in the foreground. The window must stay open — closing it or pressing
Ctrl+C stops n8n, and everything else in this project then fails with
connection errors.

## Gotchas

### Never set `N8N_ENCRYPTION_KEY` on this machine

A key already exists in `~/.n8n/config`. Setting a different value makes every
saved credential undecryptable. `scripts/start-n8n.ps1` deliberately omits it.

When migrating to always-on hosting, copy the existing value across and set it
explicitly there, so recreating the container does not break credentials.

### n8n-mcp blocks localhost by default

Symptom:

```
SSRF protection: Localhost access is blocked in strict mode
```

n8n-mcp validates outbound URLs against SSRF rules. `WEBHOOK_SECURITY_MODE`
defaults to `strict`, which blocks both localhost and private IPs.

| Mode | Localhost | Private IPs |
|---|---|---|
| `strict` (default) | blocked | blocked |
| `moderate` | **allowed** | blocked |
| `permissive` | allowed | allowed |

`moderate` is the minimum that works for a local n8n, so that is what this
project uses. `permissive` is unnecessary and weakens protection for no gain.

### MCP env changes need a Claude Code restart

`claude mcp add` writes to `~/.claude.json` immediately, but the MCP server
process is spawned at session start. Changing env vars mid-session leaves the
running process on the old values — the config looks right while the behaviour
is stale. Restart Claude Code after any `claude mcp add`/`remove`.

### First `npx n8n-mcp` run times out

The package pulls a large node database on first use, which exceeds the 30s MCP
connection timeout. Installing globally (`npm install -g n8n-mcp`) and pointing
the config at the `n8n-mcp` binary rather than `npx` avoids this permanently.

### No SMTP means no password recovery

n8n has no mail server configured, so the "forgot password" email link does
nothing. The only recovery path is:

```powershell
# stop n8n first — it holds a lock on the SQLite file
n8n user-management:reset
```

This returns the instance to first-run state. It clears users; workflows and
credentials are untouched. Keep the login credentials somewhere safe.

## Reconnecting the MCP from scratch

```bash
npm install -g n8n-mcp

claude mcp add n8n-mcp \
  -e MCP_MODE=stdio \
  -e LOG_LEVEL=error \
  -e DISABLE_CONSOLE_OUTPUT=true \
  -e WEBHOOK_SECURITY_MODE=moderate \
  -e N8N_API_URL=http://127.0.0.1:5678 \
  -e N8N_API_KEY=<key from n8n Settings -> n8n API> \
  -- n8n-mcp
```

Then restart Claude Code and confirm with `n8n_health_check`. A healthy result
reports `connected: true` and an n8n version.

## Verifying the API key by hand

```bash
# expect 200 with a JSON body
curl -H "X-N8N-API-KEY: $KEY" http://127.0.0.1:5678/api/v1/workflows?limit=5

# expect 401 "'X-N8N-API-KEY' header required"
curl http://127.0.0.1:5678/api/v1/workflows
```

Useful for telling an auth problem apart from an SSRF or connectivity problem,
since the MCP reports both as a generic connection failure.
