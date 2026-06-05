import { BadRequestException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  create(body: { email?: string; name?: string }) {
    const email = body?.email?.trim();
    if (!email) {
      throw new BadRequestException("email is required");
    }
    return this.prisma.user.create({ data: { email, name: body.name?.trim() || null } });
  }
}
