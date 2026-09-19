import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthedRequest } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';

/**
 * Whether this caller is an admin, asked of the DATABASE on every request.
 *
 * Never of the token: that was minted before the flag could have been taken
 * away, and a revoked admin should stop working now rather than when their
 * session happens to expire.
 *
 * A non-admin gets NotFound, not Forbidden. Forbidden would confirm that there
 * is an admin surface and that this is its address; NotFound says the same
 * thing an unauthenticated stranger and a wrong URL say. RequiredAuthGuard runs
 * first, so by here there is a userId or the request never arrived.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { userId } = context.switchToHttp().getRequest<AuthedRequest>();
    if (!userId) throw new NotFoundException();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!user?.isAdmin) throw new NotFoundException();
    return true;
  }
}
