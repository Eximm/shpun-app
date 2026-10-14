The local `Core::Cloud::Currency` adapter is a modified version of the
currency class in danuk/shm 3.6.0, licensed under Apache License 2.0.

Original project: https://github.com/danuk/shm

Modifications: rates are read from the local SHM database rather than the SHM
Cloud service; input freshness/validation and a local audit trail were added.
The original license is reproduced in `LICENSE.upstream`.

The build also patches `app/public_html/shm/v1.cgi` and
`app/lib/Core/Transport/Telegram.pm` from the pinned danuk/shm 3.6.2
image to add signed Telegram Mini App registration. These upstream files are
licensed under the same Apache License 2.0 terms.
