import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedEmailDomain,
  validateRegistrationEmailBasic,
} from "./email.js";

test("rejects every domain outside the allowlist", () => {
  for (const email of [
    "wwweer@1234443.vb",
    "user@emailgen.uk",
    "user@jmaie.com",
    "user@mailto.plus",
    "user@company.example",
    "user@sub.gmail.com",
  ]) {
    assert.deepEqual(validateRegistrationEmailBasic(email), {
      ok: false,
      normalized: email,
      code: "email_domain_not_allowed",
    });
  }
});

test("accepts popular permanent mailbox providers", () => {
  for (const email of [
    "person@gmail.com",
    "person@mail.ru",
    "person@bk.ru",
    "person@yandex.ru",
    "person@rambler.ru",
    "person@outlook.com",
    "person@yahoo.com",
    "person@icloud.com",
    "person@proton.me",
    "person@tuta.com",
    "person@gmx.de",
    "person@ukr.net",
  ]) {
    assert.deepEqual(validateRegistrationEmailBasic(email), {
      ok: true,
      normalized: email,
    });
  }
});

test("matches allowed domains exactly", () => {
  assert.equal(isAllowedEmailDomain("gmail.com"), true);
  assert.equal(isAllowedEmailDomain("GMAIL.COM"), true);
  assert.equal(isAllowedEmailDomain("sub.gmail.com"), false);
  assert.equal(isAllowedEmailDomain("gmail.com.example"), false);
});

test("still rejects malformed mailbox input", () => {
  assert.equal(validateRegistrationEmailBasic("a@gmail.com").code, "email_local_too_short");
  assert.equal(validateRegistrationEmailBasic("bad..name@gmail.com").code, "email_local_invalid");
  assert.equal(validateRegistrationEmailBasic("name@gmail").code, "email_invalid_format");
  assert.equal(validateRegistrationEmailBasic("name@@gmail.com").code, "email_invalid_format");
});
