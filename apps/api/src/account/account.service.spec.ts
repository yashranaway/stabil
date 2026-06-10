import { describe, expect, it, vi } from "vitest";

import { AccountService } from "./account.service";

describe("AccountService.deleteAccount", () => {
  it("runs one transaction with all four cleanup operations", async () => {
    const tx = vi.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: tx,
      refreshToken: { deleteMany: vi.fn().mockReturnValue("refresh") },
      shareGrant: { updateMany: vi.fn().mockReturnValue("shares") },
      candidateProfile: { updateMany: vi.fn().mockReturnValue("profiles") },
      user: { update: vi.fn().mockReturnValue("user") },
    };
    const svc = new AccountService(prisma as never);

    await svc.deleteAccount({ id: "u1", email: "a@b.c", name: null, role: "CANDIDATE" });

    expect(tx).toHaveBeenCalledOnce();
    expect(tx.mock.calls[0][0]).toHaveLength(4);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
