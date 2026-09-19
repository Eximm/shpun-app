import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const sourceRoot = path.resolve(process.argv[2] || "");

function read(relativePath) {
  const file = path.join(sourceRoot, relativePath);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`ERROR missing_source_file file=${file}`);
    process.exitCode = 3;
    throw error;
  }
}

function extractSub(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`sub\\s+${escaped}\\s*\\{([\\s\\S]*?)(?=\\nsub\\s|\\n1;\\s*$)`))?.[1] || "";
}

function result(level, id, ok, detail) {
  const status = ok ? "PASS" : level === "critical" ? "FAIL" : "WARN";
  console.log(`${status} ${id} ${detail}`);
  return { level, id, ok, detail };
}

if (!process.argv[2]) {
  console.error("Usage: npm run audit:shm3 -- <path-to-shm-source>");
  process.exit(3);
}

const routes = read("app/public_html/shm/v1.cgi");
const passwd = read("app/lib/Core/User/Passwd.pm");
const user = read("app/lib/Core/User.pm");

const checks = [];

const telegramStart = routes.indexOf("'/telegram/web/auth'");
const oauthStart = routes.indexOf("'/oauth2/init/*'");
const telegramRoutes = telegramStart >= 0
  ? routes.slice(telegramStart, oauthStart > telegramStart ? oauthStart : undefined)
  : "";
const telegramSessionTypes = [...telegramRoutes.matchAll(
  /^ {12}session_id\s*=>\s*\{\s*type\s*=>\s*'([^']+)'/gm
)].map((match) => match[1]);
checks.push(result(
  "critical",
  "telegram_session_schema",
  telegramSessionTypes.length > 0 && telegramSessionTypes.every((type) => type === "string"),
  telegramSessionTypes.length
    ? `types=${telegramSessionTypes.join(",")}; expected all string`
    : "session_id schema not found"
));

const resetVerify = extractSub(passwd, "passwd_reset_verify");
const resetPersistsPassword = /\$self->passwd\s*\(/.test(resetVerify) || /set_password\s*\(/.test(resetVerify);
checks.push(result(
  "critical",
  "password_reset_persists",
  resetPersistsPassword,
  resetPersistsPassword
    ? "reset handler persists the supplied password"
    : "reset handler does not visibly persist the supplied password"
));

const registration = extractSub(user, "reg_api_safe");
const forwardsFullName = /\$self->reg\s*\([\s\S]*?full_name\s*=>/.test(registration);
const forwardsPhone = /\$self->reg\s*\([\s\S]*?phone\s*=>/.test(registration);
checks.push(result(
  "warning",
  "registration_profile_fields",
  forwardsFullName && forwardsPhone,
  `forwards_full_name=${forwardsFullName} forwards_phone=${forwardsPhone}; ShpunApp profile.set is the fallback`
));

const userRouteStart = routes.indexOf("'/user' =>");
const userRouteEnd = routes.indexOf("'/user/referrals'", userRouteStart);
const userRoute = userRouteStart >= 0 ? routes.slice(userRouteStart, userRouteEnd) : "";
const supportsPostUser = /\bPOST\s*=>\s*\{/.test(userRoute);
checks.push(result(
  "warning",
  "profile_post_route",
  supportsPostUser,
  supportsPostUser
    ? "POST /user is present"
    : "POST /user is absent; ShpunApp profile.set fallback is required"
));

const emailRouteStart = routes.indexOf("'/user/email' =>");
const emailRouteEnd = routes.indexOf("'/user/service'", emailRouteStart);
const emailRoute = emailRouteStart >= 0 ? routes.slice(emailRouteStart, emailRouteEnd) : "";
const emailMethods = ["GET", "PUT", "POST", "DELETE"];
const emailComplete = emailMethods.every((method) => new RegExp(`\\b${method}\\s*=>\\s*\\{`).test(emailRoute));
checks.push(result(
  "critical",
  "email_contract",
  emailComplete,
  `required_methods=${emailMethods.join(",")}`
));

const criticalFailures = checks.filter((check) => check.level === "critical" && !check.ok);
const warnings = checks.filter((check) => check.level === "warning" && !check.ok);
console.log(`SUMMARY critical_failures=${criticalFailures.length} warnings=${warnings.length}`);

if (criticalFailures.length) process.exitCode = 2;
