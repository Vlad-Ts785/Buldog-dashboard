#!/bin/bash
# run.sh file.sql -> runs SQL on VPS read-only (table output)
SQL="$1"
{ echo 'cd /root/yard-dashboard; set -a; . <(grep "^MYSQL_" .env); set +a; mysql --default-character-set=utf8mb4 -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -t 2>&1 <<'"'"'SQLEOF'"'"''; cat "$SQL"; echo; echo 'SQLEOF'; } | ssh -i ~/.ssh/beget-yard/id_ed25519 root@159.194.201.167 'bash -s'
