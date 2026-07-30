import { createSigner } from "fast-jwt";
import { describe, expect, it } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  InvalidAccessTokenError,
  type AccessTokenPayload,
} from "./authToken.js";

const secret = "test-secret-do-not-use-in-prod";
const payload: AccessTokenPayload = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "OWNER",
};

describe("signAccessToken / verifyAccessToken", () => {
  it("imzalanan token doğru payload ile doğrulanır", () => {
    const token = signAccessToken(payload, secret);
    const decoded = verifyAccessToken(token, secret);

    expect(decoded).toEqual(payload);
  });

  it("bozuk bir token InvalidAccessTokenError fırlatır", () => {
    expect(() => verifyAccessToken("not-a-jwt", secret)).toThrow(InvalidAccessTokenError);
  });

  it("farklı bir sırla imzalanmış (sahte) token InvalidAccessTokenError fırlatır", () => {
    const forged = signAccessToken(payload, "attacker-controlled-secret");
    expect(() => verifyAccessToken(forged, secret)).toThrow(InvalidAccessTokenError);
  });

  it("süresi dolmuş bir token InvalidAccessTokenError fırlatır", () => {
    const expiredSigner = createSigner({ key: secret, expiresIn: -1000 });
    const expiredToken = expiredSigner(payload);

    expect(() => verifyAccessToken(expiredToken, secret)).toThrow(InvalidAccessTokenError);
  });

  it("eksik alanlı bir payload ile imzalanmış token InvalidAccessTokenError fırlatır", () => {
    const incompleteSigner = createSigner({ key: secret });
    const incompleteToken = incompleteSigner({ userId: "user-1" });

    expect(() => verifyAccessToken(incompleteToken, secret)).toThrow(InvalidAccessTokenError);
  });

  it("geçerli bir Role değeri olmayan (kurcalanmış) role alanı InvalidAccessTokenError fırlatır", () => {
    const signer = createSigner({ key: secret });
    const tamperedToken = signer({ userId: "user-1", tenantId: "tenant-1", role: "SUPERADMIN" });

    expect(() => verifyAccessToken(tamperedToken, secret)).toThrow(InvalidAccessTokenError);
  });
});

describe("generateRefreshToken / hashRefreshToken", () => {
  it("her çağrıda farklı bir token üretir", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toBe(b.token);
  });

  it("token ve hash'i farklıdır; hashRefreshToken aynı token için deterministiktir", () => {
    const { token, tokenHash } = generateRefreshToken();
    expect(tokenHash).not.toBe(token);
    expect(hashRefreshToken(token)).toBe(tokenHash);
  });

  it("expiresAt gelecekte bir zamandır", () => {
    const { expiresAt } = generateRefreshToken();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
