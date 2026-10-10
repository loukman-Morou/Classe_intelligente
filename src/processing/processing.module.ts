import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProcessingProducerService, OCR_QUEUE, PURGE_QUEUE } from './processing-producer.service';
import { OcrWorker } from './workers/ocr.worker';
import { PurgeWorker } from './workers/purge.worker';
import { OcrModule } from '../ocr/ocr.module';
import { StorageModule } from '../storage/storage.module';
import { ChunkingService } from '../documents/chunking.service';
import { RagModule } from '../rag/rag.module';
import { RedisConfig } from '../config/configuration';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<RedisConfig>('redis').url,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: OCR_QUEUE },
      { name: PURGE_QUEUE },
    ),
    OcrModule,
    StorageModule,
    RagModule,
  ],
  providers: [
    ProcessingProducerService,
    ChunkingService,
    OcrWorker,
    PurgeWorker,
  ],
  exports: [ProcessingProducerService, ChunkingService],
})
export class ProcessingModule {}
