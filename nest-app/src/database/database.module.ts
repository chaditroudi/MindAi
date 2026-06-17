import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const uri = cfg.get<string>('mongodb.uri');
        const dbName = cfg.get<string>('mongodb.db');
        const serverSelectionTimeoutMS = cfg.get<number>('mongodb.serverSelectionTimeoutMs') ?? 8_000;
        if (!uri) throw new Error('MONGODB_URI environment variable is required');
        return { uri, dbName, serverSelectionTimeoutMS };
      },
    }),
  ],
})
export class DatabaseModule {}
