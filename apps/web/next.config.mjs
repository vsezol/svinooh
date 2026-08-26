/** @type {import('next').NextConfig} */
export default {
  // A self-contained server directory, so the runtime image carries what it
  // needs and not the whole node_modules tree
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};
