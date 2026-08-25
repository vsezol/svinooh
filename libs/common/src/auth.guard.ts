import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

interface AuthedRequest extends Request {
  userId?: string | null;
}

async function extractUserId(req: AuthedRequest, jwt: JwtService): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await jwt.verifyAsync<{ sub?: unknown }>(header.slice(7));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Routes that require sign-in (portfolio mutations) */
@Injectable()
export class RequiredAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = await extractUserId(req, this.jwt);
    if (!userId) throw new UnauthorizedException('Sign in required');
    req.userId = userId;
    return true;
  }
}

/** Public routes where sign-in is optional (portfolio viewing: isOwner) */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.userId = await extractUserId(req, this.jwt);
    return true;
  }
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return req.userId ?? null;
  },
);
