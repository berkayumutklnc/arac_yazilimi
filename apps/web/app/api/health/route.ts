import { NextResponse } from "next/server";

// Docker healthcheck + Caddy upstream health + scripts/uptime-check.sh için
// (bkz. docs/adr/0015-production-deployment-architecture.md). Kimlik
// doğrulama gerektirmez, hiçbir kişisel/iş verisi taşımaz.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
