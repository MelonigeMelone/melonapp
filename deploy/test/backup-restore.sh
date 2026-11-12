#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
work="$(mktemp -d)"
box="$work/box"
export COMPOSE_PROJECT_NAME="melon-backup-test-$$"
cleanup() {
  (cd "$work/m" && docker compose down -v > /dev/null 2>&1) || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
sql() {
  docker compose exec -T db psql -tAqU melon -d melon -c "$1"
}

mkdir -p "$work/m/bin" "$box"
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

printf 'BACKUP_TARGET=%s/\nBACKUP_SSH_KEY=/none\nBACKUP_RECIPIENTS=%s/m/backup.recipients\n' "$box" "$work" > backup.env
if bin/melon-backup > /dev/null 2>&1; then fail "copied without recipients"; fi
echo "# no key" > backup.recipients
if bin/melon-backup > /dev/null 2>&1; then fail "copied with comment-only recipients"; fi
[[ -z "$(ls -A "$box")" ]] || fail "something reached the box without encryption"

age-keygen -o "$work/key.txt" 2> /dev/null
age-keygen -y "$work/key.txt" > backup.recipients
sleep 1
bin/melon-backup > /dev/null
sealed="$(find "$box" -name 'melon-*.dump.age' | head -1)"
[[ -n "$sealed" ]] || fail "no encrypted copy on the box"
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

echo "backup and restore: ok"
