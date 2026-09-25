#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: install-fleet-agent.sh <repo-root>}"
unit_dir="$HOME/.config/systemd/user"
env_dir="$HOME/.config/gabriel"
env_file="$env_dir/fleet-agent.env"
unit_file="$unit_dir/gabriel-fleet-agent.service"

mkdir -p "$unit_dir" "$env_dir"
if [[ ! -f "$env_file" ]]; then
  install -m 600 /dev/null "$env_file"
  printf '%s\n' '# PERSISTFLOW_BASE_URL=...' '# PERSISTFLOW_FLEET_NODE_ID=...' '# PERSISTFLOW_FLEET_NODE_SECRET=...' > "$env_file"
  chmod 600 "$env_file"
fi

cat > "$unit_file" <<EOF
[Unit]
Description=Gabriel Fleet Agent
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/gabriel/fleet-agent.env
ExecStart=/usr/bin/env node $repo_root/persistd/src/fleet/node-agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now gabriel-fleet-agent.service
echo 'Gabriel Fleet Agent installed and started.'
