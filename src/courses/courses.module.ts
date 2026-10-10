import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CourseAccessGuard } from './guards/course-access.guard';
import { CourseClassOwnerGuard } from './guards/course-class-owner.guard';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [ClassesModule],
  controllers: [CoursesController],
  providers: [CoursesService, CourseAccessGuard, CourseClassOwnerGuard],
  exports: [CoursesService, CourseAccessGuard],
})
export class CoursesModule {}
