FROM danuk/shm-core:3.6.0@sha256:9be11a896a78d414cae85d7da4b0b058fcf9115a0fa5484925ce89db1d5def78
COPY Core/Cloud/Currency.pm /app/lib/Core/Cloud/Currency.pm
COPY patch_telegram_webapp_registration.pl /tmp/patch_telegram_webapp_registration.pl
RUN perl /tmp/patch_telegram_webapp_registration.pl /app/public_html/shm/v1.cgi /app/lib/Core/Transport/Telegram.pm
