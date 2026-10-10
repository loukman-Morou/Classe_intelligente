import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { LlmConfig } from '../config/configuration';

/**
 * Résultat d'une requête radar pédagogique côté cours.
 * Le seuil anonymat est appliqué : les topics sous MIN_THRESHOLD sont exclus.
 */
export interface CourseRadarResult {
  courseId: string;
  courseName: string;
  totalQuestions: number;
  topics: Array<{
    topic: string;
    questionCount: number;
  }>;
}

/**
 * Résultat du radar cross-classes côté professeur.
 * Agrège plusieurs classes partageant le même cours original.
 */
export interface ProfessorRadarResult {
  professorCourseId: string;
  professorCourseName: string;
  totalClasses: number;
  totalStudents: number;
  totalQuestions: number;
  topics: Array<{
    topic: string;
    questionCount: number;
    byClass: Array<{
      classId: string;
      className: string;
      questionCount: number;
    }>;
  }>;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('AnalyticsService');

  /**
   * Seuil d'anonymat configurable (env ANALYTICS_MIN_THRESHOLD, défaut : 5).
   * En dessous de ce seuil, une statistique n'est pas affichée au professeur
   * pour éviter la ré-identification indirecte d'un étudiant.
   */
  private readonly MIN_THRESHOLD: number;

  private client!: OpenAI;
  private chatModel!: string;

  constructor(
    private readonly prisma: PrismaService,
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
  // Enregistrer une question posée (appelé par AiService, non bloquant)
  // --------------------------------------------------------------------------

  /**
   * Extrait le thème d'une question posée à l'IA et incrémente le compteur.
   *
   * DESIGN : cette méthode est appelée en fire-and-forget depuis AiService
   * (`.catch(err => logger.warn(err))`). Un échec n'impacte JAMAIS la réponse
   * du chat — le radar pédagogique est une fonctionnalité annexe, pas critique.
   *
   * La classification est faite par le LLM en mode JSON strict pour éviter
   * des topics verbeux ou incohérents. Si le LLM échoue, on skippe silencieusement.
   */
  async recordQuestion(
    question: string,
    courseId: string,
    classId: string,
  ): Promise<void> {
    try {
      const topicName = await this.classifyQuestion(question, courseId);
      if (!topicName) return; // Pas de topic identifiable → skip

      await this.upsertTopicCount(topicName, courseId, classId);
    } catch (err) {
      // Log mais jamais de throw : le chat doit toujours répondre même si
      // l'analytics échoue.
      this.logger.warn(
        `recordQuestion échoué pour courseId=${courseId} : ${String(err)}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Vue radar côté cours (owner/co-owner ou professeur du cours)
  // --------------------------------------------------------------------------

  async getCourseRadar(courseId: string): Promise<CourseRadarResult> {
    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { id: true, name: true },
    });

    const analytics = await this.prisma.questionAnalytics.findMany({
      where: {
        courseId,
        questionCount: { gte: this.MIN_THRESHOLD },
      },
      include: { questionTopic: { select: { name: true } } },
      orderBy: { questionCount: 'desc' },
    });

    const totalQuestions = analytics.reduce((sum, a) => sum + a.questionCount, 0);

    return {
      courseId,
      courseName: course.name,
      totalQuestions,
      topics: analytics.map((a) => ({
        topic: a.questionTopic.name,
        questionCount: a.questionCount,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Vue radar cross-classes côté professeur
  // --------------------------------------------------------------------------

  /**
   * Agrège les données de tous les cours issus d'un cours professeur original
   * (via CourseShareRecord / ClassCourse). Le seuil d'anonymat est appliqué
   * par classe pour éviter qu'une classe avec 1 étudiant expose ses données.
   *
   * Si une classe a moins de MIN_THRESHOLD questions sur un topic, ce topic
   * n'est pas affiché dans le détail par classe (mais peut rester dans l'aggrégat
   * si d'autres classes dépassent le seuil).
   */
  async getProfessorRadar(professorId: string): Promise<ProfessorRadarResult[]> {
    // Cours originaux du professeur.
    const profCourses = await this.prisma.professorCourse.findMany({
      where: { professorId },
      select: { id: true, name: true },
    });

    const results: ProfessorRadarResult[] = [];

    for (const profCourse of profCourses) {
      // Récupérer toutes les copies classes de ce cours original.
      const classCourses = await this.prisma.classCourse.findMany({
        where: { professorCourseId: profCourse.id },
        select: {
          courseId: true,
          class: { select: { id: true, name: true } },
        },
      });

      if (classCourses.length === 0) continue;

      const courseIds = classCourses.map((cc) => cc.courseId);
      const classMap = new Map(
        classCourses.map((cc) => [cc.courseId, cc.class]),
      );

      // Agréger les analytics de toutes ces copies.
      const analytics = await this.prisma.questionAnalytics.findMany({
        where: { courseId: { in: courseIds } },
        include: {
          questionTopic: { select: { name: true } },
          course: { select: { id: true } },
        },
      });

      // Grouper par nom de topic pour l'agrégation cross-classes.
      const topicMap = new Map<string, {
        total: number;
        byClass: Map<string, { classId: string; className: string; count: number }>;
      }>();

      for (const a of analytics) {
        const topicName = a.questionTopic.name;
        const cls = classMap.get(a.courseId);
        if (!cls) continue;

        if (!topicMap.has(topicName)) {
          topicMap.set(topicName, { total: 0, byClass: new Map() });
        }

        const entry = topicMap.get(topicName)!;
        entry.total += a.questionCount;

        // Seuil par classe : ne pas exposer si trop peu de questions.
        if (a.questionCount >= this.MIN_THRESHOLD) {
          entry.byClass.set(cls.id, {
            classId: cls.id,
            className: cls.name,
            count: a.questionCount,
          });
        }
      }

      // Filtrer les topics dont le total est sous le seuil.
      const topics = Array.from(topicMap.entries())
        .filter(([, entry]) => entry.total >= this.MIN_THRESHOLD)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([topic, entry]) => ({
          topic,
          questionCount: entry.total,
          byClass: Array.from(entry.byClass.values()).map((c) => ({
            classId: c.classId,
            className: c.className,
            questionCount: c.count,
          })),
        }));

      const totalQuestions = topics.reduce((s, t) => s + t.questionCount, 0);

      // Compter les étudiants uniques dans toutes les classes concernées.
      const totalStudents = await this.prisma.classMember.count({
        where: {
          classId: {
            in: classCourses
              .map((cc) => cc.class.id)
              .filter((id): id is string => !!id),
          },
        },
      });

      results.push({
        professorCourseId: profCourse.id,
        professorCourseName: profCourse.name,
        totalClasses: classCourses.length,
        totalStudents,
        totalQuestions,
        topics,
      });
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  /**
   * Classifie la question en un thème court (1-4 mots) via le LLM.
   *
   * SÉCURITÉ :
   *  - La question est traitée comme donnée (pas comme instruction).
   *  - Le prompt système ne contient jamais le contenu de la question.
   *  - Réponse JSON forcée (json_object) : format stable, pas de texte libre.
   *  - Si le LLM retourne quelque chose d'inattendu → null (skip silencieux).
   */
  private async classifyQuestion(
    question: string,
    courseId: string,
  ): Promise<string | null> {
    // Récupérer les topics existants pour ce cours (aide le LLM à regrouper).
    const existingTopics = await this.prisma.questionTopic.findMany({
      where: { courseId },
      select: { name: true },
      take: 20,
    });

    const existingList = existingTopics.map((t) => t.name).join(', ') || 'aucun';

    const completion = await this.client.chat.completions.create({
      model: this.chatModel,
      max_tokens: 50,
      temperature: 0.1, // Faible température : classification reproductible
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Tu es un classificateur de questions pédagogiques. ' +
            'Retourne UNIQUEMENT un objet JSON avec un seul champ "topic" : ' +
            'un groupe thématique court (1 à 4 mots) identifiant la notion principale de la question. ' +
            'Si une question est trop vague ou hors sujet, retourne {"topic": null}. ' +
            'Priorité : regrouper avec un topic existant si pertinent.',
        },
        {
          role: 'user',
          content:
            `Topics existants pour ce cours : ${existingList}\n\n` +
            `Question à classifier :\n${question.slice(0, 500)}`,
        },
      ],
    });

    try {
      const raw = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as { topic?: string | null };
      const topic = parsed.topic;

      if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
        return null;
      }

      // Normaliser : titre capitalize, max 60 chars.
      return topic.trim().slice(0, 60);
    } catch {
      return null;
    }
  }

  /**
   * Upsert atomique : crée le topic s'il n'existe pas, incrémente le compteur.
   * Utilise `updateMany` + `count` pour être safe en cas d'appels concurrents
   * (deux questions sur le même topic au même instant).
   */
  private async upsertTopicCount(
    topicName: string,
    courseId: string,
    classId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Upsert du topic.
      let topic = await tx.questionTopic.findUnique({
        where: { courseId_name: { courseId, name: topicName } },
        select: { id: true },
      });

      if (!topic) {
        topic = await tx.questionTopic.create({
          data: { courseId, name: topicName },
          select: { id: true },
        });
      }

      // Upsert du compteur (questionCount += 1 de façon atomique).
      const existing = await tx.questionAnalytics.findUnique({
        where: {
          courseId_questionTopicId: {
            courseId, questionTopicId: topic.id,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await tx.questionAnalytics.update({
          where: { id: existing.id },
          data: { questionCount: { increment: 1 } },
        });
      } else {
        await tx.questionAnalytics.create({
          data: {
            courseId,
            questionTopicId: topic.id,
            questionCount: 1,
          },
        });
      }
    });
  }
}
