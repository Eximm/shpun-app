The local `Core::Cloud::Currency` adapter is a modified version of the
currency class in danuk/shm 3.5.0, licensed under Apache License 2.0.

Original project: https://github.com/danuk/shm

Modifications: rates are read from the local SHM database rather than the SHM
Cloud service; input freshness/validation and a local audit trail were added.
The original license is reproduced in `LICENSE.upstream`.
