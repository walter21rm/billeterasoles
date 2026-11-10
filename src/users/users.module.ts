import { Module } from '@nestjs/common';
import { HttpUserDirectory } from './http-user-directory';
import { UserDirectory } from './user-directory';

@Module({
  providers: [{ provide: UserDirectory, useClass: HttpUserDirectory }],
  exports: [UserDirectory],
})
export class UsersModule {}
