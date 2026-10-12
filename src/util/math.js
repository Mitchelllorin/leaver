export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing. */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Wrap degrees into [0, 360). */
export const wrap360 = (d) => ((d % 360) + 360) % 360;

/** Wrap degrees into [-180, 180). */
export const wrap180 = (d) => {
  const w = wrap360(d);
  return w >= 180 ? w - 360 : w;
};

/** Days between a JS Date and the J2000.0 epoch (2000-01-01 12:00 TT). */
export function daysSinceJ2000(date = new Date()) {
  return (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86_400_000;
}

export function j2000ToDate(days) {
  return new Date(Date.UTC(2000, 0, 1, 12, 0, 0) + days * 86_400_000);
}

/** Human-readable distance. Metric, with AU above 10 million km. */
export function formatDistance(km, units = 'metric') {
  const au = km / 149_597_870.7;
  if (units === 'imperial') {
    const mi = km * 0.621371;
    if (mi > 1e6) return `${(mi / 1e6).toFixed(2)} million mi`;
    return `${Math.round(mi).toLocaleString()} mi`;
  }
  if (au > 0.02 && au < 1e4) return `${au.toFixed(3)} AU`;
  if (km > 1e6) return `${(km / 1e6).toFixed(2)} million km`;
  if (km > 1000) return `${(km / 1000).toFixed(1)} thousand km`;
  return `${Math.round(km)} km`;
}

export function formatSpeed(kmPerSec, units = 'metric') {
  if (units === 'imperial') return `${(kmPerSec * 2236.94).toFixed(0)} mph`;
  if (kmPerSec >= 1000) return `${(kmPerSec / 1000).toFixed(2)} thousand km/s`;
  return `${kmPerSec.toFixed(1)} km/s`;
}

export function formatDays(days) {
  if (Math.abs(days) < 1) return `${(days * 24).toFixed(1)} hours`;
  if (Math.abs(days) < 365) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(2)} years`;
}

export function formatMass(kg) {
  const e = Math.floor(Math.log10(kg));
  const m = kg / Math.pow(10, e);
  return `${m.toFixed(2)} x 10^${e} kg`;
}

/** Truncate to a sane number of decimals for ARIA announcements. */
export const speak = (n, dp = 1) => Number(n.toFixed(dp));
