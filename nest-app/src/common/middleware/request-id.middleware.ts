import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../logger/app.logger';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    requestContext.run({ requestId: randomUUID() }, next);
  }
}
