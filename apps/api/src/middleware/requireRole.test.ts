import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "./requireRole.js";
import { Role } from "../generated/prisma/enums.js";

function createFakeRequest(role: Role): FastifyRequest {
  return { authContext: { userId: "user-1", tenantId: "tenant-1", role } } as unknown as FastifyRequest;
}

function createFakeReply() {
  const send = vi.fn<(payload: unknown) => void>();
  const code = vi.fn<(statusCode: number) => { send: typeof send }>(() => ({ send }));
  const reply = { code } as unknown as FastifyReply;
  return { reply, code, send };
}

describe("requireRole", () => {
  it("izin verilen rollerden biriyse true döner, yanıt göndermez", () => {
    const request = createFakeRequest(Role.OWNER);
    const { reply, code } = createFakeReply();

    const result = requireRole(request, reply, [Role.OWNER, Role.ENGINEER]);

    expect(result).toBe(true);
    expect(code).not.toHaveBeenCalled();
  });

  it("izin verilmeyen bir rolse false döner ve 403 gönderir", () => {
    const request = createFakeRequest(Role.DEALER);
    const { reply, code, send } = createFakeReply();

    const result = requireRole(request, reply, [Role.OWNER, Role.ENGINEER]);

    expect(result).toBe(false);
    expect(code).toHaveBeenCalledWith(403);
    // expect.objectContaining()/expect.any() vitest'te `any` döner (bilinen tip boşluğu).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
