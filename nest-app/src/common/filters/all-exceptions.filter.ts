import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Normalize to { error, code? } — the format Angular's ApiError parser expects.
    //
    // NestJS built-in exceptions (UnauthorizedException, NotFoundException, etc.) put
    // the real message under `message` and set `error` to the HTTP reason phrase
    // (e.g. "Unauthorized").  Custom HttpException({ error, code }, status) puts the
    // real message directly under `error`.  We detect the format by the presence of
    // `statusCode` in the response body, which only NestJS built-ins include.
    let errorMsg: string;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        errorMsg = raw;
      } else {
        const r = raw as Record<string, unknown>;
        const isBuiltinFormat = typeof r['statusCode'] === 'number';
        errorMsg = isBuiltinFormat && typeof r['message'] === 'string'
          ? (r['message'] as string)
          : typeof r['error'] === 'string'
            ? (r['error'] as string)
            : 'An error occurred';
        errorCode = typeof r['code'] === 'string' ? (r['code'] as string) : undefined;
      }
      // Pick up code attached via Object.assign(new UnauthorizedException(), { code })
      if (!errorCode) {
        const attached = (exception as unknown as Record<string, unknown>)['code'];
        if (typeof attached === 'string') errorCode = attached;
      }
    } else {
      errorMsg = exception instanceof Error ? exception.message : 'Internal server error';
    }

    const body: Record<string, unknown> = { error: errorMsg };
    if (errorCode) body['code'] = errorCode;

    res.status(status).json(body);
  }
}
