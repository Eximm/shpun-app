FROM danuk/shm-core:3.5.0@sha256:051b4a577758b0528b4987778a6a4b9809a494522e1222b6badb9bdc8bbd1576
COPY Core/Cloud/Currency.pm /app/lib/Core/Cloud/Currency.pm
COPY patch_telegram_webapp_registration.pl /tmp/patch_telegram_webapp_registration.pl
RUN perl /tmp/patch_telegram_webapp_registration.pl /app/public_html/shm/v1.cgi /app/lib/Core/Transport/Telegram.pm
