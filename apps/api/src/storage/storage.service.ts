import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import * as Minio from "minio";

interface Endpoint {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

function parseEndpoint(url: string): Endpoint {
  const u = new URL(url);
  const useSSL = u.protocol === "https:";
  return {
    endPoint: u.hostname,
    port: u.port ? Number(u.port) : useSSL ? 443 : 80,
    useSSL,
  };
}

/**
 * S3-compatible object storage (MinIO). Uses an internal client for bucket ops and
 * a public-endpoint client for presigned URLs, so URLs are reachable by the browser
 * even though the API talks to MinIO over the docker network.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger("StorageService");
  private readonly accessKey = process.env.MINIO_ROOT_USER ?? "stabil";
  private readonly secretKey = process.env.MINIO_ROOT_PASSWORD ?? "stabilsecret";
  readonly documentsBucket = process.env.MINIO_BUCKET_DOCUMENTS ?? "stabil-documents";
  readonly reportsBucket = process.env.MINIO_BUCKET_REPORTS ?? "stabil-reports";

  private readonly internal: Minio.Client;
  private readonly publicClient: Minio.Client;

  constructor() {
    const internalUrl = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
    const publicUrl = process.env.MINIO_PUBLIC_ENDPOINT ?? internalUrl;
    // Pin region so presign never triggers a getBucketRegion network call
    // (the public client's endpoint isn't reachable from inside the container).
    const region = process.env.MINIO_REGION ?? "us-east-1";
    const creds = { accessKey: this.accessKey, secretKey: this.secretKey, region };
    this.internal = new Minio.Client({ ...parseEndpoint(internalUrl), ...creds });
    this.publicClient = new Minio.Client({ ...parseEndpoint(publicUrl), ...creds });
  }

  async onModuleInit(): Promise<void> {
    for (const bucket of [this.documentsBucket, this.reportsBucket]) {
      try {
        if (!(await this.internal.bucketExists(bucket))) {
          await this.internal.makeBucket(bucket);
        }
      } catch (err) {
        this.logger.error(`bucket "${bucket}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** A short-lived URL the client can PUT file bytes to directly. */
  presignedPut(bucket: string, key: string, expirySeconds = 900): Promise<string> {
    return this.publicClient.presignedPutObject(bucket, key, expirySeconds);
  }

  /** A short-lived URL to download an object. */
  presignedGet(bucket: string, key: string, expirySeconds = 900): Promise<string> {
    return this.publicClient.presignedGetObject(bucket, key, expirySeconds);
  }

  /** Server-side upload (e.g. generated report PDFs). */
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<unknown> {
    return this.internal.putObject(bucket, key, body, body.length, { "Content-Type": contentType });
  }
}
