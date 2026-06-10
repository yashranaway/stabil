import { describe, expect, it, vi } from "vitest";

import { VerificationService } from "./verification.service";

const admin = { id: "admin1", email: "a@x.com", name: null, role: "ADMIN" as const };

describe("VerificationService", () => {
  it("approving a document sets APPROVED + reviewer metadata", async () => {
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue({ id: "d1", status: "PENDING" }),
        update: vi.fn().mockImplementation(({ data }) => ({ id: "d1", ...data })),
      },
    };
    const svc = new VerificationService(prisma as never);
    const out = await svc.review(admin, "d1", true);
    expect(out.status).toBe("APPROVED");
    expect(out.reviewedBy).toBe("admin1");
    expect(prisma.document.update).toHaveBeenCalled();
  });

  it("countApproved counts only APPROVED documents", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const svc = new VerificationService({ document: { count } } as never);
    const n = await svc.countApproved("p1");
    expect(n).toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { profileId: "p1", status: "APPROVED" } });
  });
});
