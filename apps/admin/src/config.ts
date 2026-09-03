const int = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  /**
   * The shared secret the api signs its forwarded requests with.
   *
   * This service is on the private network and has no public domain, so a
   * request reaching it has already been through the api — which verified the
   * caller's token and looked their admin flag up in the database. The secret
   * is the second lock: without it every route refuses, so a service
   * accidentally exposed is still not an open door.
   */
  internalSecret: process.env.INTERNAL_SECRET ?? '',
};
