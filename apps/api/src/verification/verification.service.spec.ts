import { describe, expect, it, vi } from "vitest";

import { VerificationService } from "./verification.service";

const admin = { id: "admin1", email: "a@x.com", name: null, role: "ADMIN" as const };

describe("VerificationService", () => {
  it("approving a document sets APPROVED + reviewer metadata", async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({ id: "d1", status: "PENDING", kind: "pan", profile: { ownerUserId: "owner1" } }),
        update: vi.fn().mockImplementation(({ data }) => ({ id: "d1", ...data })),
      },
    };
    const notifications = { create: vi.fn() };
    const storage = { documentsBucket: "docs", presignedPut: vi.fn(), presignedGet: vi.fn() };
    const svc = new VerificationService(prisma as never, notifications as never, storage as never);
    const out = await svc.review(admin, "d1", true);
    expect(out.status).toBe("APPROVED");
    expect(out.reviewedBy).toBe("admin1");
    expect(prisma.document.update).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith("owner1", "verification_result", expect.any(Object));
  });

  it("countApproved counts only APPROVED documents", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const svc = new VerificationService(
      { document: { count } } as never,
      { create: vi.fn() } as never,
      { documentsBucket: "docs", presignedPut: vi.fn(), presignedGet: vi.fn() } as never,
    );
    const n = await svc.countApproved("p1");
    expect(n).toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { profileId: "p1", status: "APPROVED" } });
  });
});
