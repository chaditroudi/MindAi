import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const PUBLIC_EXACT = new Set(['/api/provider', '/api/meta', '/health']);
const PUBLIC_PREFIXES = ['/api/key', '/api/docs'];

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredKey = this.cfg.get<string>('server.apiKey');
    if (!requiredKey) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (PUBLIC_EXACT.has(req.path)) return true;
    if (
      PUBLIC_PREFIXES.some(
        (p) => req.path === p || req.path.startsWith(p + '/'),
      )
    )
      return true;

    const provided = Array.isArray(req.headers['x-api-key'])
      ? req.headers['x-api-key'][0]
      : req.headers['x-api-key'];

    if (provided !== requiredKey) {
      throw new UnauthorizedException('Invalid or missing x-api-key header.');
    }
    return true;
  }
}
