import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../generated/prisma/enums.js";
import "../types/fastify.js";

// Route-seviyesi rol kontrolü — servis katmanının kendi rol kontrolünün
// (varsa) YERİNE değil, YANINA eklenen bir savunma derinliği katmanı (bkz.
// docs/security-audit.md, bu turun 2. maddesi). `request.authContext` zaten
// authPreHandler tarafından doğrulanmış JWT'den geliyor — hiçbir zaman
// body/query'den okunmaz. 403 gönderirse true/false ile çağırana "devam etme"
// sinyali verir; loglama (varsa) çağıranın sorumluluğunda tutulur ki bu
// yardımcı fonksiyon genel amaçlı kalsın.
export function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedRoles: readonly Role[],
): boolean {
  if (!allowedRoles.includes(request.authContext.role)) {
    void reply.code(403).send({
      error: `Rol "${request.authContext.role}" bu işlemi yapamaz.`,
    });
    return false;
  }
  return true;
}
