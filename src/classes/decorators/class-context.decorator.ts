import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ClassContext } from '../classes.types';

/**
 * Injecte le ClassContext attaché à la requête par ClassMemberGuard ou ClassOwnerGuard.
 * À n'utiliser que sur une route déjà protégée par l'un de ces guards.
 */
export const ClassCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClassContext => {
    const request = ctx.switchToHttp().getRequest<{ classContext: ClassContext }>();
    return request.classContext;
  },
);
