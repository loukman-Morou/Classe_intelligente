import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProposalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CourseSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Lister les propositions en attente pour une classe
  // (owner/co-owner de la classe uniquement)
  // --------------------------------------------------------------------------

  async getPendingProposals(classId: string) {
    return this.prisma.courseUpdateProposal.findMany({
      where: {
        classCourse: { classId },
        status: ProposalStatus.PENDING,
      },
      include: {
        proposedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        professorCourse: {
          include: { course: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --------------------------------------------------------------------------
  // Accepter une proposition → applique le contenu sur la copie classe
  // --------------------------------------------------------------------------

  async acceptProposal(proposalId: string, classId: string, reviewerId: string) {
    const proposal = await this.loadAndValidateProposal(proposalId, classId);

    await this.prisma.$transaction(async (tx) => {
      const content = proposal.proposalContent as Record<string, unknown>;

      // Appliquer le contenu de la proposition sur la copie classe.
      await tx.course.update({
        where: { id: proposal.classCourse.classCourseId },
        data: {
          ...(content['name'] !== undefined && { name: content['name'] as string }),
          ...(content['description'] !== undefined && {
            description: content['description'] as string,
          }),
        },
      });

      // Marquer la copie comme à jour.
      await tx.classCourse.update({
        where: { id: proposal.classCourseId },
        data: { syncStatus: 'UP_TO_DATE' },
      });

      // Clore la proposition.
      await tx.courseUpdateProposal.update({
        where: { id: proposalId },
        data: {
          status: ProposalStatus.ACCEPTED,
          reviewedByUserId: reviewerId,
          reviewedAt: new Date(),
        },
      });
    });

    await this.audit.record({
      actorUserId: reviewerId,
      action: 'COURSE_PROPOSAL_ACCEPTED',
      targetType: 'CourseUpdateProposal',
      targetId: proposalId,
      metadata: { classId },
    });
  }

  // --------------------------------------------------------------------------
  // Refuser une proposition
  // --------------------------------------------------------------------------

  async rejectProposal(proposalId: string, classId: string, reviewerId: string) {
    const proposal = await this.loadAndValidateProposal(proposalId, classId);

    // Si le responsable refuse alors que syncStatus = UPDATE_AVAILABLE, on passe
    // en DIVERGED : la copie a volontairement divergé de l'original.
    const newSyncStatus =
      proposal.classCourse.syncStatus === 'UPDATE_AVAILABLE' ? 'DIVERGED' : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.courseUpdateProposal.update({
        where: { id: proposalId },
        data: {
          status: ProposalStatus.REJECTED,
          reviewedByUserId: reviewerId,
          reviewedAt: new Date(),
        },
      });

      if (newSyncStatus) {
        await tx.classCourse.update({
          where: { id: proposal.classCourseId },
          data: { syncStatus: newSyncStatus },
        });
      }
    });

    await this.audit.record({
      actorUserId: reviewerId,
      action: 'COURSE_PROPOSAL_REJECTED',
      targetType: 'CourseUpdateProposal',
      targetId: proposalId,
      metadata: { classId },
    });
  }

  // --------------------------------------------------------------------------
  // Annuler une proposition (professeur uniquement, depuis son espace)
  // --------------------------------------------------------------------------

  async cancelProposal(proposalId: string, professorId: string) {
    const proposal = await this.prisma.courseUpdateProposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        status: true,
        proposedByUserId: true,
        classCourse: { select: { classId: true } },
      },
    });

    if (!proposal) throw new NotFoundException('Proposition introuvable.');
    if (proposal.proposedByUserId !== professorId) {
      throw new ForbiddenException("Vous n'êtes pas l'auteur de cette proposition.");
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException('Seule une proposition en attente peut être annulée.');
    }

    await this.prisma.courseUpdateProposal.update({
      where: { id: proposalId },
      data: { status: ProposalStatus.CANCELLED },
    });

    await this.audit.record({
      actorUserId: professorId,
      action: 'COURSE_PROPOSAL_CANCELLED',
      targetType: 'CourseUpdateProposal',
      targetId: proposalId,
    });
  }

  // --------------------------------------------------------------------------
  // Helper : charger et valider une proposition ciblant bien la classe
  // --------------------------------------------------------------------------

  private async loadAndValidateProposal(proposalId: string, classId: string) {
    const proposal = await this.prisma.courseUpdateProposal.findUnique({
      where: { id: proposalId },
      include: {
        classCourse: {
          select: { id: true, classCourseId: true, classId: true, syncStatus: true },
        },
      },
    });

    if (!proposal) throw new NotFoundException('Proposition introuvable.');
    if (proposal.classCourse.classId !== classId) {
      throw new ForbiddenException("Cette proposition ne concerne pas votre classe.");
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(
        `Cette proposition a déjà été traitée (statut : ${proposal.status}).`,
      );
    }

    return proposal;
  }
}
