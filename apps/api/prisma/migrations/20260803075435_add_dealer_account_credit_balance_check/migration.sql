ALTER TABLE "DealerAccount"
  ADD CONSTRAINT "DealerAccount_creditBalanceKurus_check" CHECK ("creditBalanceKurus" >= 0);
