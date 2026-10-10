import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { RevisionService } from './revision.service';
import { RagModule } from '../rag/rag.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [RagModule, CoursesModule],
  controllers: [QuizzesController],
  providers: [RevisionService],
  exports: [RevisionService],
})
export class QuizzesModule {}
