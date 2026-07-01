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
      if (!errorCode) {
        const attached = (exception as unknown as Record<string, unknown>)['code'];
        if (typeof attached === 'string') errorCode = attached;
      }
    } else {
      errorMsg = 'Internal server error';
    }

    const body: Record<string, unknown> = { error: errorMsg };
    if (errorCode) body['code'] = errorCode;

    // Pass through any extra payload fields the service attached
    // (e.g. currentLimit, suggestedLimit, agentApiKey) so the frontend
    // can act on structured error responses rather than falling back to defaults.
    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null) {
        for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
          if (!(key in body) && key !== 'message' && key !== 'statusCode') {
            body[key] = val;
          }
        }
      }
    }

    res.status(status).json(body);
  }
}
