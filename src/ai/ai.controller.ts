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
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /courses/:courseId/chat
   *
   * Rate limiting plus strict que le global : appels LLM coûteux.
   * 20 req/minute par IP (ajustable en Phase 14 selon les métriques).
   *
   * CourseAccessGuard vérifie l'accès ET résout le rôle avant tout appel LLM.
   * L'IA ne décide jamais des permissions (docs/security.md §8).
   */
  @Post('courses/:courseId/chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CourseAccessGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  chat(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() dto: ChatMessageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.aiService.chat(
      ctx.course.id,
      ctx.course.classId as string,
      user.userId,
      dto,
    );
  }

  /**
   * GET /courses/:courseId/conversations
   * Étudiant/professeur → ses propres conversations.
   * Owner/co-owner → toutes (sans exposer userId pour les conv anonymes).
   */
  @Get('courses/:courseId/conversations')
  @UseGuards(CourseAccessGuard)
  getConversations(
    @CourseCtx() ctx: CourseAccessContext,
    @CurrentUser() user: RequestUser,
  ) {
    return this.aiService.getConversations(
      ctx.course.id,
      user.userId,
      ctx.courseRole,
    );
  }

  /**
   * GET /conversations/:conversationId
   * Détail d'une conversation avec ses messages.
   * Pas de :courseId dans ce chemin → le service recharge la conv depuis la
   * DB, résout le courseRole et vérifie l'appartenance (protection IDOR).
   */
  @Get('conversations/:conversationId')
  getConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.aiService.getConversationById(conversationId, user.userId);
  }
}
