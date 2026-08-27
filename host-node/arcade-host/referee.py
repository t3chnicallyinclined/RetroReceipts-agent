#!/usr/bin/env python3
# referee.py — the HOST NODE's match referee. Watches the money match this cabinet was assigned
# (server tells us via the heartbeat's `assigned`: wager_id + both fighters' SteamIDs + best_of),
# counts games off the game's own per-set win tally, and reports the finished set to the server
# (POST /skinsync/arcade/host/report {winner, loser, wgames, lgames}) — closing the loop that makes
# a refereed money match settle with a real score even when neither player runs the app.
#
# Memory reads are the LIVE-VALIDATED monitor (mvc_match_mon.py, proven 2026-08-16 on this box),
# ported as-is: session ptr *(exe+0xacd3a8) → standby @+0x1cd (1 = a game is being fought);
# set-score ptr *(exe+0x2edf628) → win tally +0xbc (seat P1) / +0xbd (seat P2), persists post-game.
#
# ── THE MONEY GATE ──────────────────────────────────────────────────────────────────────────────
# Reporting decides who gets PAID, and the one unproven link is seat→SteamID: which fighter is the
# tally's "P1"? Until that mapping is validated live, this runs in OBSERVE mode: it counts the set,
# logs exactly what it WOULD report (plus seat-evidence scans of where each SteamID sits in the
# session block, to lock the mapping), and never POSTs. To arm reporting AFTER validation, set BOTH
# in the service env:   REFEREE_SEAT_P1=challenger|acceptor   REFEREE_REPORT=1
# Game counting is delta-based (tally value at game start vs end), so it is correct whether the
# tally accumulates across the set or resets per game. Anomalies (both seats ticked, none ticked,
# tally went down) are logged and NOT counted — a miscounted game must never reach a report.
#
# State: referee_state.json next to this script — durable across restarts mid-set, and read by
# arcade_hostd.sh to feed the heartbeat's `active` flag (which also drives the server's rail
# betting-close latch for refereed matches). Assignment comes from assigned_resp.json (the raw
# heartbeat reply hostd dumps each tick). Single file, stdlib only, 1s poll — keep it simple.
import glob, json, os, struct, sys, time, urllib.request

EXE = "MarvelVsCapcomFightingCollection.exe"
OFF_SESSION_PTR = 0xacd3a8
OFF_SETSCORE_PTR = 0x2edf628
S_STANDBY = 0x1cd
# GGPO player->seat map (replay lane, UNVERIFIED ONLINE: reads (0,0,0,0) in every offline mode ever
# measured; the whole point of logging it here is the first-ever capture during a REAL online match).
OFF_GGPO_SEATMAP = 0xAC6F98  # exe+this: 4 x i32, GGPO player k -> seat index (-1 = unmapped)
SEAT_SCAN_SPAN = 0xE0000  # bounded session-block window for the SteamID seat-evidence scan

DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(DIR, "referee_state.json")
ASSIGNED_PATH = os.path.join(DIR, "assigned_resp.json")
TOKEN_PATH = os.path.expanduser("~/.metasync_host_token")
HOST = os.environ.get("METASYNC_HOST", "https://nobd.net")
REPORT_ARMED = os.environ.get("REFEREE_REPORT", "0") == "1"
SEAT_P1 = os.environ.get("REFEREE_SEAT_P1", "")  # "challenger" | "acceptor" — locked by live validation


def log(msg):
    print("[referee] %s %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


# ── memory access (ported verbatim from the validated mvc_match_mon.py) ─────────────────────────
def find_pid():
    for p in glob.glob("/proc/[0-9]*"):
        try:
            if EXE.lower() in open(p + "/maps").read().lower():
                return int(os.path.basename(p))
        except Exception:
            pass
    return None


def base_of(pid):
    for line in open("/proc/%d/maps" % pid):
        if EXE.lower() in line.lower() and " r" in line[:40]:
            return int(line.split("-")[0], 16)
    return None


class Mem:
    def __init__(self, pid):
        self.f = open("/proc/%d/mem" % pid, "rb", 0)

    def rd(self, a, n):
        try:
            self.f.seek(a)
            b = self.f.read(n)
            return b if len(b) == n else None
        except Exception:
            return None

    def u8(self, a):
        b = self.rd(a, 1)
        return b[0] if b else None

    def u64(self, a):
        b = self.rd(a, 8)
        return struct.unpack("<Q", b)[0] if b else None

    def i32x4(self, a):
        b = self.rd(a, 16)
        return list(struct.unpack("<4i", b)) if b else None


# ── assignment (from the heartbeat reply hostd dumps) ───────────────────────────────────────────
# FRESHNESS GATE (defense-in-depth with the unit's one-way PartOf coupling): hostd dumps the reply
# every ~8-10s, so a file older than 60s means the daemon is dead or wedged — its frozen last
# assignment must NOT keep the referee counting a stale wager against whatever match is on screen.
# ⚠ LOAD-BEARING SHAPE (Bazzite-expert review 2026-08-27): the stale case returns None INSIDE the
# loop — the referee IDLES INERT, it never exits. Since the unit coupling is deliberately one-way
# (no Requires=), "referee running alone against a daemon that never came up" is a REACHABLE state,
# and this gate is what makes it safe. Do NOT "tidy" this into an exit: under Restart=always an
# exit-on-stale becomes a 5-second flap loop.
ASSIGNED_MAX_AGE_S = 60


def read_assignment():
    try:
        if time.time() - os.path.getmtime(ASSIGNED_PATH) > ASSIGNED_MAX_AGE_S:
            return None
        d = json.load(open(ASSIGNED_PATH))
        a = d.get("assigned") or {}
        if a.get("kind") == "wager" and a.get("p1") and a.get("p2"):
            ft = (int(a.get("best_of", 5)) + 1) // 2
            return {"wid": a["wager_id"], "p1": a["p1"], "p2": a["p2"], "ft": max(1, ft)}
    except Exception:
        pass
    return None


def save_state(st):
    st["ts"] = time.time()
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f)
    os.replace(tmp, STATE_PATH)  # atomic — hostd reads this concurrently


def fresh_state(wid):
    # base = the tally values at assignment time — ticks are counted RELATIVE to it, so a stale
    # pre-assignment tally can never leak games into a new set.
    return {"wid": wid, "standby": 0, "s1": 0, "s2": 0, "games": [], "done": False,
            "seat_evidence": [], "base": None, "ggpo": None}


# ── seat evidence: where do the two assigned SteamIDs sit inside the session block? ─────────────
# The host knows both fighters' ids — scan a bounded window once per set and log the offsets. After
# one live validation ("player X was P1") the stable offset pair locks REFEREE_SEAT_P1 for good.
def seat_scan(mem, sess, sid1, sid2):
    hits = []
    targets = {int(sid1): "p1_sid", int(sid2): "p2_sid"}
    for off in range(0, SEAT_SCAN_SPAN, 0x1000):
        blk = mem.rd(sess + off, 0x1000)
        if not blk:
            continue
        for i in range(0, 0x1000 - 7, 8):
            v = struct.unpack_from("<Q", blk, i)[0]
            if v in targets:
                hits.append({"role": targets[v], "off": hex(off + i)})
                if len(hits) >= 16:
                    return hits
    return hits


# ── reporting (server is idempotent; "already" is success) ──────────────────────────────────────
def report(winner, loser, wg, lg):
    try:
        token = open(TOKEN_PATH).read().strip()
    except Exception:
        log("REPORT BLOCKED: no host token at %s" % TOKEN_PATH)
        return False
    body = json.dumps({"winner": winner, "loser": loser, "wgames": wg, "lgames": lg}).encode()
    req = urllib.request.Request(
        HOST + "/skinsync/arcade/host/report", data=body, method="POST",
        headers={"content-type": "application/json", "authorization": "Bearer " + token},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                resp = r.read().decode()
            log("report -> %s" % resp[:200])
            if '"ok":true' in resp.replace(" ", ""):
                return True
        except Exception as e:
            log("report attempt %d failed: %s" % (attempt + 1, e))
        time.sleep(10)
    return False


def main():
    log("start (mode=%s, seat_p1=%r)" % ("ARMED" if REPORT_ARMED and SEAT_P1 else "OBSERVE", SEAT_P1))
    st = None
    snap = None  # (t1, t2) tallies at game start
    while True:
        time.sleep(1)
        asg = read_assignment()
        if not asg:
            if st is not None:
                log("assignment cleared — reset")
                st, snap = None, None
                save_state({"wid": "", "standby": 0, "done": False})
            continue
        if st is None or st["wid"] != asg["wid"]:
            log("assigned %s: %s vs %s FT%d" % (asg["wid"], asg["p1"], asg["p2"], asg["ft"]))
            st, snap = fresh_state(asg["wid"]), None
            save_state(st)

        pid = find_pid()
        if not pid:
            continue
        try:
            mem = Mem(pid)
            base = base_of(pid)
            sess = mem.u64(base + OFF_SESSION_PTR) or 0
            sc = mem.u64(base + OFF_SETSCORE_PTR) or 0
            standby = (mem.u8(sess + S_STANDBY) or 0) if sess else 0
            t1 = (mem.u8(sc + 0xBC) or 0) if sc else 0
            t2 = (mem.u8(sc + 0xBD) or 0) if sc else 0
        except Exception as e:
            log("read error: %s" % e)
            continue

        # ── game counting: TALLY-TICK based, not standby-edge based. The standby flag was only
        # ever live-validated across a SINGLE-game set; if it stays high across a multi-game FT,
        # edge-paired deltas would see one 3-1 jump at the end and (correctly) refuse it. A tally
        # tick of exactly +1 on exactly one seat IS a game result (validated: "VICTORY = win-tally
        # ticks at match end") whenever it happens. Standby stays as the active flag + logging.
        if st["base"] is None and sc:
            st["base"] = [t1, t2]
            save_state(st)
        if st["base"] is not None and sc:
            b1, b2 = st["base"]
            d1, d2 = t1 - b1, t2 - b2
            if d1 < 0 or d2 < 0:
                log("tally reset (%d,%d) -> (%d,%d) — new match block, re-baselined" % (b1, b2, t1, t2))
                st["base"] = [t1, t2]
                save_state(st)
            elif d1 + d2 > 0:
                if d1 == 1 and d2 == 0:
                    st["s1"] += 1
                elif d2 == 1 and d1 == 0:
                    st["s2"] += 1
                else:
                    log("ANOMALY: tally jumped p1=%+d p2=%+d in one poll — NOT counted, re-baselined" % (d1, d2))
                st["games"].append({"t": int(time.time()), "d1": d1, "d2": d2})
                st["base"] = [t1, t2]
                log("game result — set score seatP1 %d : %d seatP2 (FT%d)" % (st["s1"], st["s2"], asg["ft"]))
                save_state(st)

        if standby != st["standby"]:
            if standby == 1:  # game start: log + first game runs the seat scan + the GGPO probe
                log("game start (tallies %d-%d)" % (t1, t2))
                if sess and not st["seat_evidence"]:
                    ev = seat_scan(mem, sess, asg["p1"], asg["p2"])
                    st["seat_evidence"] = ev
                    log("seat evidence: %s" % json.dumps(ev))
                # 🔬 replay-lane request: first-ever ONLINE capture of the GGPO player->seat map.
                gm = mem.i32x4(base + OFF_GGPO_SEATMAP)
                st["ggpo"] = gm
                log("ggpo seat map (G+0x258): %s" % gm)
            st["standby"] = standby
            save_state(st)

        if not st["done"] and max(st["s1"], st["s2"]) >= asg["ft"]:
            p1_wins = st["s1"] > st["s2"]
            wg, lg = (st["s1"], st["s2"]) if p1_wins else (st["s2"], st["s1"])
            if REPORT_ARMED and SEAT_P1 in ("challenger", "acceptor"):
                # seat P1 = the configured fighter; assignment's p1 field IS the challenger
                seat1_sid = asg["p1"] if SEAT_P1 == "challenger" else asg["p2"]
                seat2_sid = asg["p2"] if SEAT_P1 == "challenger" else asg["p1"]
                winner, loser = (seat1_sid, seat2_sid) if p1_wins else (seat2_sid, seat1_sid)
                log("SET COMPLETE %d-%d — reporting winner=%s" % (wg, lg, winner))
                report(winner, loser, wg, lg)
            else:
                log("OBSERVE: set complete seatP1 %d-%d seatP2 — WOULD report (seat map unvalidated; evidence=%s)"
                    % (st["s1"], st["s2"], json.dumps(st["seat_evidence"])))
            st["done"] = True
            save_state(st)


if __name__ == "__main__":
    main()
