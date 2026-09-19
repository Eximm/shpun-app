#!/bin/sh
set -eu

docker exec shm-mysql-1 sh -lc '
  mysql --batch --skip-column-names \
    -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -e "
      SELECT CONCAT(\"db_now=\", NOW(), \" tz=\", @@session.time_zone);
      SELECT user_id, created, COALESCE(last_login, \"never\"), verified,
             IF(login LIKE \"%@%\", \"email_login\", \"other_login\")
      FROM users
      ORDER BY user_id DESC
      LIMIT 12;
      SELECT CONCAT(\"created_last_24h=\", COUNT(*))
      FROM users
      WHERE created >= NOW() - INTERVAL 24 HOUR;
    "
'
