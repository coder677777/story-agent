// Story Agent: lines the voiceover up with the script.
// Finds every pause in the recorded voice, then matches each sentence / comma break of the script to the pause where it
// really happens (a small dynamic-programming search, so one long breath can't throw everything off). Words inside each
// phrase are spread over the time they're actually spoken, and captions are timed from those words.

const PUNCT = /[.!?,;:…—–-]["')\]]*$/;
const STRONG = /[.!?…]["')\]]*$/;

// Caption chunks: 2-4 words, breaking after punctuation, never leaving one word alone
export function chunkWords(words) {
  const out = []; let c = [];
  words.forEach((w, k) => { c.push(k); if (c.length >= 4 || (PUNCT.test(w) && c.length >= 2)) { out.push(c); c = []; } });
  if (c.length === 1 && out.length) out[out.length - 1].push(c[0]); else if (c.length) out.push(c);
  return out;
}

// Pauses in the audio: runs of quiet at least minLen long
export function findPauses(ch, sr, minLen = 0.11) {
  const win = Math.max(1, Math.round(sr * 0.01)), rms = [];
  for (let i = 0; i + win <= ch.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += ch[j] * ch[j]; rms.push(Math.sqrt(s / win)); }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0, peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const thr = floor + (peak - floor) * 0.06;
  const loud = rms.map((v) => v > thr);
  // smooth tiny gaps inside words (plosives) so they don't count as pauses
  const first = loud.indexOf(true), last = loud.lastIndexOf(true);
  const pauses = [];
  for (let i = Math.max(0, first); i <= last;) {
    if (loud[i]) { i++; continue; }
    let j = i; while (j <= last && !loud[j]) j++;
    const len = (j - i) * 0.01;
    if (len >= minLen) pauses.push({ s: i * 0.01, e: j * 0.01, c: ((i + j) / 2) * 0.01, len });
    i = j;
  }
  return { pauses, speechStart: Math.max(0, first) * 0.01, speechEnd: (last + 1) * 0.01, duration: ch.length / sr };
}

// scenes: [{ vo }]. Returns per-scene audio ranges and caption times (seconds, relative to the scene's start).
export function alignVoice(ch, sr, scenes, opts = {}) {
  const { pauses, speechStart, speechEnd, duration } = findPauses(ch, sr);
  // phrases across the whole script
  const phrases = []; // { scene, words:[], chars, strong, sceneEnd }
  scenes.forEach((s, si) => {
    const words = String(s.vo || "").trim().split(/\s+/).filter(Boolean);
    let cur = [];
    words.forEach((w, k) => {
      cur.push(w);
      if (PUNCT.test(w) || k === words.length - 1) {
        phrases.push({ scene: si, words: cur, chars: cur.join(" ").length + 2, strong: STRONG.test(w) || k === words.length - 1, sceneEnd: k === words.length - 1 });
        cur = [];
      }
    });
  });
  const K = phrases.length;
  if (!K) return null;
  // expected time of each boundary (end of phrase k), assuming an even speaking pace with pauses spread evenly
  const totalChars = phrases.reduce((a, p) => a + p.chars, 0);
  const span = speechEnd - speechStart;
  const exp = []; let acc = 0;
  for (let k = 0; k < K - 1; k++) { acc += phrases[k].chars; exp.push(speechStart + span * (acc / totalChars)); }
  // Segment DP: choose which pause ends each phrase. Between two chosen pauses the speaking speed must match the
  // number of characters in between (judged on a log scale), real sentence ends like longer pauses, and skipping a
  // long pause in the middle of speech is unlikely. Unmatched breaks are allowed (filled in by interpolation).
  const B = K - 1, P = pauses.length;
  const totalPause = pauses.reduce((a, p) => a + p.len, 0);
  const rate = Math.max(0.02, (speechEnd - speechStart - totalPause * 0.85) / totalChars); // seconds of speech per character
  const cumC = [0]; for (let k = 0; k < K; k++) cumC.push(cumC[k] + phrases[k].chars);         // chars before phrase k
  const cumL = [0]; for (let j = 0; j < P; j++) cumL.push(cumL[j] + pauses[j].len);
  const wB = (k) => (phrases[k].sceneEnd ? 1.6 : phrases[k].strong ? 1.2 : 0.55);
  const tEnd = (j) => (j < 0 ? speechStart : pauses[j].e), tStart = (j) => (j >= P ? speechEnd : pauses[j].s);
  const skipCost = (j0, j1) => { let c = 0; for (let j = j0 + 1; j < j1; j++) c += pauses[j].len > 0.3 ? 1.0 + 3.0 * pauses[j].len : 0.05 + pauses[j].len * 0.6; return c; };
  const segCost = (k0, j0, k1, j1) => {
    // speech from after pause j0 to the start of pause j1 covers phrases k0+1..k1
    const C = cumC[k1 + 1] - cumC[k0 + 1];
    const inner = j1 - j0 > 1 ? cumL[Math.min(j1, P)] - cumL[j0 + 1] : 0;
    const D = tStart(j1) - tEnd(j0) - inner * 0.85;
    if (D <= 0.02) return 1e9;
    const r = Math.log((D + 0.2) / (C * rate + 0.2));
    return (r * r) / 0.06;
  };
  const bonus = (k, j) => -1.6 * wB(k) * Math.min(pauses[j].len / 0.3, 1.7);
  const skipB = (k) => (phrases[k].sceneEnd ? 5 : phrases[k].strong ? 3 : 0.8);
  const MAXK = 6, MAXJ = 18, INF = 1e18;
  // dp over (boundary k, pause j); k = -1/j = -1 is the start, k = B/j = P is the end
  const key = (k, j) => (k + 1) * (P + 2) + (j + 1);
  const dp = new Float64Array((B + 2) * (P + 2)).fill(INF), from = new Int32Array((B + 2) * (P + 2)).fill(-1);
  dp[key(-1, -1)] = 0;
  for (let k = 0; k <= B; k++) {
    const jRange = k === B ? [P] : Array.from({ length: P }, (_, j) => j);
    for (const j of jRange) {
      let best = INF, arg = -1;
      for (let k0 = Math.max(-1, k - MAXK); k0 < k; k0++) {
        let skips = 0; for (let m = k0 + 1; m < k; m++) skips += skipB(m);
        for (let j0 = Math.max(-1, j - MAXJ); j0 < j; j0++) {
          const v = dp[key(k0, j0)]; if (v >= INF) continue;
          const c = v + skips + segCost(k0, j0, k, j) + skipCost(j0, j) + (k < B ? bonus(k, j) : 0);
          if (c < best) { best = c; arg = key(k0, j0); }
        }
      }
      dp[key(k, j)] = best; from[key(k, j)] = arg;
    }
  }
  const got = new Array(B).fill(null);
  for (let cur = key(B, P); cur > 0;) {
    const prev = from[cur]; if (prev < 0) break;
    const k = Math.floor(prev / (P + 2)) - 1, j = (prev % (P + 2)) - 1;
    if (k >= 0 && j >= 0) got[k] = pauses[j];
    cur = prev;
    if (k < 0) break;
  }
  // fill unmatched boundaries by interpolating between matched neighbours (by characters)
  const bt = got.map((p) => (p ? { s: p.s, e: p.e, c: p.c } : null));
  const charAt = []; acc = 0; for (let k = 0; k < B; k++) { acc += phrases[k].chars; charAt.push(acc); }
  for (let k = 0; k < B; k++) if (!bt[k]) {
    let a = k - 1; while (a >= 0 && !bt[a]) a--;
    let b = k + 1; while (b < B && !bt[b]) b++;
    const ta = a >= 0 ? bt[a].e : speechStart, ca = a >= 0 ? charAt[a] : 0;
    const tb = b < B ? bt[b].s : speechEnd, cb = b < B ? charAt[b] : totalChars;
    const t = ta + (tb - ta) * ((charAt[k] - ca) / Math.max(1, cb - ca));
    bt[k] = { s: t, e: t, c: t };
  }
  // speech span of each phrase, then words inside it
  phrases.forEach((p, k) => {
    p.t0 = k === 0 ? speechStart : bt[k - 1].e;
    p.t1 = k === K - 1 ? speechEnd : bt[k].s;
    if (p.t1 < p.t0 + 0.05) p.t1 = p.t0 + 0.05;
    const w = p.words.map((x) => x.replace(/[^\p{L}\p{N}]/gu, "").length + 1.2), tot = w.reduce((a, b) => a + b, 0);
    let t = p.t0; p.wt = p.words.map((_, n) => { const d = (p.t1 - p.t0) * (w[n] / tot); const r = [t, t + d]; t += d; return r; });
  });
  // scenes: cut points in the middle of the pause between scenes
  const out = []; let t = opts.lead ?? 0.25;
  const firstPh = (si) => phrases.findIndex((p) => p.scene === si);
  scenes.forEach((s, si) => {
    const ks = phrases.map((p, k) => (p.scene === si ? k : -1)).filter((k) => k >= 0);
    if (!ks.length) { out.push({ start: t, dur: opts.silentDur ?? 1.4, a0: null, a1: null, caps: [] }); t += opts.silentDur ?? 1.4; return; }
    const k0 = ks[0], k1 = ks[ks.length - 1];
    const a0 = k0 === 0 ? Math.max(0, speechStart - 0.08) : bt[k0 - 1].c;
    const a1 = k1 === K - 1 ? Math.min(duration, speechEnd + 0.25) : bt[k1].c;
    const words = ks.flatMap((k) => phrases[k].words), wt = ks.flatMap((k) => phrases[k].wt);
    const caps = chunkWords(words).map((idx) => ({ text: idx.map((n) => words[n]).join(" "), t0: wt[idx[0]][0] - a0, t1: wt[idx[idx.length - 1]][1] - a0 }));
    out.push({ start: t, dur: Math.max(0.3, a1 - a0), a0, a1, caps });
    t += Math.max(0.3, a1 - a0);
  });
  const END = opts.endDur ?? 3.2;
  return { scenes: out, endStart: t, total: t + END, pauses: pauses.length, matched: got.filter(Boolean).length, boundaries: B,
    phraseTimes: phrases.map((p) => [p.t0, p.t1]) };
}
