// Optional browser acceptance suite. Uses isolated API fixtures, never real accounts.
// Set PLAYWRIGHT_PACKAGE / CHROMIUM_CHANNEL when using a bundled browser runtime.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

(async () => {
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const server = await createServer({ root: path.resolve(__dirname, ".."), server: { host: "127.0.0.1", port: 5194, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_CHANNEL ? { channel: process.env.CHROMIUM_CHANNEL } : {}) });
  const errors = [];
  const base = server.resolvedUrls.local[0].replace(/\/$/, "");
  const screenshotDir = process.env.APPEARANCE_SCREENSHOT_DIR;
  async function setup(theme, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...options });
    await context.addInitScript(() => {
      for (const kind of ["pwa_install", "push"]) sessionStorage.setItem(`onboarding.prompt.shown.session.v1:${kind}`, "1");
      localStorage.setItem("push_disabled_by_user", "1");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const state = { settings: { theme, effectsEnabled: true, gamesEnabled: true }, failSave: false, writes: [] };
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith("/api/")) return route.continue();
      let payload = { ok: true, items: [] };
      if (pathname === "/api/appearance") payload = { ok: true, settings: state.settings };
      if (pathname === "/api/admin/appearance") {
        if (state.failSave) return route.fulfill({ status: 503, json: { ok: false, error: "unavailable" } });
        state.settings = route.request().postDataJSON(); state.writes.push(state.settings);
        payload = { ok: true, settings: state.settings };
      }
      if (pathname === "/api/me") payload = { ok: true, authSessionId: "appearance-test", profile: {
        id: 901, login: "test@example.com", displayName: "Test", email: "test@example.com", emailVerified: true,
        emailStepDone: true, passwordStepDone: true, isAdmin: true }, balance: { amount: 54.98, currency: "RUB" }, bonus: 0, discount: 0 };
      if (pathname === "/api/services") payload = { ok: true, items: [], summary: {
        total: 2, active: 2, pending: 0, notPaid: 0, blocked: 0, monthlyCost: 300, currency: "RUB" } };
      if (pathname === "/api/notifications/feed") payload = { ok: true, items: [
        "Обновили список серверов Shpun", "Новости подключения", "Всё снова работает!", "Обновление приложения", "Поддержка рядом",
      ].map((title, index) => ({ event_id: `appearance-news-${index}`, type: "broadcast.news", ts: 1793700000 - index * 86400,
        title, message: "Короткие обновления сервиса и важные сообщения для наших клиентов." })) };
      await route.fulfill({ json: payload });
    });
    await page.goto(`${base}/home`);
    if (theme !== "classic") await page.locator(`.app[data-seasonal=${theme}]`).waitFor();
    else await page.locator(".home-page").waitFor();
    return { page, context, state };
  }
  try {
    const { page, context, state } = await setup("neon");
    assert.equal(await page.locator(".home-balance-card").count(), 1);
    await page.waitForTimeout(150);
    const first = await page.locator(".seasonal-particles").evaluate((canvas) => canvas.toDataURL());
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator(".seasonal-particles").evaluate((canvas) => canvas.toDataURL()), first, "background really animates");
    for (const width of [320, 393, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}px`);
    }
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "vice-coast-home.png") });
    await page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    await page.getByRole("button", { name: "Поехали", exact: true }).click();
    await page.waitForTimeout(1200);
    assert.ok(await page.locator(".seasonal-road-item").count() > 0);
    const oldTop = await page.locator(".seasonal-car").evaluate((node) => node.style.top);
    await page.getByRole("button", { name: "Перестроиться вверх", exact: true }).click();
    assert.notEqual(await page.locator(".seasonal-car").evaluate((node) => node.style.top), oldTop);
    await page.getByRole("button", { name: "Пауза", exact: true }).click();
    const paused = await page.locator(".seasonal-game-stats").innerText();
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".seasonal-game-stats").innerText(), paused);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "vice-coast-race.png") });
    await page.getByRole("button", { name: "Оформление", exact: true }).click();
    await page.getByRole("checkbox", { name: "Фоновые анимации и эффекты", exact: true }).uncheck();
    assert.equal(await page.locator(".seasonal-particles").count(), 0);
    await page.getByRole("checkbox", { name: "Использовать сезонную тему", exact: true }).uncheck();
    assert.equal(await page.locator(".app[data-seasonal]").count(), 0);
    await page.keyboard.press("Escape");
    await page.reload(); await page.locator(".home-page").waitFor();
    assert.equal(await page.locator(".app[data-seasonal]").count(), 0, "opt-out survives reload");
    await page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    await page.getByRole("checkbox", { name: "Использовать сезонную тему", exact: true }).check();
    assert.equal(await page.locator(".seasonal-particles").count(), 0, "motion opt-out survives separately");
    await page.keyboard.press("Escape");
    await page.goto(`${base}/admin?tab=appearance`);
    await page.getByRole("radio", { name: "Зимний Шпунь", exact: true }).check();
    state.failSave = true;
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Не удалось сохранить оформление" }).waitFor();
    assert.equal(state.settings.theme, "neon");
    state.failSave = false;
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Настройки оформления сохранены" }).waitFor();
    assert.equal(state.writes.at(-1).theme, "winter");
    await page.goto(`${base}/home`); await page.locator(".app[data-seasonal=winter]").waitFor();
    console.log("PASS animated scene, steering, pause, persistent opt-outs, failed save and global theme switch");
    await context.close();

    const winter = await setup("winter", { viewport: { width: 393, height: 852 } });
    await winter.page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    const stage = winter.page.locator(".seasonal-tree-stage");
    const box = await stage.boundingBox();
    await stage.click({ position: { x: box.width / 2, y: box.height * .55 } });
    assert.equal(await winter.page.locator(".seasonal-tree-ornament").count(), 1);
    const ornament = winter.page.locator(".seasonal-tree-ornament");
    const startLeft = await ornament.evaluate((node) => node.style.left);
    await ornament.focus(); await winter.page.keyboard.press("ArrowRight");
    assert.notEqual(await ornament.evaluate((node) => node.style.left), startLeft);
    const ob = await ornament.boundingBox();
    await winter.page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
    await winter.page.mouse.down(); await winter.page.mouse.move(ob.x + ob.width / 2 + 24, ob.y + ob.height / 2 - 10, { steps: 4 }); await winter.page.mouse.up();
    assert.equal(await ornament.count(), 1, "dragging never creates an extra bauble");
    await winter.page.getByRole("button", { name: "Погасить огни", exact: true }).click();
    assert.equal(await winter.page.locator(".seasonal-tree-stage--lit").count(), 0);
    await winter.page.getByRole("button", { name: "Немного волшебства", exact: true }).click();
    await winter.page.locator(".seasonal-tree-stage--celebrate").waitFor();
    if (screenshotDir) await winter.page.screenshot({ path: path.join(screenshotDir, "winter-tree-mobile.png") });
    const bounds = await winter.page.locator("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 394 && bounds.y >= 0 && bounds.y + bounds.height <= 853);
    await winter.page.keyboard.press("Escape"); await winter.page.reload();
    await winter.page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    assert.equal(await winter.page.locator(".seasonal-tree-ornament").count(), 1, "tree survives reload");
    await winter.context.close();
    console.log("PASS mobile tree decoration, drag, keyboard, lights, sparkle, persistence and dialog bounds");

    const reduced = await setup("winter", { reducedMotion: "reduce" });
    assert.equal(await reduced.page.locator(".seasonal-particles").count(), 0);
    await reduced.context.close();
    const classic = await setup("classic");
    assert.equal(await classic.page.locator(".seasonal-backdrop,.seasonal-launcher").count(), 0);
    await classic.context.close();
    assert.deepEqual(errors, []);
    console.log("PASS reduced-motion preference, classic rollback and no browser exceptions");
  } finally { await browser.close(); await server.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
