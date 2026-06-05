import { Body, Controller, Get, Post } from "@nestjs/common";

import { UsersService } from "./users.service";

@Controller("api/v1/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() body: { email?: string; name?: string }) {
    return this.users.create(body);
  }
}
