import type { Role } from "../generated/prisma/enums.js";
import type { createTenantScopedDb } from "../db/tenantScopedDb.js";

// Doğrulanmış JWT'den türetilir (bkz. authPreHandler.ts) — hiçbir route
// body/query/param'dan tenantId/userId/role okumamalı, yalnızca bunu kullanmalı.
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext;
    tenantDb: ReturnType<typeof createTenantScopedDb>;
  }
}
