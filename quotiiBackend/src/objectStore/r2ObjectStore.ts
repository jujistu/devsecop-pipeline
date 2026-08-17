import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ObjectStore } from './objectStore.interface';

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region?: string;
}

/**
 * Cloudflare R2 adapter for the ObjectStore seam.
 *
 * R2 exposes an S3-compatible API. Configuration comes from env
 * (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * R2_REGION) - never hardcoded.
 */
export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(
    key: string,
    data: Buffer | Uint8Array,
    contentType?: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: data,
      ...(contentType ? { ContentType: contentType } : {}),
    });
    await this.client.send(command);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) {
        return null;
      }
      // `transformToByteArray` is available on all StreamingBlobPayload types;
      // cast to `any` to stay version-agnostic across the SDK v3 stream types.
      const body = response.Body as any;
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });
    await this.client.send(command);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    const name = error && (error as { name?: string }).name;
    return name === 'NotFound' || name === 'NoSuchKey';
  }
}
