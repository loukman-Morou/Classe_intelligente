import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithUser } from '../guards/jwt-auth.guard';
import { RequestUser } from '../auth.types';

/**
 * Injecte le RequestUser posé par JwtStrategy dans un paramètre de contrôleur.
 * À utiliser uniquement sur une route protégée par @UseGuards(JwtAuthGuard).
 *
 * @example
 * @Get('me')
 * @UseGuards(JwtAuthGuard)
 * getMe(@CurrentUser() user: RequestUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
