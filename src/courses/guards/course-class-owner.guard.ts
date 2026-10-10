import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';
import { CourseAccessContext } from '../courses.types';

/**
 * À appliquer APRÈS CourseAccessGuard.
 * Restreint l'action aux owner et co-owner de la classe parente du cours.
 */
@Injectable()
export class CourseClassOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser & { courseAccessContext?: CourseAccessContext }>();

    const ctx = request.courseAccessContext;
    if (!ctx) throw new ForbiddenException('CourseAccessGuard must run before CourseClassOwnerGuard.');

    if (ctx.courseRole !== 'CLASS_OWNER' && ctx.courseRole !== 'CLASS_CO_OWNER') {
      throw new ForbiddenException(
        'Seul le responsable ou co-responsable de la classe peut effectuer cette action sur un cours.',
      );
    }

    return true;
  }
}
