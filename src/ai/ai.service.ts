import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RagService } from '../rag/rag.service';
import { PromptBuilderService, ConversationTurn } from './prompt-builder.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { LlmConfig } from '../config/configuration';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private client!: OpenAI;
  private chatModel!: string;
  private maxTokens!: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rag: RagService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {
    const cfg = this.config.getOrThrow<LlmConfig>('llm');
    this.chatModel = cfg.chatModel;
    this.maxTokens = cfg.maxTokens;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  // --------------------------------------------------------------------------
  // Chat principal
  // --------------------------------------------------------------------------

  async chat(
    courseId: string,
    classId: string,
    userId: string,
    dto: ChatMessageDto,
  ): Promise<ChatResponseDto> {
    // 1. Résoudre / créer la conversation.
    const conversation = await this.resolveConversation(
      courseId,
      userId,
      dto.conversationId,
      dto.anonymous ?? false,
    );

    // 2. Recharger l'historique depuis la DB (jamais depuis le payload client).
    const history = await this.loadHistory(conversation.id);

    // 3. Recherche sémantique — filtrage strict classId/courseId déjà dans RagService.
    const chunks = await this.rag.search({
      query: dto.message,
      courseId,
      classId,
    });

    const fromCourseContext = chunks.length > 0;

    // 4. Construire les messages LLM avec séparation SYSTEM/USER/DOCUMENT.
    const messages = this.promptBuilder.build(dto.message, chunks, history);

    // 5. Appel LLM.
    this.logger.debug(
      `Chat LLM — courseId=${courseId} chunks=${chunks.length} turns=${history.length}`,
    );

    const completion = await this.client.chat.completions.create({
      model: this.chatModel,
      messages,
      max_tokens: this.maxTokens,
      temperature: 0.3, // Réponses plus déterministes pour un contexte pédagogique
    });

    const answer = completion.choices[0]?.message?.content ?? '';
    if (!answer) {
      this.logger.warn(`Réponse LLM vide — courseId=${courseId}`);
    }

    // 6. Extraire les sources.
    const sources = this.promptBuilder.extractSources(answer, chunks);

    // 7. Persister les deux messages (user + assistant) en transaction.
    const [userMessage, assistantMessage] = await this.prisma.$transaction(async (tx) => {
      const userMsg = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: dto.message,
          sources: null,
        },
      });

      const assistantMsg = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role: MessageRole.ASSISTANT,
          content: answer,
          sources: sources.length > 0 ? sources : null,
        },
      });

      return [userMsg, assistantMsg];
    });

    // 8. Enregistrement analytics — fire-and-forget, jamais bloquant.
    // Un échec de classification ne doit JAMAIS retarder ni faire échouer la
    // réponse chat. Le radar pédagogique est une fonctionnalité annexe.
    void this.analytics
      .recordQuestion(dto.message, courseId, classId)
      .catch((err: unknown) =>
        this.logger.warn(`recordQuestion failed: ${String(err)}`),
      );

    // 8b. Mise à jour de lastActivityAt — fire-and-forget.
    // Un message chat est une activité significative qui réinitialise le
    // compteur d'inactivité de la classe (Phase 13).
    void this.lifecycle
      .touchClass(classId)
      .catch((err: unknown) =>
        this.logger.warn(`touchClass failed: ${String(err)}`),
      );

    // 9. Audit non bloquant (pas de throw si ça échoue).
    void this.audit.record({
      actorUserId: userId,
      action: 'CHAT_MESSAGE',
      targetType: 'Conversation',
      targetId: conversation.id,
      metadata: {
        courseId,
        anonymous: conversation.isAnonymous,
        chunksUsed: chunks.length,
        fromCourseContext,
      },
    });

    return {
      messageId: assistantMessage.id,
      conversationId: conversation.id,
      answer,
      sources,
      fromCourseContext,
    };
  }

  // --------------------------------------------------------------------------
  // Lister les conversations d'un cours (étudiant voit les siennes,
  // owner/co-owner voient toutes — anonymat préservé côté serialisation)
  // --------------------------------------------------------------------------

  async getConversations(courseId: string, userId: string, courseRole: string) {
    const isResponsible = courseRole === 'CLASS_OWNER' || courseRole === 'CLASS_CO_OWNER';

    const conversations = await this.prisma.conversation.findMany({
      where: {
        courseId,
        // Un étudiant ou professeur ne voit que ses propres conversations.
        // Un owner/co-owner voit toutes les conversations du cours.
        ...(isResponsible ? {} : { userId }),
      },
      select: {
        id: true,
        courseId: true,
        // isAnonymous : toujours exposé pour que le client sache l'afficher différemment
        isAnonymous: true,
        createdAt: true,
        updatedAt: true,
        // userId exposé UNIQUEMENT si la conversation n'est pas anonyme
        // ET que l'acteur est owner/co-owner (voir commentaire ci-dessous).
        // On ne peut pas conditionner les champs Prisma dynamiquement,
        // donc on charge userId et on le filtre côté service.
        userId: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return conversations.map((conv) => ({
      id: conv.id,
      courseId: conv.courseId,
      isAnonymous: conv.isAnonymous,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      // Règle d'anonymat (docs/security.md §9) :
      //  - Une conversation anonyme → userId jamais exposé, même à l'owner.
      //  - Une conversation non anonyme et acteur owner/co-owner → userId visible.
      //  - Sinon → userId masqué (étudiant voit ses propres convs, userId = le sien).
      userId:
        !conv.isAnonymous && isResponsible
          ? conv.userId
          : conv.userId === userId
          ? conv.userId  // l'étudiant voit son propre userId
          : null,        // les autres ne voient pas
    }));
  }

  // --------------------------------------------------------------------------
  // Lire une conversation (avec ses messages)
  // --------------------------------------------------------------------------

  async getConversation(conversationId: string, userId: string, courseRole: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            sources: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation introuvable.');

    const isOwner =
      courseRole === 'CLASS_OWNER' || courseRole === 'CLASS_CO_OWNER';

    // Un étudiant ne peut voir que ses propres conversations.
    if (!isOwner && conversation.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
    }

    return {
      id: conversation.id,
      courseId: conversation.courseId,
      isAnonymous: conversation.isAnonymous,
      // Règle d'anonymat : même l'owner ne voit pas l'userId d'une conv anonyme.
      userId:
        !conversation.isAnonymous && (isOwner || conversation.userId === userId)
          ? conversation.userId
          : null,
      messages: conversation.messages,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Lire une conversation par id — résout le courseRole en interne
  // (utilisé par GET /conversations/:id sans :courseId dans la route)
  // --------------------------------------------------------------------------

  async getConversationById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, role: true, content: true, sources: true, createdAt: true,
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation introuvable.');

    // Résoudre si l'acteur est owner/co-owner de la classe parente.
    const cls = await this.prisma.class.findFirst({
      where: { courses: { some: { id: conversation.courseId } } },
      select: { ownerId: true, coOwnerId: true },
    });

    const isOwner = cls && (cls.ownerId === userId || cls.coOwnerId === userId);

    if (!isOwner && conversation.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
    }

    return {
      id: conversation.id,
      courseId: conversation.courseId,
      isAnonymous: conversation.isAnonymous,
      userId:
        !conversation.isAnonymous && (isOwner || conversation.userId === userId)
          ? conversation.userId
          : null,
      messages: conversation.messages,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  /** Résout ou crée une conversation. Vérifie que la conv appartient au bon cours/user. */
  private async resolveConversation(
    courseId: string,
    userId: string,
    conversationId: string | undefined,
    isAnonymous: boolean,
  ) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, courseId: true, userId: true, isAnonymous: true },
      });

      if (!existing) throw new NotFoundException('Conversation introuvable.');

      // Vérification IDOR : la conversation doit appartenir à CE cours et à CE user.
      // Jamais de confiance dans le conversationId envoyé par le client.
      if (existing.courseId !== courseId || existing.userId !== userId) {
        throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
      }

      return existing;
    }

    // Créer une nouvelle conversation.
    return this.prisma.conversation.create({
      data: { courseId, userId, isAnonymous },
      select: { id: true, courseId: true, userId: true, isAnonymous: true },
    });
  }

  /** Charge les N derniers messages d'une conversation depuis la DB. */
  private async loadHistory(conversationId: string): Promise<ConversationTurn[]> {
    const MAX_MESSAGES = 20; // 10 tours (user + assistant)

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      select: { role: true, content: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_MESSAGES,
    });

    return messages.map((m) => ({
      role: m.role === MessageRole.USER ? 'USER' : 'ASSISTANT',
      content: m.content,
    }));
  }
}
