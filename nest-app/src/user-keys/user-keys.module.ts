import { Module } from '@nestjs/common';
import { UserKeysController } from './user-keys.controller';

@Module({
  controllers: [UserKeysController],
})
export class UserKeysModule {}
