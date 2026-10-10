import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { ClassMemberGuard } from './guards/class-member.guard';
import { ClassOwnerGuard } from './guards/class-owner.guard';

@Module({
  controllers: [ClassesController],
  providers: [ClassesService, ClassMemberGuard, ClassOwnerGuard],
  exports: [ClassesService, ClassMemberGuard, ClassOwnerGuard],
})
export class ClassesModule {}
