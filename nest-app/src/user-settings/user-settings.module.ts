import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserSettings, UserSettingsSchema, UserSettingsRepository } from './user-settings.repository';
import { UserSettingsService } from './user-settings.service';
import { UserSettingsController } from './user-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserSettings.name, schema: UserSettingsSchema }]),
  ],
  controllers: [UserSettingsController],
  providers:   [UserSettingsRepository, UserSettingsService],
  exports:     [UserSettingsService],
})
export class UserSettingsModule {}
