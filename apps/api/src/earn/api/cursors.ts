import { MalformedCursor } from '../application/errors';
import type { Resume } from '../application/queries';

export function encode(resume: Resume): string {
  const raw = JSON.stringify({
    v: resume.catalogVersion,
    o: resume.offset,
    q: resume.fingerprint,
  });
  return Buffer.from(raw).toString('base64url').replace(/=+$/, '');
}

export function decode(cursor: string): Resume {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<string, unknown>;
    const version = Number(data.v);
    const offset = Number(data.o);
    if (!Number.isInteger(version) || !Number.isInteger(offset) || typeof data.q !== 'string') {
      throw new Error('not a cursor');
    }
    return { catalogVersion: version, offset, fingerprint: data.q };
  } catch (error) {
    throw new MalformedCursor(String(error));
  }
}
