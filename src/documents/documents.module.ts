import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FileValidationService } from './file-validation.service';
import { ChunkingService } from './chunking.service';
import { StorageModule } from '../storage/storage.module';
import { ProcessingModule } from '../processing/processing.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [StorageModule, ProcessingModule, CoursesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, FileValidationService, ChunkingService],
  exports: [DocumentsService, FileValidationService, ChunkingService],
})
export class DocumentsModule {}
