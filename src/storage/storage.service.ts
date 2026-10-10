import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageConfig } from '../config/configuration';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('StorageService');
  private client!: S3Client;
  private bucket!: string;
  private signedUrlTtl!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cfg = this.config.get<StorageConfig>('storage')!;
    this.bucket = cfg.bucket;
    this.signedUrlTtl = cfg.signedUrlTtlSeconds;

    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKey,
        secretAccessKey: cfg.secretKey,
      },
      // Forcer path-style pour Cloudflare R2 et MinIO (compatibilité hors AWS).
      forcePathStyle: true,
    });

    this.logger.log(`StorageService initialisé — bucket: ${this.bucket}`);
  }

  /**
   * Génère une URL signée d'UPLOAD (PUT) vers S3.
   * Le client frontend envoie directement le fichier sur cette URL sans passer
   * par notre API — réduit la charge réseau du backend et évite de buffériser
   * le fichier en mémoire.
   *
   * La durée de vie est volontairement courte (5 min max pour l'upload,
   * indépendante de signedUrlTtl qui est pour le download).
   */
  async getUploadUrl(
    storageKey: string,
    contentType: string,
    contentLength: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    // 5 minutes : largement suffisant pour déclencher l'upload côté client.
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  /**
   * Génère une URL signée de DOWNLOAD (GET) temporaire.
   * Durée configurable (STORAGE_SIGNED_URL_TTL_SECONDS, défaut 15 min).
   * Ne jamais exposer de clé S3 ni d'URL permanente au frontend.
   */
  async getDownloadUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: this.signedUrlTtl });
  }

  /**
   * Supprime un objet du stockage.
   * Appelé par le job BullMQ de purge asynchrone (jamais en synchrone dans
   * le chemin HTTP) pour ne pas bloquer la réponse sur une opération réseau.
   */
  async deleteObject(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.client.send(command);
    this.logger.log(`Objet supprimé : ${storageKey}`);
  }
}
