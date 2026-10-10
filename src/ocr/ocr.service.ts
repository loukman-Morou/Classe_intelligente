import { Injectable, Logger } from '@nestjs/common';

/**
 * Service d'extraction de texte depuis différents formats.
 *
 * Deux stratégies selon le type MIME :
 *  - PDF → pdf-parse (extraction du texte natif du PDF)
 *  - Image (JPEG/PNG) → Tesseract.js (OCR)
 *
 * Les bibliothèques sont importées dynamiquement pour :
 *  a) ne pas alourdir le démarrage de l'app principale
 *  b) permettre de les mocker facilement dans les tests
 *
 * SÉCURITÉ : le fichier est traité entièrement en mémoire (Buffer).
 * Jamais écrit sur disque avec le nom original — protection path traversal
 * et infection de fichiers temporaires.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger('OcrService');

  // Timeout d'extraction pour éviter qu'un fichier malformé bloque le worker.
  private readonly PDF_TIMEOUT_MS  = 30_000;
  private readonly IMAGE_TIMEOUT_MS = 120_000;

  /**
   * Point d'entrée principal. Dispatche vers la stratégie appropriée
   * selon le MIME type du document.
   */
  async extractText(fileBuffer: Buffer, mimeType: string): Promise<string> {
    this.logger.debug(`Extraction texte — mimeType=${mimeType} size=${fileBuffer.length}`);

    switch (mimeType) {
      case 'application/pdf':
        return this.extractFromPdf(fileBuffer);
      case 'image/jpeg':
      case 'image/png':
        return this.extractFromImage(fileBuffer);
      default:
        throw new Error(`Type MIME non supporté pour l'extraction : ${mimeType}`);
    }
  }

  // --------------------------------------------------------------------------
  // Extraction PDF (texte natif)
  // --------------------------------------------------------------------------

  private async extractFromPdf(buffer: Buffer): Promise<string> {
    return this.withTimeout(async () => {
      // Import dynamique : pdf-parse n'est pas utilisé dans l'app principale,
      // uniquement dans le worker de traitement.
      const pdfParse = await import('pdf-parse').then((m) => m.default ?? m);

      const data = await pdfParse(buffer, {
        // Désactiver le rendu des pages (on veut juste le texte).
        pagerender: undefined,
        // Limiter aux 1000 premières pages pour éviter les PDF piège.
        max: 1000,
      });

      const text = data.text?.trim() ?? '';

      if (!text) {
        // PDF scanné sans couche texte : fallback OCR signalé via une erreur
        // spécifique pour que le worker sache qu'il faut changer de stratégie.
        throw new Error('PDF_NO_TEXT_LAYER');
      }

      this.logger.debug(`PDF extrait : ${data.numpages} pages, ${text.length} caractères`);
      return text;
    }, this.PDF_TIMEOUT_MS, 'Timeout dépassé pour l\'extraction PDF.');
  }

  // --------------------------------------------------------------------------
  // OCR image (Tesseract.js)
  // --------------------------------------------------------------------------

  private async extractFromImage(buffer: Buffer): Promise<string> {
    return this.withTimeout(async () => {
      const Tesseract = await import('tesseract.js');

      // Utiliser la langue française en priorité, anglaise en fallback.
      // Les données de langue sont téléchargées automatiquement par Tesseract.js
      // au premier usage — prévoir une phase de warm-up en prod (Phase 15).
      const { data: { text } } = await Tesseract.recognize(buffer, 'fra+eng', {
        logger: (msg: { status: string; progress?: number }) => {
          if (msg.status === 'recognizing text') {
            this.logger.debug(`OCR progression : ${Math.round((msg.progress ?? 0) * 100)}%`);
          }
        },
      });

      const cleaned = text?.trim() ?? '';
      this.logger.debug(`OCR terminé : ${cleaned.length} caractères extraits`);
      return cleaned;
    }, this.IMAGE_TIMEOUT_MS, 'Timeout dépassé pour l\'OCR image.');
  }

  // --------------------------------------------------------------------------
  // Helper : timeout sur une Promise
  // --------------------------------------------------------------------------

  private withTimeout<T>(fn: () => Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      fn()
        .then((result) => { clearTimeout(timer); resolve(result); })
        .catch((err: unknown) => { clearTimeout(timer); reject(err); });
    });
  }
}
