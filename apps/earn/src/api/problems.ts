import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CatalogNotReady,
  CatalogVersionGone,
  EarnError,
  MalformedCursor,
  PoolNotFound,
  SelectionMismatch,
} from '../application/errors';
import { InvalidParameter } from './params';

export const PROBLEM_BASE = 'https://svinooh.com/problems';
export const MEDIA_TYPE = 'application/problem+json';

interface Translation {
  status: number;
  slug: string;
  title: string;
  detail?: string;
}

const TRANSLATIONS: Array<[new (...args: never[]) => Error, Translation]> = [
  [
    CatalogNotReady,
    {
      status: 503,
      slug: 'not-ready',
      title: 'Not ready',
      detail: 'the catalog has not been built yet; retry shortly',
    },
  ],
  [PoolNotFound, { status: 404, slug: 'not-found', title: 'Not found' }],
  [
    CatalogVersionGone,
    {
      status: 400,
      slug: 'cursor-expired',
      title: 'Invalid cursor',
      detail: 'the data this cursor points into has been refreshed; start again without it',
    },
  ],
  [
    SelectionMismatch,
    {
      status: 400,
      slug: 'cursor-query-mismatch',
      title: 'Invalid cursor',
      detail: 'this cursor was issued for a different set of filters; start again without it',
    },
  ],
  [
    MalformedCursor,
    {
      status: 400,
      slug: 'invalid-cursor',
      title: 'Invalid cursor',
      detail: 'cursor is not one we issued',
    },
  ],
  [InvalidParameter, { status: 422, slug: 'invalid-parameter', title: 'Invalid parameter' }],
];

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problems');

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const translated = TRANSLATIONS.find(([failure]) => error instanceof failure);

    if (translated) {
      const [, how] = translated;
      this.write(response, how.status, how.slug, how.title, how.detail ?? String((error as Error).message));
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const slug = status === 404 ? 'not-found' : status === 405 ? 'method-not-allowed' : 'error';
      this.write(response, status, slug, 'Error', error.message);
      return;
    }
    if (error instanceof EarnError) {
      this.write(response, 500, 'internal', 'Internal error', error.message);
      return;
    }
    this.log.error(error);
    this.write(response, 500, 'internal', 'Internal error', String(error));
  }

  private write(
    response: Response,
    status: number,
    slug: string,
    title: string,
    detail: string,
  ): void {
    response
      .status(status)
      .type(MEDIA_TYPE)
      .send(JSON.stringify({ type: `${PROBLEM_BASE}/${slug}`, title, status, detail }));
  }
}
