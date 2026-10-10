import {
  Body,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { CourseAccessGuard } from '../courses/guards/course-access.guard';
import { CourseCtx } from '../courses/decorators/course-context.decorator';
import { CourseAccessContext } from '../courses/courses.types';
import { DocumentsService } from './documents.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * POST /courses/:courseId/documents/upload-url
   * Demander une URL d'upload S3 présignée.
   * Accès : owner/co-owner ou professeur assigné — pas les étudiants.
   * CourseAccessGuard résout le rôle ; la restriction STUDENT est
   * appliquée ici avant d'appeler le service.
   */
  @Post('courses/:courseId/documents/upload-url')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CourseAccessGuard)
  requestUploadUrl(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() dto: RequestUploadUrlDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (ctx.courseRole === 'STUDENT') {
      throw new ForbiddenException('Les étudiants ne sont pas autorisés à uploader des documents.');
    }
    return this.documentsService.requestUploadUrl(ctx.course.id, dto, user.userId);
  }

  /**
   * POST /documents/:documentId/complete
   * Finaliser l'upload : vérification magic bytes + enqueue OCR.
   * Pas de guard de cours ici — le service vérifie que l'acteur est bien
   * l'initiateur de l'upload (uploadedByUserId).
   */
  @Post('documents/:documentId/complete')
  @HttpCode(HttpStatus.OK)
  completeUpload(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.completeUpload(documentId, dto, user.userId);
  }

  /**
   * GET /courses/:courseId/documents
   * Liste les documents visibles du cours selon le rôle du user.
   */
  @Get('courses/:courseId/documents')
  @UseGuards(CourseAccessGuard)
  findAll(@CourseCtx() ctx: CourseAccessContext) {
    return this.documentsService.findAllForCourse(ctx.course.id);
  }

  /**
   * GET /documents/:documentId/download
   * Retourne une URL signée temporaire (15 min).
   * Le service vérifie l'accès au cours via le courseId du document.
   */
  @Get('documents/:documentId/download')
  getDownloadUrl(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.getDownloadUrl(documentId, user.userId);
  }

  /**
   * DELETE /documents/:documentId
   * Suppression logique — purge physique S3 en asynchrone (Phase 7).
   * Le service vérifie que l'acteur est owner/co-owner du cours ou uploader.
   */
  @Delete('documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.remove(documentId, user.userId);
  }
}
