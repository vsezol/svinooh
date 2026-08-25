import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Measures every HTTP request: a counter + a duration histogram, with
 * method/route/status labels. The route comes from the matched pattern (e.g.
 * /api/portfolios/:slug), not the concrete URL — otherwise label cardinality
 * would explode. We record on the finish event, once the status is final.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const stop = this.metrics.httpDuration.startTimer();

    res.on('finish', () => {
      const matched = req.route?.path as string | undefined;
      const route = matched ? `${req.baseUrl || ''}${matched}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      stop(labels);
      this.metrics.httpRequests.inc(labels);
      if (res.statusCode >= 500) this.metrics.errors.inc({ type: 'http_5xx' });
    });

    return next.handle();
  }
}
