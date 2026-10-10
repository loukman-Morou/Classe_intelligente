import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptBuilderService } from './prompt-builder.service';
import { RagModule } from '../rag/rag.module';
import { CoursesModule } from '../courses/courses.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [RagModule, CoursesModule, AnalyticsModule],
  controllers: [AiController],
  providers: [AiService, PromptBuilderService],
  exports: [AiService],
})
export class AiModule {}
