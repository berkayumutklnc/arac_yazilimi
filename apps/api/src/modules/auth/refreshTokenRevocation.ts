// authRefresh.service.ts'nin reuse-detection bloğundan çıkarıldı (saf
// ekstraksiyon, davranış değişmedi) — apps/api/src/modules/user'ın
// deactivateUser'ı da aynı fonksiyonu kullanır (bkz. ADR 0012).
export interface RevokeAllRefreshTokensDb {
  refreshToken: {
    updateMany: (args: {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    }) => Promise<unknown>;
  };
}

export async function revokeAllRefreshTokensForUser(
  db: RevokeAllRefreshTokensDb,
  userId: string,
): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
