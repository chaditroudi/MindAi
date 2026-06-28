import { UnauthorizedException } from '@nestjs/common';

export function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing.');
  return id;
}
