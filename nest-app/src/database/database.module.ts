import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('mongodb.uri');
        const dbName = configService.get<string>('mongodb.db');
        const serverSelectionTimeoutMS = configService.get<number>('mongodb.serverSelectionTimeoutMs') ?? 8_000;
        if (!uri) throw new Error('MONGODB_URI environment variable is required');
        return { uri, dbName, serverSelectionTimeoutMS };
      },
    }),
  ],
})
export class DatabaseModule {}
