import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtConfig } from '../../config/configuration';
import { JwtPayload, RequestUser } from '../auth.types';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const jwtConfig = configService.get<JwtConfig>('jwt');
    if (!jwtConfig?.accessSecret) {
      throw new Error('JWT_ACCESS_SECRET manquant — vérifier la configuration.');
    }

    super({
      // Extraction depuis le header Authorization: Bearer <token>.
      // Jamais depuis un query param ou un cookie non HttpOnly — voir
      // docs/security.md §2.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.accessSecret,
    });
  }

  /**
   * Appelé par Passport APRÈS vérification de la signature et de l'expiration.
   * On recharge systématiquement le statut depuis la DB : un compte suspendu
   * APRÈS l'émission du token doit être refusé immédiatement, pas lors du
   * prochain refresh.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session invalide ou compte inactif.');
    }
    return { userId: payload.sub, role: payload.role, jti: payload.jti };
  }
}
