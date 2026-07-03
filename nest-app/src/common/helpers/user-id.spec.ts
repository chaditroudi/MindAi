import { UnauthorizedException } from '@nestjs/common';
import { requireUserId } from './user-id';

describe('requireUserId', () => {
  it('returns the trimmed id when present', () => {
    expect(requireUserId('  user-123  ')).toBe('user-123');
  });

  it('throws UnauthorizedException when undefined', () => {
    expect(() => requireUserId(undefined)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when empty or whitespace-only', () => {
    expect(() => requireUserId('')).toThrow(UnauthorizedException);
    expect(() => requireUserId('   ')).toThrow(UnauthorizedException);
  });
});
