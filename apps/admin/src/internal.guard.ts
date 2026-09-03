import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { config } from './config';

/**
 * Only the api may call this service.
 *
 * NotFound rather than Unauthorized, deliberately: a caller who should not be
 * here learns that there is nothing here, rather than that there is something
 * here they are not allowed to have. The same answer the api gives a
 * non-admin, so the two cannot be told apart from outside.
 *
 * With no secret configured everything refuses. A service that fell back to
 * open when its variable was missing would be one deploy away from being open.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!config.internalSecret) throw new NotFoundException();
    const req = context.switchToHttp().getRequest<Request>();
    if (req.header('x-internal-secret') !== config.internalSecret) throw new NotFoundException();
    return true;
  }
}
