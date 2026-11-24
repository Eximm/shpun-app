# Mobile authentication layout

The portaled login/registration overlay temporarily uses unzoomed body CSS pixels and restores normal app zoom on close. It tracks visualViewport size/offset for browser chrome, pinch zoom and keyboard viewport changes. Its card and password grid allow shrinking; touch inputs are at least 16px to avoid iOS focus magnification without disabling user zoom. Registration remains vertically scrollable.

The Telegram iframe keeps its intrinsic viewport and auth callback. Fitting reads Telegram's explicit style/attribute dimensions, scales the whole frame, batches ResizeObserver/attribute updates through requestAnimationFrame and avoids repeated identical style writes. Its color-scheme is normal to prevent the dark parent from producing an opaque white iframe canvas. Cross-origin content is neither read nor modified.

Optional `test:auth-browser` uses isolated API/widget fixtures, no real login requests. Set PLAYWRIGHT_PACKAGE, PLAYWRIGHT_BROWSERS_PATH and BROWSER_ENGINE=webkit or chromium (Chromium uses installed Edge). It checks 320/393px phones, landscape, reduced viewport height, late iframe width changes, registration scrolling, zoom cleanup and no runtime/observer errors. Desktop WebKit with an iPhone user agent is a compatibility test, not a physical iPhone test.
