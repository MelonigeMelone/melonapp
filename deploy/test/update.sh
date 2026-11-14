#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
version="${MELON_TEST_VERSION:-0.3.0}"
work="$(mktemp -d)"
export COMPOSE_PROJECT_NAME="melon-update-test-$$"
cleanup() {
  (cd "$work/m" && docker compose down -v > /dev/null 2>&1) || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
setting() {
  sed -n "s/^$1=//p" .env
}
healthy() {
  docker compose exec -T caddy wget -qO- http://server:8080/health > /dev/null 2>&1
}
source_with() {
  rm -rf "$work/src"
  mkdir -p "$work/src/v$version/deploy/bin"
  cp "$repo/deploy/docker-compose.yml" "$repo/deploy/Caddyfile" "$work/src/v$version/deploy/"
  cp "$repo"/deploy/bin/* "$work/src/v$version/deploy/bin/"
}

mkdir -p "$work/m/bin"
cp "$repo/deploy/docker-compose.yml" "$repo/deploy/Caddyfile" "$work/m/"
cp "$repo"/deploy/bin/* "$work/m/bin/"
cd "$work/m"
printf 'MELON_DOMAIN=:80\nPOSTGRES_PASSWORD=update-test\nMELON_SERVER_SECRET=update-test-secret-update-test-secret-xx\n' > .env
export MELON_UPDATE_SOURCE="file://$work/src"
source_with

if MELON_PROVENANCE_REPO=someone/else bin/melon-update "$version" 2> "$work/err"; then
  fail "image from another repo's workflow accepted"
fi
grep -q "was not built by someone/else" "$work/err" || fail "wrong rejection: $(cat "$work/err")"
[[ -z "$(setting MELON_IMAGE)" ]] || fail ".env changed after a rejected image"
compgen -G "*.new" > /dev/null && fail "downloaded files left behind"
[[ -z "$(docker compose ps -q)" ]] || fail "containers started after a rejected image"

docker compose up -d --wait db > /dev/null 2>&1

bin/melon-update "$version" > "$work/out" 2>&1 || fail "update failed: $(cat "$work/out")"
grep -q "running $version" "$work/out" || fail "no success message"
[[ "$(setting MELON_IMAGE)" =~ ^ghcr\.io/melonigemelone/melonapp-server@sha256:[0-9a-f]{64}$ ]] || fail "server not pinned by digest: $(setting MELON_IMAGE)"
[[ "$(setting MELON_WEB_IMAGE)" =~ ^ghcr\.io/melonigemelone/melonapp-web@sha256:[0-9a-f]{64}$ ]] || fail "web not pinned by digest: $(setting MELON_WEB_IMAGE)"
healthy || fail "not healthy after update"
pinned="$(setting MELON_IMAGE)"

source_with
python3 - "$work/src/v$version/deploy/docker-compose.yml" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("MELON_DATABASE_URL: postgres://melon:${POSTGRES_PASSWORD}@db:5432/melon", "MELON_DATABASE_URL: postgres://melon:wrong@db:5432/melon")
open(path, "w").write(text)
PY
if bin/melon-update "$version" > "$work/out" 2>&1; then
  fail "broken update reported success"
fi
grep -q "going back to the previous version" "$work/out" || fail "no rollback without a migration: $(cat "$work/out")"
[[ "$(setting MELON_IMAGE)" == "$pinned" ]] || fail ".env not restored"
grep -qF "postgres://melon:\${POSTGRES_PASSWORD}@db" docker-compose.yml || fail "compose file not restored"
for _ in $(seq 1 30); do healthy && break; sleep 2; done
healthy || fail "previous version not running after rollback"

source_with
python3 - "$work/src/v$version/deploy/docker-compose.yml" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("MELON_DATABASE_URL: postgres://melon:${POSTGRES_PASSWORD}@db:5432/melon", "MELON_DATABASE_URL: postgres://melon:wrong@db:5432/melon")
text = text.replace("\nvolumes:\n", """
  migrated:
    image: postgres:17-alpine
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    command: ["psql", "-h", "db", "-U", "melon", "-d", "melon", "-c", "insert into _sqlx_migrations (version, description, success, checksum, execution_time) values (99999, 'simulated', true, '\\\\x00', 0)"]
    networks: [internal]

volumes:
""", 1)
open(path, "w").write(text)
PY
if bin/melon-update "$version" > "$work/out" 2>&1; then
  fail "update with a migrated database reported success"
fi
grep -q "the database may already be migrated" "$work/out" || fail "old version started against a migrated database: $(cat "$work/out")"
[[ -z "$(docker compose ps -q server)" ]] || fail "server still running after a migration and a failed update"
[[ "$(setting MELON_IMAGE)" == "$pinned" ]] || fail ".env not restored after a migration"

echo "update test passed"
