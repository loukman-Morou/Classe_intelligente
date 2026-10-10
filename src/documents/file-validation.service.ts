import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Mapping : MIME déclaré → magic bytes attendus.
 *
 * Ne jamais se fier uniquement à l'extension ou au Content-Type déclaré par
 * le client (trivial à forger). On vérifie les magic bytes réels du fichier.
 * Voir docs/security.md §10.
 */
const ALLOWED_TYPES: Record<string, { magic: Buffer[]; ext: string }> = {
  'application/pdf': {
    magic: [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
    ext: 'pdf',
  },
  'image/jpeg': {
    magic: [Buffer.from([0xff, 0xd8, 0xff])],
    ext: 'jpg',
  },
  'image/png': {
    magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ext: 'png',
  },
};

export type AllowedMimeType = keyof typeof ALLOWED_TYPES;

@Injectable()
export class FileValidationService {
  /**
   * Valide que le MIME déclaré est dans l'allowlist.
   * Appelé au moment de la demande d'URL d'upload (avant même l'envoi du fichier).
   */
  assertMimeAllowed(mimeType: string): void {
    if (!ALLOWED_TYPES[mimeType]) {
      throw new BadRequestException(
        `Type de fichier non autorisé : ${mimeType}. ` +
          `Types acceptés : ${Object.keys(ALLOWED_TYPES).join(', ')}.`,
      );
    }
  }

  /**
   * Vérifie les magic bytes réels du fichier.
   * Appelé lors du `POST /documents/:id/complete` où le frontend renvoie
   * les 16 premiers bytes du fichier (lus côté client après l'upload S3).
   *
   * Pourquoi : un client malveillant peut déclarer `application/pdf` et
   * envoyer un exécutable. Les magic bytes empêchent ce type d'attaque.
   */
  assertMagicBytes(mimeType: string, headerBytes: Buffer): void {
    const config = ALLOWED_TYPES[mimeType];
    if (!config) {
      throw new BadRequestException(`Type MIME non supporté : ${mimeType}.`);
    }

    const matches = config.magic.some((magic) =>
      headerBytes.slice(0, magic.length).equals(magic),
    );

    if (!matches) {
      throw new BadRequestException(
        `Le contenu réel du fichier ne correspond pas au type déclaré (${mimeType}).`,
      );
    }
  }

  /** Retourne les types MIME autorisés. */
  getAllowedMimeTypes(): string[] {
    return Object.keys(ALLOWED_TYPES);
  }
}
