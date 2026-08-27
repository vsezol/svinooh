/**
 * Everything this service reads from its environment, in one place.
 *
 * Without a broker it has nothing to do: it exists to read one queue and write
 * another, so it says so at startup and keeps answering its health check rather
 * than pretending to work.
 */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  rabbitUrl: process.env.RABBITMQ_URL ?? '',
  port: Number(process.env.PORT ?? 3000),
  /** One wallet at a time: the work is a couple of queries, and a queue that
   *  drains slowly is not a problem worth parallelism */
  prefetch: Number(process.env.ALERTS_PREFETCH ?? 4),
};
