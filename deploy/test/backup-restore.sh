#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
work="$(mktemp -d)"
box="$work/box"
receiver=""
export COMPOSE_PROJECT_NAME="melon-backup-test-$$"
cleanup() {
  kill "$receiver" 2> /dev/null || true
  (cd "$work/m" && docker compose down -v > /dev/null 2>&1) || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
pings() {
  cat "$work/pings" 2> /dev/null || true
}
sql() {
  docker compose exec -T db psql -tAqU melon -d melon -c "$1"
}

mkdir -p "$work/m/bin" "$box"
python3 - "$work/pings" > /dev/null 2>&1 <<'PY' &
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        with open(sys.argv[1], "a") as f:
            f.write(self.path + " " + body + "\n")
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args):
        pass
http.server.HTTPServer(("127.0.0.1", 18099), H).serve_forever()
PY
receiver=$!
cp "$repo/deploy/docker-compose.yml" "$repo/deploy/Caddyfile" "$work/m/"
cp "$repo"/deploy/bin/* "$work/m/bin/"
chmod +x "$work/m/bin/"*
cd "$work/m"
printf 'MELON_DOMAIN=:80\nPOSTGRES_PASSWORD=backup-test\nMELON_SERVER_SECRET=backup-test-secret-backup-test-secret-xx\n' > .env
docker compose up -d db > /dev/null 2>&1
for _ in $(seq 60); do
  sql "create table canary(v text); insert into canary values ('original')" > /dev/null 2>&1 && break
  sleep 1
done
[[ "$(sql 'select v from canary')" == original ]] || fail "database did not start"

bin/melon-backup > /dev/null
[[ ! -d offsite ]] || fail "copied without backup.env"

printf 'BACKUP_TARGET=%s/\nBACKUP_SSH_KEY=/none\nBACKUP_RECIPIENTS=%s/m/backup.recipients\nBACKUP_PING_URL=http://127.0.0.1:18099/check\n' "$box" "$work" > backup.env
if bin/melon-backup > /dev/null 2>&1; then fail "copied without recipients"; fi
pings | grep -q '^/check/fail .*no age recipient' || fail "missing recipients were not reported: $(pings)"
echo "# no key" > backup.recipients
if bin/melon-backup > /dev/null 2>&1; then fail "copied with comment-only recipients"; fi
[[ -z "$(ls -A "$box")" ]] || fail "something reached the box without encryption"

age-keygen -o "$work/key.txt" 2> /dev/null
age-keygen -y "$work/key.txt" > backup.recipients
sleep 1
bin/melon-backup > /dev/null
sealed="$(find "$box" -name 'melon-*.dump.age' | head -1)"
[[ -n "$sealed" ]] || fail "no encrypted copy on the box"
[[ "$(pings | tail -1)" == "/check "*copied ]] || fail "success was not reported: $(pings)"
[[ "$(find "$box" -type f ! -name '*.dump.age' | wc -l)" == 0 ]] || fail "plaintext on the box"
[[ "$(head -c 21 "$sealed")" == age-encryption.org/v1 ]] || fail "copy is not age"
if grep -q canary "$sealed"; then fail "table name readable in the copy"; fi

sql "update canary set v='changed'"
if bin/melon-restore "$sealed" --yes > /dev/null 2>&1; then fail "restored without a key"; fi
age-keygen -o "$work/wrong.txt" 2> /dev/null
if bin/melon-restore "$sealed" --yes --identity "$work/wrong.txt" > /dev/null 2>&1; then fail "restored with the wrong key"; fi
[[ "$(sql 'select v from canary')" == changed ]] || fail "wrong key touched the database"
cp "$sealed" "$work/tampered.age"
printf 'X' | dd of="$work/tampered.age" bs=1 seek=200 conv=notrunc 2> /dev/null
if bin/melon-restore "$work/tampered.age" --yes --identity "$work/key.txt" > /dev/null 2>&1; then fail "restored a tampered file"; fi
[[ "$(sql 'select v from canary')" == changed ]] || fail "tampered file touched the database"

bin/melon-restore "$sealed" --yes --identity "$work/key.txt" > /dev/null 2>&1
[[ "$(sql 'select v from canary')" == original ]] || fail "encrypted restore did not bring the data back"
[[ -z "$(find backups -name 'restore-*')" ]] || fail "decrypted temp file left behind"
[[ "$(sql "select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'melon_app'")" == 0 ]] || fail "restored tables do not belong to melon_app"
[[ "$(sql "select rolsuper from pg_roles where rolname = 'melon_app'")" == f ]] || fail "melon_app is a superuser"

before="$(pings | wc -l)"
bin/melon-backup --local > /dev/null
[[ "$(pings | wc -l)" == "$before" ]] || fail "--local pinged"
docker compose stop db > /dev/null 2>&1
if bin/melon-backup > /dev/null 2>&1; then fail "backup succeeded without a database"; fi
pings | tail -1 | grep -q '^/check/fail .*failed in line' || fail "a failed dump was not reported: $(pings)"
if pings | grep -q "$box\|/none"; then fail "ping leaked configuration"; fi

echo "backup and restore: ok"
