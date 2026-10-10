import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus, CourseSyncStatus, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProfessorCourseDto } from './dto/create-professor-course.dto';
import { ShareCourseToClassDto } from './dto/share-course.dto';
import { CreateUpdateProposalDto } from './dto/create-update-proposal.dto';
import { ReviewProposalDto } from './dto/review-proposal.dto';
import { ProfessorCourseContext } from './professor.types';

// Seuil minimal d'occurrences pour afficher une statistique dans le radar
// pédagogique (évite la ré-identification d'un étudiant dans un petit groupe).
// Configurable en Phase 12 (admin) — valeur par défaut du cahier des charges §21.
const ANONYMITY_THRESHOLD = 5;

@Injectable()
export class ProfessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Créer un cours original dans l'espace professeur
  // --------------------------------------------------------------------------

  async createCourse(dto: CreateProfessorCourseDto, professorId: string) {
    const course = await this.prisma.$transaction(async (tx) => {
      // Le cours sous-jacent (Course) n'a pas de classId → espace professeur
      const c = await tx.course.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          classId: null,
        },
      });

      const pc = await tx.professorCourse.create({
        data: { professorId, courseId: c.id, version: 1 },
      });

      // Snapshot version initiale
      await tx.courseVersion.create({
        data: {
          professorCourseId: pc.id,
          version: 1,
          snapshot: { name: c.name, description: c.description },
          changesDescription: 'Version initiale',
        },
      });

      return { ...pc, course: c };
    });

    await this.audit.record({
      actorUserId: professorId,
      action: 'PROFESSOR_COURSE_CREATED',
      targetType: 'ProfessorCourse',
      targetId: course.id,
      metadata: { name: dto.name },
    });

    return course;
  }

  // --------------------------------------------------------------------------
  // Lister les cours originaux du professeur
  // --------------------------------------------------------------------------

  async findMyCourses(professorId: string) {
    return this.prisma.professorCourse.findMany({
      where: { professorId },
      include: {
        course: { select: { id: true, name: true, description: true } },
        classCourses: {
          select: { id: true, classId: true, syncStatus: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --------------------------------------------------------------------------
  // Partager un cours vers une classe (crée une copie indépendante)
  // --------------------------------------------------------------------------

  async shareCourseToClass(
    profCourseCtx: ProfessorCourseContext,
    dto: ShareCourseToClassDto,
    professorId: string,
  ) {
    const cls = await this.prisma.class.findUnique({
      where: { id: dto.classId },
      select: { id: true, status: true, ownerId: true, coOwnerId: true },
    });

    if (!cls) throw new NotFoundException('Classe introuvable.');
    if (cls.status !== ClassStatus.ACTIVE) {
      throw new BadRequestException('Impossible de partager un cours dans une classe non active.');
    }

    // Vérifier que le professeur est membre de la classe cible (il doit y être
    // présent pour que ses cours et son radar soient liés à cette classe).
    const membership = await this.prisma.classMember.findUnique({
      where: { userId_classId: { userId: professorId, classId: dto.classId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException("Vous n'êtes pas membre de cette classe.");
    }

    // Empêcher un double partage du même cours vers la même classe.
    const existing = await this.prisma.classCourse.findUnique({
      where: { professorCourseId_classId: {
        professorCourseId: profCourseCtx.id, classId: dto.classId,
      }},
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException('Ce cours est déjà partagé avec cette classe.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Créer la copie du cours (Course avec classId renseigné)
      const copy = await tx.course.create({
        data: {
          name: profCourseCtx.name,
          description: profCourseCtx.description,
          classId: dto.classId,
        },
      });

      // 2. Créer le lien ClassCourse
      const classCourse = await tx.classCourse.create({
        data: {
          classCourseId: copy.id,
          professorCourseId: profCourseCtx.id,
          classId: dto.classId,
          sharedAtVersion: profCourseCtx.version,
          syncStatus: CourseSyncStatus.UP_TO_DATE,
        },
      });

      return { copy, classCourse };
    });

    await this.audit.record({
      actorUserId: professorId,
      action: 'PROFESSOR_COURSE_SHARED',
      targetType: 'ProfessorCourse',
      targetId: profCourseCtx.id,
      metadata: { classId: dto.classId, copyCourseId: result.copy.id },
    });

    return result;
  }

  // --------------------------------------------------------------------------
  // Proposer une mise à jour vers une ou plusieurs classes
  // --------------------------------------------------------------------------

  async proposeUpdate(
    profCourseCtx: ProfessorCourseContext,
    dto: CreateUpdateProposalDto,
    professorId: string,
  ) {
    // Vérifier que la ClassCourse appartient bien à ce cours professeur
    const classCourse = await this.prisma.classCourse.findFirst({
      where: {
        id: dto.classCourseId,
        professorCourseId: profCourseCtx.id,
      },
      select: { id: true, classId: true, syncStatus: true },
    });

    if (!classCourse) {
      throw new NotFoundException("Copie de cours introuvable ou n'appartient pas à votre cours.");
    }

    // Pas deux propositions PENDING pour la même classe en même temps.
    const pendingExists = await this.prisma.courseUpdateProposal.findFirst({
      where: {
        professorCourseId: profCourseCtx.id,
        classCourseId: dto.classCourseId,
        status: ProposalStatus.PENDING,
      },
      select: { id: true },
    });
    if (pendingExists) {
      throw new ConflictException(
        'Une proposition est déjà en attente pour cette classe. Annulez-la avant d\'en créer une nouvelle.',
      );
    }

    const proposal = await this.prisma.$transaction(async (tx) => {
      const p = await tx.courseUpdateProposal.create({
        data: {
          professorCourseId: profCourseCtx.id,
          classCourseId: dto.classCourseId,
          proposedByUserId: professorId,
          type: dto.type,
          proposalContent: dto.proposalContent,
          message: dto.message ?? null,
          status: ProposalStatus.PENDING,
        },
      });

      // Mettre à jour le syncStatus de la copie
      await tx.classCourse.update({
        where: { id: dto.classCourseId },
        data: { syncStatus: CourseSyncStatus.UPDATE_AVAILABLE },
      });

      return p;
    });

    await this.audit.record({
      actorUserId: professorId,
      action: 'COURSE_UPDATE_PROPOSED',
      targetType: 'CourseUpdateProposal',
      targetId: proposal.id,
      metadata: { classCourseId: dto.classCourseId, type: dto.type },
    });

    return proposal;
  }

  // --------------------------------------------------------------------------
  // Annuler une proposition (professeur uniquement)
  // --------------------------------------------------------------------------

  async cancelProposal(proposalId: string, professorId: string) {
    const proposal = await this.prisma.courseUpdateProposal.findUnique({
      where: { id: proposalId },
      select: { id: true, proposedByUserId: true, status: true, classCourseId: true },
    });

    if (!proposal) throw new NotFoundException('Proposition introuvable.');
    if (proposal.proposedByUserId !== professorId) {
      throw new ForbiddenException("Vous n'êtes pas l'auteur de cette proposition.");
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException('Seule une proposition PENDING peut être annulée.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.courseUpdateProposal.update({
        where: { id: proposalId },
        data: { status: ProposalStatus.CANCELLED, updatedAt: new Date() },
      });

      // Recalculer le syncStatus : repasser à UP_TO_DATE s'il n'y a plus de PENDING
      const remainingPending = await tx.courseUpdateProposal.count({
        where: { classCourseId: proposal.classCourseId, status: ProposalStatus.PENDING },
      });
      if (remainingPending === 0) {
        await tx.classCourse.update({
          where: { id: proposal.classCourseId },
          data: { syncStatus: CourseSyncStatus.UP_TO_DATE },
        });
      }
    });

    return { message: 'Proposition annulée.' };
  }

  // --------------------------------------------------------------------------
  // Traiter une proposition (responsable de classe)
  // --------------------------------------------------------------------------

  async reviewProposal(proposalId: string, dto: ReviewProposalDto, reviewerUserId: string) {
    const proposal = await this.prisma.courseUpdateProposal.findUnique({
      where: { id: proposalId },
      include: {
        classCourse: {
          select: { id: true, classId: true, classCourseId: true, syncStatus: true },
        },
      },
    });

    if (!proposal) throw new NotFoundException('Proposition introuvable.');
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException('Cette proposition a déjà été traitée.');
    }

    // Vérifier que le reviewer est owner/co-owner de la classe concernée
    const cls = await this.prisma.class.findUnique({
      where: { id: proposal.classCourse.classId },
      select: { ownerId: true, coOwnerId: true },
    });
    if (!cls || (cls.ownerId !== reviewerUserId && cls.coOwnerId !== reviewerUserId)) {
      throw new ForbiddenException(
        "Seul le responsable ou co-responsable de la classe peut traiter cette proposition.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Mettre à jour le statut de la proposition
      await tx.courseUpdateProposal.update({
        where: { id: proposalId },
        data: {
          status: dto.decision,
          reviewedAt: new Date(),
          reviewedByUserId: reviewerUserId,
        },
      });

      if (dto.decision === ProposalStatus.ACCEPTED) {
        // Appliquer le contenu de la proposition au cours de la classe
        // (mise à jour simple du nom/description — les documents sont gérés
        // séparément via le flux document Phase 6)
        const content = JSON.parse(proposal.proposalContent) as {
          name?: string;
          description?: string;
        };

        if (content.name || content.description !== undefined) {
          await tx.course.update({
            where: { id: proposal.classCourse.classCourseId },
            data: {
              ...(content.name && { name: content.name }),
              ...(content.description !== undefined && { description: content.description }),
            },
          });
        }

        await tx.classCourse.update({
          where: { id: proposal.classCourse.id },
          data: { syncStatus: CourseSyncStatus.UP_TO_DATE },
        });
      } else {
        // REJECTED : si pas d'autre PENDING, repasser UP_TO_DATE
        const remainingPending = await tx.courseUpdateProposal.count({
          where: {
            classCourseId: proposal.classCourse.id,
            status: ProposalStatus.PENDING,
            id: { not: proposalId },
          },
        });
        if (remainingPending === 0) {
          await tx.classCourse.update({
            where: { id: proposal.classCourse.id },
            data: { syncStatus: CourseSyncStatus.UP_TO_DATE },
          });
        }
      }
    });

    await this.audit.record({
      actorUserId: reviewerUserId,
      action: `COURSE_UPDATE_PROPOSAL_${dto.decision}`,
      targetType: 'CourseUpdateProposal',
      targetId: proposalId,
    });

    return { message: `Proposition ${dto.decision.toLowerCase()}.` };
  }

  // --------------------------------------------------------------------------
  // Radar pédagogique cross-classes (vue professeur)
  // Agrégation anonymisée des questions posées dans toutes les classes
  // qui utilisent les cours de ce professeur.
  // --------------------------------------------------------------------------

  async getPedagogicalRadar(professorId: string) {
    // 1. Récupérer tous les cours du professeur
    const profCourses = await this.prisma.professorCourse.findMany({
      where: { professorId },
      select: {
        id: true,
        course: { select: { id: true, name: true } },
        classCourses: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            classId: true,
            classCourseId: true,
            class: { select: { name: true, academicYear: true } },
          },
        },
      },
    });

    // 2. Pour chaque copie classe, récupérer les analytics agrégées
    const radar = await Promise.all(
      profCourses.map(async (pc) => {
        const classAnalytics = await Promise.all(
          pc.classCourses.map(async (cc) => {
            const analytics = await this.prisma.questionAnalytics.findMany({
              where: { courseId: cc.classCourseId },
              include: { questionTopic: { select: { name: true } } },
              orderBy: { questionCount: 'desc' },
            });

            // Appliquer le seuil d'anonymat : ne pas exposer les topics
            // avec trop peu d'occurrences (risque de ré-identification).
            const filteredAnalytics = analytics.filter(
              (a) => a.questionCount >= ANONYMITY_THRESHOLD,
            );

            return {
              classId: cc.classId,
              className: cc.class.name,
              academicYear: cc.class.academicYear,
              topics: filteredAnalytics.map((a) => ({
                topic: a.questionTopic.name,
                questionCount: a.questionCount,
              })),
            };
          }),
        );

        // Agréger aussi toutes les classes ensemble pour la vue globale du cours
        const topicTotals: Record<string, number> = {};
        for (const ca of classAnalytics) {
          for (const t of ca.topics) {
            topicTotals[t.topic] = (topicTotals[t.topic] ?? 0) + t.questionCount;
          }
        }

        const aggregated = Object.entries(topicTotals)
          .filter(([, count]) => count >= ANONYMITY_THRESHOLD)
          .sort(([, a], [, b]) => b - a)
          .map(([topic, questionCount]) => ({ topic, questionCount }));

        return {
          professorCourseId: pc.id,
          courseName: pc.course.name,
          totalClasses: pc.classCourses.length,
          aggregatedTopics: aggregated,
          byClass: classAnalytics,
        };
      }),
    );

    return radar;
  }

  // --------------------------------------------------------------------------
  // Propositions en attente reçues par les classes d'un responsable
  // (endpoint pour le responsable, pas le professeur)
  // --------------------------------------------------------------------------

  async getPendingProposalsForClass(classId: string, reviewerUserId: string) {
    // Vérifier que le reviewer est responsable de cette classe
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { ownerId: true, coOwnerId: true },
    });
    if (!cls || (cls.ownerId !== reviewerUserId && cls.coOwnerId !== reviewerUserId)) {
      throw new ForbiddenException('Accès refusé.');
    }

    return this.prisma.courseUpdateProposal.findMany({
      where: {
        classCourse: { classId },
        status: ProposalStatus.PENDING,
      },
      include: {
        proposedBy: { select: { id: true, firstName: true, lastName: true } },
        classCourse: {
          include: {
            classCourse: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --------------------------------------------------------------------------
  // Révoquer un partage (le cours reste dans la classe mais n'est plus lié)
  // --------------------------------------------------------------------------

  async revokeShare(
    profCourseCtx: ProfessorCourseContext,
    classId: string,
    professorId: string,
  ) {
    const share = await this.prisma.classCourse.findUnique({
      where: {
        professorCourseId_classId: {
          professorCourseId: profCourseCtx.id,
          classId,
        },
      },
      select: { id: true, status: true },
    });

    if (!share || share.status !== 'ACTIVE') {
      throw new NotFoundException('Partage actif introuvable pour cette classe.');
    }

    await this.prisma.classCourse.update({
      where: { id: share.id },
      data: { status: 'REVOKED' },
    });

    await this.audit.record({
      actorUserId: professorId,
      action: 'PROFESSOR_COURSE_SHARE_REVOKED',
      targetType: 'ClassCourse',
      targetId: share.id,
      metadata: { classId, professorCourseId: profCourseCtx.id },
    });

    return { message: 'Partage révoqué. Le cours reste dans la classe en lecture seule.' };
  }
}
