import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restreint une route aux rôles listés.
 * Doit toujours être utilisé conjointement avec @UseGuards(JwtAuthGuard, RolesGuard).
 *
 * @example
 * @Roles(UserRole.ADMIN)
 * @UseGuards(JwtAuthGuard, RolesGuard)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
