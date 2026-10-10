import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { CourseAccessGuard } from '../courses/guards/course-access.guard';
import { CourseCtx } from '../courses/decorators/course-context.decorator';
import { CourseAccessContext } from '../courses/courses.types';
import { ProfessorRoleGuard } from '../professor/guards/professor-role.guard';
import { AnalyticsService } from './analytics.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /courses/:courseId/analytics/questions
   *
   * Radar pédagogique d'un cours spécifique.
   * Accès : tout membre du cours (owner, co-owner, professeur assigné, étudiant).
   * Les données retournées sont toujours agrégées — jamais de lien étudiant/question.
   * Le seuil MIN_THRESHOLD est appliqué côté service.
   */
  @Get('courses/:courseId/analytics/questions')
  @UseGuards(CourseAccessGuard)
  getCourseRadar(@CourseCtx() ctx: CourseAccessContext) {
    return this.analyticsService.getCourseRadar(ctx.course.id);
  }

  /**
   * GET /professor/radar
   *
   * Radar cross-classes : toutes les copies de tous les cours du professeur.
   * Réservé aux utilisateurs de rôle PROFESSOR (ProfessorRoleGuard).
   * Le seuil MIN_THRESHOLD est appliqué par topic ET par classe.
   */
  @Get('professor/radar')
  @UseGuards(ProfessorRoleGuard)
  getProfessorRadar(@CurrentUser() user: RequestUser) {
    return this.analyticsService.getProfessorRadar(user.userId);
  }
}
