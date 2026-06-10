import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";

// Minimal structural types so we don't depend on @types/express.
interface ResponseLike {
  status(code: number): ResponseLike;
  type(contentType: string): ResponseLike;
  json(body: unknown): void;
}
interface RequestLike {
  url: string;
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

/** Render every error as RFC 9457 problem+json (see docs/architecture/04-api-contracts.md). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<ResponseLike>();
    const req = ctx.getRequest<RequestLike>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        detail = body;
      } else if (body && typeof body === "object") {
        const obj = body as Record<string, unknown>;
        if (typeof obj.message === "string") {
          detail = obj.message;
        } else if (obj.message !== undefined) {
          errors = obj.message; // e.g. Zod flatten()
        } else {
          errors = obj;
        }
      }
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: TITLES[status] ?? "Error",
        status,
        ...(detail ? { detail } : {}),
        ...(errors ? { errors } : {}),
        instance: req.url,
      });
  }
}
