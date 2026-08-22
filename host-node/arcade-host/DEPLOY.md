# arcade-host — deploy & operate

> ⚠ **SCOPE / STATUS.** This documents the LEGACY / alternative hosting path — a
> headless-Steam lobby provider (`arcade_host.py`, Python) on the OVH box. It is NOT
> the current shipping host node, and `arcade_host.py` is **not** in this repo. The
> CURRENT path is the bash host-node (`arcade_host.sh` + `arcade_hostd.sh` + the
> `../injector/` proxy `version.dll`), which the Retro Receipts agent **auto-installs**
> when you toggle "Host this machine" — no manual steps. See `README.md` in this dir
> and `../../docs/SEAMLESS-HOST-INSTALL.md`. Kept below for reference on the
> headless-Steam approach (memory `mvc-headless-steam-vps`).

The headless Steam lobby-provider daemon for NOBD ARCADE. Runs on the OVH box
(`15.204.141.58`, user `ubuntu`) alongside the logged-in `nobd_arcade` Steam
client. skinsync (nobd VPS) POSTs to it at wager-lock; it creates/owns the MvC2
lobby and returns the join id + owner id.

See `../docs/ARCADE-WORKSTREAM.md` for the contract this implements.

---

## 0. What's on the box already (inventory, verified 2026-08-19)

- SSH: `ssh -i ~/.ssh/maplecast_automation ubuntu@15.204.141.58` (hostname `ns1012691`, Ubuntu 22.04, Python 3.10.12, up 27 days).
- Proven bot plumbing: `~/lobbymaker/` — `libsteam_api.so` (385 KB, valid ELF, exports every flat lobby verb we need), `md_lobby.py` (ManualDispatch CreateLobby, the code this daemon ports), `create_lobby_test.py`, `steam_test.py`, `responder*.py`, `steam_appid.txt` (=2634890).
- Steam SDK: `~/.steam/sdk64/steamclient.so` symlink in place.
- Steam client login helpers: `~/gui_login.sh` (Xvfb :99 + `/usr/games/steam -login`), `~/launch_steam.sh`, `~/type_creds.sh`; creds in `~/steam_creds.env` (chmod 600, off-repo).
- **Steam client is currently DOWN** (`~/.steam/steam.pid` = 184716 is stale, no steam process running). Xvfb :99 is up (pid 171170). A `tmux srv` session runs the maplecast-flycast training server — leave it alone.
- The daemon file `~/arcade_host.py` was copied here during the Phase-1 smoke test and confirmed to run (loads the real `.so`, attempts `SteamAPI_InitFlat`, serves `/health`). Formalize it into `~/arcade-host/` per below.

---

## 1. Install the daemon on the box

```bash
ssh -i ~/.ssh/maplecast_automation ubuntu@15.204.141.58

mkdir -p ~/arcade-host
# copy arcade_host.py, arcade.env.example, arcade-host.service, test_client.sh
# (scp them from this repo's host-node/arcade-host/ dir, or from the smoke-test copy at ~/arcade_host.py)
cp ~/arcade_host.py ~/arcade-host/arcade_host.py   # if you used the smoke-test copy

cd ~/arcade-host
cp arcade.env.example arcade.env
# generate the shared secret ONCE and paste it in:
openssl rand -hex 32     # -> put in arcade.env as ARCADE_KEY=...
chmod 600 arcade.env
```

From your workstation instead of copying by hand:
```bash
scp -i ~/.ssh/maplecast_automation \
  host-node/arcade-host/arcade_host.py host-node/arcade-host/arcade.env.example \
  host-node/arcade-host/arcade-host.service host-node/arcade-host/test_client.sh \
  ubuntu@15.204.141.58:~/arcade-host/
```

**The SAME `ARCADE_KEY` value must go into `/etc/skinsync.env` on the nobd VPS**
(Phase-2 `arcade.rs` reads it). The key is the only secret; it never enters git.

---

## 2. Bring up the Steam client (manual — this is the human part)

The daemon reports `steam_up:false` until the `nobd_arcade` client is logged in.
Modern Steam ignores `-login user pass` non-interactively, so login is driven with
xdotool + a Steam Guard code (see memory `mvc-headless-steam-vps`). One clean session:

```bash
# never run steamcmd + client at the same time on this account (churn -> lockout)
pkill -f "/usr/games/steam" ; sleep 2
tmux new -s steam                      # persist across SSH disconnect
DISPLAY=:99 ~/gui_login.sh             # brings up Xvfb :99 + steam login form
# screenshot to read the form:  DISPLAY=:99 import -window root /tmp/s.png
# drive the CEF form with xdotool (user -> pass -> Sign in), then type the
# emailed Steam Guard code into the 5-box prompt. Detach: Ctrl-b d
```

Verify the client is logged on:
```bash
ps aux | grep -i steamwebhelper | grep -v grep      # should show processes
cat ~/.steam/steam.pid                              # matches a live pid
```

> Fragility note (from prior sessions): the headless Linux client can wedge (dead
> token, black Xvfb). If login won't take, the fallback for GATE-1 is the real game
> under Proton as the owner (Path B) — but that is a later phase. For Phase-1 the
> daemon is done and correct regardless; it just needs a live client to flip
> `steam_up` true.

---

## 3. Start the daemon

Quick foreground test:
```bash
cd ~/arcade-host
set -a; . ./arcade.env; set +a
python3 arcade_host.py            # Ctrl-C to stop
```

As a service (recommended):
```bash
sudo cp ~/arcade-host/arcade-host.service /etc/systemd/system/arcade-host.service
sudo systemctl daemon-reload
sudo systemctl enable --now arcade-host
systemctl status arcade-host
journalctl -u arcade-host -f
```

Health check (must send the key):
```bash
curl -s -H "X-Arcade-Key: $ARCADE_KEY" http://127.0.0.1:7301/health
# {"ok":true,"steam_up":true,"my_steamid":"7656119...","appid":"2634890","lobbies":[]}
```
`steam_up` will be `false` until step 2 succeeds — that is expected and correct.

---

## 4. Firewall — only the nobd VPS may reach 7301

The daemon binds `0.0.0.0` but must only be reachable from the nobd VPS (where
skinsync runs). Lock it down with ufw:

```bash
NOBD_IP=$(dig +short nobd.net | tail -1)     # confirm this is the skinsync VPS IP
sudo ufw allow 22/tcp
sudo ufw allow from "$NOBD_IP" to any port 7301 proto tcp
sudo ufw deny 7301/tcp                        # everyone else blocked
sudo ufw enable
sudo ufw status verbose
```

If ufw is not desired, an iptables equivalent:
```bash
sudo iptables -A INPUT -p tcp --dport 7301 -s "$NOBD_IP" -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 7301 -j DROP
```

The `X-Arcade-Key` header is the second layer; the firewall is the first. Do not
rely on the key alone.

---

## 5. GATE-1 live probe (the one hard gate)

Goal: bot creates a real lobby → owner clicks the link → does the game enter the
lobby and start a set? Prereq: step 2 done (`steam_up:true`).

On the box (or from the nobd VPS with `HOST=15.204.141.58:7301`):
```bash
cd ~/arcade-host
KEY=$(sed -n 's/^ARCADE_KEY=//p' arcade.env)

# 1) create the probe lobby (FT2, room for owner + 2 players + a spectator)
HOST=127.0.0.1:7301 KEY=$KEY ./test_client.sh create 2 4 gate1-probe
# -> {"ok":true,"lobby_id":"1097752...","owner_steamid":"7656119..."}

# 2) build the join link and give it to the owner + one more player:
#    steam://joinlobby/2634890/<lobby_id>/<owner_steamid>

# 3) owner clicks it -> WATCH: does MvC open, land in the lobby, and can a set start?
#    (health lists the live lobby; members can be confirmed later via memory-read)
HOST=127.0.0.1:7301 KEY=$KEY ./test_client.sh health

# 4) tear down
HOST=127.0.0.1:7301 KEY=$KEY ./test_client.sh close <lobby_id>
```

Pass = the game enters a bot-owned lobby and a set runs (owner-independent P2P, per
memory `mvc-lobby-p2p-re`). If it fails: fallback A = bot feeds the type-5 first
packet (wire notes in `mvc-headless-steam-vps`), fallback B = real game under Proton
as owner. The daemon's HTTP contract is unchanged either way — the lobby *provider*
is swappable behind these four routes.

---

## 6. HTTP contract (quick reference)

Every route requires header `X-Arcade-Key: <ARCADE_KEY>` (401 otherwise).

| Route | Body | Success |
|---|---|---|
| `POST /lobby/create` | `{ft, size, passcode?, tag}` | `{ok:true, lobby_id, owner_steamid}` |
| `POST /lobby/kick` | `{lobby_id, steamid}` | `{ok:true, method, note}` (best-effort, see below) |
| `POST /lobby/close` | `{lobby_id}` | `{ok:true}` |
| `GET /health` | — | `{ok, steam_up, my_steamid, appid, lobbies:[…]}` |

- ids are returned as **strings** (avoid JS 64-bit precision loss).
- `passcode` present ⇒ lobby is created **FriendsOnly** (unlisted) and the passcode
  is stored as lobby data; absent ⇒ **Public**. Players join by the direct
  `steam://joinlobby` link regardless, so an unlisted lobby is the right default for
  wagers.
- Steam down ⇒ `create/kick/close` return **503 `steam_down`**; skinsync must
  **fail open** (fall back to challenger-hosted flow) per the workstream contract.
- **Kick caveat:** Steamworks has **no host-force-kick** for lobbies. `/lobby/kick`
  sets a `Kicked_<steamid>` lobby-data marker and broadcasts a `SendLobbyChatMsg`
  kick message; true removal needs the game-protocol path (open RE item). Honest
  status: soft-kick only today.
