#!/bin/bash
# Droplet Daily Auto-Clean Script for Disk Space Optimization

# 1. Systemd logs cleanup
journalctl --vacuum-time=2d >/dev/null 2>&1 || true

# 2. PM2 logs flush
pm2 flush >/dev/null 2>&1 || true

# 3. Clean old actions-runner duplicate backup versions (keep only active 'externals')
for R_DIR in /home/githubrunner/actions-runner /root/actions-runner; do
  if [ -d "$R_DIR" ]; then
    find "$R_DIR" -maxdepth 1 -name "externals.*" -type d -exec rm -rf {} + 2>/dev/null || true
    rm -rf "$R_DIR/_work/_update" 2>/dev/null || true
    find "$R_DIR/_diag" -name "*.log" -mtime +2 -delete 2>/dev/null || true
  fi
done

# 4. Clean APT and NPM temp cache
apt-get clean >/dev/null 2>&1 || true
npm cache clean --force >/dev/null 2>&1 || true
rm -rf /root/.npm/_logs/* /tmp/* >/dev/null 2>&1 || true
