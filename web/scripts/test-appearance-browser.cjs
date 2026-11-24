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
    assert.equal(await page.getByRole("switch").count(),3+await page.getByRole("switch",{name:"Движение телефона",exact:true}).count());
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
        const nav=document.querySelector(".bottomnav");
        if(getComputedStyle(nav).position!=="fixed"||!nav.querySelector(".snowdrift"))errors.push("navigation snow must preserve fixed navigation");
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
    const automaticPhone=await setup("winter",{hasTouch:true,viewport:{width:393,height:852}});
    await automaticPhone.context.addInitScript(()=>{
      Object.defineProperty(DeviceMotionEvent,"requestPermission",{configurable:true,value:undefined});
      setInterval(()=>window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:0,y:0,z:9.8},acceleration:{x:0,y:0,z:0}})),100);
    });
    await automaticPhone.page.reload();await automaticPhone.page.locator(".home-page").waitFor();
    await automaticPhone.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    assert.equal(await automaticPhone.page.getByRole("switch",{name:"Движение телефона",exact:true}).isChecked(),true,"sensor defaults on without permission API");
    await automaticPhone.page.getByRole("switch",{name:"Движение телефона",exact:true}).uncheck();
    await automaticPhone.page.reload();await automaticPhone.page.locator(".home-page").waitFor();
    await automaticPhone.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    assert.equal(await automaticPhone.page.getByRole("switch",{name:"Движение телефона",exact:true}).isChecked(),false,"explicit opt-out survives reload");
    await automaticPhone.context.close();
    const weather=await setup("winter",{viewport:{width:393,height:852}});
    async function chooseSnow(value) {
      await weather.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
      await weather.page.getByRole("combobox",{name:"Интенсивность снега"}).selectOption(value);
      await weather.page.getByRole("button",{name:"Готово",exact:true}).click();
      await weather.page.waitForTimeout(150);
    }
    const coverage=()=>weather.page.locator("canvas.seasonal-particles").evaluate(c=>{
      const pixels=c.getContext("2d").getImageData(0,0,c.width,c.height).data,bands=[0,0,0];
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>30)bands[Math.min(2,Math.floor(y/c.height*3))]++;
      return bands;
    });
    await chooseSnow("light");
    const light=await coverage();assert.ok(light.every(n=>n>20),"light snow starts across the whole viewport");
    if(screenshotDir)await weather.page.screenshot({path:path.join(screenshotDir,"winter-light-snow.png")});
    await weather.page.waitForTimeout(20000);
    const settled=await coverage();assert.ok(settled[2]>20,"upper cards never starve lower viewport of snow");
    await chooseSnow("flurry");const dense=await coverage();
    assert.ok(dense.reduce((a,b)=>a+b,0)>light.reduce((a,b)=>a+b,0)*1.8,"heavy snow is visibly denser on phone");
    if(screenshotDir)await weather.page.screenshot({path:path.join(screenshotDir,"winter-heavy-snow.png")});
    console.log("PASS whole-viewport light snow after 20 seconds and visibly denser heavy snow",{light,settled,dense});
    await weather.context.close();
    const phoneCase=await setup("winter",{hasTouch:true,viewport:{width:393,height:852}});
    await phoneCase.context.addInitScript(()=>{
      window.__motionRequests=0;window.__motionResult="granted";window.__roofChunks=0;
      localStorage.setItem("shpun.winter.snowbanks.v1",JSON.stringify({version:1,banks:[["/home|home-balance",{seed:.5,heights:Array.from({length:48},(_,i)=>i>0&&i<47?4:0)}]]}));
      const ellipse=CanvasRenderingContext2D.prototype.ellipse;
      CanvasRenderingContext2D.prototype.ellipse=function(...args){if(this.canvas.classList.contains("seasonal-particles"))window.__roofChunks++;return ellipse.apply(this,args);};
      Object.defineProperty(DeviceMotionEvent,"requestPermission",{configurable:true,value:async()=>{window.__motionRequests++;return window.__motionResult;}});
    });
    await phoneCase.page.reload();await phoneCase.page.locator(".home-page").waitFor();
    assert.equal(await phoneCase.page.evaluate(()=>window.__motionRequests),0,"no automatic sensor permission request");
    await phoneCase.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    await phoneCase.page.getByRole("switch",{name:"Движение телефона",exact:true}).check();
    assert.equal(await phoneCase.page.evaluate(()=>window.__motionRequests),1);
    const reading=async(x)=>phoneCase.page.evaluate(x=>window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:0,y:0,z:9.8},acceleration:{x,y:0,z:0}})),x);
    await reading(0);
    await phoneCase.page.getByRole("button",{name:"Готово",exact:true}).click();
    const roofPath=await phoneCase.page.locator(".home-balance-card .snowdrift path").getAttribute("d");
    await phoneCase.page.waitForTimeout(50);await reading(16);await phoneCase.page.waitForTimeout(140);await reading(-16);
    await phoneCase.page.locator(".snow-weather--gust").waitFor();
    await phoneCase.page.waitForTimeout(180);
    assert.notEqual(await phoneCase.page.locator(".home-balance-card .snowdrift path").getAttribute("d"),roofPath,"shake changes the actual roof bank");
    assert.equal(await phoneCase.page.locator(".bottomnav .snowdrift").count(),1);
    assert.ok(await phoneCase.page.evaluate(()=>window.__roofChunks>0),"shed roof snow is drawn as falling chunks");
    if(screenshotDir)await phoneCase.page.screenshot({path:path.join(screenshotDir,"winter-shake-gust.png")});
    assert.equal(new URL(phoneCase.page.url()).pathname,"/home");
    assert.equal(await phoneCase.page.evaluate(()=>JSON.parse(localStorage.getItem("shpun.winter.snowman.v1")).snow),0,"shaking never clears banks or awards collected snow");
    await phoneCase.page.waitForTimeout(2600);assert.equal(await phoneCase.page.locator(".snow-weather--gust").count(),0);
    await reading(16);await phoneCase.page.waitForTimeout(140);await reading(-16);await phoneCase.page.waitForTimeout(100);
    assert.equal(await phoneCase.page.locator(".snow-weather--gust").count(),0,"shake cooldown prevents continuous effects");
    await phoneCase.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    await phoneCase.page.getByRole("switch",{name:"Движение телефона",exact:true}).uncheck();
    await phoneCase.page.getByRole("button",{name:"Готово",exact:true}).click();
    await reading(16);await phoneCase.page.waitForTimeout(140);await reading(-16);assert.equal(await phoneCase.page.locator(".snow-weather--gust").count(),0);
    await phoneCase.page.evaluate(()=>window.__motionResult="denied");
    await phoneCase.page.getByRole("button",{name:"Настройки зимней темы",exact:true}).click();
    await phoneCase.page.getByRole("switch",{name:"Движение телефона",exact:true}).click();
    await phoneCase.page.getByRole("status").filter({hasText:"Доступ к движению телефона не разрешён"}).waitFor();
    assert.equal(await phoneCase.page.getByRole("switch",{name:"Движение телефона",exact:true}).isChecked(),false);
    await phoneCase.page.evaluate(()=>window.__motionResult="granted");
    await phoneCase.page.getByRole("switch",{name:"Движение телефона",exact:true}).check();
    await phoneCase.page.getByRole("button",{name:"Готово",exact:true}).click();
    await phoneCase.page.evaluate(()=>{window.__tiltTimer=setInterval(()=>window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:-6,y:0,z:7.7},acceleration:{x:0,y:0,z:0}})),50);});
    await phoneCase.page.waitForTimeout(3300);
    const heldChunks=await phoneCase.page.evaluate(()=>window.__roofChunks);
    await phoneCase.page.waitForTimeout(1100);
    assert.equal(await phoneCase.page.evaluate(()=>window.__roofChunks),heldChunks,"holding a tilt does not produce a continuous snow stream");
    await phoneCase.context.close();
    console.log("PASS explicit sensor permission, short shake effect, cooldown, no destructive actions, opt-out and permission denial");

    const gravityCase=await setup("winter",{hasTouch:true,viewport:{width:393,height:852}});
    await gravityCase.context.addInitScript(()=>{
      Object.defineProperty(DeviceMotionEvent,"requestPermission",{configurable:true,value:undefined});
      window.__gravity={x:0,y:9.8,z:0};window.__screenAngle=0;window.__fallTrace=[];
      Object.defineProperty(screen.orientation,"angle",{configurable:true,get:()=>window.__screenAngle});
      localStorage.setItem("shpun.winter.snowbanks.v1",JSON.stringify({version:1,banks:["/home|home-balance","/winter|bottom-navigation"].map(key=>[key,{seed:.5,heights:Array.from({length:48},(_,i)=>i>0&&i<47?4:0)}])}));
      setInterval(()=>window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:window.__gravity,acceleration:{x:0,y:0,z:0}})),50);
      const clear=CanvasRenderingContext2D.prototype.clearRect,arc=CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.clearRect=function(...args){this.__firstArc=true;return clear.apply(this,args);};
      CanvasRenderingContext2D.prototype.arc=function(...args){if(this.__firstArc&&this.canvas.classList.contains("seasonal-particles")){window.__fallTrace.push([args[0],args[1]]);this.__firstArc=false;}return arc.apply(this,args);};
    });
    async function gravityScenario(vector,angle,axis,sign,unsupported){
      await gravityCase.page.reload();await gravityCase.page.locator(".home-page").waitFor();
      await gravityCase.page.waitForTimeout(150);
      await gravityCase.page.evaluate(({vector,angle})=>{window.__gravity=vector;window.__screenAngle=angle;if(angle)screen.orientation.dispatchEvent(new Event("change"));},{vector,angle});
      await gravityCase.page.waitForTimeout(1100);
      if(unsupported){
        for(const selector of [".home-balance-card .snowdrift",".bottomnav .snowdrift"])
          assert.equal(await gravityCase.page.locator(selector).evaluate(el=>Number(el.style.opacity)),0,"unsupported roof empties completely");
      }
      await gravityCase.page.evaluate(()=>window.__fallTrace=[]);await gravityCase.page.waitForTimeout(450);
      const displacement=await gravityCase.page.evaluate(axis=>{let sum=0,n=0;const points=window.__fallTrace;for(let i=1;i<points.length;i++){const d=points[i][axis]-points[i-1][axis];if(Math.abs(d)<15){sum+=d;n++;}}return{sum,n};},axis);
      assert.ok(displacement.n>=5&&displacement.sum*sign>3,"flakes follow screen-space gravity "+JSON.stringify({vector,angle,displacement}));
      if(unsupported)assert.equal(await gravityCase.page.locator(".home-balance-card .snowdrift").evaluate(el=>Number(el.style.opacity)),0,"unsupported snow does not regrow");
    }
    await gravityScenario({x:-9.8,y:0,z:0},0,0,1,true);
    await gravityScenario({x:0,y:-9.8,z:0},0,1,-1,true);
    await gravityScenario({x:9.8,y:0,z:0},90,1,1,false);
    await gravityScenario({x:-9.8,y:0,z:0},270,1,1,false);
    await gravityCase.context.close();
    console.log("PASS locked 90/180-degree roof release, reversed snowfall, no unsupported regrowth and screen auto-rotation");

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
