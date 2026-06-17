import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserApiKey, UserApiKeySchema } from './schemas/user-api-key.schema';
import { UserKeysController } from './user-keys.controller';
import { UserKeysService } from './user-keys.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserApiKey.name, schema: UserApiKeySchema }]),
  ],
  controllers: [UserKeysController],
  providers:   [UserKeysService],
  exports:     [UserKeysService],
})
export class UserKeysModule {}
