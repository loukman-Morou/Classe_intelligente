import { Injectable, Logger } from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LifecycleConfig } from '../config/configuration';
import { StorageService } from '../storage/storage.service';

/**
 * Service de cycle de vie des classes.
 *
 * Pipeline (voir cahier des charges §5, docs/database.md) :
 *   ACTIVE
 *     → INACTIVE   (90j sans activité — configurable)
 *     → ARCHIVED   (180j sans activité depuis création OU action responsable)
 *     → PENDING_DELETION (365j après archivage — configurable)
 *     → DELETED    (30j après PENDING_DELETION — configurable)
 *
 * Garanties :
 *  - Jamais de saut d'étape (ACTIVE → DELETED impossible directement).
 *  - Chaque transition est auditée.
 *  - Le responsable et le co-responsable sont notifiés avant chaque étape critique.
 *  - Anonymisation RGPD des données personnelles avant DELETED.
 *  - Suppression physique S3 asynchrone (ne bloque pas la transition).
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  private readonly cfg: LifecycleConfig;

  constructor(
    private readonly prisma:        PrismaService,
    private readonly audit:         AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage:       StorageService,
    configService: ConfigService,
  ) {
    this.cfg = configService.getOrThrow<LifecycleConfig>('lifecycle');
  }

  // --------------------------------------------------------------------------
  // Point d'entrée principal — appelé par le cron job
  // --------------------------------------------------------------------------

  /**
   * Exécute le cycle de vie complet : détecte et traite TOUTES les classes
   * concernées par n'importe quelle transition. Robuste : une erreur sur une
   * classe ne bloque pas le traitement des autres.
   */
  async runAllTransitions(): Promise<void> {
    this.logger.log('Lifecycle run : démarrage des transitions.');

    await Promise.allSettled([
      this.runTransition('ACTIVE_TO_INACTIVE'),
      this.runTransition('INACTIVE_TO_ARCHIVED'),
      this.runTransition('ARCHIVED_TO_PENDING'),
      this.runTransition('PENDING_TO_DELETED'),
    ]);

    this.logger.log('Lifecycle run : terminé.');
  }

  // --------------------------------------------------------------------------
  // ACTIVE → INACTIVE
  // --------------------------------------------------------------------------

  private async runTransition(type: string): Promise<void> {
    try {
      switch (type) {
        case 'ACTIVE_TO_INACTIVE':   await this.markInactive();    break;
        case 'INACTIVE_TO_ARCHIVED': await this.archiveInactive(); break;
        case 'ARCHIVED_TO_PENDING':  await this.markPending();     break;
        case 'PENDING_TO_DELETED':   await this.deleteClasses();   break;
      }
    } catch (err) {
      this.logger.error(`Lifecycle transition ${type} failed: ${String(err)}`);
    }
  }

  /**
   * ACTIVE → INACTIVE : classes sans activité depuis LIFECYCLE_INACTIVE_AFTER_DAYS.
   *
   * "Activité" = lastActivityAt sur la classe, mis à jour par AiService.chat,
   * DocumentsService.completeUpload, et CoursesService.create (voir updateLastActivity).
   */
  private async markInactive(): Promise<void> {
    const cutoff = this.daysAgo(this.cfg.inactiveAfterDays);

    const classes = await this.prisma.class.findMany({
      where: {
        status: ClassStatus.ACTIVE,
        OR: [
          { lastActivityAt: { lt: cutoff } },
          { lastActivityAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true, name: true, ownerId: true, coOwnerId: true, lastActivityAt: true,
      },
    });

    for (const cls of classes) {
      await this.prisma.class.update({
        where: { id: cls.id },
        data:  { status: ClassStatus.INACTIVE },
      });

      await this.audit.record({
        action: 'CLASS_AUTO_INACTIVE',
        targetType: 'Class',
        targetId: cls.id,
        metadata: {
          lastActivityAt: cls.lastActivityAt,
          inactiveAfterDays: this.cfg.inactiveAfterDays,
        },
      });

      // Notifier owner + co-owner (fire-and-forget).
      await this.notifications.notifyMany(
        [cls.ownerId, cls.coOwnerId],
        'CLASS_INACTIVE',
        { classId: cls.id, className: cls.name },
      );

      this.logger.log(`Class ${cls.id} → INACTIVE`);
    }
  }

  // --------------------------------------------------------------------------
  // INACTIVE → ARCHIVED
  // --------------------------------------------------------------------------

  private async archiveInactive(): Promise<void> {
    const cutoff = this.daysAgo(this.cfg.archiveAfterDays);

    const classes = await this.prisma.class.findMany({
      where: {
        status: ClassStatus.INACTIVE,
        OR: [
          { lastActivityAt: { lt: cutoff } },
          { lastActivityAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true, name: true, ownerId: true, coOwnerId: true },
    });

    for (const cls of classes) {
      await this.prisma.class.update({
        where: { id: cls.id },
        data:  { status: ClassStatus.ARCHIVED },
      });

      await this.audit.record({
        action: 'CLASS_AUTO_ARCHIVED',
        targetType: 'Class',
        targetId: cls.id,
        metadata: { archiveAfterDays: this.cfg.archiveAfterDays },
      });

      await this.notifications.notifyMany(
        [cls.ownerId, cls.coOwnerId],
        'CLASS_ARCHIVED',
        { classId: cls.id, className: cls.name },
      );

      this.logger.log(`Class ${cls.id} → ARCHIVED`);
    }
  }

  // --------------------------------------------------------------------------
  // ARCHIVED → PENDING_DELETION
  // --------------------------------------------------------------------------

  private async markPending(): Promise<void> {
    const cutoff = this.daysAgo(this.cfg.pendingDeletionAfterDays);

    // On se base sur updatedAt de la classe : c'est la date à laquelle elle est
    // passée en ARCHIVED (la dernière mise à jour de son statut).
    const classes = await this.prisma.class.findMany({
      where: {
        status:    ClassStatus.ARCHIVED,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, name: true, ownerId: true, coOwnerId: true },
    });

    for (const cls of classes) {
      await this.prisma.class.update({
        where: { id: cls.id },
        data:  { status: ClassStatus.PENDING_DELETION },
      });

      await this.audit.record({
        action: 'CLASS_AUTO_PENDING_DELETION',
        targetType: 'Class',
        targetId: cls.id,
        metadata: { pendingDeletionAfterDays: this.cfg.pendingDeletionAfterDays },
      });

      await this.notifications.notifyMany(
        [cls.ownerId, cls.coOwnerId],
        'CLASS_PENDING_DELETION',
        {
          classId: cls.id,
          className: cls.name,
          deletionInDays: this.cfg.deletedAfterDays,
        },
      );

      this.logger.log(`Class ${cls.id} → PENDING_DELETION`);
    }
  }

  // --------------------------------------------------------------------------
  // PENDING_DELETION → DELETED (avec anonymisation RGPD)
  // --------------------------------------------------------------------------

  private async deleteClasses(): Promise<void> {
    const cutoff = this.daysAgo(this.cfg.deletedAfterDays);

    const classes = await this.prisma.class.findMany({
      where: {
        status:    ClassStatus.PENDING_DELETION,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, name: true, ownerId: true, coOwnerId: true },
    });

    for (const cls of classes) {
      await this.deleteClass(cls.id, cls.name);
    }
  }

  /**
   * Suppression complète d'une classe :
   * 1. Anonymisation des conversations (RGPD — `isAnonymous` des messages).
   * 2. Suppression logique des documents (S3 via PurgeWorker Phase 7).
   * 3. Suppression des chunks (données vectorielles).
   * 4. Suppression des membres, cours, invitations, quiz, notifications.
   * 5. Passage au statut DELETED.
   *
   * Tout est dans une transaction Prisma sauf la suppression S3 (asynchrone).
   * Si la transaction échoue, la classe reste en PENDING_DELETION — pas de
   * suppression partielle.
   */
  private async deleteClass(classId: string, className: string): Promise<void> {
    this.logger.log(`Suppression classe ${classId} en cours...`);

    try {
      // Récupérer les storageKeys AVANT la transaction (on en aura besoin pour S3).
      const documents = await this.prisma.document.findMany({
        where:  { course: { classId }, status: { not: 'DELETED' } },
        select: { id: true, storageKey: true },
      });

      await this.prisma.$transaction(async (tx) => {
        // 1. Anonymiser les conversations (RGPD) :
        //    Les messages restent pour les statistiques agrégées mais l'userId
        //    est mis à null sur la conversation (isAnonymous = true).
        await tx.conversation.updateMany({
          where: { course: { classId } },
          data:  { isAnonymous: true },
        });

        // 2. Supprimer les chunks vectoriels.
        await tx.documentChunk.deleteMany({
          where: { classId },
        });

        // 3. Marquer les documents comme DELETED (suppression logique).
        await tx.document.updateMany({
          where: { course: { classId } },
          data:  { status: 'DELETED', deletedAt: new Date() },
        });

        // 4. Supprimer quiz, questions analytiques, insights, invitations,
        //    membres, cours dans l'ordre des contraintes FK.
        await tx.quizQuestion.deleteMany({
          where: { quiz: { course: { classId } } },
        });
        await tx.quiz.deleteMany({ where: { course: { classId } } });
        await tx.pedagogicalInsight.deleteMany({
          where: { course: { classId } },
        });
        await tx.questionAnalytics.deleteMany({
          where: { course: { classId } },
        });
        await tx.questionTopic.deleteMany({
          where: { course: { classId } },
        });
        await tx.message.deleteMany({
          where: { conversation: { course: { classId } } },
        });
        await tx.conversation.deleteMany({ where: { course: { classId } } });
        await tx.invitation.deleteMany({ where: { course: { classId } } });
        await tx.courseProfessor.deleteMany({
          where: { course: { classId } },
        });
        await tx.course.deleteMany({ where: { classId } });
        await tx.classMember.deleteMany({ where: { classId } });
        await tx.notification.deleteMany({
          where: {
            type: { in: ['CLASS_INACTIVE', 'CLASS_ARCHIVED', 'CLASS_PENDING_DELETION'] },
            payload: { path: ['classId'], equals: classId },
          },
        });

        // 5. Passer la classe en DELETED.
        await tx.class.update({
          where: { id: classId },
          data:  { status: ClassStatus.DELETED },
        });
      });

      // 6. Audit après transaction réussie.
      await this.audit.record({
        action: 'CLASS_AUTO_DELETED',
        targetType: 'Class',
        targetId: classId,
        metadata: { documentsDeleted: documents.length },
      });

      // 7. Purge S3 asynchrone — hors transaction, en parallèle.
      //    Utilise Promise.allSettled : un échec S3 ne fait pas réapparaître
      //    la classe (elle est DELETED en DB). Les fichiers orphelins seront
      //    nettoyés par un job de réconciliation en Phase 15.
      void Promise.allSettled(
        documents.map((doc) =>
          this.storage.deleteObject(doc.storageKey).catch((err) =>
            this.logger.warn(`S3 purge échouée pour ${doc.storageKey}: ${String(err)}`),
          ),
        ),
      );

      this.logger.log(`Class ${classId} → DELETED (${documents.length} documents)`);

    } catch (err) {
      // Erreur dans la transaction : la classe reste en PENDING_DELETION.
      // On ne lève pas l'erreur pour ne pas bloquer les autres suppressions.
      this.logger.error(`Échec suppression classe ${classId}: ${String(err)}`);

      await this.audit.record({
        action: 'CLASS_AUTO_DELETION_FAILED',
        targetType: 'Class',
        targetId: classId,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // --------------------------------------------------------------------------
  // Mise à jour de lastActivityAt (appelée par les services métier)
  // --------------------------------------------------------------------------

  /**
   * Met à jour lastActivityAt sur la classe parente d'un cours.
   * Fire-and-forget : ne doit jamais bloquer une action métier.
   *
   * Appelé par : AiService.chat, DocumentsService.completeUpload,
   *              CoursesService.create.
   */
  async touchClass(classId: string): Promise<void> {
    try {
      await this.prisma.class.updateMany({
        where: { id: classId, status: ClassStatus.ACTIVE },
        data:  { lastActivityAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`touchClass(${classId}) failed: ${String(err)}`);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }
}
