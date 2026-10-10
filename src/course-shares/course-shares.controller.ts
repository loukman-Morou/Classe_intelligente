import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { ClassMemberGuard } from '../classes/guards/class-member.guard';
import { ClassOwnerGuard } from '../classes/guards/class-owner.guard';
import { ClassCtx } from '../classes/decorators/class-context.decorator';
import { ClassContext } from '../classes/classes.types';
import { CourseSharesService } from './course-shares.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class CourseSharesController {
  constructor(private readonly service: CourseSharesService) {}

  // GET /classes/:classId/proposals — owner/co-owner de la classe
  @Get('classes/:classId/proposals')
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  getPendingProposals(@ClassCtx() cls: ClassContext) {
    return this.service.getPendingProposals(cls.id);
  }

  // POST /classes/:classId/proposals/:proposalId/accept — owner/co-owner
  @Post('classes/:classId/proposals/:proposalId/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  accept(
    @ClassCtx() cls: ClassContext,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.acceptProposal(proposalId, cls.id, user.userId);
  }

  // POST /classes/:classId/proposals/:proposalId/reject — owner/co-owner
  @Post('classes/:classId/proposals/:proposalId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  reject(
    @ClassCtx() cls: ClassContext,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.rejectProposal(proposalId, cls.id, user.userId);
  }

  // DELETE /professor-courses/:professorCourseId/proposals/:proposalId
  // (annulation par le professeur — pas besoin de ClassOwnerGuard ici)
  @Delete('professor-courses/:professorCourseId/proposals/:proposalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.cancelProposal(proposalId, user.userId);
  }
}
