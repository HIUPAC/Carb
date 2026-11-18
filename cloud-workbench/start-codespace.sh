#!/usr/bin/env bash
set -euo pipefail

umask 077
runtime_dir="${XDG_RUNTIME_DIR:-${HOME}/.cache}/carb-cloud-workbench"
mkdir -p "$runtime_dir"
exec 9>"$runtime_dir/start.lock"
flock 9
log_file="$runtime_dir/server.log"

ready() {
  curl --max-time 1 -fsS 'http://127.0.0.1:4180/_carb/status' 2>/dev/null | grep -Fq '"cloud":true' &&
    grep -Fq 'Carb cloud workbench: ' "$log_file"
}

if ! ready; then
  nohup node cloud-workbench/server.mjs --port 4180 >"$log_file" 2>&1 </dev/null 9>&- &
  for attempt in {1..40}; do
    if ready; then break; fi
    sleep 0.25
  done
fi

if ready; then
  grep -Fm 1 'Carb cloud workbench: ' "$log_file"
else
  printf '%s\n' 'Carb 云工作区未启动。请检查上面的安装结果，再运行 bash cloud-workbench/start-codespace.sh。'
  exit 1
fi
