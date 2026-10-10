import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { JwtConfig } from '../config/configuration';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload, RequestUser } from './auth.types';

/**
 * Paramètres Argon2id recommandés OWASP (2024) pour un serveur avec mémoire
 * suffisante. À ajuster à la baisse si la RAM du serveur de déploiement le
 * requiert (min : m=19456, t=2, p=1).
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class AuthService {
  private readonly jwtConfig: JwtConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    const cfg = configService.get<JwtConfig>('jwt');
    if (!cfg) throw new Error('Configuration JWT manquante.');
    this.jwtConfig = cfg;
  }

  // --------------------------------------------------------------------------
  // Register
  // --------------------------------------------------------------------------

  async register(dto: RegisterDto) {
    // Vérification avant le hash pour éviter un hash Argon2 coûteux inutile.
    const exists = await this.usersService.existsByEmail(
      dto.email.toLowerCase().trim(),
    );
    if (exists) {
      throw new ConflictException('Un compte avec cet email existe déjà.');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.usersService.create({
      email: dto.email.toLowerCase().trim(),
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      role: UserRole.STUDENT,
    });

    return { user };
  }

  // --------------------------------------------------------------------------
  // Login
  // --------------------------------------------------------------------------

  async login(
    dto: LoginDto,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const user = await this.usersService.findByEmailWithPassword(
      dto.email.toLowerCase().trim(),
    );

    // Hash leurre pour que le temps de réponse soit identique que l'email
    // existe ou non — défense contre les timing attacks d'énumération de comptes
    // (credential stuffing). Le hash leurre ne correspond à aucun vrai compte :
    // argon2.verify retournera false, ce qui est le seul résultat attendu.
    const DUMMY_HASH =
      '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$somehashvalue00000000000000000000000000000000';
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;

    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hashToVerify, dto.password);
    } catch {
      // argon2.verify lève sur un hash malformé ; on traite ça comme un échec.
      passwordValid = false;
    }

    if (!user || !passwordValid || user.status !== 'ACTIVE') {
      // Message générique — ne révèle pas si c'est l'email ou le mot de passe
      // qui est faux. Les deux cas produisent exactement le même message.
      throw new UnauthorizedException('Email ou mot de passe incorrect.');
    }

    const tokens = await this.generateTokenPair(user.id, user.role, meta);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    };
  }

  // --------------------------------------------------------------------------
  // Refresh — rotation stricte
  // --------------------------------------------------------------------------

  async refresh(
    rawRefreshToken: string,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    // 1. Vérifier signature + expiration avec le secret REFRESH (≠ access).
    let payload: { sub: string; jti: string };
    try {
      payload = this.jwtService.verify<{ sub: string; jti: string }>(
        rawRefreshToken,
        { secret: this.jwtConfig.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré.');
    }

    // 2. Chercher en DB par hash.
    const tokenHash = this.hashToken(rawRefreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token inconnu.');
    }

    if (storedToken.isRevoked) {
      // Token révoqué réutilisé → signe possible de compromission.
      // Révoquer TOUTES les sessions du user par précaution (reset de sécurité).
      await this.revokeAllUserTokens(payload.sub);
      throw new UnauthorizedException(
        'Refresh token révoqué. Toutes les sessions ont été invalidées par sécurité.',
      );
    }

    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token expiré.');
    }

    // 3. Rotation : invalider immédiatement l'ancien token.
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    // 4. Recharger le user — ne pas faire confiance au seul payload JWT.
    const user = await this.usersService.findById(storedToken.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif ou introuvable.');
    }

    // 5. Émettre une nouvelle paire.
    return this.generateTokenPair(user.id, user.role, meta);
  }

  // --------------------------------------------------------------------------
  // Logout
  // --------------------------------------------------------------------------

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    // updateMany : idempotent même si le token est déjà révoqué ou inexistant.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  // --------------------------------------------------------------------------
  // /auth/me — rechargement DB obligatoire
  // --------------------------------------------------------------------------

  async getMe(requestUser: RequestUser) {
    // Ne jamais renvoyer les données du seul payload JWT : le rôle ou le statut
    // peuvent avoir été modifiés (suspension, promotion admin...) depuis l'émission
    // du token.
    const user = await this.usersService.findById(requestUser.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif ou introuvable.');
    }
    return { user };
  }

  // --------------------------------------------------------------------------
  // Révocation globale (ex : changement de mot de passe, action admin)
  // --------------------------------------------------------------------------

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  private async generateTokenPair(
    userId: string,
    role: UserRole,
    meta: { ip?: string; userAgent?: string },
  ) {
    const jti = randomUUID();

    const accessPayload: JwtPayload = { sub: userId, role, jti };
    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessTtl,
    });

    // Refresh token : JWT signé avec un secret DISTINCT de l'access token,
    // payload minimal, durée de vie longue. Un token opaque (chaîne aléatoire)
    // serait une alternative valable — on garde JWT ici pour la simplicité de
    // vérification de l'expiration sans roundtrip DB supplémentaire.
    const rawRefreshToken = this.jwtService.sign(
      { sub: userId, jti },
      {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshTtl,
      },
    );

    const decoded = this.jwtService.decode(rawRefreshToken) as { exp: number };
    const expiresAt = new Date(decoded.exp * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt,
        // Données techniques minimales pour l'audit et la détection d'abus.
        // Jamais exposées à l'utilisateur. Tronquées avant insertion.
        ipAddress: meta.ip?.substring(0, 45) ?? null,
        userAgent: meta.userAgent?.substring(0, 200) ?? null,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashToken(token: string): string {
    // SHA-256 suffit pour hacher un token aléatoire haute entropie (≠ mot de
    // passe humain). Pas de risque de force brute par dictionnaire ici.
    return createHash('sha256').update(token).digest('hex');
  }
}
