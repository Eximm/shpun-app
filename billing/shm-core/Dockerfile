FROM danuk/shm-core:3.6.2@sha256:bbb987755a0562b07bc6134121f2423564bfdb20ec02d0da0d0d9697a458994f
COPY Core/Cloud/Currency.pm /app/lib/Core/Cloud/Currency.pm
COPY patch_telegram_webapp_registration.pl /tmp/patch_telegram_webapp_registration.pl
RUN perl /tmp/patch_telegram_webapp_registration.pl /app/public_html/shm/v1.cgi /app/lib/Core/Transport/Telegram.pm
