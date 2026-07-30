import type { Role } from "../generated/prisma/enums.js";

// Amaca özel metod stili — EcuFileStoragePort ile aynı (bkz.
// modules/ecufile/ecuFileUpload.service.ts). Yalnızca sendInvitationEmail
// var; yeni bir e-posta türü gerçekten ortaya çıkınca yeni bir metod eklenir
// (YAGNI — genel amaçlı send(message) YOK).
export interface InvitationEmailParams {
  toEmail: string;
  tenantName: string;
  role: Role;
  // Tam oluşturulmuş link — çağıran webAppBaseUrl + ham token'dan kurar.
  // Ham token BAŞKA hiçbir yerde (ör. bu interface'te ayrı bir alan olarak)
  // taşınmaz.
  redeemUrl: string;
  expiresAt: Date;
}

export interface EmailSender {
  sendInvitationEmail(params: InvitationEmailParams): Promise<void>;
}

// Gerçek gönderici gelene kadar (bkz. ADR 0011) yerel geliştirme varsayılanı
// — davet linkini terminale yazar, geliştirici kopyalayıp tarayıcıda açar.
export class ConsoleEmailSender implements EmailSender {
  async sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
    console.log(
      `[davet e-postası] ${params.toEmail} (${params.tenantName}, rol: ${params.role}) → ${params.redeemUrl} (son geçerlilik: ${params.expiresAt.toISOString()})`,
    );
    await Promise.resolve();
  }
}

// Otomatik test paketleri için — log gürültüsü olmadan sessizce çözülür.
export class NoopEmailSender implements EmailSender {
  async sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
    void params;
    await Promise.resolve();
  }
}
