#!/bin/sh
set -eu

# Only an explicit HTTPS origin is accepted. No paths, tokens, credentials,
# ports or nginx syntax may enter the template through this setting.
if [ -n "${ARTIFACT_ORIGIN:-}" ]; then
    case "$ARTIFACT_ORIGIN" in https://*) ;; *) exit 1 ;; esac
    host=${ARTIFACT_ORIGIN#https://}
    case "$host" in ''|*[!a-zA-Z0-9.-]*|.*|*..*|*.) exit 1 ;; esac
fi
case "${PORT:-8080}" in ''|*[!0-9]*) exit 1 ;; esac
[ "${PORT:-8080}" -gt 0 ] && [ "${PORT:-8080}" -le 65535 ]
case "${ARTIFACT_RESOLVER:-1.1.1.1}" in ''|*[!0-9.:]*) exit 1 ;; esac

export PORT=${PORT:-8080}
export ARTIFACT_ORIGIN=${ARTIFACT_ORIGIN:-}
export ARTIFACT_RESOLVER=${ARTIFACT_RESOLVER:-1.1.1.1}
envsubst '${PORT} ${ARTIFACT_ORIGIN} ${ARTIFACT_RESOLVER}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
