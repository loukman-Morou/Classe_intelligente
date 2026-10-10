import {
  Body,
  Controller,
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
import { RevisionService } from './revision.service';
import { GenerateQuizDto } from './dto/generate-quiz.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class QuizzesController {
  constructor(private readonly revisionService: RevisionService) {}

  /**
   * POST /courses/:courseId/quizzes/generate
   *
   * Génère un contenu de révision (QCM, questions ouvertes, flashcards, résumé)
   * à partir des documents RAG du cours.
   *
   * Rate limiting strict : la génération LLM est coûteuse.
   * 10 req/min par IP — suffisant pour une session de révision normale.
   *
   * CourseAccessGuard : tous les membres du cours peuvent générer (étudiant,
   * professeur, owner). Le service vérifie en plus que le documentId (si fourni)
   * appartient bien à ce cours.
   */
  @Post('courses/:courseId/quizzes/generate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CourseAccessGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  generate(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() dto: GenerateQuizDto,
  ) {
    return this.revisionService.generate(
      ctx.course.id,
      ctx.course.classId as string,
      dto,
    );
  }

  /**
   * POST /courses/:courseId/quizzes
   * Persiste un QCM généré (l'utilisateur choisit de le sauvegarder).
   * Seuls les QCM (type MCQ) sont persistables en l'état (Phase 10).
   */
  @Post('courses/:courseId/quizzes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CourseAccessGuard)
  saveQuiz(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() generated: GenerateQuizDto,
    @CurrentUser() user: RequestUser,
  ) {
    // Le client renvoie le GeneratedQuiz complet ; le service valide et persiste.
    return this.revisionService.saveQuiz(
      ctx.course.id,
      generated as unknown as import('./revision.service').GeneratedQuiz,
      user.userId,
    );
  }

  /**
   * GET /courses/:courseId/quizzes
   * Liste les quiz sauvegardés du cours.
   */
  @Get('courses/:courseId/quizzes')
  @UseGuards(CourseAccessGuard)
  findAll(@CourseCtx() ctx: CourseAccessContext) {
    return this.revisionService.findAllForCourse(ctx.course.id);
  }

  /**
   * GET /quizzes/:quizId
   * Retourne un quiz sauvegardé avec ses questions.
   * Le service vérifie que le quiz appartient au bon cours.
   */
  @Get('courses/:courseId/quizzes/:quizId')
  @UseGuards(CourseAccessGuard)
  findOne(
    @CourseCtx() ctx: CourseAccessContext,
    @Param('quizId', ParseUUIDPipe) quizId: string,
  ) {
    return this.revisionService.findOne(quizId, ctx.course.id);
  }

  /**
   * POST /courses/:courseId/summaries
   * Alias sémantique pour générer un résumé (type SUMMARY).
   * Même pipeline que /quizzes/generate, juste le type forcé.
   */
  @Post('courses/:courseId/summaries')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CourseAccessGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  generateSummary(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() dto: Omit<GenerateQuizDto, 'type'>,
  ) {
    return this.revisionService.generate(
      ctx.course.id,
      ctx.course.classId as string,
      { ...dto, type: 'SUMMARY' } as GenerateQuizDto,
    );
  }
}
