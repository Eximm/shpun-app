// api/src/app/plugins/jsonBody.ts
//
// Fastify's default JSON parser rejects an empty body with
// FST_ERR_CTP_EMPTY_JSON_BODY when Content-Type is application/json.
//
// Some server-to-server clients (notably the SHM Telegram template calling
// http.post / http.get with all parameters in the query string) send
// `Content-Type: application/json` with an EMPTY body. Treat an empty JSON
// body as an empty object so those requests reach the route handler.
//
// Malformed non-empty JSON still fails with the normal parse error.

import type { FastifyInstance } from "fastify";

export function registerTolerantJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
}
