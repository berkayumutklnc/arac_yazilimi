import { describe, expect, it, vi } from "vitest";
import { Role } from "../generated/prisma/enums.js";
import { ConsoleEmailSender, NoopEmailSender } from "./emailSender.js";

const params = {
  toEmail: "owner@acme.test",
  tenantName: "Acme Atölye",
  role: Role.OWNER,
  redeemUrl: "https://app.example.test/invite/accept?token=abc123",
  expiresAt: new Date("2026-08-06T00:00:00Z"),
};

describe("ConsoleEmailSender", () => {
  it("davet linkini içeren bir satır loglar, hata fırlatmaz", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await new ConsoleEmailSender().sendInvitationEmail(params);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(loggedLine).toContain(params.redeemUrl);
    expect(loggedLine).toContain(params.toEmail);

    logSpy.mockRestore();
  });
});

describe("NoopEmailSender", () => {
  it("hiçbir şey yapmadan sessizce çözülür (test ortamı varsayılanı)", async () => {
    await expect(new NoopEmailSender().sendInvitationEmail(params)).resolves.toBeUndefined();
  });
});
