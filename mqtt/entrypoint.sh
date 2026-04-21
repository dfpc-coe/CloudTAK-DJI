#!/bin/sh
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME must be set}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD must be set}"

mkdir -p /mosquitto/config /mosquitto/data /mosquitto/log

printf '%s:%s' "$MQTT_USERNAME" "$MQTT_PASSWORD" > /mosquitto/config/passwd
mosquitto_passwd -U /mosquitto/config/passwd

exec mosquitto -c /mosquitto/config/mosquitto.conf
