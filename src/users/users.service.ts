import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Projection publique d'un User : exclut le hash de mot de passe.
 * Toutes les réponses API passent par ce type — passwordHash n'est jamais
 * sérialisé côté HTTP.
 */
export type SafeUser = Omit<User, 'passwordHash'>;

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Charge le User AVEC son passwordHash — SEUL usage autorisé : AuthService.login().
   * Ne pas appeler depuis les contrôleurs ou d'autres services.
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });
  }

  async existsByEmail(email: string): Promise<boolean> {
    return !!(await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    }));
  }

  async create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: User['role'];
  }): Promise<SafeUser> {
    return this.prisma.user.create({
      data,
      select: SAFE_USER_SELECT,
    });
  }

  async isActive(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status === UserStatus.ACTIVE;
  }
}
