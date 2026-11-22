// Story Agent: change a recorded voice's speed and pitch separately, right in the browser.
// Pitch: resample (which also changes speed). Speed: WSOLA time-stretch, which changes length without changing pitch.
// Together: any speed with any pitch, no chipmunk effect from speeding up.

function resample(x, r) { // r > 1 = higher pitch and shorter
  if (Math.abs(r - 1) < 1e-4) return x;
  const n = Math.floor((x.length - 1) / r), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r, k = Math.floor(p), f = p - k;
    // cubic (Catmull-Rom) interpolation keeps the voice clean
    const a = x[Math.max(0, k - 1)], b = x[k], c = x[Math.min(x.length - 1, k + 1)], d = x[Math.min(x.length - 1, k + 2)];
    y[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  }
  return y;
}

// WSOLA: stretch length by factor a (a > 1 = longer/slower) keeping pitch
function wsola(x, a, sr) {
  if (Math.abs(a - 1) < 1e-3) return x;
  const N = Math.round(sr * 0.035) & ~1, Hs = N / 2, Ha = Hs / a, tol = Math.round(sr * 0.008);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.floor(x.length * a) + N, y = new Float32Array(outLen), wsum = new Float32Array(outLen);
  const step = Math.max(1, Math.round(sr / 8000)); // compare a decimated signal so the search stays fast
  let prevEnd = 0; // where the natural continuation of the last frame starts in the input
  let outPos = 0;
  for (let m = 0; ; m++) {
    const target = Math.round(m * Ha);
    if (target + N + tol >= x.length) break;
    let best = target;
    if (m > 0) {
      let bestScore = -Infinity;
      const lo = Math.max(0, target - tol), hi = Math.min(x.length - N - 1, target + tol);
      for (let s = lo; s <= hi; s += step) {
        let sc = 0;
        for (let i = 0; i < Hs; i += step * 2) sc += x[s + i] * x[prevEnd + i];
        if (sc > bestScore) { bestScore = sc; best = s; }
      }
    }
    for (let i = 0; i < N; i++) { y[outPos + i] += x[best + i] * win[i]; wsum[outPos + i] += win[i]; }
    prevEnd = best + Hs;
    outPos += Hs;
  }
  const len = Math.min(outLen, outPos + Hs);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = wsum[i] > 1e-3 ? y[i] / wsum[i] : 0;
  return out;
}

// speed: 1 = as recorded, 1.2 = 20% faster. pitch: semitones, +2 = a bit higher / less deep
export function changeVoice(samples, sr, speed = 1, pitch = 0) {
  const r = Math.pow(2, pitch / 12);
  const up = resample(samples, r);          // pitch up by r, length / r
  return wsola(up, r / speed, sr);          // back to (original length / speed), pitch unchanged by the stretch
}
