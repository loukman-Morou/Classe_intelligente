import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { CourseAccessGuard } from '../courses/guards/course-access.guard';
import { CourseCtx } from '../courses/decorators/course-context.decorator';
import { CourseAccessContext } from '../courses/courses.types';
import { PedagogicalInsightsService } from './pedagogical-insights.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PedagogicalInsightsController {
  constructor(
    private readonly insightsService: PedagogicalInsightsService,
  ) {}

  /**
   * GET /courses/:courseId/pedagogical-insights
   *
   * Retourne les insights déjà calculés pour ce cours.
   * Accès : professeur du cours, owner/co-owner.
   * Les étudiants ne voient pas les insights (non pertinent pour eux).
   */
  @Get('courses/:courseId/pedagogical-insights')
  @UseGuards(CourseAccessGuard)
  findForCourse(@CourseCtx() ctx: CourseAccessContext) {
    // Les insights pédagogiques sont réservés au corps enseignant.
    // Un étudiant ne doit pas voir les statistiques de la classe —
    // même agrégées, elles lui permettraient d'inférer des comportements collectifs.
    if (ctx.courseRole === 'STUDENT') {
      throw new ForbiddenException(
        'Les insights pédagogiques sont réservés aux responsables et professeurs.',
      );
    }
    return this.insightsService.findForCourse(ctx.course.id);
  }

  /**
   * POST /courses/:courseId/pedagogical-insights/generate
   *
   * Déclenche la génération IA des insights.
   * Rate limit : 3 req/heure (génération LLM coûteuse, déclenchée manuellement).
   * Accès : professeur du cours ou owner/co-owner.
   */
  @Post('courses/:courseId/pedagogical-insights/generate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CourseAccessGuard)
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  generate(
    @CourseCtx() ctx: CourseAccessContext,
    @CurrentUser() user: RequestUser,
  ) {
    if (ctx.courseRole === 'STUDENT') {
      throw new ForbiddenException('Action réservée aux responsables et professeurs.');
    }
    return this.insightsService.generateForCourse(
      ctx.course.id,
      ctx.course.classId as string,
      user.userId,
    );
  }

  /**
   * DELETE /courses/:courseId/pedagogical-insights/:insightId
   *
   * Marque un insight comme traité (le professeur a agi dessus).
   * L'insight est supprimé — une nouvelle génération peut le recréer si
   * le problème persiste.
   */
  @Delete('courses/:courseId/pedagogical-insights/:insightId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CourseAccessGuard)
  dismiss(
    @CourseCtx() ctx: CourseAccessContext,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.insightsService.dismiss(insightId, ctx.course.id, user.userId);
  }
}
