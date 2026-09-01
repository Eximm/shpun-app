import type { FastifyInstance, FastifyRequest } from "fastify";
import { validateRegistrationEmail } from "../../shared/utils/email.js";

function isPrivateAddress(value: unknown): boolean {
  const ip = String(value ?? "").replace(/^::ffff:/, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const match = ip.match(/^172\.(\d+)\./);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function isInternalRequest(req: FastifyRequest): boolean {
  const host = String(req.headers.host ?? "").split(":", 1)[0].toLowerCase();
  return isPrivateAddress(req.ip) && (
    host === "shpun-app-api" ||
    host === "127.0.0.1" ||
    host === "localhost"
  );
}

export async function emailValidationRoutes(app: FastifyInstance) {
  app.get("/internal/email-domain/check", async (req, reply) => {
    if (!isInternalRequest(req)) {
      return reply.code(404).send({ ok: false, code: "not_found" });
    }

    const domain = String((req.query as any)?.domain ?? "").trim().toLowerCase();
    const result = await validateRegistrationEmail(`check@${domain}`);
    return reply.send({ ok: result.ok, code: result.code ?? null });
  });
}
