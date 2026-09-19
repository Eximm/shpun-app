#!/bin/sh
set -eu

app_dir=/opt/shpun-app/src

echo "section=git"
cd "$app_dir"
printf 'head='
git rev-parse HEAD
printf 'branch='
git branch --show-current
printf 'origin_main='
git ls-remote origin refs/heads/main | awk '{print $1}'
printf 'dirty_entries='
git status --porcelain=v1 | wc -l
git status --short

echo "section=containers"
for container in shpun-app-api shpun-app-web; do
  docker inspect "$container" --format \
    'name={{.Name}} image={{.Image}} restart_count={{.RestartCount}} status={{.State.Status}} started={{.State.StartedAt}}'
done

echo "section=health"
printf 'api_health='
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8091/health
printf '\napi_public_health='
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8091/api/health
printf '\nweb_status='
curl --output /dev/null --silent --show-error --write-out '%{http_code}' --max-time 10 http://127.0.0.1:8090/
printf '\n'

echo "section=recent_logs"
for container in shpun-app-api shpun-app-web; do
  log_file=$(mktemp)
  docker logs --since 1h "$container" >"$log_file" 2>&1
  total=$(wc -l <"$log_file")
  errors=$(grep -Eic 'error|fatal|panic|exception|unhandled' "$log_file" || true)
  rm -f "$log_file"
  printf 'name=%s total_lines=%s error_like_lines=%s\n' "$container" "$total" "$errors"
done

echo "section=oauth_flags"
docker inspect shpun-app-api --format '{{range .Config.Env}}{{println .}}{{end}}' |
  awk -F= '
    $1 == "SHM_OAUTH_PROVIDERS" { print "SHM_OAUTH_PROVIDERS=" (length(substr($0, index($0, "=") + 1)) ? "set" : "empty"); providers=1 }
    $1 == "OAUTH_CALLBACK_BASE_URL" { print "OAUTH_CALLBACK_BASE_URL=" (length(substr($0, index($0, "=") + 1)) ? "set" : "empty"); callback=1 }
    END {
      if (!providers) print "SHM_OAUTH_PROVIDERS=absent";
      if (!callback) print "OAUTH_CALLBACK_BASE_URL=absent";
    }
  '

echo "section=compose"
sha256sum "$app_dir/docker-compose.yml"
docker compose -f "$app_dir/docker-compose.yml" config --services

echo "section=capacity"
df -h "$app_dir" | tail -1
docker system df --format 'type={{.Type}} total={{.TotalCount}} active={{.Active}} size={{.Size}} reclaimable={{.Reclaimable}}'

echo "section=sqlite"
db_path=/opt/shpun-app/data/linkdb.sqlite
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$db_path" ]; then
  printf 'journal_mode='
  sqlite3 -readonly "$db_path" 'PRAGMA journal_mode;'
  printf 'quick_check='
  sqlite3 -readonly "$db_path" 'PRAGMA quick_check;'
  stat -c 'database_size_bytes=%s' "$db_path"
  for suffix in -wal -shm; do
    if [ -f "${db_path}${suffix}" ]; then
      stat -c "sqlite${suffix}_size_bytes=%s" "${db_path}${suffix}"
    fi
  done
else
  echo "status=unavailable"
fi
