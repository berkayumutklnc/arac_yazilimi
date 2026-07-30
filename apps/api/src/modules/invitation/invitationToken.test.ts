import { describe, expect, it } from "vitest";
import { generateInvitationToken, hashInvitationToken, INVITATION_TTL_MS } from "./invitationToken.js";

describe("generateInvitationToken / hashInvitationToken", () => {
  it("her çağrıda farklı bir ham token üretir, hash'i deterministik olarak eşleştirir", () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashInvitationToken(first.token));
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it("expiresAt, INVITATION_TTL_MS kadar ileride bir tarih olur", () => {
    const before = Date.now();
    const { expiresAt } = generateInvitationToken();
    const after = Date.now();

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + INVITATION_TTL_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + INVITATION_TTL_MS);
  });
});
