import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [CoursesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  // AnalyticsService exporté pour que AiService puisse l'injecter
  // (recordQuestion appelé en fire-and-forget après chaque message).
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
