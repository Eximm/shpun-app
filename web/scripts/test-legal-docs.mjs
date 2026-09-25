#!/usr/bin/env node
// Regression for the service documents module (LegalDocs) and its synced
// Telegram-bot legal HTML template.
//
// Locks in:
//   - a dedicated "Оплата и возвраты" document, shared wording with the bot page
//   - VPON usage terms, refunds and bonus semantics identical in both places
//   - in-app support CTA (no more @shpun_staff as the main contact)
//   - a mini TOC with anchors, FAQ blocks and a single revision date
//   - mobile-safe navigation and no page overflow
//   - the bot legal template stays full HTML with balanced tags and anchors
//
// Usage: npm run test:legal-docs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");
const readMaybe = (rel) => {
  const p = path.join(webRoot, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\r\n?/g, "\n") : "";
};

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}
const count = (haystack, needle) => haystack.split(needle).length - 1;

const docs = read("src/pages/LegalDocs.tsx");
const css = read("src/index.css");
const bot = readMaybe("../local-billing/shpun_legal.production.tpl");

/* ── Payment document + shared wording ────────────────────────────────────── */

assert("payment document exists", docs.includes('key: "payment"') && docs.includes('title: "Оплата и возвраты"'));
assert("payment doc is the first navigation entry", docs.indexOf('key: "payment"') < docs.indexOf('key: "privacy"'));
assert("payment doc covers balance sections", ["Основной баланс", "Бонусный баланс", "Оплата услуг", "Подписки", "Возвраты", "Если возникла проблема с подключением"].every((s) => docs.includes(s)));
assert("payment doc has FAQ blocks", docs.includes("faq:") && docs.includes("Можно ли вывести бонусы?"));

/* ── Balance / bonus / refund wording ─────────────────────────────────────── */

assert("main balance text present", docs.includes("авансовый платёж для оплаты услуг"));
assert("main balance does not guarantee a specific server", docs.includes("не закрепляет за пользователем конкретный сервер"));
assert("bonus restrictions listed", ["нельзя вывести", "нельзя обменять на деньги", "нельзя вернуть на банковскую карту"].every((s) => docs.includes(s)));
assert("bonus share limit is not hardcoded as universal", docs.includes("Например") && docs.includes("если для услуги установлен такой лимит"));
assert("zero vs unavailable is explained", docs.includes("0 ₽ и недоступность оплаты — разные состояния"));
assert("refunds are individual", docs.includes("Возвраты рассматриваются индивидуально"));
assert("refund alternatives listed", docs.includes("обновление подписки или ключа") && docs.includes("резервную ссылку или QR"));
assert("refund is within applicable law", docs.includes("в пределах, допускаемых применимым законодательством"));

/* ── Legal safety: no absolute/contradictory wording ──────────────────────── */

for (const bad of ["возврат невозможен", "возвратов нет", "не положен", "никаких гарантий вообще"]) {
  assert(`no absolute wording: "${bad}"`, !docs.includes(bad));
}

/* ── Support CTA: in-app, not @shpun_staff ────────────────────────────────── */

assert("contacts has an in-app support CTA", docs.includes('cta: { label: "Открыть поддержку", to: "/support" }'));
assert("support CTA renders through the router Link", docs.includes("to={section.cta.to}"));
assert("old @shpun_staff is gone from the app docs", !docs.includes("shpun_staff") && !docs.includes("SUPPORT_TELEGRAM"));
assert("email is the secondary contact", docs.includes("shpynsdn@gmail.com"));

/* ── Terms: VPN semantics ─────────────────────────────────────────────────── */

for (const section of [
  "Что предоставляет подписка",
  "Доступность инфраструктуры",
  "Внешние ограничения",
  "Скорость и стабильность",
  "Работа сторонних сервисов",
  "Обязанности пользователя при диагностике",
  "Поддержка",
]) {
  assert(`terms has section: ${section}`, docs.includes(section));
}
assert("external dependencies listed", ["интернет-провайдера", "мобильного оператора", "блокировок", "маршрутизации"].every((s) => docs.includes(s)));
assert("reasonable-effort wording present", docs.includes("предпринимает разумные меры"));

/* ── Overview ─────────────────────────────────────────────────────────────── */

assert("overview has a Главное section", docs.includes(">Главное<") && docs.includes("Основной баланс используется для оплаты услуг"));
assert("overview highlights bonuses are non-withdrawable", docs.includes("Бонусы используются только внутри Shpun и не выводятся"));
assert("overview highlights variable server composition", docs.includes("Состав серверов, стран и протоколов может меняться"));
assert("overview cards come from the docs config", /legal-grid[\s\S]*?docs\.map/.test(docs));

/* ── TOC + navigation + revision (app) ────────────────────────────────────── */

assert("document renders a TOC", docs.includes('className="legal-toc"') && docs.includes("Содержание"));
assert("TOC anchors are generated per section", docs.includes("id={`legal-${doc.key}-${index}`}") && docs.includes("scrollIntoView"));
assert("single revision date constant", docs.includes('const EDITION_DATE = "25.09.2026"'));
assert("revision date is not duplicated", (docs.match(/EDITION_DATE/g) || []).length >= 3 && !docs.includes("21.05.2026"));
assert("tabs use six entries", /\.legal-tabs \{[\s\S]*?repeat\(6, minmax\(0,1fr\)\)/.test(css));

/* ── Readability + mobile safety (app) ────────────────────────────────────── */

assert("reading line-height is comfortable", /\.legal-p \{[\s\S]*?line-height: 1.62;/.test(css));
assert("callout + faq styles exist", css.includes(".legal-callout {") && css.includes(".legal-faq__item {"));
assert("support CTA style exists", css.includes(".legal-cta {"));
assert("anchored sections offset the sticky nav", css.includes(".legal-section-card {\n  scroll-margin-top: 96px;"));
assert("tabs scroll on mobile", /@media \(max-width: 680px\) \{[\s\S]*?\.legal-tabs \{[\s\S]*?overflow-x: auto;/.test(css));
assert("TOC scrolls on mobile", /@media \(max-width: 680px\) \{[\s\S]*?\.legal-toc \{[\s\S]*?overflow-x: auto;/.test(css));

/* ── Bot legal template: full HTML, synced content, support CTA ───────────── */

assert("bot legal template file exists", bot.length > 0);
assert("bot template is a full HTML page", bot.startsWith("<!DOCTYPE html>") && bot.trimEnd().endsWith("</html>"));
assert("bot template has balanced section tags", count(bot, "<section") === count(bot, "</section>"));
assert("bot template has balanced div tags", count(bot, "<div") === count(bot, "</div>"));
assert("bot template has balanced style tags", count(bot, "<style") === count(bot, "</style>"));
assert("bot template has balanced script tags", count(bot, "<script") === count(bot, "</script>"));
assert("bot template keeps the six anchors", ["#overview", "#payments", "#privacy", "#offer", "#terms", "#contacts"].every((a) => bot.includes(`href="${a}"`)));
assert("bot template has an in-app support CTA", bot.includes("https://app.shpun.net/support") && bot.includes("Открыть поддержку") && bot.includes("js-support"));
assert("bot template does not use @shpun_staff", !bot.includes("shpun_staff"));
assert("bot template shows the revision date", bot.includes("25.09.2026"));
assert("bot template keeps the email as secondary contact", bot.includes("shpynsdn@gmail.com"));
assert("bot template has the Главное block", bot.includes("Главное") && bot.includes("Основной баланс используется для оплаты услуг"));
assert("bot template has payments semantics", bot.includes("авансовый платёж для оплаты услуг") && bot.includes("нельзя вывести") && bot.includes("Возвраты рассматриваются индивидуально"));
assert("bot template has VPN limitations", bot.includes("интернет-провайдера") && bot.includes("предпринимает разумные меры"));
assert("bot template has TOC + FAQ", bot.includes('class="toc"') && bot.includes('class="faq"'));
assert("bot template has a mobile viewport", bot.includes('name="viewport"'));
assert("bot template opens links via Telegram WebApp", bot.includes("Telegram.WebApp") && bot.includes("openLink"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: service documents (app + bot) synced, in-app support CTA, TOC, revision verified");