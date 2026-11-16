# Seasonal appearance

The existing page layout, balances, service states, payment flows and navigation remain unchanged. Two optional visual skins add original illustrated backgrounds and local, recreational interactions.

- **Vice Coast**: warm peach/dusty pink/lavender Florida artwork, floating light particles, mouse-responsive scenery, and a 30-second three-lane driving game.
- **Winter Shpun**: snowy evergreen artwork, mouse-responsive falling snow, and a tree that can be decorated with draggable, keyboard-accessible ornaments. Lights and a brief sparkle effect are interactive.

## Administration

Open `/admin?tab=appearance`. Select Classic, Vice Coast, or Winter Shpun, optionally disable background animation or games globally, then Save. The backend reuses the existing SHM administrator check. A regular user or anonymous visitor cannot save settings.

The persisted configuration is a singleton in `app_appearance_settings` in the existing SQLite database. A new installation defaults to Classic. `GET /api/appearance` exposes only the theme and two feature flags. `PUT /api/admin/appearance` requires administrator authorization and validates the complete payload. Open clients refresh on focus/visibility or within one minute; failed refreshes retain the last successful configuration.

The winter switch is manual: select Winter Shpun here in early December. There is no automatic date or recurring task.

## Client controls

The seasonal header button opens a native dialog with Play and Appearance tabs. Appearance controls are also available in Profile → Settings. Customers may disable the theme or background motion separately. These preferences persist on the device and synchronize across its open tabs. OS reduced-motion preferences always disable background animation. Classic or global game disabling removes the relevant activity. Admin screens, authentication, legal pages and the connection assistant retain their normal styling.

No automatic audio, payments, billing bonuses, rewards, account mutation, external game services, or gameplay telemetry. The driving record and tree decorations are stored only locally. Keyboard and touch controls are supported. Background animation pauses when the page is hidden and cleans up on theme change; driving pauses on visibility loss and on dialog close.

## Assets and visual references

Files under `web/public/themes/` are original generated illustrations, optimized to WebP. Transparent sprites retain alpha. The background for Vice Coast was reworked after inspecting Rockstar's official GTA VI website and artwork gallery; no official artwork, game logo, protagonists, soundtrack, or other downloaded Rockstar material is shipped in the application.

- https://www.rockstargames.com/VI
- https://www.rockstargames.com/VI/media/artwork-wallpapers

## Verification

- API: `npm run test:appearance` — public-safe defaults, admin authorization, validation, persistence and rollback.
- Web: `npm run test:appearance` — lane bounds, collision/collection, game completion and frame-gap safety.
- Optional browser acceptance: `node scripts/test-appearance-browser.cjs` from `web`, with Playwright available. `PLAYWRIGHT_PACKAGE` can specify an existing runtime package; `CHROMIUM_CHANNEL` can select an installed browser. `APPEARANCE_SCREENSHOT_DIR` optionally stores test screenshots.
- The browser suite uses isolated API fixtures. It verifies real animation, steering and pause, ornament dragging and keyboard controls, lights, persistence, reduced motion, administrator saving, save failure, global theme switching and classic rollback. It creates no real orders and sends no real payments.
