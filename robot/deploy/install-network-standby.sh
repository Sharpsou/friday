#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Exécuter ce script avec sudo." >&2
  exit 1
fi

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -o root -g root -m 0755 "$SOURCE_DIR/friday-services-sleep" /usr/local/libexec/friday-services-sleep
install -o root -g root -m 0755 "$SOURCE_DIR/friday-services-wake" /usr/local/libexec/friday-services-wake
install -o root -g root -m 0440 "$SOURCE_DIR/friday-wake.sudoers" /etc/sudoers.d/friday-wake
visudo -cf /etc/sudoers.d/friday-wake
install -o root -g root -m 0644 "$SOURCE_DIR/friday-awake.target" /etc/systemd/system/friday-awake.target
install -o root -g root -m 0644 "$SOURCE_DIR/friday-wake.service" /etc/systemd/system/friday-wake.service
install -o root -g root -m 0644 "$SOURCE_DIR/friday-camera.service" /etc/systemd/system/friday-camera.service
install -o root -g root -m 0644 "$SOURCE_DIR/friday-robot.service" /etc/systemd/system/friday-robot.service
install -d -o pi -g pi -m 0750 /var/lib/friday-wake
if [ ! -f /var/lib/friday-wake/desired-state ]; then
  printf 'awake\n' > /var/lib/friday-wake/desired-state
fi
chown pi:pi /var/lib/friday-wake/desired-state
systemctl daemon-reload
systemctl disable friday-camera.service friday-robot.service || true
systemctl enable --now friday-wake.service
systemctl start friday-awake.target
systemctl is-active --quiet friday-wake.service
systemctl is-active --quiet friday-camera.service
systemctl is-active --quiet friday-robot.service
echo "Agent de réveil installé, robot maintenu éveillé."
