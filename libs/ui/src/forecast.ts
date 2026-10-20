export interface Forecast {
  times: number[];
  values: number[];
}

export function forecast(values: number[], times: number[], windowMs: number | null): Forecast | null {
  if (values.length < 3) return null;
  const end = times[times.length - 1];
  const opens = windowMs === null ? times[0] : end - windowMs;
  const from = times.findIndex((t) => t >= opens);
  const xs = times.slice(from);
  const ys = values.slice(from);
  if (xs.length < 3) return null;

  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i++) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    variance += (xs[i] - meanX) ** 2;
  }
  if (variance === 0) return null;
  const slope = covariance / variance;

  const step = medianStep(xs);
  const last = values[values.length - 1];
  const out: Forecast = { times: [end], values: [last] };
  for (let t = end + step; t <= end + (end - xs[0]) + step / 2; t += step) {
    out.times.push(t);
    out.values.push(last + slope * (t - end));
  }
  return out.times.length > 1 ? out : null;
}

function medianStep(times: number[]): number {
  const steps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
}
