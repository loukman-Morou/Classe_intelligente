import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { ProfessorRoleGuard } from './guards/professor-role.guard';
import { ProfessorCourseOwnerGuard, RequestWithProfCourse } from './guards/professor-course-owner.guard';
import { ProfessorService } from './professor.service';
import { CreateProfessorCourseDto } from './dto/create-professor-course.dto';
import { ShareCourseToClassDto } from './dto/share-course.dto';
import { CreateUpdateProposalDto } from './dto/create-update-proposal.dto';
import { ReviewProposalDto } from './dto/review-proposal.dto';

/**
 * Deux groupes de routes :
 *
 *   /professor/*   → espace du professeur (rôle PROFESSOR requis)
 *   /classes/:classId/proposals/* + /proposals/:id/review
 *                  → côté responsable de classe (tout user authentifié,
 *                    autorisation vérifiée dans le service)
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ProfessorController {
  constructor(private readonly professorService: ProfessorService) {}

  // -------------------------------------------------------------------------
  // Espace professeur — cours originaux
  // -------------------------------------------------------------------------

  /** POST /professor/courses — créer un cours original */
  @Post('professor/courses')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ProfessorRoleGuard)
  createCourse(
    @Body() dto: CreateProfessorCourseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.createCourse(dto, user.userId);
  }

  /** GET /professor/courses — mes cours originaux */
  @Get('professor/courses')
  @UseGuards(ProfessorRoleGuard)
  findMyCourses(@CurrentUser() user: RequestUser) {
    return this.professorService.findMyCourses(user.userId);
  }

  /** GET /professor/radar — radar pédagogique cross-classes */
  @Get('professor/radar')
  @UseGuards(ProfessorRoleGuard)
  getRadar(@CurrentUser() user: RequestUser) {
    return this.professorService.getPedagogicalRadar(user.userId);
  }

  /**
   * POST /professor/courses/:professorCourseId/share
   * Partager un cours vers une classe (crée une copie indépendante).
   * ProfessorCourseOwnerGuard attache profCourseContext à la requête.
   */
  @Post('professor/courses/:professorCourseId/share')
  @UseGuards(ProfessorRoleGuard, ProfessorCourseOwnerGuard)
  shareCourse(
    @Req() req: RequestWithProfCourse,
    @Body() dto: ShareCourseToClassDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.shareCourseToClass(
      req.profCourseContext!,
      dto,
      user.userId,
    );
  }

  /**
   * DELETE /professor/courses/:professorCourseId/share/:classId
   * Révoquer un partage existant.
   */
  @Delete('professor/courses/:professorCourseId/share/:classId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ProfessorRoleGuard, ProfessorCourseOwnerGuard)
  revokeShare(
    @Req() req: RequestWithProfCourse,
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.revokeShare(
      req.profCourseContext!,
      classId,
      user.userId,
    );
  }

  // -------------------------------------------------------------------------
  // Propositions de mise à jour (côté professeur)
  // -------------------------------------------------------------------------

  /**
   * POST /professor/courses/:professorCourseId/proposals
   * Proposer une mise à jour vers une copie classe.
   */
  @Post('professor/courses/:professorCourseId/proposals')
  @UseGuards(ProfessorRoleGuard, ProfessorCourseOwnerGuard)
  proposeUpdate(
    @Req() req: RequestWithProfCourse,
    @Body() dto: CreateUpdateProposalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.proposeUpdate(
      req.profCourseContext!,
      dto,
      user.userId,
    );
  }

  /**
   * DELETE /professor/proposals/:proposalId/cancel
   * Annuler une proposition encore PENDING.
   */
  @Delete('professor/proposals/:proposalId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ProfessorRoleGuard)
  cancelProposal(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.cancelProposal(proposalId, user.userId);
  }

  // -------------------------------------------------------------------------
  // Côté classe — traitement des propositions (responsable)
  // -------------------------------------------------------------------------

  /**
   * GET /classes/:classId/proposals
   * Liste les propositions PENDING reçues pour cette classe.
   * Autorisation vérifiée dans le service (owner/co-owner uniquement).
   */
  @Get('classes/:classId/proposals')
  getPendingProposals(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.getPendingProposalsForClass(classId, user.userId);
  }

  /**
   * PATCH /proposals/:proposalId/review
   * Accepter ou refuser une proposition.
   * Autorisation vérifiée dans le service (owner/co-owner de la classe).
   */
  @Patch('proposals/:proposalId/review')
  @HttpCode(HttpStatus.OK)
  reviewProposal(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: ReviewProposalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.professorService.reviewProposal(proposalId, dto, user.userId);
  }
}
