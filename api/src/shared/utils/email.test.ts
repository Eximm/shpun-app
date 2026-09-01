import assert from "node:assert/strict";
import test from "node:test";

import {
  isDisposableEmailDomain,
  validateRegistrationEmailBasic,
} from "./email.js";

test("rejects known disposable domains and their subdomains", () => {
  for (const email of [
    "q3zize2b@huad.ru",
    "user@mailinator.com",
    "user@sub.yopmail.com",
    "user@temp-mail.org",
    "user@mail.tm",
    "user@mailto.plus",
    "user@1secmail.com",
    "user@jmaie.com",
  ]) {
    assert.deepEqual(validateRegistrationEmailBasic(email), {
      ok: false,
      normalized: email,
      code: "email_disposable",
    });
  }
});

test("rejects obvious rotating disposable-domain names", () => {
  assert.equal(isDisposableEmailDomain("temporary-mail.example"), true);
  assert.equal(isDisposableEmailDomain("throwawayemail.example"), true);
  assert.equal(isDisposableEmailDomain("10minutemail.example"), true);
});

test("keeps normal public and private mail domains valid", () => {
  for (const email of [
    "person@gmail.com",
    "person@mail.ru",
    "person@yandex.ru",
    "person@outlook.com",
    "person@proton.me",
    "person@company.example",
  ]) {
    assert.deepEqual(validateRegistrationEmailBasic(email), {
      ok: true,
      normalized: email,
    });
  }
});
