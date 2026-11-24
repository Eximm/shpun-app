const assert=require("node:assert/strict"),path=require("node:path");
const {pathToFileURL}=require("node:url");
const playwright=require(process.env.PLAYWRIGHT_PACKAGE||"playwright");
(async()=>{
 process.env.VITE_TG_BOT_USERNAME="fixture_bot";
 const {createServer}=await import(pathToFileURL(require.resolve("vite")).href);
 const server=await createServer({root:path.resolve(__dirname,".."),server:{host:"127.0.0.1",port:5195,strictPort:true}});
 await server.listen();const engine=process.env.BROWSER_ENGINE||"webkit";
 const browser=await playwright[engine].launch({headless:true,...(engine==="chromium"?{channel:"msedge"}:{})});
 try{
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",serviceWorkers:"block"});
 const errors=[];const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",async route=>{const p=new URL(route.request().url()).pathname;if(!p.startsWith("/api/"))return route.continue();return route.fulfill({status:p==="/api/me"?401:200,json:p==="/api/appearance"?{ok:true,settings:{theme:"classic",effectsEnabled:false,gamesEnabled:false}}:{ok:false,error:"not_authenticated"}});});
 await page.route("https://telegram.org/js/telegram-widget.js*",route=>route.fulfill({contentType:"application/javascript",body:`(()=>{const s=document.currentScript,f=document.createElement('iframe');f.width='620';f.height='56';f.style.cssText='background:transparent;border:none;overflow:hidden';f.src='https://oauth.telegram.org/embed/fixture';s.parentNode.appendChild(f);})();`}));
 await page.route("https://oauth.telegram.org/embed/fixture",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:`<html style="background:transparent"><body style="margin:0;background:transparent;font:22px Arial"><button style="width:560px;height:54px;border:0;border-radius:28px;background:#54a9e3;color:white">Log in as a user with a very long Telegram name</button><span style="display:inline-block;width:50px">👤</span></body></html>`}));
 await page.goto(server.resolvedUrls.local[0]+"login");await page.locator(".loginPanel__primaryAction").click();await page.locator(".loginRegisterChoice__btn").click();await page.locator("#tg-widget-container iframe").waitFor({timeout:5000});await page.waitForTimeout(600);
 for(const [width,height] of [[393,852],[320,568],[852,393],[393,380]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(350);
  const boxes=await page.evaluate(()=>{const box=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scroll:e.scrollWidth,client:e.clientWidth};};return{card:box(".loginAuthModal__card"),body:box(".loginAuthModal__card>.card__body"),widget:box("#tg-widget-container"),frame:box("#tg-widget-container iframe"),viewport:innerWidth};});
  console.log("PASS",engine,width,height,"dialog and complete Telegram widget fit");
  {assert.ok(boxes.card.x>=-1&&boxes.card.x+boxes.card.width<=width+1,"dialog stays within viewport");assert.ok(boxes.frame.x>=boxes.widget.x-1&&boxes.frame.x+boxes.frame.width<=boxes.widget.x+boxes.widget.width+1,"whole widget stays inside its container");}
  if(process.env.APPEARANCE_SCREENSHOT_DIR&&width===393&&height===852)await page.screenshot({path:path.join(process.env.APPEARANCE_SCREENSHOT_DIR,"auth-"+engine+".png")});
 }
 assert.ok(await page.locator(".loginAuthModal .input").first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16),"iOS inputs avoid focus magnification");
 assert.equal(await page.locator("#tg-widget-container iframe").evaluate(e=>getComputedStyle(e).colorScheme),"normal","transparent widget uses its own color scheme");
 for(const width of [280,900,620]){await page.locator("#tg-widget-container iframe").evaluate((f,w)=>f.style.width=w+"px",width);await page.waitForTimeout(150);assert.ok(await page.locator("#tg-widget-container iframe").evaluate(f=>f.getBoundingClientRect().right<=f.parentElement.getBoundingClientRect().right+1),"late Telegram resize stays contained");}
 await page.locator(".loginAuthModal .modal__close").click();
 assert.equal(await page.evaluate(()=>document.body.classList.contains("login-auth-open")),false,"body zoom restored after close");
 await page.locator(".loginPanel__secondaryAction").click();
 await page.locator(".loginAuthModal__card>.card__body").evaluate(e=>e.scrollTop=e.scrollHeight);
 assert.ok(await page.locator(".loginAuthModal__card>.card__body").evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<2),"registration can scroll to its bottom");
 assert.deepEqual(errors,[],"no resize observer feedback loop or runtime errors");
 await context.close();
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
