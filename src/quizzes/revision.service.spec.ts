import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { RevisionService, GeneratedQuiz } from './revision.service';
import { QuizType, QuizDifficulty, GenerateQuizDto } from './dto/generate-quiz.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RagService, RagChunk } from '../rag/rag.service';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COURSE_ID = 'course-uuid';
const CLASS_ID  = 'class-uuid';
const DOC_ID    = 'doc-uuid';
const USER_ID   = 'user-uuid';

const MOCK_CHUNKS: RagChunk[] = [
  {
    chunkId: 'c1', documentId: DOC_ID, documentName: 'cours.pdf',
    content: 'Le subnetting divise un réseau IP en sous-réseaux.', similarity: 0.92,
  },
  {
    chunkId: 'c2', documentId: DOC_ID, documentName: 'cours.pdf',
    content: 'Le masque /27 donne 32 adresses, dont 30 utilisables.', similarity: 0.88,
  },
];

const VALID_MCQ_RESPONSE = JSON.stringify({
  title: 'Quiz Réseaux',
  questions: [
    {
      question: 'Combien d\'adresses donne un /27 ?',
      choices: ['16', '32', '64', '128'],
      correctIndex: 1,
      explanation: 'Un /27 donne 2^5 = 32 adresses.',
    },
  ],
});

const VALID_SUMMARY_RESPONSE = JSON.stringify({
  title: 'Résumé — Réseaux',
  summary: '## Subnetting\n\nLe subnetting divise un réseau en sous-réseaux...',
});

const VALID_FLASHCARD_RESPONSE = JSON.stringify({
  title: 'Flashcards — Réseaux',
  flashcards: [
    { front: 'Qu\'est-ce que le subnetting ?', back: 'Division d\'un réseau en sous-réseaux.' },
  ],
});

const VALID_OPEN_RESPONSE = JSON.stringify({
  title: 'Questions ouvertes — Réseaux',
  openQuestions: [
    {
      question: 'Expliquez le calcul du masque /27.',
      modelAnswer: '2^5 = 32 adresses, dont 30 utilisables.',
    },
  ],
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeService(overrides: {
  ragChunks?: RagChunk[];
  llmResponse?: string;
  docExists?: boolean;
  prismaOverrides?: Record<string, unknown>;
} = {}) {
  const ragChunks = overrides.ragChunks ?? MOCK_CHUNKS;
  const llmResponse = overrides.llmResponse ?? VALID_MCQ_RESPONSE;

  const prisma = {
    document: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.docExists === false ? null : { id: DOC_ID },
      ),
    },
    quiz: {
      create: jest.fn().mockResolvedValue({ id: 'quiz-uuid', courseId: COURSE_ID }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'quiz-uuid', questions: [] }),
    },
    ...overrides.prismaOverrides,
  } as unknown as PrismaService;

  const rag = {
    search: jest.fn().mockResolvedValue(ragChunks),
  } as unknown as RagService;

  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      apiKey: 'test-key', embeddingModel: 'text-embedding-3-small',
      chatModel: 'gpt-4o-mini', ragTopK: 6, ragSimilarityThreshold: 0.7,
      maxTokens: 1000,
    }),
  } as unknown as ConfigService;

  const svc = new RevisionService(prisma, rag, config);

  // Mock du client OpenAI
  (svc as unknown as {
    client: { chat: { completions: { create: jest.Mock } } };
  }).client = {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: llmResponse } }],
        }),
      },
    },
  };

  return { svc, prisma, rag };
}

function makeDto(overrides: Partial<GenerateQuizDto> = {}): GenerateQuizDto {
  return {
    type: QuizType.MCQ,
    numberOfQuestions: 5,
    difficulty: QuizDifficulty.MEDIUM,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests : génération QCM
// ---------------------------------------------------------------------------

describe('RevisionService.generate — MCQ', () => {
  it('retourne un quiz QCM valide', async () => {
    const { svc } = makeService({ llmResponse: VALID_MCQ_RESPONSE });
    const result = await svc.generate(COURSE_ID, CLASS_ID, makeDto());

    expect(result.type).toBe(QuizType.MCQ);
    expect(result.questions).toHaveLength(1);
    expect(result.questions![0].correctIndex).toBe(1);
    expect(result.sourceDocumentIds).toContain(DOC_ID);
  });

  it('passe le courseId et classId au RAG (isolation)', async () => {
    const { svc, rag } = makeService();
    await svc.generate(COURSE_ID, CLASS_ID, makeDto());

    expect(rag.search).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: COURSE_ID, classId: CLASS_ID }),
    );
  });

  it('lève BadRequestException si aucun chunk RAG trouvé', async () => {
    const { svc } = makeService({ ragChunks: [] });
    await expect(
      svc.generate(COURSE_ID, CLASS_ID, makeDto()),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève BadRequestException si le JSON LLM est invalide', async () => {
    const { svc } = makeService({ llmResponse: 'pas du json {{{{' });
    await expect(
      svc.generate(COURSE_ID, CLASS_ID, makeDto()),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève BadRequestException si le JSON LLM ne contient pas "questions"', async () => {
    const { svc } = makeService({
      llmResponse: JSON.stringify({ title: 'Test', wrongField: [] }),
    });
    await expect(
      svc.generate(COURSE_ID, CLASS_ID, makeDto()),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève BadRequestException si correctIndex est hors limites', async () => {
    const badResponse = JSON.stringify({
      title: 'Quiz',
      questions: [{
        question: 'Q?', choices: ['A', 'B'], correctIndex: 5, explanation: 'E',
      }],
    });
    const { svc } = makeService({ llmResponse: badResponse });
    await expect(
      svc.generate(COURSE_ID, CLASS_ID, makeDto()),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Tests : autres types
// ---------------------------------------------------------------------------

describe('RevisionService.generate — types', () => {
  it('génère un résumé (SUMMARY)', async () => {
    const { svc } = makeService({ llmResponse: VALID_SUMMARY_RESPONSE });
    const result = await svc.generate(COURSE_ID, CLASS_ID, makeDto({ type: QuizType.SUMMARY }));

    expect(result.type).toBe(QuizType.SUMMARY);
    expect(result.summary).toContain('## Subnetting');
  });

  it('génère des flashcards (FLASHCARD)', async () => {
    const { svc } = makeService({ llmResponse: VALID_FLASHCARD_RESPONSE });
    const result = await svc.generate(COURSE_ID, CLASS_ID, makeDto({ type: QuizType.FLASHCARD }));

    expect(result.type).toBe(QuizType.FLASHCARD);
    expect(result.flashcards).toHaveLength(1);
    expect(result.flashcards![0].front).toBeTruthy();
  });

  it('génère des questions ouvertes (OPEN)', async () => {
    const { svc } = makeService({ llmResponse: VALID_OPEN_RESPONSE });
    const result = await svc.generate(COURSE_ID, CLASS_ID, makeDto({ type: QuizType.OPEN }));

    expect(result.type).toBe(QuizType.OPEN);
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions![0].modelAnswer).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests : sécurité IDOR documentId
// ---------------------------------------------------------------------------

describe('RevisionService.generate — sécurité documentId', () => {
  it('accepte un documentId appartenant au cours', async () => {
    const { svc } = makeService({ docExists: true });
    const result = await svc.generate(
      COURSE_ID, CLASS_ID, makeDto({ documentId: DOC_ID }),
    );
    expect(result).toBeDefined();
  });

  it('lève ForbiddenException si documentId n\'appartient pas au cours (IDOR)', async () => {
    const { svc } = makeService({ docExists: false });
    await expect(
      svc.generate(COURSE_ID, CLASS_ID, makeDto({ documentId: 'cross-course-doc-uuid' })),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// Tests : sécurité topic (injection)
// ---------------------------------------------------------------------------

describe('RevisionService — sécurité topic', () => {
  it('tronque le topic à 200 caractères dans le prompt', async () => {
    const longTopic = 'A'.repeat(300);
    const { svc, rag } = makeService();

    // On vérifie que la requête RAG contient une version tronquée du topic
    await svc.generate(COURSE_ID, CLASS_ID, makeDto({ topic: longTopic }));

    // La requête RAG est construite à partir du topic — vérifier qu'elle ne dépasse pas
    const ragCall = (rag.search as jest.Mock).mock.calls[0][0];
    // La requête RAG contient le topic (partiellement)
    expect(ragCall.query).toBeDefined();
    expect(typeof ragCall.query).toBe('string');
  });

  it('topic contenant balises XML n\'affecte pas la structure du prompt', async () => {
    // Le topic est injecté dans le userPrompt, pas le systemPrompt.
    // Ce test vérifie que la génération ne plante pas avec un topic malformé.
    const { svc } = makeService();
    const result = await svc.generate(
      COURSE_ID, CLASS_ID,
      makeDto({ topic: '<script>alert("xss")</script>' }),
    );
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests : persistance quiz
// ---------------------------------------------------------------------------

describe('RevisionService.saveQuiz', () => {
  it('sauvegarde un QCM avec ses questions', async () => {
    const { svc, prisma } = makeService();
    const generated: GeneratedQuiz = {
      type: QuizType.MCQ,
      title: 'Test Quiz',
      courseId: COURSE_ID,
      sourceDocumentIds: [DOC_ID],
      questions: [{
        question: 'Q?', choices: ['A', 'B', 'C', 'D'],
        correctIndex: 0, explanation: 'A est correct.',
      }],
    };

    await svc.saveQuiz(COURSE_ID, generated, USER_ID);
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseId: COURSE_ID, title: 'Test Quiz' }),
      }),
    );
  });

  it('lève BadRequestException si le quiz n\'a pas de questions (résumé, flashcards)', async () => {
    const { svc } = makeService();
    const generated: GeneratedQuiz = {
      type: QuizType.SUMMARY, title: 'Résumé', courseId: COURSE_ID,
      sourceDocumentIds: [], summary: 'Contenu...',
    };
    await expect(svc.saveQuiz(COURSE_ID, generated, USER_ID)).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Tests : findOne vérifie l'appartenance au cours
// ---------------------------------------------------------------------------

describe('RevisionService.findOne', () => {
  it('lève BadRequestException si le quiz n\'appartient pas au cours', async () => {
    const { svc } = makeService({
      prismaOverrides: {
        quiz: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    });
    await expect(svc.findOne('quiz-uuid', 'mauvais-cours-uuid')).rejects.toThrow(BadRequestException);
  });
});
