import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// Public paths skip server-level API key auth
const PUBLIC_PATHS = new Set(['/api/provider', '/api/meta', '/api/key', '/health']);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredKey = this.cfg.get<string>('server.apiKey');
    if (!requiredKey) return true; // key not configured — allow all

    const req  = ctx.switchToHttp().getRequest<Request>();
    if (PUBLIC_PATHS.has(req.path)) return true;

    const provided = Array.isArray(req.headers['x-api-key'])
      ? req.headers['x-api-key'][0]
      : req.headers['x-api-key'];

    if (provided !== requiredKey) {
      throw new UnauthorizedException('Invalid or missing x-api-key header.');
    }
    return true;
  }
}
