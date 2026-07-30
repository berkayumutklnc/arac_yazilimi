import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./authPassword.js";

describe("hashPassword / verifyPassword", () => {
  it("aynı şifreden her seferinde farklı bir hash üretir (salt)", async () => {
    const h1 = await hashPassword("s3cret-pass");
    const h2 = await hashPassword("s3cret-pass");
    expect(h1).not.toBe(h2);
  });

  it("doğru şifre ile doğrulama başarılı olur", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "correct-horse-battery-staple")).resolves.toBe(true);
  });

  it("yanlış şifre ile doğrulama başarısız olur", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });

  it("bozuk/geçersiz bir hash string'i hata fırlatmadan false döner", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });
});
