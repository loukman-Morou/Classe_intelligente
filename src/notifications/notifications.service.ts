import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType =
  | 'CLASS_INACTIVE'
  | 'CLASS_ARCHIVED'
  | 'CLASS_PENDING_DELETION'
  | 'CLASS_DELETED'
  | 'DOCUMENT_PROCESSING_FAILED'
  | 'COURSE_UPDATE_AVAILABLE'
  | 'PROFESSOR_INVITED';

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

/**
 * Service de notifications internes (stockées en DB, table `notifications`).
 *
 * Principe : toutes les méthodes sont fire-and-forget — elles ne lèvent jamais
 * d'exception visible par l'appelant. Un échec de notification ne doit jamais
 * bloquer une action métier (archivage, traitement de document, etc.).
 *
 * Le push temps-réel (WebSocket/SSE) sera branché ici en Phase 15 si nécessaire.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une notification pour un utilisateur.
   * Fire-and-forget : l'erreur est loggée, jamais propagée.
   */
  async notify(dto: CreateNotificationDto): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId:  dto.userId,
          type:    dto.type,
          payload: dto.payload ?? {},
        },
      });
    } catch (err) {
      // On logue mais on ne propage pas : une notification ratée ne doit jamais
      // faire échouer l'action qui l'a déclenchée.
      this.logger.error(
        `Échec notification type=${dto.type} userId=${dto.userId}: ${String(err)}`,
      );
    }
  }

  /**
   * Notifie plusieurs utilisateurs en parallèle (ex: owner + co-owner d'une classe).
   */
  async notifyMany(
    userIds: (string | null | undefined)[],
    type: NotificationType,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const validIds = userIds.filter((id): id is string => !!id);
    await Promise.allSettled(
      validIds.map((userId) => this.notify({ userId, type, payload })),
    );
  }

  /**
   * Récupère les notifications non lues d'un utilisateur (paginées).
   */
  async getUnread(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where:   { userId, readAt: null },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select:  { id: true, type: true, payload: true, createdAt: true },
    });
  }

  /**
   * Marque des notifications comme lues.
   */
  async markAsRead(notificationIds: string[], userId: string): Promise<void> {
    // On filtre par userId pour éviter qu'un utilisateur marque les
    // notifications d'un autre comme lues (IDOR).
    await this.prisma.notification.updateMany({
      where: { id: { in: notificationIds }, userId, readAt: null },
      data:  { readAt: new Date() },
    });
  }
}
