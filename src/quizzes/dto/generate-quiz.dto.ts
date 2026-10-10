import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum QuizType {
  MCQ        = 'MCQ',
  OPEN       = 'OPEN',
  FLASHCARD  = 'FLASHCARD',
  SUMMARY    = 'SUMMARY',
}

export enum QuizDifficulty {
  EASY   = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD   = 'HARD',
}

export class GenerateQuizDto {
  /** Type de contenu à générer. */
  @IsEnum(QuizType)
  type!: QuizType;

  /** Nombre de questions / cartes (non applicable pour SUMMARY). */
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  numberOfQuestions?: number;

  @IsEnum(QuizDifficulty)
  @IsOptional()
  difficulty?: QuizDifficulty;

  /**
   * Focus thématique optionnel : "subnetting", "protocoles TCP/IP", etc.
   * Transmis au LLM pour orienter la sélection des chunks RAG.
   * Sanitisé avant injection dans le prompt.
   */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  topic?: string;

  /**
   * Si fourni, le quiz porte sur un document spécifique du cours.
   * Doit appartenir au cours (vérifié dans le service).
   */
  @IsUUID('4')
  @IsOptional()
  documentId?: string;
}
