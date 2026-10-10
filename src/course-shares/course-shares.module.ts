import { Module } from '@nestjs/common';
import { CourseSharesController } from './course-shares.controller';
import { CourseSharesService } from './course-shares.service';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [ClassesModule],
  controllers: [CourseSharesController],
  providers: [CourseSharesService],
  exports: [CourseSharesService],
})
export class CourseSharesModule {}
