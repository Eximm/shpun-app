# Winter appearance

The existing dashboard layout and billing flows are preserved. Admins select Classic or Winter Shpun in `/admin?tab=appearance`, with independent switches for background effects and activities. Clients can opt out on their device. Previous unsupported theme values fall back to Classic.

The winter room includes a persistent tree with draggable ornaments, keyboard movement/deletion, automatic decoration, ten-step undo, a star that plays an original short bell phrase, twinkling ornaments, light switching and snow shaking. Three gifts reveal holiday wishes. A manually started 30-second snow-catching activity supports pointer, touch and an accessible slider, with a local best score.

Sound is OFF by default. Users explicitly enable quiet synthetic bells and snow crunch in the winter room. No external music, autoplay, background loop or audio download. Audio suspends on hiding the page and closes when leaving the room. Theme/motion choices, tree, sound preference and snow record stay local to the device. No rewards, billing changes or gameplay telemetry.

Original WebP scenery, tree and ornament assets remain under `web/public/themes/`. Background effects pause while hidden and respect device reduced-motion settings. Manually started snowfall can be played with background animation disabled.

Verification: API `npm run test:appearance`; web `npm run build`, `npm run check:all`; optional `node scripts/test-appearance-browser.cjs` with PLAYWRIGHT_PACKAGE and CHROMIUM_CHANNEL. Browser checks use isolated API fixtures, never real payments or orders.

Prepared for a combined application release with the separate domain and monitoring changes. Production activation is separate from a local build.

## Visual foundation, November 2026

The winter room now has a responsive illustrated introduction, five activity sections (tree, collection, snowfall, globe, wishes), and eight persistent decoration types. Existing v1 trees remain compatible; unknown decoration types safely use the original bauble. Collection selection takes customers directly to the tree. There are no locked reward claims, fake levels, prize buttons or daily gifts.

3D icons are original Microsoft Fluent Emoji PNG files under MIT, pinned to commit 1ffb34c752ecf5d402f04cfb4b392c77f57c54bc and served locally. Source list and full copyright/license are bundled under web/public/themes/icons. The snow game also uses image sprites rather than system emoji. The globe supports touch/pointer tilting and a keyboard-accessible shake action.

The actual seasonal award system is separate: see winter-flex-rewards.md. Visual decorations on the device do not establish reward eligibility.

## Interactive snow and discoveries

Snow has four device-local modes: off, light, steady and flurry. An irregular bounded height field builds on actual visible card tops; flakes collide with the banks. Thin SVG hit areas accept brushing while ordinary links/buttons remain clickable. Wide gaps allow taller banks; narrow gaps keep snow below the next tile. Layout updates on scroll, resize and route/content changes. No hidden-tab time catch-up. Canvas is capped to roughly 30 FPS / DPR 1.5, up to 125 flakes and 16 visible surfaces. Theme/motion opt-out removes the interaction layer; open dialogs pause accumulation.

Brushing converts removed snow volume into a bounded local stash. Sweeping an empty area grants nothing. Mouse, touch and keyboard clearing are supported. Snow can be spent once per construction step on three snowman stages; the completed friend sits by the tree. A small tracks hint exposes this activity organically. Greeting the snowman and repeated touches of the tree star reveal small cosmetic responses. These are not prize actions or server progression. Sound is opt-in and synchronized between weather and room controls.

New local keys: shpun.winter.snowfall.v1 and shpun.winter.snowman.v1. Cosmetic inventory is intentionally not a billing entitlement.

Snowbank continuity: irregular banks are restored per route/semantic tile from shpun.winter.snowbanks.v1 (bounded to 64 validated records). Initial tiles receive only a faint dusting. Opacity grows continuously with snow height; there is no fixed white baseline or binary visibility threshold. Fresh/returning surfaces fade in gently. Brush-end, keyboard clearing, pagehide and hidden-page transitions save state; ordinary snowfall is checkpointed every two seconds. Empty banks stay empty across reloads and regrow naturally. There is no simulated snowfall catch-up while the app is closed. Snapshots contain decorative heights/seed only, not billing or reward data.

Scroll attachment: snow caps are native absolutely positioned children of their tile containers, rendered through portals. They scroll with browser compositing immediately, including between animation frames. JavaScript layout reads only drive snowfall collisions and resizing; they do not chase viewport scroll positions for painting caps. Statistic links have non-interactive snow frames, so brushing does not nest buttons inside navigation links. Card bodies retain rounded clipping. All existing snow snapshots and gradual opacity remain compatible. Browser regression checks measure alignment during multiple synchronous scroll jumps without yielding to a JS animation frame.

Snow audio: brushing uses one softly filtered continuous friction voice for the entire movement, with smoothed pressure, seamless looping, an idle timeout and a release tail. Pointer release/cancel ends the stroke; repeated pointer samples never start separate bursts. Rolling snowballs uses a longer lower-frequency envelope. Muting, hiding the page or leaving the room disposes voices so they cannot resume later. Unit tests cover 200 successive updates reusing one voice; browser checks count actual looping audio sources and confirm release after pointer-up.
