import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditEventInput {
  /** null pour un événement système sans acteur humain identifié. */
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  /**
   * Contexte non sensible uniquement (docs/security.md §16/§17) : jamais de mot
   * de passe, token, clé API, ni contenu de document/question privée. Un simple
   * `Record<string, unknown>` serializable en JSON.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Point d'écriture unique des logs d'audit. Centraliser ici (plutôt que chaque
 * service appelant `prisma.auditLog.create` directement) permet de garantir un
 * seul format et, surtout, de ne jamais faire échouer la requête métier si
 * l'audit lui-même échoue (l'audit ne doit jamais être un point de défaillance
 * qui bloque une action légitime de l'utilisateur).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(event: RecordAuditEventInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: event.actorUserId,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          metadata: event.metadata as never,
        },
      });
    } catch (error) {
      // Ne jamais laisser un échec d'écriture d'audit faire échouer l'action
      // métier elle-même (ex: un login qui a réussi ne doit pas devenir un 500
      // parce que l'INSERT d'audit a échoué) — mais on le trace côté serveur
      // pour ne pas perdre l'incident silencieusement.
      this.logger.error(
        `Échec d'écriture d'un log d'audit (action=${event.action})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
