import { Module } from '@nestjs/common';
import { ProfessorController } from './professor.controller';
import { ProfessorService } from './professor.service';
import { ProfessorRoleGuard } from './guards/professor-role.guard';
import { ProfessorCourseOwnerGuard } from './guards/professor-course-owner.guard';

@Module({
  controllers: [ProfessorController],
  providers: [ProfessorService, ProfessorRoleGuard, ProfessorCourseOwnerGuard],
  exports: [ProfessorService],
})
export class ProfessorModule {}
