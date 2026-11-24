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
    page.on("response", response => { if (response.url().includes("/themes/") && response.status() >= 400) errors.push(`asset ${response.status()} ${response.url()}`); });
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
    const { page, context, state } = await setup("winter");
    assert.equal(await page.locator(".home-balance-card").count(), 1);
    await page.waitForTimeout(150);
    const first = await page.locator(".seasonal-particles").evaluate((canvas) => canvas.toDataURL());
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator(".seasonal-particles").evaluate((canvas) => canvas.toDataURL()), first, "background really animates");
    for (const width of [320, 393, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}px`);
    }
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "winter-home.png") });
    await page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    await page.getByRole("button", { name: "Нарядить за меня", exact: true }).click();
    assert.equal(await page.locator(".seasonal-tree-ornament").count(), 18);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir,"winter-room-desktop.png") });
    await page.getByRole("button", { name: "Отменить изменение", exact: true }).click();
    assert.equal(await page.locator(".seasonal-tree-ornament").count(), 0);
    await page.getByRole("button", { name: "Коллекция", exact: true }).click();
    await page.getByRole("button", { name: "Снежинка", exact: true }).click();
    const treeStage = page.locator(".seasonal-tree-stage");
    const treeBox = await treeStage.boundingBox();
    await treeStage.click({ position: { x: treeBox.width / 2, y: treeBox.height * .55 } });
    assert.ok((await page.locator(".seasonal-tree-ornament img").getAttribute("src")).endsWith("snowflake.png"));
    await page.getByRole("button", { name: "Начать заново", exact: true }).click();
    await page.getByRole("button", { name: "Снежный шар", exact: true }).click();
    await page.getByRole("button", { name: "Встряхнуть снежный шар", exact: true }).click();
    await page.locator(".winter-globe--snowing").waitFor();
    await page.getByRole("status").filter({ hasText: "Пусть маленькое желание" }).waitFor();
    await page.getByRole("checkbox", { name: "Звуки праздника · тихие отклики на действия", exact: true }).check();
    await page.getByRole("button", { name: "Подарки", exact: true }).click();
    await page.getByRole("button", { name: "Открыть подарок 1", exact: true }).click();
    assert.ok((await page.locator(".winter-wish").innerText()).includes("тепло"));
    await page.getByRole("button", { name: "Поймать снежинки", exact: true }).click();
    await page.getByRole("button", { name: "Начать снегопад", exact: true }).click();
    await page.waitForTimeout(1100);
    const snow = await page.locator(".winter-snow-game").evaluate((node) => node.toDataURL());
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator(".winter-snow-game").evaluate((node) => node.toDataURL()), snow);
    await page.getByRole("button", { name: "Остановить", exact: true }).click();
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
    await page.getByRole("radio", { name: /Классическое оформление/ }).check();
    state.failSave = true;
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Не удалось сохранить оформление" }).waitFor();
    assert.equal(state.settings.theme, "winter");
    state.failSave = false;
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Настройки оформления сохранены" }).waitFor();
    assert.equal(state.writes.at(-1).theme, "classic");
    await page.goto(`${base}/home`); await page.locator(".home-page").waitFor();
    console.log("PASS animated snow, tree undo, sound opt-in, gifts, snowfall, persistent opt-outs, failed save and global theme switch");
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
    if (screenshotDir) { await winter.page.screenshot({ path: path.join(screenshotDir, "winter-tree-mobile.png") }); await winter.page.locator("dialog").evaluate((node) => node.scrollTop = 0); await winter.page.screenshot({ path: path.join(screenshotDir, "winter-room-mobile.png") }); }
    for (const width of [320,393,768,1280]) {
      await winter.page.setViewportSize({width,height:852});
      const dialog = await winter.page.locator("dialog").boundingBox();
      assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width + 1);
      assert.ok(await winter.page.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    }
    await winter.page.setViewportSize({width:393,height:852});
    const bounds = await winter.page.locator("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 394 && bounds.y >= 0 && bounds.y + bounds.height <= 853);
    await winter.page.keyboard.press("Escape"); await winter.page.reload();
    await winter.page.getByRole("button", { name: "Тема и игры", exact: true }).click();
    assert.equal(await winter.page.locator(".seasonal-tree-ornament").count(), 1, "tree survives reload");
    await winter.context.close();
    console.log("PASS mobile tree decoration, drag, keyboard, lights, sparkle, persistence and dialog bounds");

    const weather = await setup("winter", { hasTouch: true });
    await weather.page.getByRole("button", {name:"Тема и игры",exact:true}).click();
    await weather.page.getByRole("button", {name:"Оформление",exact:true}).click();
    await weather.page.getByRole("combobox", {name:"Интенсивность снега",exact:true}).selectOption("flurry");
    await weather.page.keyboard.press("Escape");
    await weather.page.waitForTimeout(18000);
    assert.ok(await weather.page.locator(".snowdrift").count() >= 4,"snow accumulates on actual tile tops");
    if(screenshotDir) await weather.page.screenshot({path:path.join(screenshotDir,"winter-snowdrifts.png")});
    const assertSnowAlignment = async (label) => {
      const result = await weather.page.evaluate(() => {
        const tiles=Array.from(document.querySelectorAll(".main .home-balance-card,.main .card,.main [data-snow-surface]")).map(node=>node.getBoundingClientRect());
        const errors=[];
        for(const snow of document.querySelectorAll(".snowdrift svg")) {
          const box=snow.getBoundingClientRect();
          const tile=tiles.find(rect=>Math.abs(rect.left+8-box.left)<1.2 && Math.abs(rect.width-16-box.width)<1.2 && Math.abs(rect.top-(box.top+22))<1.2);
          if(!tile || Math.abs(tile.top-(box.top+22))>1.2 || Math.abs(box.height-28)>1.2) errors.push({snow:{left:box.left,top:box.top,width:box.width,height:box.height},tile:tile?{top:tile.top,left:tile.left,width:tile.width}:null});
        }
        return {count:document.querySelectorAll(".snowdrift").length,errors};
      });
      assert.ok(result.count>0,`snow visible: ${label}`);
      assert.deepEqual(result.errors,[],`snow follows actual tile tops: ${label}`);
    };
    for(const width of [360,393,768,1280]) {
      await weather.page.setViewportSize({width,height:1000});await weather.page.waitForTimeout(350);
      await assertSnowAlignment(`${width}px`);
      await weather.page.evaluate(()=>scrollTo(0,100));await weather.page.waitForTimeout(250);
      await assertSnowAlignment(`${width}px scrolled`);
      await weather.page.evaluate(()=>scrollTo(0,0));await weather.page.waitForTimeout(250);
    }
    await weather.page.setViewportSize({width:393,height:852});await weather.page.waitForTimeout(350);
    if(screenshotDir) await weather.page.screenshot({path:path.join(screenshotDir,"winter-snow-aligned-mobile.png")});
    await weather.page.setViewportSize({width:1280,height:1000});await weather.page.waitForTimeout(350);
    await weather.page.waitForTimeout(8000);
    const hitPoint = async () => weather.page.locator(".snowdrift").first().evaluate(button=>{
      const rect=button.getBoundingClientRect(), x=rect.x+rect.width/2;
      for(let y=rect.y+1;y<rect.bottom;y+=.5) if(document.elementFromPoint(x,y)?.closest(".snowdrift")===button) return {x,y};
      return null;
    });
    const hit=await hitPoint(); assert.ok(hit,"only the painted snow surface receives pointer input");
    await weather.page.mouse.move(hit.x,hit.y);await weather.page.mouse.down();await weather.page.mouse.move(hit.x+65,hit.y,{steps:8});await weather.page.mouse.up();
    const afterMouse=await weather.page.evaluate(()=>JSON.parse(localStorage.getItem("shpun.winter.snowman.v1")).snow);
    assert.ok(afterMouse>0,"real mouse sweep collects snow");
    await weather.page.setViewportSize({width:393,height:852});await weather.page.waitForTimeout(400);
    const touch=await hitPoint();assert.ok(touch);
    const cdp=await weather.context.newCDPSession(weather.page);
    const scroll=await weather.page.evaluate(()=>scrollY);
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:touch.x,y:touch.y}]});
    for(let i=1;i<=5;i++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:touch.x+i*9,y:touch.y}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await cdp.detach();
    assert.equal(await weather.page.evaluate(()=>scrollY),scroll,"brushing snow on touch does not scroll the page");
    assert.equal(new URL(weather.page.url()).pathname,"/home");
    await weather.page.setViewportSize({width:1280,height:1000});await weather.page.waitForTimeout(400);
    const ids = await weather.page.locator(".snowdrift").evaluateAll(nodes=>nodes.map(node=>node.dataset.snowId));
    for(const id of ids) { const drift=weather.page.locator(`.snowdrift[data-snow-id="${id}"]`); if(await drift.count()){await drift.focus();await weather.page.keyboard.press("Enter");} }
    const stash = await weather.page.evaluate(()=>JSON.parse(localStorage.getItem("shpun.winter.snowman.v1")));
    assert.ok(stash.snow >= 75,`collected physical snow can build a friend: ${stash.snow}`);
    assert.equal(new URL(weather.page.url()).pathname,"/home","brushing never activates underlying tile links");
    await weather.page.getByRole("button", {name:"Тема и игры",exact:true}).click();
    await weather.page.getByRole("button", {name:/Чьи-то следы возле ёлки/}).click();
    for(const amount of [15,25,35]) await weather.page.getByRole("button", {name:`Скатать ком · ${amount} снега`,exact:true}).click();
    await weather.page.locator(".winter-tree-snowman").waitFor();
    await weather.page.locator(".winter-snowman-friend").click();
    await weather.page.locator(".winter-snowman-friend--wave").waitFor();
    await weather.page.getByRole("button", {name:"Позвенеть новогодней звездой",exact:true}).click({clickCount:3});
    await weather.page.locator(".winter-tree--aurora").waitFor();
    if(screenshotDir) await weather.page.screenshot({path:path.join(screenshotDir,"winter-snowman.png")});
    await weather.page.keyboard.press("Escape");await weather.page.reload();
    assert.equal(await weather.page.evaluate(()=>JSON.parse(localStorage.getItem("shpun.winter.snowman.v1")).stage),3);
    await weather.page.getByRole("button", {name:"Тема и игры",exact:true}).click();
    await weather.page.getByRole("button", {name:"Оформление",exact:true}).click();
    await weather.page.getByRole("combobox", {name:"Интенсивность снега",exact:true}).selectOption("off");
    await weather.page.keyboard.press("Escape");
    assert.equal(await weather.page.locator(".snow-weather").count(),0);
    await weather.context.close();
    console.log("PASS physical snow accumulation, keyboard clearing, collected snow, three snowman stages, hidden reactions, persistence and snow off");

    const reduced = await setup("winter", { reducedMotion: "reduce" });
    assert.equal(await reduced.page.locator(".seasonal-particles").count(), 0);
    await reduced.context.close();
    const classic = await setup("classic");
    assert.equal(await classic.page.locator(".seasonal-backdrop,.seasonal-launcher").count(), 0);
    await classic.context.close();
    assert.deepEqual(errors, []);
    console.log("PASS reduced-motion preference, classic rollback and no browser exceptions");
  } catch (error) { for (const context of browser.contexts()) for (const page of context.pages()) { console.error((await page.locator("body").innerText()).slice(0,5000)); } throw error; } finally { await browser.close(); await server.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
