import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Source, SourceSchema, SourcesService } from './sources.service';
import { SourcesController } from './sources.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Source.name, schema: SourceSchema }]),
  ],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
