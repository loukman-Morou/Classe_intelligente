import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CourseAccessContext } from '../courses.types';

/**
 * Injecte le CourseAccessContext attaché par CourseAccessGuard.
 * À utiliser uniquement sur une route protégée par ce guard.
 */
export const CourseCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CourseAccessContext => {
    const request = ctx.switchToHttp().getRequest<{ courseAccessContext: CourseAccessContext }>();
    return request.courseAccessContext;
  },
);
