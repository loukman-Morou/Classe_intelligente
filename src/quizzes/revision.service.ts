import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import { LlmConfig } from '../config/configuration';
import { GenerateQuizDto, QuizDifficulty, QuizType } from './dto/generate-quiz.dto';

// ---------------------------------------------------------------------------
// Types de sortie
// ---------------------------------------------------------------------------

export interface McqQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface OpenQuestion {
  question: string;
  modelAnswer: string;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface GeneratedQuiz {
  type: QuizType;
  title: string;
  courseId: string;
  documentId?: string;
  topic?: string;
  difficulty?: QuizDifficulty;
  /** QCM */
  questions?: McqQuestion[];
  /** Questions ouvertes */
  openQuestions?: OpenQuestion[];
  /** Flashcards */
  flashcards?: Flashcard[];
  /** Résumé */
  summary?: string;
  /** Chunks sources utilisés (pour traçabilité) */
  sourceDocumentIds: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RevisionService {
  private readonly logger = new Logger('RevisionService');
  private client!: OpenAI;
  private chatModel!: string;
  private maxTokens!: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
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
  // Générer un contenu de révision
  // --------------------------------------------------------------------------

  async generate(
    courseId: string,
    classId: string,
    dto: GenerateQuizDto,
  ): Promise<GeneratedQuiz> {

    // 1. Vérifier que le documentId (si fourni) appartient bien à ce cours.
    if (dto.documentId) {
      await this.assertDocumentBelongsToCourse(dto.documentId, courseId);
    }

    // 2. Construire la requête de recherche RAG.
    const ragQuery = this.buildRagQuery(dto);

    // 3. Recherche sémantique filtrée — même pipeline que le chat, même isolation.
    const chunks = await this.rag.search({
      query: ragQuery,
      courseId,
      classId,
      topK: 8,
    });

    if (chunks.length === 0) {
      throw new BadRequestException(
        'Aucun contenu pertinent trouvé dans les documents de ce cours. ' +
        'Assurez-vous que des documents ont été uploadés et traités (statut READY).',
      );
    }

    const sourceDocumentIds = [...new Set(chunks.map((c) => c.documentId))];

    // 4. Construire le prompt de génération.
    const { systemPrompt, userPrompt } = this.buildPrompts(dto, chunks);

    // 5. Appel LLM avec instruction de retour JSON strict.
    this.logger.debug(
      `Génération ${dto.type} — courseId=${courseId} chunks=${chunks.length}`,
    );

    const completion = await this.client.chat.completions.create({
      model: this.chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: this.maxTokens * 2, // Génération plus longue qu'un chat
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });

    const rawJson = completion.choices[0]?.message?.content ?? '{}';

    // 6. Parser et valider la réponse JSON.
    return this.parseAndValidate(rawJson, dto, courseId, sourceDocumentIds);
  }

  // --------------------------------------------------------------------------
  // Persister un quiz (le client peut demander à sauvegarder)
  // --------------------------------------------------------------------------

  async saveQuiz(
    courseId: string,
    generated: GeneratedQuiz,
    actorId: string,
  ) {
    if (!generated.questions || generated.questions.length === 0) {
      throw new BadRequestException('Seuls les QCM peuvent être sauvegardés.');
    }

    return this.prisma.quiz.create({
      data: {
        courseId,
        title: generated.title,
        questions: {
          create: generated.questions.map((q) => ({
            prompt: q.question,
            choices: q.choices,
            correctChoiceIndex: q.correctIndex,
            explanation: q.explanation,
          })),
        },
      },
      include: { questions: true },
    });
  }

  // --------------------------------------------------------------------------
  // Lister / lire les quiz sauvegardés d'un cours
  // --------------------------------------------------------------------------

  async findAllForCourse(courseId: string) {
    return this.prisma.quiz.findMany({
      where: { courseId },
      include: { questions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(quizId: string, courseId: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, courseId },
      include: { questions: { orderBy: { createdAt: 'asc' } } },
    });

    if (!quiz) {
      throw new BadRequestException('Quiz introuvable dans ce cours.');
    }

    return quiz;
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  /**
   * Vérifie que le document appartient bien au cours — protection IDOR :
   * un étudiant ne peut pas demander un résumé d'un document d'un autre cours
   * en envoyant un documentId valide mais cross-cours.
   */
  private async assertDocumentBelongsToCourse(
    documentId: string,
    courseId: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        courseId,
        status: DocumentStatus.READY,
      },
      select: { id: true },
    });

    if (!doc) {
      throw new ForbiddenException(
        "Ce document n'appartient pas à ce cours ou n'est pas encore prêt.",
      );
    }
  }

  /**
   * Construit la requête de recherche RAG à partir du DTO.
   * On n'utilise jamais la valeur brute du `topic` comme requête SQL —
   * elle est uniquement transmise à l'API d'embeddings (texte libre).
   */
  private buildRagQuery(dto: GenerateQuizDto): string {
    const base: Record<QuizType, string> = {
      [QuizType.MCQ]:       'questions et concepts clés du cours',
      [QuizType.OPEN]:      'notions importantes et problèmes à résoudre',
      [QuizType.FLASHCARD]: 'définitions termes et concepts fondamentaux',
      [QuizType.SUMMARY]:   'contenu principal et points essentiels du cours',
    };

    const base_q = base[dto.type];
    return dto.topic ? `${dto.topic} — ${base_q}` : base_q;
  }

  /**
   * Construit les prompts système et utilisateur.
   *
   * SÉCURITÉ :
   *  - `dto.topic` est injecté dans le prompt UTILISATEUR (pas système),
   *    après troncature à 200 chars (validée par le DTO).
   *  - Les chunks RAG sont encadrés par <document_context>, comme dans le chat.
   *  - Le prompt système est une constante — ne contient jamais de contenu utilisateur.
   */
  private buildPrompts(
    dto: GenerateQuizDto,
    chunks: Array<{ content: string; documentName: string; documentId: string; similarity: number }>,
  ): { systemPrompt: string; userPrompt: string } {
    const n = dto.numberOfQuestions ?? 10;
    const diff = dto.difficulty ?? QuizDifficulty.MEDIUM;

    const systemPrompts: Record<QuizType, string> = {
      [QuizType.MCQ]: `Tu es un expert pédagogique qui crée des QCM rigoureux.
Tu dois retourner UNIQUEMENT un objet JSON valide, sans texte avant ou après, au format :
{
  "title": "Titre du quiz",
  "questions": [
    {
      "question": "Question ?",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "Explication concise de la bonne réponse."
    }
  ]
}
Règles : ${n} questions, difficulté ${diff}, 4 choix par question, correctIndex est l'index (0-3) de la bonne réponse. Utilise UNIQUEMENT le contenu du document_context fourni. Ne génère rien hors contexte.`,

      [QuizType.OPEN]: `Tu es un expert pédagogique qui crée des questions ouvertes stimulantes.
Tu dois retourner UNIQUEMENT un objet JSON valide, sans texte avant ou après, au format :
{
  "title": "Titre des questions",
  "openQuestions": [
    {
      "question": "Question ouverte ?",
      "modelAnswer": "Réponse modèle détaillée."
    }
  ]
}
Règles : ${n} questions, difficulté ${diff}. Utilise UNIQUEMENT le contenu du document_context.`,

      [QuizType.FLASHCARD]: `Tu es un expert pédagogique qui crée des flashcards mémorables.
Tu dois retourner UNIQUEMENT un objet JSON valide, sans texte avant ou après, au format :
{
  "title": "Flashcards — [sujet]",
  "flashcards": [
    { "front": "Terme ou question", "back": "Définition ou réponse concise" }
  ]
}
Règles : ${n} cartes, une seule notion par carte, recto court, verso complet mais concis. Utilise UNIQUEMENT le contenu du document_context.`,

      [QuizType.SUMMARY]: `Tu es un expert pédagogique qui crée des résumés structurés.
Tu dois retourner UNIQUEMENT un objet JSON valide, sans texte avant ou après, au format :
{
  "title": "Résumé — [sujet]",
  "summary": "Résumé complet en markdown, structuré avec des titres ## et des listes."
}
Règles : couvre tous les points importants du document_context. Sois exhaustif mais concis. Format markdown uniquement dans le champ summary.`,
    };

    // Contexte documentaire — même structure que PromptBuilderService.
    const documentContext = chunks
      .map(
        (c, i) =>
          `<source index="${i + 1}" document="${c.documentName
            .replace(/"/g, '&quot;')}" document_id="${c.documentId}">
${c.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
</source>`,
      )
      .join('\n\n');

    const topicLine = dto.topic
      ? `\nFocus thématique : ${dto.topic.slice(0, 200)}\n`
      : '';

    const userPrompt =
      `<document_context>\n${documentContext}\n</document_context>\n` +
      topicLine +
      `\nGénère le contenu demandé à partir des documents ci-dessus.`;

    return {
      systemPrompt: systemPrompts[dto.type],
      userPrompt,
    };
  }

  /**
   * Parse la réponse JSON du LLM et valide sa structure.
   *
   * Le LLM peut retourner du JSON mal formé ou une structure inattendue.
   * On ne fait jamais confiance au format retourné — on valide chaque champ
   * et on lève une `BadRequestException` (pas une 500) si la structure est invalide.
   */
  private parseAndValidate(
    rawJson: string,
    dto: GenerateQuizDto,
    courseId: string,
    sourceDocumentIds: string[],
  ): GeneratedQuiz {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      this.logger.error(`JSON LLM invalide : ${rawJson.slice(0, 200)}`);
      throw new BadRequestException(
        'Le modèle IA a retourné une réponse invalide. Veuillez réessayer.',
      );
    }

    const title = typeof parsed['title'] === 'string'
      ? parsed['title']
      : `${dto.type} — ${new Date().toLocaleDateString('fr-FR')}`;

    const base: GeneratedQuiz = {
      type: dto.type,
      title,
      courseId,
      documentId: dto.documentId,
      topic: dto.topic,
      difficulty: dto.difficulty,
      sourceDocumentIds,
    };

    switch (dto.type) {
      case QuizType.MCQ: {
        const qs = this.assertArray(parsed['questions'], 'questions');
        base.questions = qs.map((q, i) => {
          const qObj = this.assertObject(q, `questions[${i}]`);
          return {
            question:     this.assertString(qObj['question'],     `questions[${i}].question`),
            choices:      this.assertStringArray(qObj['choices'], `questions[${i}].choices`, 4),
            correctIndex: this.assertCorrectIndex(qObj['correctIndex'],
                          (qObj['choices'] as unknown[]).length, i),
            explanation:  this.assertString(qObj['explanation'],  `questions[${i}].explanation`),
          };
        });
        break;
      }
      case QuizType.OPEN: {
        const qs = this.assertArray(parsed['openQuestions'], 'openQuestions');
        base.openQuestions = qs.map((q, i) => {
          const qObj = this.assertObject(q, `openQuestions[${i}]`);
          return {
            question:    this.assertString(qObj['question'],    `openQuestions[${i}].question`),
            modelAnswer: this.assertString(qObj['modelAnswer'], `openQuestions[${i}].modelAnswer`),
          };
        });
        break;
      }
      case QuizType.FLASHCARD: {
        const cards = this.assertArray(parsed['flashcards'], 'flashcards');
        base.flashcards = cards.map((c, i) => {
          const cObj = this.assertObject(c, `flashcards[${i}]`);
          return {
            front: this.assertString(cObj['front'], `flashcards[${i}].front`),
            back:  this.assertString(cObj['back'],  `flashcards[${i}].back`),
          };
        });
        break;
      }
      case QuizType.SUMMARY: {
        base.summary = this.assertString(parsed['summary'], 'summary');
        break;
      }
    }

    return base;
  }

  // Helpers de validation du JSON LLM
  private assertArray(val: unknown, field: string): unknown[] {
    if (!Array.isArray(val) || val.length === 0) {
      throw new BadRequestException(
        `Réponse IA invalide : "${field}" doit être un tableau non vide.`,
      );
    }
    return val;
  }

  private assertObject(val: unknown, field: string): Record<string, unknown> {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      throw new BadRequestException(`Réponse IA invalide : "${field}" doit être un objet.`);
    }
    return val as Record<string, unknown>;
  }

  private assertString(val: unknown, field: string): string {
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new BadRequestException(
        `Réponse IA invalide : "${field}" doit être une chaîne non vide.`,
      );
    }
    return val.trim();
  }

  private assertStringArray(val: unknown, field: string, minLength: number): string[] {
    const arr = this.assertArray(val, field);
    if (arr.length < minLength) {
      throw new BadRequestException(
        `Réponse IA invalide : "${field}" doit contenir au moins ${minLength} éléments.`,
      );
    }
    return arr.map((item, i) => this.assertString(item, `${field}[${i}]`));
  }

  private assertCorrectIndex(val: unknown, choicesLength: number, qi: number): number {
    const idx = Number(val);
    if (!Number.isInteger(idx) || idx < 0 || idx >= choicesLength) {
      throw new BadRequestException(
        `Réponse IA invalide : "questions[${qi}].correctIndex" hors limites (${idx}).`,
      );
    }
    return idx;
  }
}
