#!/usr/bin/env bash
# arcade-host smoke/probe client. Run from anywhere that can reach the daemon.
#   HOST=127.0.0.1:7301 KEY=<arcade_key> ./test_client.sh health
#   HOST=15.204.141.58:7301 KEY=<arcade_key> ./test_client.sh create 2 4 probe-set
#   ... create <ft> <size> <tag> [passcode]
#   ... close  <lobby_id>
#   ... kick   <lobby_id> <steamid>
set -euo pipefail
HOST="${HOST:-127.0.0.1:7301}"
KEY="${KEY:?set KEY=<arcade_key>}"
CMD="${1:-health}"
H=(-s -H "X-Arcade-Key: ${KEY}" -H "Content-Type: application/json")

case "$CMD" in
  health)
    curl "${H[@]}" "http://${HOST}/health"; echo ;;
  create)
    FT="${2:-2}"; SIZE="${3:-4}"; TAG="${4:-probe}"; PASS="${5:-}"
    if [ -n "$PASS" ]; then
      BODY=$(printf '{"ft":%s,"size":%s,"tag":"%s","passcode":"%s"}' "$FT" "$SIZE" "$TAG" "$PASS")
    else
      BODY=$(printf '{"ft":%s,"size":%s,"tag":"%s"}' "$FT" "$SIZE" "$TAG")
    fi
    echo "POST /lobby/create $BODY"
    curl "${H[@]}" -d "$BODY" "http://${HOST}/lobby/create"; echo ;;
  close)
    LID="${2:?need lobby_id}"
    curl "${H[@]}" -d "$(printf '{"lobby_id":"%s"}' "$LID")" "http://${HOST}/lobby/close"; echo ;;
  kick)
    LID="${2:?need lobby_id}"; SID="${3:?need steamid}"
    curl "${H[@]}" -d "$(printf '{"lobby_id":"%s","steamid":"%s"}' "$LID" "$SID")" "http://${HOST}/lobby/kick"; echo ;;
  *)
    echo "usage: $0 {health|create <ft> <size> <tag> [passcode]|close <lobby_id>|kick <lobby_id> <steamid>}" >&2
    exit 1 ;;
esac
