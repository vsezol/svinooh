/**
 * The build-time constants webpack's DefinePlugin substitutes.
 *
 * There is no Node here — `process` never exists at run time; these reads are
 * replaced by literals when the bundle is built, which is why the declaration
 * is this narrow.
 */
declare const process: {
  env: {
    AGENT_API_URL?: string;
  };
};
