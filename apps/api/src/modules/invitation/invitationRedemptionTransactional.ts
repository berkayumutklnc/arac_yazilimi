import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import {
  redeemInvitation,
  InvalidInvitationTokenError,
  type InvitationRedemptionDb,
  type RedeemInvitationResult,
} from "./invitationRedemption.service.js";

// bkz. docs/adr/0011-invitation-model.md. redeemInvitation'ın saf, fake ile
// test edilmiş mantığını DEĞİŞTİRMEZ; yalnızca prisma.$transaction üzerinde
// çalışan ÜRETİM adaptörünü sağlar — guard'lı updateMany (tek-kullanımlık) +
// user.create AYNI transaction'da, biri diğerinden bağımsız commit edilemez.
const UNIQUE_VIOLATION_CODE = "P2002";

function buildTransactionalDb(tx: Prisma.TransactionClient): InvitationRedemptionDb {
  return {
    invitation: {
      findUnique: (args) => tx.invitation.findUnique(args),
      updateMany: (args) => tx.invitation.updateMany(args),
    },
    user: {
      create: (args) => tx.user.create(args),
    },
  };
}

export async function redeemInvitationTransactional(
  prisma: PrismaClient,
  token: string,
  newPassword: string,
): Promise<RedeemInvitationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const db = buildTransactionalDb(tx);
      return redeemInvitation(db, token, newPassword);
    });
  } catch (error) {
    // (tenantId,email) unique index'ine çarpma — bu davet kabul edilmeden
    // ÖNCE aynı e-postayla tenant'ta zaten aktif bir User oluşmuş (ör. iki
    // davetin yarışı) — enumeration direnci için aynı generic hataya çevrilir.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION_CODE) {
      throw new InvalidInvitationTokenError();
    }
    throw error;
  }
}
