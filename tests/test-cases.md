# Test cases: OpenClaw Jelastic package

Manifest: `manifest.jps` v1.8  
Docs: [OpenClaw documentation](https://docs.openclaw.ai/)

**Automated:** `./tests/smoke-test.sh` (run on cp node via SSH)  
**Manual:** browser, demo, and optional API-key scenarios below

---

## Priority matrix

| Priority | When |
|----------|------|
| **P0** | Every release, before demo |
| **P1** | After changes to `start.sh`, credentials, or gateway config |
| **P2** | Full QA, optional features |

---

## Block A — Package deployment (PKG)

| ID | Priority | Type | Title | Steps | Expected |
|----|----------|------|-------|-------|----------|
| PKG-01 | P0 | Manual | Clean install | Install package in Jelastic → wait for Success | Access card with Token (`oc_…`) and Password (`pw_…`) |
| PKG-02 | P0 | Manual | Unique credentials | Install two separate environments | Token and Password differ between envs |
| PKG-03 | P0 | Auto | Container running | `docker ps --filter name=openclaw` | Status `Up`, restart policy `unless-stopped` |
| PKG-04 | P0 | Auto | Runtime image | `docker images \| grep openclaw-node` | Image `openclaw-node:22-bullseye-slim` present |
| PKG-05 | P0 | Auto | Persistent directories | `ls /data/openclaw/` | `workspace/`, `devices/`, `start.sh` exist |
| PKG-06 | P0 | Auto | HTTP health | `curl http://127.0.0.1:80/` | HTTP 2xx |
| PKG-07 | P0 | Auto* | Token in config | Pass `--token` from access card | `gateway.auth.token` matches access card |
| PKG-08 | P0 | Auto | Port mapping | `docker port openclaw` | `18789/tcp → 0.0.0.0:80` |
| PKG-09 | P1 | Manual | HTTPS via platform | Open `https://${env.domain}/` | Valid SSL, UI loads |
| PKG-10 | P1 | Manual | Redeploy preserves state | Add file to workspace → Redeploy | Data and credentials unchanged |

\* PKG-07 requires `--token` or `OPENCLAW_EXPECTED_TOKEN`.

---

## Block B — OpenClaw gateway & Control UI (OC)

| ID | Priority | Type | Title | Steps | Expected |
|----|----------|------|-------|-------|----------|
| OC-01 | P0 | Manual | Control UI accessible | Open startPage / Open in browser | Web Control UI loads, no auth error |
| OC-02 | P0 | Auto | Gateway bind | `openclaw config get gateway.bind` | `lan` |
| OC-03 | P0 | Auto | Gateway mode | `openclaw config get gateway.mode` | `local` |
| OC-04 | P0 | Auto | Auth mode | `openclaw config get gateway.auth.mode` | `token` |
| OC-05 | P1 | Manual | Invalid token rejected | Open URL with `#token=oc_invalid` | Access denied |
| OC-06 | P1 | Manual | Repeat browser login | Close tab → reopen startPage | Session restores |
| OC-07 | P0 | Manual | First device auto-approved | First browser login after install | No manual `devices approve` |
| OC-08 | P0 | Auto/Manual | Devices list | `openclaw devices list` | Output after first login; browser device approved |
| OC-09 | P0 | Auto | Device approval log | `cat /tmp/openclaw-device-approval.log` | No critical errors |
| OC-10 | P1 | Manual | New device after restart | `docker restart openclaw` → new browser profile | Document actual behavior (known regression risk) |
| OC-11 | P0 | Manual | Chat in UI | Send message in Control UI | Agent response within ~30s |
| OC-12 | P1 | Manual | Session persistence | Refresh page | Chat history preserved |
| OC-13 | P2 | Manual | New session | Create new chat/session in UI | Isolated conversation |
| OC-14 | P1 | Manual | Install without API key | No GEMINI/OPENROUTER keys | Gateway and UI work; model may error |
| OC-15 | P1 | Manual | Gemini model | Set `GEMINI_API_KEY` before install | Model `google/gemini-2.5-flash`, OC-11 works |
| OC-16 | P1 | Manual | OpenRouter model | Set `OPENROUTER_API_KEY` only | Model `openrouter/auto`, OC-11 works |
| OC-17 | P2 | Manual | Model change in UI | Change model in UI/config | Responses reflect new model |
| OC-18 | P0 | Auto | Config directory | Check `/home/node/.openclaw` in container | Directory exists |
| OC-19 | P0 | Auto | Trusted proxies | `openclaw config get gateway.trustedProxies` | Contains `127.0.0.1` |
| OC-20 | P2 | Manual | Config via UI | Change setting in UI → refresh | Setting persisted |
| OC-21 | P1 | Manual | Update addon | Add-ons → Update OpenClaw to Latest | Completes; version ≥ previous |
| OC-22 | P1 | Manual | UI after update | OC-01 + OC-11 after addon | Same token, UI works |
| OC-23 | P1 | Manual | Container restart | `docker restart openclaw` | UI back within ~2 min |
| OC-24 | P2 | Manual | cp node restart | Restart Docker node | Container auto-starts |
| OC-25 | P2 | Manual | No public IP | `extip: false` | Access only via domain, not raw IP |

---

## Block C — Demo script (manual)

Run after P0 smoke passes. Reference: [docs.openclaw.ai](https://docs.openclaw.ai/)

| Step | Time | Action | Fallback |
|------|------|--------|----------|
| 1 | 2 min | Overview: self-hosted AI gateway | Show docs Overview |
| 2 | 2 min | Jelastic one-click install | Pre-installed env |
| 3 | 1 min | Unique token in access card | Screenshot |
| 4 | 2 min | Open in browser → Control UI | Manual URL with `#token=` |
| 5 | 3 min | Tour UI: chat, settings | Screenshot |
| 6 | 4 min | Live prompt: *Explain OpenClaw gateway in 3 bullets* | Pre-written answer |
| 7 | 2 min | Self-hosted: `docker ps`, `/data/openclaw` | UI only |
| 8 | 2 min | Device pairing concept + `devices list` | Explain from docs |
| 9 | 2 min | Update addon (mention or run) | Mention only |
| 10 | 1 min | Q&A, links to docs | — |

**Demo prompts**

1. *What is the OpenClaw Gateway and how does it connect chat apps to AI agents?*
2. *List 3 channels OpenClaw supports.*
3. *Write a one-line bash command to check if the gateway is running on port 18789.*

---

## Block D — Negative / edge cases

| ID | Priority | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| NEG-01 | P2 | skopeo / image load failure | Block network during install | Install fails with clear error |
| NEG-02 | P2 | Container removed | `docker rm -f openclaw` | Recoverable via redeploy |
| NEG-03 | P2 | Multiple pending devices | Two pairing requests at once | Document approver behavior |
| NEG-04 | P2 | Invalid bootstrap URL | Open stale/wrong bootstrap link | No access without valid token |

---

## Go / No-Go checklist

```
[ ] PKG-01  Install success
[ ] PKG-02  Unique credentials
[ ] PKG-03  Container running (smoke-test.sh)
[ ] PKG-06  HTTP health (smoke-test.sh)
[ ] PKG-07  Token match (smoke-test.sh --token ...)
[ ] PKG-09  HTTPS / domain
[ ] OC-01   Browser auto-login
[ ] OC-07   Device auto-approved
[ ] OC-11   Chat response (with API key)
[ ] PKG-10  Redeploy preserves data
```

---

## Mapping: test ID → smoke-test.sh

| Test ID | Automated in smoke-test.sh |
|---------|----------------------------|
| PKG-03 | Yes |
| PKG-04 | Yes |
| PKG-05 | Yes |
| PKG-06 | Yes |
| PKG-07 | Yes (with `--token`) |
| PKG-08 | Yes |
| PKG-09 | Yes (with `--domain`) |
| OC-02, OC-03, OC-04, OC-19 | Yes |
| OC-08, OC-09, OC-18 | Yes (partial) |
| All other IDs | Manual |
