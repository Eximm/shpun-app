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
      window.__snowAudio = { starts:0, stops:0 };
      const start=AudioBufferSourceNode.prototype.start, stop=AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start=function(...args){ if(this.loop)window.__snowAudio.starts++;return start.apply(this,args); };
      AudioBufferSourceNode.prototype.stop=function(...args){ if(this.loop)window.__snowAudio.stops++;return stop.apply(this,args); };

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
    const { page, context, state } = await setup("winter", {hasTouch:true});
    const open=()=>page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    await open();
    assert.equal(await page.locator(".winter-settings-dialog").count(),1);
    assert.equal(await page.getByRole("switch").count(),3);
    assert.equal(await page.locator(".winter-playground,.seasonal-tree-stage,.seasonal-tabs").count(),0);
    assert.equal(await page.getByRole("button",{name:"Поиграть",exact:true}).count(),0);
    assert.equal(await page.locator('img[src="/themes/winter-tree.webp"]').count(),0);
    for(const [width,height] of [[320,568],[393,852],[768,1024],[1280,900]]){
      await page.setViewportSize({width,height});
      const box=await page.locator("dialog").boundingBox();
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`settings fit ${width}px`);
      assert.ok(await page.locator("dialog").evaluate(node=>node.scrollWidth<=node.clientWidth+1));
      if(screenshotDir&&(width===393||width===1280))await page.screenshot({path:path.join(screenshotDir,width===393?"winter-settings-mobile.png":"winter-settings-desktop.png")});
    }
    await page.getByRole("switch",{name:"Звук снега",exact:true}).check();
    await page.getByRole("combobox",{name:"Интенсивность снега",exact:true}).selectOption("flurry");
    await page.getByRole("switch",{name:"Движение и эффекты",exact:true}).uncheck();
    assert.equal(await page.locator(".seasonal-particles").count(),0);
    await page.getByRole("switch",{name:"Зимнее оформление",exact:true}).uncheck();
    assert.equal(await page.locator(".app[data-seasonal]").count(),0);
    await page.keyboard.press("Escape");
    await page.reload();await page.locator(".home-page").waitFor();
    assert.equal(await page.locator(".app[data-seasonal]").count(),0);
    await open();
    assert.ok(await page.getByRole("switch",{name:"Звук снега",exact:true}).isChecked());
    await page.getByRole("switch",{name:"Зимнее оформление",exact:true}).check();
    assert.equal(await page.locator(".seasonal-particles").count(),0);
    await page.getByRole("switch",{name:"Движение и эффекты",exact:true}).check();
    assert.equal(await page.getByRole("combobox",{name:"Интенсивность снега",exact:true}).inputValue(),"flurry");
    await page.getByRole("button",{name:"Готово",exact:true}).click();
    assert.equal(await page.locator("dialog").count(),0);
    await page.evaluate(()=>window.dispatchEvent(new Event("shpun-winter-discovery")));
    assert.equal(await page.locator("dialog").count(),0,"staged discovery does not open early activities");
    await page.waitForTimeout(2200);
    for(const width of [360,393,768,1280]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
      const errors=await page.evaluate(()=>{
        const errors=[];
        for(const top of [40,120,240,80,0]){
          scrollTo({top,behavior:"instant"});
          for(const cap of document.querySelectorAll(".snowdrift")){
            const host=cap.parentElement,box=host.getBoundingClientRect(),snow=cap.querySelector("svg").getBoundingClientRect();
            if(!host.classList.contains("snow-bearing-surface")||Math.abs(box.top-snow.top-22)>1.2)errors.push({top,y:box.top,snow:snow.top});
          }
        }
        return errors;
      });
      assert.deepEqual(errors,[],`native scroll alignment ${width}px`);
    }
    await page.waitForTimeout(1600);
    const point=await page.locator(".snowdrift").first().evaluate(node=>{
      const box=node.getBoundingClientRect(),x=box.x+box.width/2;
      for(let y=box.top+.5;y<box.bottom;y+=.5)if(document.elementFromPoint(x,y)?.closest(".snowdrift")===node)return{x,y};
      return null;
    });assert.ok(point);
    const before=await page.evaluate(()=>window.__snowAudio.starts);
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+60,point.y,{steps:10});await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.__snowAudio.starts)-before,1,"one continuous sound per brush gesture");
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.__snowAudio.starts-window.__snowAudio.stops),0,"no stuck audio loop");
    assert.equal(new URL(page.url()).pathname,"/home");
    assert.equal(await page.locator(".snow-discovery,.winter-playground").count(),0);
    await open();await page.getByRole("combobox",{name:"Интенсивность снега",exact:true}).selectOption("off");
    await page.getByRole("button",{name:"Готово",exact:true}).click();assert.equal(await page.locator(".snow-weather").count(),0);
    await page.goto(`${base}/admin?tab=appearance`);
    assert.equal(await page.getByRole("checkbox",{name:"Разрешить сезонные игры",exact:true}).count(),0);
    await page.getByRole("radio",{name:/Классическое оформление/}).check();state.failSave=true;
    await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("alert").filter({hasText:"Не удалось сохранить оформление"}).waitFor();
    assert.equal(state.settings.theme,"winter");state.failSave=false;
    await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("status").filter({hasText:"Настройки оформления сохранены"}).waitFor();
    assert.equal(state.writes.at(-1).theme,"classic");await page.goto(`${base}/home`);await page.locator(".home-page").waitFor();
    assert.equal(await page.locator(".seasonal-backdrop,.seasonal-launcher").count(),0);
    await context.close();
    const reduced=await setup("winter",{reducedMotion:"reduce"});
    assert.equal(await reduced.page.locator(".seasonal-particles").count(),0);
    await reduced.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    assert.ok(await reduced.page.getByRole("switch",{name:"Движение и эффекты",exact:true}).isDisabled());
    assert.equal(await reduced.page.locator(".winter-playground,.seasonal-tabs").count(),0);
    await reduced.context.close();assert.deepEqual(errors,[]);
    console.log("PASS compact winter-only settings, phone/tablet/desktop bounds, all controls, persistence, native snow scrolling, continuous audio, no early activities, admin saving and reduced motion");
  } catch(error){for(const context of browser.contexts())for(const page of context.pages())console.error((await page.locator("body").innerText()).slice(0,5000));throw error;}
  finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
