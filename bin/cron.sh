#!/bin/bash
# Lo que corre cron, una línea por red:  bin/cron.sh <twitter|linkedin|discord>
#
# Primero se asegura de tener noticias frescas (no hace nada si ya las hay) y después
# publica. Si el refresco falla, el post usa las que ya estén redactadas; si no queda
# ninguna fresca, el post falla también y NO publica nada viejo. Todo va al log.
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")/.." || exit 1
{
  echo "=== $(date -u +%FT%TZ) $1"
  node bin/cli.js refresh
  node bin/cli.js post "$1"
} >> social-poster.log 2>&1
