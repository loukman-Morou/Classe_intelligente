import { Module } from '@nestjs/common';
import { PedagogicalInsightsController } from './pedagogical-insights.controller';
import { PedagogicalInsightsService } from './pedagogical-insights.service';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [CoursesModule],
  controllers: [PedagogicalInsightsController],
  providers: [PedagogicalInsightsService],
  exports: [PedagogicalInsightsService],
})
export class PedagogicalInsightsModule {}
