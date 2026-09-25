#!/usr/bin/env node
// Regression for the service documents module (LegalDocs).
//
// Locks in:
//   - a dedicated "Оплата и возвраты" document (balance / bonuses / subscriptions / refunds)
//   - VPN usage terms with availability/external-limitation semantics
//   - a useful overview ("Главное") + compact doc cards
//   - a mini TOC with working anchors and a single revision date
//   - mobile-safe navigation (scrollable tabs / TOC, no page overflow)
//   - legally safe wording (no absolute "no refunds" claims)
//
// Usage: npm run test:legal-docs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const docs = read("src/pages/LegalDocs.tsx");
const css = read("src/index.css");

/* ── New payment document ─────────────────────────────────────────────────── */

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

/* ── TOC + navigation + revision ──────────────────────────────────────────── */

assert("document renders a TOC", docs.includes('className="legal-toc"') && docs.includes("Содержание"));
assert("TOC anchors are generated per section", docs.includes("id={`legal-${doc.key}-${index}`}") && docs.includes("scrollIntoView"));
assert("single revision date constant", docs.includes('const EDITION_DATE = "25.09.2026"'));
assert("revision date is not duplicated", (docs.match(/EDITION_DATE/g) || []).length >= 3 && !docs.includes("21.05.2026"));
assert("tabs use six entries", /\.legal-tabs \{[\s\S]*?repeat\(6, minmax\(0,1fr\)\)/.test(css));

/* ── Readability + mobile safety ──────────────────────────────────────────── */

assert("reading line-height is comfortable", /\.legal-p \{[\s\S]*?line-height: 1.62;/.test(css));
assert("callout + faq styles exist", css.includes(".legal-callout {") && css.includes(".legal-faq__item {"));
assert("anchored sections offset the sticky nav", css.includes(".legal-section-card {\n  scroll-margin-top: 96px;"));
assert("tabs scroll on mobile", /@media \(max-width: 680px\) \{[\s\S]*?\.legal-tabs \{[\s\S]*?overflow-x: auto;/.test(css));
assert("TOC scrolls on mobile", /@media \(max-width: 680px\) \{[\s\S]*?\.legal-toc \{[\s\S]*?overflow-x: auto;/.test(css));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: service documents (payment/refunds, VPN terms, TOC, overview) verified");