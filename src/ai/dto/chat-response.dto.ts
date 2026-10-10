export interface ChatSource {
  documentId: string;
  documentName: string;
}

export interface ChatResponseDto {
  messageId: string;
  conversationId: string;
  answer: string;
  sources: ChatSource[];
  /** Indique si la réponse vient des documents du cours ou des connaissances générales du modèle. */
  fromCourseContext: boolean;
}
