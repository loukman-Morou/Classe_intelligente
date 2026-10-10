import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PedagogicalInsightSeverity } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LlmConfig } from '../config/configuration';

export interface InsightWithTopic {
  id: string;
  topic: string;
  severity: PedagogicalInsightSeverity;
  questionCount: number;
  recommendation: string | null;
  createdAt: Date;
}

@Injectable()
export class PedagogicalInsightsService {
  private readonly logger = new Logger('PedagogicalInsightsService');

  /**
   * Seuil d'occurrences à partir duquel un topic est analysé.
   * Identique à AnalyticsService.MIN_THRESHOLD — les deux partagent la même
   * valeur d'environnement pour cohérence.
   */
  private readonly MIN_THRESHOLD: number;

  private client!: OpenAI;
  private chatModel!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.MIN_THRESHOLD = parseInt(
      process.env.ANALYTICS_MIN_THRESHOLD ?? '5', 10,
    );
    const llm = this.config.getOrThrow<LlmConfig>('llm');
    this.chatModel = llm.chatModel;
    this.client = new OpenAI({
      apiKey: llm.apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  // --------------------------------------------------------------------------
  // Lister les insights d'un cours (professeur ou owner/co-owner)
  // --------------------------------------------------------------------------

  async findForCourse(courseId: string): Promise<InsightWithTopic[]> {
    const insights = await this.prisma.pedagogicalInsight.findMany({
      where: { courseId },
      include: { questionTopic: { select: { name: true } } },
      orderBy: [
        { severity: 'desc' },    // HIGH avant MEDIUM avant LOW
        { questionCount: 'desc' },
      ],
    });

    return insights.map((i) => ({
      id: i.id,
      topic: i.questionTopic.name,
      severity: i.severity,
      questionCount: i.questionCount,
      recommendation: i.recommendation,
      createdAt: i.createdAt,
    }));
  }

  // --------------------------------------------------------------------------
  // Générer (ou regénérer) les insights d'un cours via IA
  // --------------------------------------------------------------------------

  /**
   * Analyse les topics fréquents du cours et produit des suggestions
   * pédagogiques. L'IA PROPOSE — le professeur DÉCIDE (doc §22).
   *
   * Appelé manuellement par le professeur ou le responsable (pas automatique).
   * Ne modifie jamais un cours directement.
   */
  async generateForCourse(
    courseId: string,
    classId: string,
    actorId: string,
  ): Promise<InsightWithTopic[]> {
    // Vérifier que l'acteur est professeur du cours ou owner/co-owner de la classe.
    await this.assertActorCanTriggerInsights(courseId, classId, actorId);

    // Récupérer les topics qui dépassent le seuil.
    const analytics = await this.prisma.questionAnalytics.findMany({
      where: {
        courseId,
        questionCount: { gte: this.MIN_THRESHOLD },
      },
      include: { questionTopic: { select: { id: true, name: true } } },
      orderBy: { questionCount: 'desc' },
      take: 10, // Limiter le contexte LLM
    });

    if (analytics.length === 0) {
      throw new BadRequestException(
        'Pas assez de données pour générer des suggestions pédagogiques. ' +
        `Il faut au moins ${this.MIN_THRESHOLD} questions par thème.`,
      );
    }

    // Construire la liste des difficultés pour le LLM.
    const topicsContext = analytics
      .map((a) => `- ${a.questionTopic.name} : ${a.questionCount} questions`)
      .join('\n');

    // Appel LLM — prompt système strict, topics en userPrompt.
    const completion = await this.client.chat.completions.create({
      model: this.chatModel,
      max_tokens: 1500,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Tu es un conseiller pédagogique expert. ' +
            'On te donne une liste de notions qui posent fréquemment problème à des étudiants. ' +
            'Pour chaque notion, évalue la sévérité (HIGH/MEDIUM/LOW selon le nombre de questions) ' +
            'et propose UNE suggestion pédagogique concrète et actionnable. ' +
            'Retourne UNIQUEMENT un objet JSON valide au format :\n' +
            '{"insights": [{"topic": "string", "severity": "HIGH|MEDIUM|LOW", "recommendation": "string"}]}',
        },
        {
          role: 'user',
          content:
            `Notions fréquemment demandées dans ce cours :\n${topicsContext}\n\n` +
            'Génère les insights pédagogiques.',
        },
      ],
    });

    const rawJson = completion.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseLlmInsights(rawJson, analytics);

    // Persister les insights (upsert par topic).
    const saved: InsightWithTopic[] = [];

    for (const item of parsed) {
      const topic = analytics.find((a) => a.questionTopic.name === item.topic);
      if (!topic) continue;

      // Supprimer l'ancien insight pour ce topic (on régénère).
      await this.prisma.pedagogicalInsight.deleteMany({
        where: { courseId, questionTopicId: topic.questionTopic.id },
      });

      const insight = await this.prisma.pedagogicalInsight.create({
        data: {
          courseId,
          questionTopicId: topic.questionTopic.id,
          severity: item.severity,
          questionCount: topic.questionCount,
          recommendation: item.recommendation,
        },
        include: { questionTopic: { select: { name: true } } },
      });

      saved.push({
        id: insight.id,
        topic: insight.questionTopic.name,
        severity: insight.severity,
        questionCount: insight.questionCount,
        recommendation: insight.recommendation,
        createdAt: insight.createdAt,
      });
    }

    await this.audit.record({
      actorUserId: actorId,
      action: 'PEDAGOGICAL_INSIGHTS_GENERATED',
      targetType: 'Course',
      targetId: courseId,
      metadata: { insightCount: saved.length },
    });

    return saved;
  }

  // --------------------------------------------------------------------------
  // Marquer un insight comme traité (professeur l'a lu et agi)
  // --------------------------------------------------------------------------

  async dismiss(insightId: string, courseId: string, actorId: string): Promise<void> {
    const insight = await this.prisma.pedagogicalInsight.findFirst({
      where: { id: insightId, courseId },
      select: { id: true },
    });

    if (!insight) throw new NotFoundException('Insight introuvable dans ce cours.');

    await this.prisma.pedagogicalInsight.delete({ where: { id: insightId } });

    await this.audit.record({
      actorUserId: actorId,
      action: 'PEDAGOGICAL_INSIGHT_DISMISSED',
      targetType: 'PedagogicalInsight',
      targetId: insightId,
    });
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  private async assertActorCanTriggerInsights(
    courseId: string,
    classId: string,
    actorId: string,
  ): Promise<void> {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { ownerId: true, coOwnerId: true },
    });

    if (!cls) throw new NotFoundException('Classe introuvable.');

    const isOwner = cls.ownerId === actorId || cls.coOwnerId === actorId;
    if (isOwner) return;

    const isProfessor = await this.prisma.courseProfessor.findUnique({
      where: { userId_courseId: { userId: actorId, courseId } },
      select: { id: true },
    });

    if (!isProfessor) {
      throw new ForbiddenException(
        'Seul le responsable, le co-responsable ou le professeur du cours peut générer des insights.',
      );
    }
  }

  /**
   * Parse la réponse JSON du LLM et map vers les analytics réels.
   * La sévérité est calculée par le LLM mais plafonnée ici selon le
   * questionCount réel (garde-fou : le LLM ne peut pas surévaluer).
   */
  private parseLlmInsights(
    rawJson: string,
    analytics: Array<{
      questionCount: number;
      questionTopic: { name: string };
    }>,
  ): Array<{
    topic: string;
    severity: PedagogicalInsightSeverity;
    recommendation: string;
  }> {
    let parsed: { insights?: unknown[] };

    try {
      parsed = JSON.parse(rawJson) as { insights?: unknown[] };
    } catch {
      this.logger.error(`JSON LLM invalide : ${rawJson.slice(0, 200)}`);
      throw new BadRequestException(
        'Le modèle IA a retourné une réponse invalide. Veuillez réessayer.',
      );
    }

    if (!Array.isArray(parsed.insights)) {
      throw new BadRequestException('Réponse IA invalide : "insights" manquant ou non-tableau.');
    }

    const countMap = new Map(
      analytics.map((a) => [a.questionTopic.name, a.questionCount]),
    );

    return parsed.insights
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
      )
      .map((item) => {
        const topic = String(item['topic'] ?? '').trim();
        const recommendation = String(item['recommendation'] ?? '').trim();
        const llmSeverity = String(item['severity'] ?? '').toUpperCase();

        if (!topic || !recommendation) return null;

        // Calculer la sévérité réelle à partir du questionCount (garde-fou).
        const count = countMap.get(topic) ?? 0;
        const severity = this.computeSeverity(count, llmSeverity);

        return { topic, severity, recommendation };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * Sévérité calculée par règles métier (le questionCount réel prime sur le LLM).
   * Le LLM peut affiner la suggestion mais ne peut pas manipuler la sévérité finale.
   */
  private computeSeverity(
    count: number,
    llmSeverity: string,
  ): PedagogicalInsightSeverity {
    // Règles métier de base.
    if (count >= 30) return PedagogicalInsightSeverity.HIGH;
    if (count >= 15) return PedagogicalInsightSeverity.MEDIUM;
    if (count >= this.MIN_THRESHOLD) {
      // Dans la plage basse, on accepte l'avis LLM s'il dégrade (jamais upgrade).
      if (llmSeverity === 'LOW') return PedagogicalInsightSeverity.LOW;
      return PedagogicalInsightSeverity.LOW;
    }
    return PedagogicalInsightSeverity.LOW;
  }
}
