// Story Agent: free 3D animation engine. Turns a "direction" (a cast + one shot per scene, written by the AI)
// into animated blocky low-poly 3D shots: characters with expressive faces, sets, lighting, weather, camera moves
// and effects. Everything is deterministic, so the preview and the exported video are identical frame for frame.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------- the vocabulary the AI director may use
export const VOCAB = {
  sets: ["street", "park", "house_inside", "bedroom", "bathroom", "kitchen", "classroom", "school_hall", "stadium", "hospital",
    "attic", "night_road", "forest", "graveyard", "store", "rooftop", "beach", "void"],
  times: ["day", "sunset", "night", "dawn"],
  weather: ["clear", "rain", "snow", "fog", "storm"],
  moods: ["normal", "warm", "cold", "eerie_green", "red_alert", "dreamy"],
  ages: ["baby", "kid", "teen", "adult", "elder"],
  hair: ["short", "spiky", "long", "ponytail", "bun", "curly", "bald", "cap", "beanie", "messy"],
  extras: ["none", "glasses", "scarf", "beard", "mustache", "hoodie", "backpack", "bow", "headphones", "apron", "tie"],
  positions: ["center", "left", "right", "far_left", "far_right", "front", "back", "back_left", "back_right",
    "bench", "bed", "chair", "sofa", "table", "mirror", "in_mirror", "goal", "penalty_spot", "stands", "door", "window", "desk", "car", "box"],
  poses: ["stand", "sit", "lie", "kneel"],
  actions: ["idle", "walk_in", "walk_out", "walk_toward_camera", "walk_away", "run_in", "run_away", "wave", "point", "press_button",
    "kick", "cry", "hug:<id>", "nod", "shake_head", "look_around", "look_up", "look_down", "jump", "cheer", "clap", "fall",
    "reach", "hold_object", "think", "hands_on_head", "shiver", "turn_around", "sit_down", "stand_up", "sleep", "dance",
    "stare", "push_door", "hide_face", "tap_shoulder:<id>"],
  expressions: ["neutral", "happy", "smile", "sad", "crying", "shocked", "scared", "angry", "worried", "determined",
    "eyes_closed", "smirk", "proud", "confused", "tired"],
  holding: ["none", "ball", "thermos", "phone", "note", "flower", "box", "lantern", "ice_cream", "book", "cup", "key", "umbrella", "gift"],
  props: ["ball", "goal", "thermos", "mirror", "bed", "car", "stroller", "bench", "tv", "door", "box", "lamp", "flowers", "cake",
    "gift", "trophy", "chair", "coat_on_chair", "clock", "candle", "note", "umbrella", "dog", "cat", "balloon", "campfire",
    "lantern", "monitor", "grave", "snowman", "bike", "swing", "ice_cream", "phone", "tree", "fence", "mailbox", "streetlight"],
  shots: ["establishing", "wide", "medium", "close", "extreme_close", "over_shoulder", "low_angle", "high_angle", "top_down", "pov"],
  moves: ["static", "push_in", "pull_out", "pan_left", "pan_right", "orbit", "handheld", "tilt_up", "tilt_down", "dolly_follow", "crane_up", "dutch"],
  fx: ["glow_button", "button_grey", "tears", "rain", "snow", "dust", "sparkles", "fog", "ghost:<id>", "rewind", "slowmo",
    "lightning", "flatline", "heartbeat_monitor", "crowd_cheer", "shake", "spotlight", "police_lights", "fireflies",
    "ball_hits_post", "goal_scored", "freeze", "silhouette", "god_rays"],
};

// ---------- small helpers
const PI = Math.PI;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const seg = (p, a, b) => clamp((p - a) / (b - a)); // progress of p inside [a,b]
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function color(c, d) { const x = new THREE.Color(); try { x.set(c || d); } catch { x.set(d); } return x; }
const darker = (c, k = 0.7) => color(c, "#888").multiplyScalar(k);
const noise = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 2.1) * 0.3 + Math.sin(t * 4.3 + s * 0.7) * 0.2;

// shared caches so 15 shots don't use 15x the memory
const GEO = new Map(), MAT = new Map();
function rbox(w, h, d, r = 0.06, seg = 3) {
  const k = `rb${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r}|${seg}`;
  if (!GEO.has(k)) GEO.set(k, r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d));
  return GEO.get(k);
}
function geo(key, make) { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); }
function mat(c, o = {}) {
  const col = color(c, "#888");
  const k = `m${col.getHexString()}|${JSON.stringify(o)}`;
  if (!MAT.has(k)) {
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: o.rough ?? 0.78, metalness: o.metal ?? 0, flatShading: !!o.flat,
      emissive: o.emissive ? color(o.emissive, "#000") : new THREE.Color(0), emissiveIntensity: o.ei ?? 1,
      transparent: o.opacity != null && o.opacity < 1, opacity: o.opacity ?? 1, side: o.double ? THREE.DoubleSide : THREE.FrontSide });
    MAT.set(k, m);
  }
  return MAT.get(k);
}
function mesh(g, m, x = 0, y = 0, z = 0, parent, { cast = true, receive = true } = {}) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = receive;
  if (parent) parent.add(o); return o;
}
// a rounded box resting on the ground at (x, z)
function block(parent, w, h, d, c, x, y, z, o = {}) { return mesh(rbox(w, h, d, o.r ?? Math.min(0.06, w / 4, h / 4, d / 4)), mat(c, o), x, y + h / 2, z, parent, o); }
function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const TEX = new Map();
function tex(key, w, h, draw, o) { if (!TEX.has(key)) TEX.set(key, canvasTex(w, h, draw, o)); return TEX.get(key); }

// ---------- faces (drawn on the front of the head, redrawn for each expression + blink)
const FACE = new Map();
const EXPR = {
  neutral: { eye: "open", eh: 1, brow: 0, by: 0, mouth: "flat" },
  happy: { eye: "happy", brow: -0.1, by: -4, mouth: "smile", blush: 1 },
  smile: { eye: "open", eh: 0.95, brow: 0, by: -2, mouth: "smile", blush: 0.6 },
  proud: { eye: "happy", brow: -0.15, by: -6, mouth: "bigsmile", blush: 0.8 },
  sad: { eye: "open", eh: 0.8, brow: 0.38, by: -2, mouth: "frown", look: 6 },
  crying: { eye: "squeeze", brow: 0.55, by: -4, mouth: "wobble", tears: 1, blush: 0.7 },
  shocked: { eye: "wide", eh: 1.3, brow: 0.12, by: -12, mouth: "o", pupil: 0.55 },
  scared: { eye: "wide", eh: 1.2, brow: 0.45, by: -8, mouth: "wobble", sweat: 1, pupil: 0.6 },
  angry: { eye: "open", eh: 0.62, brow: -0.5, by: 6, mouth: "frown" },
  worried: { eye: "open", eh: 0.95, brow: 0.32, by: -4, mouth: "small" },
  determined: { eye: "open", eh: 0.78, brow: -0.25, by: 3, mouth: "flat" },
  eyes_closed: { eye: "closed", brow: 0.05, by: 0, mouth: "relaxed" },
  smirk: { eye: "open", eh: 0.85, brow: -0.1, by: 0, mouth: "smirk" },
  confused: { eye: "open", eh: 1, brow: 0.2, by: -4, mouth: "small", tilt: 1 },
  tired: { eye: "open", eh: 0.45, brow: 0.15, by: 2, mouth: "flat" },
};
function faceTexture(skin, exprName, blink, extras, hairCol) {
  const e = EXPR[exprName] || EXPR.neutral;
  const k = `${color(skin, "#f1c27d").getHexString()}|${exprName}|${blink}|${extras}|${hairCol}`;
  if (FACE.has(k)) return FACE.get(k);
  const t = canvasTex(256, 256, (g, W) => {
    const sk = "#" + color(skin, "#f1c27d").getHexString();
    g.fillStyle = sk; g.fillRect(0, 0, W, W);
    const grd = g.createLinearGradient(0, 160, 0, 256); grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(80,30,20,0.10)");
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
    const ink = "#1c1a22", EY = 122, EX = [86, 170];
    // blush
    if (e.blush) { g.fillStyle = `rgba(255,110,120,${0.28 * e.blush})`; for (const x of EX) { g.beginPath(); g.ellipse(x + (x < 128 ? -14 : 14), 162, 20, 11, 0, 0, 2 * PI); g.fill(); } }
    // eyes
    for (const [n, x] of EX.entries()) {
      const side = n === 0 ? -1 : 1;
      g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = "round"; g.lineWidth = 8;
      const mode = blink && e.eye !== "closed" ? "blink" : e.eye;
      if (mode === "happy") { g.beginPath(); g.arc(x, EY + 8, 15, PI * 1.15, PI * 1.85); g.stroke(); }
      else if (mode === "closed") { g.beginPath(); g.arc(x, EY - 4, 15, PI * 0.15, PI * 0.85); g.stroke(); }
      else if (mode === "blink") { g.beginPath(); g.moveTo(x - 14, EY + 2); g.quadraticCurveTo(x, EY + 8, x + 14, EY + 2); g.stroke(); }
      else if (mode === "squeeze") { g.lineWidth = 7; g.beginPath(); g.moveTo(x - 15, EY - 6 * side * 0); g.lineTo(x + 2 * side, EY + 2); g.lineTo(x - 15, EY + 9); g.stroke(); if (side > 0) { g.beginPath(); g.moveTo(x + 15, EY - 0); g.lineTo(x - 2, EY + 2); g.lineTo(x + 15, EY + 9); g.stroke(); } }
      else {
        const w = mode === "wide" ? 17 : 14, h = 21 * (e.eh || 1);
        g.beginPath(); g.ellipse(x + (e.look ? 0 : 0), EY + (e.look || 0) * 0.3, w, h, 0, 0, 2 * PI); g.fill();
        const pu = e.pupil || 1;
        g.fillStyle = "#fff"; g.beginPath(); g.ellipse(x - 5, EY - h * 0.38, 5.5 * pu + 1, 6.5 * pu + 1, 0, 0, 2 * PI); g.fill();
        g.beginPath(); g.arc(x + 5, EY + h * 0.35, 2.6, 0, 2 * PI); g.fill();
        if (mode === "wide") { g.strokeStyle = "rgba(255,255,255,0.0)"; }
      }
      // brows
      g.save(); g.translate(x, 80 + (e.by || 0)); g.rotate(side * (e.brow || 0)); g.fillStyle = hairCol ? "#" + darker(hairCol, 0.55).getHexString() : "#2a221e";
      g.beginPath(); g.roundRect ? g.roundRect(-20, -5, 40, 10, 5) : g.rect(-20, -5, 40, 10); g.fill(); g.restore();
    }
    // tears + sweat
    if (e.tears) { g.fillStyle = "rgba(120,190,255,0.9)"; for (const x of EX) { g.beginPath(); g.moveTo(x - 6, EY + 10); g.quadraticCurveTo(x - 10, 190, x - 2, 214); g.quadraticCurveTo(x + 6, 190, x + 2, EY + 10); g.fill(); } }
    if (e.sweat) { g.fillStyle = "rgba(140,200,255,0.95)"; g.beginPath(); g.moveTo(214, 64); g.quadraticCurveTo(226, 84, 214, 92); g.quadraticCurveTo(202, 84, 214, 64); g.fill(); }
    // mouth (always closed: the narrator speaks over the video)
    g.strokeStyle = "#5b2930"; g.fillStyle = "#5b2930"; g.lineWidth = 7; g.lineCap = "round";
    const MY = 186;
    g.beginPath();
    switch (e.mouth) {
      case "smile": g.arc(128, MY - 18, 22, PI * 0.2, PI * 0.8); break;
      case "bigsmile": g.moveTo(102, MY - 6); g.quadraticCurveTo(128, MY + 22, 154, MY - 6); g.closePath(); g.fill(); break;
      case "frown": g.arc(128, MY + 20, 20, PI * 1.2, PI * 1.8); break;
      case "wobble": g.moveTo(108, MY + 2); for (let i = 0; i <= 8; i++) g.lineTo(108 + i * 5, MY + (i % 2 ? -4 : 3)); break;
      case "o": g.ellipse(128, MY, 9, 12, 0, 0, 2 * PI); g.fill(); break;
      case "small": g.moveTo(120, MY + 2); g.lineTo(138, MY); break;
      case "smirk": g.moveTo(112, MY + 2); g.quadraticCurveTo(136, MY + 4, 148, MY - 8); break;
      case "relaxed": g.moveTo(116, MY); g.quadraticCurveTo(128, MY + 5, 140, MY); break;
      default: g.moveTo(112, MY); g.lineTo(144, MY);
    }
    g.stroke();
    // face extras
    if (/glasses/.test(extras)) { g.strokeStyle = "#202024"; g.lineWidth = 7; for (const x of EX) { g.beginPath(); g.roundRect ? g.roundRect(x - 27, EY - 25, 54, 48, 12) : g.rect(x - 27, EY - 25, 54, 48); g.stroke(); } g.beginPath(); g.moveTo(113, EY - 6); g.lineTo(143, EY - 6); g.stroke(); }
    if (/beard/.test(extras)) { g.fillStyle = "#" + color(hairCol, "#5a4636").getHexString(); g.beginPath(); g.moveTo(30, 150); g.quadraticCurveTo(40, 256, 128, 256); g.quadraticCurveTo(216, 256, 226, 150); g.quadraticCurveTo(200, 214, 128, 210); g.quadraticCurveTo(56, 214, 30, 150); g.fill(); }
    if (/mustache/.test(extras)) { g.fillStyle = "#" + color(hairCol, "#5a4636").getHexString(); g.beginPath(); g.ellipse(112, 172, 18, 7, 0.2, 0, 2 * PI); g.ellipse(144, 172, 18, 7, -0.2, 0, 2 * PI); g.fill(); }
  });
  FACE.set(k, t); return t;
}

// ---------- characters
const AGES = {
  baby: { s: 0.46, head: 0.5 }, kid: { s: 0.8, head: 0.56 }, teen: { s: 0.94, head: 0.52 },
  adult: { s: 1.06, head: 0.5 }, elder: { s: 1.0, head: 0.5, hunch: 0.16 },
};
function buildCharacter(spec, rand) {
  const age = AGES[spec.age] || AGES.kid, S = age.s;
  const hairCol = spec.hair?.color || (spec.age === "elder" ? "#cfcfcf" : "#3b2a20");
  const skin = spec.skin || "#f1c27d", shirt = spec.shirt || "#4a7bd0", pants = spec.pants || "#2e3548", shoes = spec.shoes || "#2b2b2b";
  const extras = (Array.isArray(spec.extra) ? spec.extra.join(" ") : String(spec.extra || "")).toLowerCase();
  const D = { legH: 0.64 * S, legW: 0.21 * S, torsoH: 0.62 * S, torsoW: 0.6 * S, torsoD: 0.34 * S, armW: 0.18 * S, armH: 0.6 * S, head: age.head };
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = D.legH; body.add(hips);
  const spine = new THREE.Group(); hips.add(spine);
  mesh(rbox(D.torsoW, D.torsoH, D.torsoD, 0.05), mat(shirt), 0, D.torsoH / 2, 0, spine);
  if (/apron/.test(extras)) mesh(rbox(D.torsoW * 0.8, D.torsoH * 0.85, 0.02, 0.01), mat("#f4f1ea"), 0, D.torsoH * 0.45, D.torsoD / 2 + 0.01, spine);
  if (/tie/.test(extras)) mesh(rbox(0.07 * S, D.torsoH * 0.6, 0.02, 0.01), mat("#b8312f"), 0, D.torsoH * 0.6, D.torsoD / 2 + 0.012, spine);
  if (/backpack/.test(extras)) mesh(rbox(D.torsoW * 0.75, D.torsoH * 0.75, 0.18 * S, 0.05), mat("#d9534f"), 0, D.torsoH * 0.5, -D.torsoD / 2 - 0.09 * S, spine);
  if (/scarf/.test(extras)) mesh(rbox(D.torsoW * 0.75, 0.11 * S, D.torsoD * 1.15, 0.04), mat("#c0392b"), 0, D.torsoH - 0.03, 0, spine);
  // chest button (the "In our town" kind of story loves these)
  let button = null, buttonLight = null;
  if (spec.chest_button && spec.chest_button !== "none") {
    const on = spec.chest_button !== "grey";
    button = mesh(geo("btn", () => new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24)), on
      ? new THREE.MeshStandardMaterial({ color: "#ff2d3a", emissive: "#ff1020", emissiveIntensity: 0.6, roughness: 0.3 })
      : mat("#8d9096", { rough: 0.5 }), 0, D.torsoH * 0.62, D.torsoD / 2 + 0.02, spine);
    button.rotation.x = PI / 2; button.scale.setScalar(S * 1.1);
    if (on) { buttonLight = new THREE.PointLight("#ff3040", 0, 0.9, 2); buttonLight.position.set(0, D.torsoH * 0.62, D.torsoD / 2 + 0.25); spine.add(buttonLight); }
  }
  // head
  const neck = new THREE.Group(); neck.position.y = D.torsoH; spine.add(neck);
  const head = new THREE.Group(); neck.add(head);
  const h = D.head;
  const skinM = mat(skin, { rough: 0.7 });
  const faceM = new THREE.MeshStandardMaterial({ map: faceTexture(skin, "neutral", 0, extras, hairCol), roughness: 0.7 });
  mesh(rbox(h, h * 0.95, h * 0.92, 0.08 * h / 0.5, 4), [skinM, skinM, skinM, skinM, faceM, skinM], 0, h * 0.48, 0, head);
  buildHair(head, spec.hair?.style || (spec.age === "elder" ? "short" : "short"), hairCol, h, rand, extras);
  if (/hoodie/.test(extras)) mesh(rbox(h * 1.12, h * 0.75, h * 0.35, 0.08), mat(shirt), 0, h * 0.42, -h * 0.55, head);
  if (/bow/.test(extras)) { const bw = mesh(rbox(h * 0.42, h * 0.18, h * 0.12, 0.04), mat("#ff5c8a"), h * 0.28, h * 1.05, h * 0.1, head); bw.rotation.z = 0.3; }
  if (/headphones/.test(extras)) { mesh(rbox(h * 1.16, h * 0.08, h * 0.12, 0.03), mat("#222"), 0, h * 1.0, 0, head); for (const sx of [-1, 1]) mesh(rbox(h * 0.12, h * 0.3, h * 0.3, 0.05), mat("#222"), sx * h * 0.55, h * 0.5, 0, head); }
  // arms
  const arms = [];
  for (const sx of [1, -1]) { // index 0 = left (+x), 1 = right (-x)
    const a = new THREE.Group(); a.position.set(sx * (D.torsoW / 2 + D.armW / 2 + 0.005), D.torsoH - 0.07 * S, 0); spine.add(a);
    mesh(rbox(D.armW, D.armH * 0.92, D.armW, 0.05), mat(shirt), 0, -D.armH * 0.46, 0, a);
    const hand = new THREE.Group(); hand.position.y = -D.armH * 0.95; a.add(hand);
    mesh(rbox(D.armW * 0.95, D.armW * 0.8, D.armW * 0.95, 0.05), skinM, 0, 0, 0, hand);
    arms.push({ g: a, hand });
  }
  // legs
  const legs = [];
  for (const sx of [1, -1]) {
    const l = new THREE.Group(); l.position.set(sx * D.legW * 0.56, D.legH, 0); body.add(l);
    mesh(rbox(D.legW, D.legH * 0.9, D.legW * 1.08, 0.05), mat(pants), 0, -D.legH * 0.45, 0, l);
    mesh(rbox(D.legW * 1.08, 0.1 * S, D.legW * 1.5, 0.04), mat(shoes), 0, -D.legH + 0.05 * S, 0.035 * S, l);
    legs.push(l);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const c = {
    id: spec.id, spec, root, body, hips, spine, neck, head, arms, legs, D, S, faceM, button, buttonLight, extras, hairCol, skin,
    height: D.legH + D.torsoH + h, seed: hash(spec.id || "x"),
    setFace(expr, blink) { const m = faceTexture(skin, expr, blink ? 1 : 0, extras, hairCol); if (faceM.map !== m) { faceM.map = m; faceM.needsUpdate = true; } },
    reset() {
      root.rotation.set(0, root.rotation.y, 0); body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
      spine.rotation.set(age.hunch || 0, 0, 0); neck.rotation.set(-(age.hunch || 0) * 0.8, 0, 0); head.rotation.set(0, 0, 0);
      for (const a of arms) a.g.rotation.set(0, 0, 0); for (const l of legs) l.rotation.set(0, 0, 0);
    },
    headWorld(v = new THREE.Vector3()) { return head.getWorldPosition(v).add(new THREE.Vector3(0, h * 0.5, 0)); },
    chestWorld(v = new THREE.Vector3()) { return spine.getWorldPosition(v).add(new THREE.Vector3(0, D.torsoH * 0.5, 0)); },
  };
  return c;
}
function buildHair(head, style, hc, h, rand, extras) {
  const m = mat(hc, { rough: 0.85 });
  const top = () => mesh(rbox(h * 1.06, h * 0.24, h * 1.0, 0.06), m, 0, h * 0.97, -h * 0.01, head);
  const back = (len = 0.62) => mesh(rbox(h * 1.06, h * len, h * 0.17, 0.05), m, 0, h * (0.98 - len / 2), -h * 0.46, head);
  const fringe = () => mesh(rbox(h * 1.06, h * 0.13, h * 0.14, 0.04), m, 0, h * 0.88, h * 0.43, head);
  const sides = (len = 0.42) => { for (const sx of [-1, 1]) mesh(rbox(h * 0.1, h * len, h * 0.85, 0.03), m, sx * h * 0.52, h * (0.98 - len / 2), -h * 0.04, head); };
  switch (style) {
    case "bald": if (/beard|mustache/.test(extras)) break; for (const sx of [-1, 1]) mesh(rbox(h * 0.08, h * 0.22, h * 0.5, 0.03), m, sx * h * 0.51, h * 0.62, -h * 0.15, head); break;
    case "spiky": top(); back(0.5); for (let i = 0; i < 7; i++) { const s = mesh(rbox(h * 0.22, h * 0.3, h * 0.22, 0.04), m, (i % 4 - 1.5) * h * 0.26, h * 1.12, (Math.floor(i / 4) - 0.5) * h * 0.4, head); s.rotation.set((rand() - 0.5) * 0.6, rand() * 0.6, (rand() - 0.5) * 0.7); } break;
    case "long": top(); back(1.0); sides(0.75); fringe(); break;
    case "ponytail": { top(); back(0.55); fringe(); const p = mesh(rbox(h * 0.24, h * 0.62, h * 0.24, 0.08), m, 0, h * 0.55, -h * 0.68, head); p.rotation.x = 0.35; break; }
    case "bun": top(); back(0.55); fringe(); mesh(rbox(h * 0.42, h * 0.36, h * 0.42, 0.14), m, 0, h * 1.16, -h * 0.25, head); break;
    case "curly": top(); for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 2; mesh(rbox(h * 0.3, h * 0.3, h * 0.3, 0.12), m, Math.cos(a) * h * 0.47, h * (0.98 + Math.sin(i * 1.7) * 0.06), Math.sin(a) * h * 0.47 - h * 0.05, head); } break;
    case "cap": { const cm = mat(hc, { rough: 0.6 }); mesh(rbox(h * 1.08, h * 0.3, h * 1.02, 0.12), cm, 0, h * 1.0, 0, head); mesh(rbox(h * 0.9, h * 0.05, h * 0.42, 0.02), cm, 0, h * 0.88, h * 0.62, head); back(0.4); break; }
    case "beanie": { const bm = mat(hc, { rough: 0.95 }); mesh(rbox(h * 1.1, h * 0.42, h * 1.05, 0.14), bm, 0, h * 1.02, 0, head); mesh(rbox(h * 1.14, h * 0.12, h * 1.09, 0.04), bm, 0, h * 0.84, 0, head); break; }
    case "messy": top(); back(0.6); fringe(); for (let i = 0; i < 5; i++) { const s = mesh(rbox(h * 0.3, h * 0.14, h * 0.3, 0.04), m, (rand() - 0.5) * h * 0.7, h * 1.08, (rand() - 0.5) * h * 0.6, head); s.rotation.set(rand() - 0.5, rand(), rand() - 0.5); } break;
    default: top(); back(0.55); fringe();
  }
}

// ---------- props
function buildProp(name, rand, opts = {}) {
  const g = new THREE.Group(); g.name = name;
  const B = (w, hh, d, c, x, y, z, o) => block(g, w, hh, d, c, x, y, z, o);
  switch (name) {
    case "ball": {
      const m = mesh(geo("ball", () => new THREE.IcosahedronGeometry(0.11, 1)), mat("#f5f5f5", { flat: true, rough: 0.5 }), 0, 0.11, 0, g);
      const p = mesh(geo("ballp", () => new THREE.IcosahedronGeometry(0.112, 0)), mat("#222", { flat: true }), 0, 0, 0, m); p.scale.setScalar(0.55); p.rotation.set(0.4, 0.2, 0);
      g.userData.ball = m; break;
    }
    case "goal": {
      const W = 3.6, H = 1.6, wm = mat("#ffffff", { rough: 0.3 });
      for (const sx of [-1, 1]) mesh(rbox(0.1, H, 0.1, 0.03), wm, sx * W / 2, H / 2, 0, g);
      mesh(rbox(W + 0.1, 0.1, 0.1, 0.03), wm, 0, H, 0, g);
      const net = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 1, map: tex("net", 64, 64, (c, w) => { c.clearRect(0, 0, w, w); c.strokeStyle = "#fff"; c.lineWidth = 2; for (let i = 0; i <= w; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, w); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } }, { repeat: [8, 4] }) });
      const back = mesh(geo("netb", () => new THREE.PlaneGeometry(W, H)), net, 0, H / 2, -1.0, g, { cast: false }); back.rotation.x = 0.0;
      for (const sx of [-1, 1]) { const s = mesh(geo("nets", () => new THREE.PlaneGeometry(1.0, H)), net, sx * W / 2, H / 2, -0.5, g, { cast: false }); s.rotation.y = PI / 2; }
      const tp = mesh(geo("nett", () => new THREE.PlaneGeometry(W, 1.0)), net, 0, H, -0.5, g, { cast: false }); tp.rotation.x = PI / 2;
      g.userData.post = new THREE.Vector3(-W / 2, H * 0.7, 0); break;
    }
    case "thermos": B(0.12, 0.3, 0.12, "#2f8f5b", 0, 0, 0, { r: 0.05, rough: 0.4 }); B(0.13, 0.06, 0.13, "#d6d6d6", 0, 0.3, 0, { r: 0.03, metal: 0.6, rough: 0.3 }); break;
    case "bench": { const w = "#9b6a3c"; B(1.8, 0.07, 0.45, w, 0, 0.42, 0); B(1.8, 0.4, 0.06, w, 0, 0.5, -0.22); for (const sx of [-0.8, 0.8]) for (const sz of [-0.18, 0.18]) B(0.07, 0.42, 0.07, "#3c3c42", sx, 0, sz); g.userData.seat = 0.49; break; }
    case "bed": { B(1.2, 0.35, 2.1, "#7a5132", 0, 0, 0); B(1.15, 0.2, 2.0, "#f1f1ee", 0, 0.35, 0); B(1.18, 0.12, 1.3, opts.blanket || "#5b7fc7", 0, 0.5, 0.35); B(0.7, 0.14, 0.36, "#ffffff", 0, 0.55, -0.75, { r: 0.07 }); B(1.2, 0.9, 0.08, "#7a5132", 0, 0, -1.05); g.userData.seat = 0.55; g.userData.lie = 0.6; break; }
    case "chair": { const w = opts.c || "#8a5a36"; B(0.5, 0.06, 0.5, w, 0, 0.44, 0); B(0.5, 0.55, 0.06, w, 0, 0.5, -0.22); for (const sx of [-0.2, 0.2]) for (const sz of [-0.2, 0.2]) B(0.06, 0.44, 0.06, w, sx, 0, sz); g.userData.seat = 0.5; break; }
    case "coat_on_chair": { const ch = buildProp("chair", rand); g.add(ch); B(0.48, 0.62, 0.12, "#5a4636", 0, 0.42, -0.26); const bt = mesh(geo("btn", () => new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24)), mat("#8d9096", { rough: 0.5 }), 0.12, 0.72, -0.18, g); bt.rotation.x = PI / 2; break; }
    case "sofa": { const c = opts.c || "#a0524a"; B(2.0, 0.42, 0.85, c, 0, 0, 0); B(2.0, 0.55, 0.22, c, 0, 0.42, -0.32); for (const sx of [-1, 1]) B(0.22, 0.32, 0.85, c, sx * 0.9, 0.42, 0); g.userData.seat = 0.48; break; }
    case "table": B(1.4, 0.08, 0.9, "#8b5e3c", 0, 0.72, 0); for (const sx of [-0.6, 0.6]) for (const sz of [-0.36, 0.36]) B(0.08, 0.72, 0.08, "#6e4a2f", sx, 0, sz); g.userData.top = 0.8; break;
    case "desk": B(1.1, 0.06, 0.6, "#c9a37a", 0, 0.7, 0); for (const sx of [-0.5, 0.5]) for (const sz of [-0.25, 0.25]) B(0.05, 0.7, 0.05, "#666", sx, 0, sz); g.userData.top = 0.76; break;
    case "tv": B(1.4, 0.45, 0.4, "#5d4433", 0, 0, 0); mesh(rbox(1.2, 0.7, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: "#111", emissive: "#3d6fbf", emissiveIntensity: opts.on ? 0.9 : 0.05, roughness: 0.2 }), 0, 0.85, 0, g); break;
    case "door": { B(1.0, 2.1, 0.1, "#7b4b2a", 0, 0, 0); B(0.08, 0.08, 0.08, "#d9b45a", 0.38, 1.0, 0.07, { metal: 0.8, rough: 0.3 }); B(1.15, 0.08, 0.14, "#5c3a20", 0, 2.1, 0); break; }
    case "box": { const c = opts.c || "#b88a55"; B(0.6, 0.45, 0.5, c, 0, 0, 0); B(0.62, 0.04, 0.12, "#d8c59c", 0, 0.45, 0); break; }
    case "lamp": { B(0.3, 0.05, 0.3, "#333", 0, 0, 0); B(0.05, 1.3, 0.05, "#333", 0, 0.05, 0); mesh(geo("shade", () => new THREE.CylinderGeometry(0.16, 0.25, 0.3, 16, 1, true)), mat("#f3e3c2", { emissive: "#ffd68a", ei: 0.5, double: true }), 0, 1.45, 0, g); const l = new THREE.PointLight("#ffcc88", 2.5, 5, 2); l.position.set(0, 1.4, 0); g.add(l); break; }
    case "flowers": for (let i = 0; i < 7; i++) { const x = (rand() - 0.5) * 0.5, z = (rand() - 0.5) * 0.3; B(0.03, 0.3 + rand() * 0.15, 0.03, "#3f8f3f", x, 0, z); B(0.1, 0.1, 0.1, ["#ff6f91", "#ffd166", "#ffffff", "#c77dff"][i % 4], x, 0.32 + rand() * 0.12, z, { r: 0.04 }); } break;
    case "cake": B(0.45, 0.22, 0.45, "#f6d6e0", 0, 0, 0, { r: 0.08 }); B(0.47, 0.05, 0.47, "#ff8fab", 0, 0.2, 0, { r: 0.02 }); for (let i = 0; i < 3; i++) { B(0.03, 0.1, 0.03, "#fff", -0.1 + i * 0.1, 0.25, 0); mesh(geo("flame", () => new THREE.SphereGeometry(0.025, 8, 6)), mat("#ffcc55", { emissive: "#ffaa33", ei: 3 }), -0.1 + i * 0.1, 0.38, 0, g, { cast: false }); } { const l = new THREE.PointLight("#ffaa55", 2, 2.5, 2); l.position.y = 0.5; g.add(l); } break;
    case "gift": B(0.4, 0.35, 0.4, "#3fa7d6", 0, 0, 0, { r: 0.03 }); B(0.08, 0.36, 0.42, "#ffd23f", 0, 0, 0, { r: 0.01 }); B(0.42, 0.36, 0.08, "#ffd23f", 0, 0, 0, { r: 0.01 }); break;
    case "trophy": B(0.25, 0.08, 0.25, "#5a4636", 0, 0, 0); B(0.06, 0.18, 0.06, "#e9c46a", 0, 0.08, 0, { metal: 0.9, rough: 0.25 }); B(0.22, 0.2, 0.22, "#e9c46a", 0, 0.26, 0, { metal: 0.9, rough: 0.25, r: 0.08 }); break;
    case "clock": { const face = mesh(geo("clockf", () => new THREE.CylinderGeometry(0.28, 0.28, 0.05, 32)), mat("#f7f3ea"), 0, 0, 0, g); face.rotation.x = PI / 2; const hm = mat("#222"); const hh = mesh(rbox(0.03, 0.16, 0.02, 0.005), hm, 0, 0.07, 0.04, g); const mh = mesh(rbox(0.02, 0.22, 0.02, 0.005), hm, 0, 0.1, 0.045, g); hh.geometry.translate?.(0, 0, 0); g.userData.hands = [hh, mh]; break; }
    case "candle": B(0.08, 0.2, 0.08, "#f3efe0", 0, 0, 0, { r: 0.02 }); mesh(geo("flame", () => new THREE.SphereGeometry(0.025, 8, 6)), mat("#ffcc55", { emissive: "#ffaa33", ei: 3 }), 0, 0.24, 0, g, { cast: false }); { const l = new THREE.PointLight("#ffaa55", 2.5, 3, 2); l.position.y = 0.3; g.add(l); g.userData.flicker = l; } break;
    case "note": B(0.22, 0.01, 0.3, "#fffdf2", 0, 0, 0, { r: 0.002 }); break;
    case "umbrella": { const c = mesh(geo("umb", () => new THREE.ConeGeometry(0.75, 0.35, 8, 1, true)), mat(opts.c || "#e63946", { double: true, flat: true }), 0, 1.9, 0, g); B(0.03, 1.9, 0.03, "#333", 0, 0, 0); c.castShadow = true; break; }
    case "dog": case "cat": {
      const isDog = name === "dog", fur = opts.c || (isDog ? "#c08a4e" : "#8d8d8d"), S = isDog ? 1 : 0.75;
      const body = new THREE.Group(); g.add(body);
      mesh(rbox(0.32 * S, 0.28 * S, 0.62 * S, 0.06), mat(fur), 0, 0.36 * S, 0, body);
      const hd = new THREE.Group(); hd.position.set(0, 0.5 * S, 0.34 * S); body.add(hd);
      mesh(rbox(0.3 * S, 0.28 * S, 0.28 * S, 0.06), mat(fur), 0, 0, 0, hd);
      mesh(rbox(0.16 * S, 0.12 * S, 0.14 * S, 0.04), mat(isDog ? darker(fur, 0.85) : fur), 0, -0.05 * S, 0.17 * S, hd);
      mesh(rbox(0.05 * S, 0.05 * S, 0.03, 0.01), mat("#111"), 0, -0.02 * S, 0.24 * S, hd);
      for (const sx of [-1, 1]) { mesh(rbox(0.05 * S, 0.06 * S, 0.02, 0.01), mat("#111"), sx * 0.07 * S, 0.05 * S, 0.141 * S, hd); const ear = mesh(rbox(0.09 * S, isDog ? 0.16 * S : 0.12 * S, 0.05 * S, 0.02), mat(darker(fur, 0.8)), sx * 0.12 * S, isDog ? 0.08 * S : 0.17 * S, -0.02, hd); if (isDog) ear.rotation.z = sx * 0.4; }
      const legsA = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Group(); l.position.set(sx * 0.1 * S, 0.24 * S, sz * 0.22 * S); body.add(l); mesh(rbox(0.09 * S, 0.24 * S, 0.09 * S, 0.03), mat(fur), 0, -0.12 * S, 0, l); legsA.push(l); }
      const tail = new THREE.Group(); tail.position.set(0, 0.45 * S, -0.3 * S); body.add(tail); mesh(rbox(0.06 * S, 0.06 * S, 0.24 * S, 0.02), mat(fur), 0, 0.05, -0.1 * S, tail); tail.rotation.x = isDog ? -0.6 : -1.1;
      g.userData.animal = { hd, tail, legs: legsA, body };
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      break;
    }
    case "balloon": { mesh(geo("bal", () => new THREE.SphereGeometry(0.22, 16, 12)), mat(opts.c || "#ff4d6d", { rough: 0.25 }), 0, 2.1, 0, g).scale.y = 1.2; B(0.01, 1.85, 0.01, "#eee", 0, 0, 0, { r: 0 }); g.userData.float = true; break; }
    case "campfire": { for (let i = 0; i < 5; i++) { const lg = mesh(rbox(0.6, 0.1, 0.1, 0.03), mat("#5b3a24"), 0, 0.06, 0, g); lg.rotation.y = (i / 5) * PI; } const f = mesh(geo("fire", () => new THREE.ConeGeometry(0.22, 0.5, 6)), mat("#ff8c2a", { emissive: "#ff6a00", ei: 3, flat: true }), 0, 0.32, 0, g, { cast: false }); const l = new THREE.PointLight("#ff8a3a", 10, 8, 2); l.position.y = 0.6; g.add(l); g.userData.flicker = l; g.userData.fire = f; break; }
    case "lantern": B(0.16, 0.24, 0.16, "#2d2d2d", 0, 0, 0, { r: 0.03 }); mesh(rbox(0.12, 0.16, 0.12, 0.02), mat("#ffd27a", { emissive: "#ffb347", ei: 2.5 }), 0, 0.12, 0, g, { cast: false }); { const l = new THREE.PointLight("#ffbb66", 4, 4, 2); l.position.y = 0.15; g.add(l); g.userData.flicker = l; } break;
    case "monitor": { B(0.08, 1.3, 0.08, "#999", 0, 0, 0); const scr = canvasTex(256, 160, () => {}); const m = new THREE.MeshStandardMaterial({ map: scr, emissive: "#ffffff", emissiveMap: scr, emissiveIntensity: 1.2, roughness: 0.3 }); B(0.62, 0.44, 0.12, "#d8dde3", 0, 1.3, 0); mesh(geo("mon", () => new THREE.PlaneGeometry(0.54, 0.34)), m, 0, 1.52, 0.065, g, { cast: false }); g.userData.ekg = scr; break; }
    case "grave": B(0.6, 0.85, 0.18, "#9aa0a6", 0, 0, 0, { r: 0.14 }); B(0.8, 0.1, 1.2, "#5b6b4f", 0, 0, 0.6, { r: 0.04 }); break;
    case "snowman": mesh(geo("sn1", () => new THREE.IcosahedronGeometry(0.38, 1)), mat("#ffffff", { flat: true }), 0, 0.36, 0, g); mesh(geo("sn2", () => new THREE.IcosahedronGeometry(0.27, 1)), mat("#ffffff", { flat: true }), 0, 0.92, 0, g); mesh(geo("sn3", () => new THREE.IcosahedronGeometry(0.19, 1)), mat("#ffffff", { flat: true }), 0, 1.32, 0, g); B(0.05, 0.05, 0.16, "#ff7f11", 0, 1.3, 0.2, { r: 0.01 }); break;
    case "bike": { for (const z of [-0.5, 0.5]) { const w = mesh(geo("wheel", () => new THREE.TorusGeometry(0.3, 0.04, 8, 20)), mat("#222"), 0, 0.33, z, g); w.rotation.y = PI / 2; } B(0.05, 0.05, 1.0, opts.c || "#e63946", 0, 0.55, 0); B(0.05, 0.45, 0.05, opts.c || "#e63946", 0, 0.3, -0.1); B(0.2, 0.05, 0.25, "#222", 0, 0.78, -0.12); B(0.5, 0.04, 0.04, "#333", 0, 0.85, 0.45); break; }
    case "swing": { for (const sx of [-0.8, 0.8]) B(0.08, 2.2, 0.08, "#c0392b", sx, 0, 0); B(1.8, 0.08, 0.08, "#c0392b", 0, 2.2, 0); const s = new THREE.Group(); s.position.y = 2.2; g.add(s); for (const sx of [-0.25, 0.25]) mesh(rbox(0.02, 1.7, 0.02, 0.005), mat("#555"), sx, -0.85, 0, s); mesh(rbox(0.6, 0.05, 0.25, 0.02), mat("#333"), 0, -1.7, 0, s); g.userData.swing = s; g.userData.seat = 0.55; break; }
    case "ice_cream": B(0.08, 0.16, 0.08, "#e6b56c", 0, 0, 0, { r: 0.02 }); mesh(geo("ic", () => new THREE.SphereGeometry(0.07, 12, 10)), mat("#ffb3c6", { rough: 0.6 }), 0, 0.2, 0, g); break;
    case "phone": B(0.09, 0.17, 0.015, "#111", 0, 0, 0, { r: 0.01 }); mesh(geo("phs", () => new THREE.PlaneGeometry(0.075, 0.15)), mat("#9ad1ff", { emissive: "#6fb6ff", ei: 1.6 }), 0, 0.085, 0.009, g, { cast: false }); break;
    case "book": B(0.22, 0.04, 0.3, "#3d5a80", 0, 0, 0, { r: 0.01 }); break;
    case "cup": B(0.09, 0.11, 0.09, "#ffffff", 0, 0, 0, { r: 0.03 }); break;
    case "key": B(0.04, 0.12, 0.01, "#e9c46a", 0, 0, 0, { metal: 0.9, rough: 0.3, r: 0.004 }); break;
    case "tree": treeInto(g, 0, 0, rand, opts); break;
    case "fence": for (let i = -6; i <= 6; i++) B(0.1, 0.9, 0.06, "#f1ede4", i * 0.5, 0, 0, { r: 0.02 }); B(6.6, 0.08, 0.04, "#f1ede4", 0, 0.65, 0.04); B(6.6, 0.08, 0.04, "#f1ede4", 0, 0.3, 0.04); break;
    case "mailbox": B(0.08, 1.0, 0.08, "#555", 0, 0, 0); B(0.28, 0.26, 0.45, "#2b5fb3", 0, 1.0, 0, { r: 0.1 }); break;
    case "streetlight": streetlight(g, 0, 0, !!opts.night); break;
    case "stroller": B(0.55, 0.35, 0.8, opts.c || "#7aa5d6", 0, 0.35, 0, { r: 0.12 }); for (const sx of [-0.25, 0.25]) for (const sz of [-0.3, 0.3]) { const w = mesh(geo("wheel2", () => new THREE.TorusGeometry(0.12, 0.03, 6, 14)), mat("#222"), sx, 0.12, sz, g); w.rotation.y = PI / 2; } B(0.04, 0.5, 0.04, "#333", 0, 0.6, -0.45); break;
    case "car": {
      const c = opts.c || "#3a6fb0";
      B(1.9, 0.55, 4.0, c, 0, 0.25, 0, { r: 0.15, rough: 0.35, metal: 0.3 });
      B(1.65, 0.5, 2.1, darker(c, 0.85), 0, 0.8, -0.25, { r: 0.15, rough: 0.35, metal: 0.3 });
      mesh(rbox(1.5, 0.38, 0.05, 0.02), mat("#9bb7d4", { rough: 0.1, metal: 0.6 }), 0, 1.05, 0.83, g);
      for (const sx of [-0.95, 0.95]) for (const sz of [-1.3, 1.3]) { const w = mesh(geo("tire", () => new THREE.CylinderGeometry(0.33, 0.33, 0.25, 16)), mat("#1a1a1a"), sx, 0.33, sz, g); w.rotation.z = PI / 2; }
      for (const sx of [-0.6, 0.6]) mesh(rbox(0.3, 0.14, 0.05, 0.03), mat("#fff8d6", { emissive: opts.night ? "#fff2b0" : "#000", ei: 3 }), sx, 0.55, 2.01, g, { cast: false });
      if (opts.night) for (const sx of [-0.6, 0.6]) { const sl = new THREE.SpotLight("#fff2c8", 40, 25, 0.5, 0.5, 1.5); sl.position.set(sx, 0.6, 2.05); sl.target.position.set(sx * 2, 0, 12); g.add(sl, sl.target); }
      break;
    }
    case "mirror": { B(1.0, 1.4, 0.06, "#6b4f3a", 0, 0, 0, { r: 0.04 }); mesh(rbox(0.86, 1.26, 0.02, 0.01), mat("#c9dbe6", { rough: 0.05, metal: 0.95 }), 0, 0.7, 0.035, g, { cast: false }); break; }
    default: return null;
  }
  return g;
}
function treeInto(parent, x, z, rand, o = {}) {
  const t = new THREE.Group(); t.position.set(x, 0, z); parent.add(t);
  const hgt = 1.4 + rand() * 1.4, kind = o.kind || (rand() < 0.3 ? "pine" : "round");
  mesh(rbox(0.22, hgt, 0.22, 0.04), mat("#6b4a2f"), 0, hgt / 2, 0, t);
  const leaf = o.dead ? "#4a3b30" : o.c || ["#4f9d4a", "#5aa84f", "#3f8a43", "#6ab04c"][Math.floor(rand() * 4)];
  if (o.dead) { for (let i = 0; i < 4; i++) { const b = mesh(rbox(0.08, 0.8, 0.08, 0.02), mat("#4a3b30"), 0, hgt - 0.1, 0, t); b.rotation.set((rand() - 0.5) * 1.6, rand() * 3, (rand() - 0.5) * 1.6); } return t; }
  if (kind === "pine") for (let i = 0; i < 3; i++) mesh(geo("pine" + i, () => new THREE.ConeGeometry(1.0 - i * 0.25, 1.1, 7)), mat(darker(leaf, 0.8), { flat: true }), 0, hgt + i * 0.6, 0, t);
  else { mesh(geo("leaf1", () => new THREE.IcosahedronGeometry(1.0, 0)), mat(leaf, { flat: true }), 0, hgt + 0.5, 0, t); mesh(geo("leaf2", () => new THREE.IcosahedronGeometry(0.7, 0)), mat(leaf, { flat: true }), 0.5, hgt + 0.1, 0.2, t); }
  const s = 0.85 + rand() * 0.5; t.scale.setScalar(s);
  t.traverse((o2) => { if (o2.isMesh) { o2.castShadow = true; o2.receiveShadow = true; } });
  return t;
}
function streetlight(parent, x, z, night) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  block(g, 0.12, 3.2, 0.12, "#3a3d44", 0, 0, 0); block(g, 0.6, 0.08, 0.12, "#3a3d44", 0.25, 3.2, 0);
  mesh(rbox(0.3, 0.1, 0.22, 0.03), mat("#fff3c4", { emissive: night ? "#ffd98a" : "#000", ei: 3 }), 0.45, 3.15, 0, g, { cast: false });
  if (night) { const l = new THREE.PointLight("#ffcf7a", 18, 9, 2); l.position.set(0.45, 3.0, 0); g.add(l); }
  return g;
}
function house(parent, x, z, w, c, roof, night, rand, rotY = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; parent.add(g);
  const hh = 2.6 + rand() * 0.8;
  block(g, w, hh, 3.2, c, 0, 0, 0, { r: 0.05 });
  const r = mesh(geo("roof" + w.toFixed(1), () => new THREE.ConeGeometry(w * 0.78, 1.5, 4)), mat(roof, { flat: true }), 0, hh + 0.75, 0, g); r.rotation.y = PI / 4; r.scale.z = 3.2 / w;
  const lit = (i) => night && (hash(x * 7 + i) % 3 !== 0);
  for (const [i, wx] of [[0, -w * 0.25], [1, w * 0.25]].entries()) {
    mesh(rbox(0.6, 0.6, 0.06, 0.02), mat(lit(i) ? "#ffd27a" : "#9cc3e0", { emissive: lit(i) ? "#ffb347" : "#000", ei: 2, rough: 0.2 }), wx[1], hh * 0.62, 1.61, g, { cast: false });
    block(g, 0.72, 0.06, 0.1, "#ffffff", wx[1], hh * 0.62 - 0.36, 1.62);
  }
  block(g, 0.7, 1.4, 0.06, darker(c, 0.6), 0, 0, 1.61);
  return g;
}
function crowd(parent, n, area, rand) {
  const bodyG = rbox(0.34, 0.42, 0.24, 0.05), headG = rbox(0.26, 0.26, 0.24, 0.05);
  const cols = ["#e63946", "#457b9d", "#f1c40f", "#2a9d8f", "#ffffff", "#e76f51", "#8e44ad", "#1d3557"];
  const bm = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
  const hm = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
  const skins = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const seats = [];
  for (let i = 0; i < n; i++) {
    const x = area.x0 + rand() * (area.x1 - area.x0), row = Math.floor(rand() * area.rows);
    seats.push({ x, y: area.y0 + row * area.dy, z: area.z0 - row * area.dz, ph: rand() * 6 });
    bm.setColorAt(i, color(cols[i % cols.length])); hm.setColorAt(i, color(skins[Math.floor(rand() * skins.length)]));
  }
  parent.add(bm, hm); bm.castShadow = false; bm.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const update = (t, cheer) => {
    seats.forEach((s, i) => {
      const b = cheer ? Math.abs(Math.sin(t * 7 + s.ph)) * 0.18 : Math.sin(t * 1.3 + s.ph) * 0.01;
      m4.makeTranslation(s.x, s.y + 0.21 + b, s.z); bm.setMatrixAt(i, m4);
      m4.makeTranslation(s.x, s.y + 0.56 + b, s.z); hm.setMatrixAt(i, m4);
    });
    bm.instanceMatrix.needsUpdate = true; hm.instanceMatrix.needsUpdate = true;
  };
  update(0, false);
  return update;
}

// ---------- sets: each returns anchors (named spots) and whether it's inside
function buildSet(name, ctx) {
  const { g, rand, night, propsWanted } = ctx;
  const A = {}; // anchors: name -> { p: Vector3, seat?, rotY?, lie? }
  const add = (n, x, z, extra = {}) => { A[n] = { p: new THREE.Vector3(x, 0, z), ...extra }; };
  const ground = (c, w = 80, d = 80, texture) => { const m = texture ? new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }) : mat(c, { rough: 0.95 }); const p = mesh(geo(`gr${w}x${d}`, () => new THREE.PlaneGeometry(w, d)), m, 0, 0, 0, g, { cast: false }); p.rotation.x = -PI / 2; return p; };
  const placeProp = (n, x, z, rotY = 0, o = {}) => { const p = buildProp(n, rand, { night, ...o }); if (!p) return null; p.position.set(x, o.y || 0, z); p.rotation.y = rotY; g.add(p); ctx.props[n] = p; return p; };
  const room = ({ floor = "#b88b5a", wall = "#e9e1d3", wall2, w = 9, d = 7, h = 3.2, floorTex = "wood", windowBack = true }) => {
    const ft = floorTex === "wood"
      ? tex("wood" + floor, 256, 256, (c, W) => { c.fillStyle = floor; c.fillRect(0, 0, W, W); for (let i = 0; i < 8; i++) { c.fillStyle = `rgba(0,0,0,${0.04 + (i % 3) * 0.03})`; c.fillRect(0, i * 32, W, 30); c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(0, i * 32 + 30, W, 2); c.fillRect((i * 97) % W, i * 32, 2, 32); } }, { repeat: [3, 3] })
      : floorTex === "tile"
        ? tex("tile" + floor, 128, 128, (c, W) => { c.fillStyle = floor; c.fillRect(0, 0, W, W); c.strokeStyle = "rgba(0,0,0,0.15)"; c.lineWidth = 3; for (let i = 0; i <= W; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, W); c.moveTo(0, i); c.lineTo(W, i); c.stroke(); } }, { repeat: [6, 6] })
        : null;
    const f = mesh(geo(`rf${w}x${d}`, () => new THREE.PlaneGeometry(w, d)), ft ? new THREE.MeshStandardMaterial({ map: ft, roughness: 0.8 }) : mat(floor), 0, 0, 0, g, { cast: false }); f.rotation.x = -PI / 2; f.position.z = -d / 2 + 2.5;
    const back = mesh(rbox(w, h, 0.2, 0.01), mat(wall), 0, h / 2, -d + 2.5, g);
    const left = mesh(rbox(0.2, h, d, 0.01), mat(wall2 || wall), -w / 2, h / 2, -d / 2 + 2.5, g);
    const right = mesh(rbox(0.2, h, d, 0.01), mat(wall2 || wall), w / 2, h / 2, -d / 2 + 2.5, g);
    const ceil = mesh(geo(`rc${w}x${d}`, () => new THREE.PlaneGeometry(w, d)), mat("#f4efe6"), 0, h, -d / 2 + 2.5, g, { cast: false }); ceil.rotation.x = PI / 2;
    block(g, w, 0.12, 0.05, "#ffffff", 0, 0, -d + 2.62); // skirting
    if (windowBack) windowOn(g, 1.8, 1.6, -d + 2.62, ctx);
    ctx.inside = true; ctx.roomBack = -d + 2.5;
    const l = new THREE.PointLight(night ? "#ffd59a" : "#fff1dc", night ? 4 : 5, 12, 2); l.position.set(0, h - 0.3, -1.5); l.castShadow = false; g.add(l);
    mesh(geo("ceilamp", () => new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20)), mat("#fff8e7", { emissive: "#fff2d0", ei: night ? 0.6 : 0.4 }), 0, h - 0.03, -1.5, g, { cast: false });
    return { back, left, right };
  };
  switch (name) {
    case "street": case "park": case "graveyard": case "forest": case "beach": case "rooftop": case "night_road": case "stadium": break;
  }
  switch (name) {
    case "street": {
      ground("#78b45a");
      block(g, 60, 0.04, 3.0, "#cfcac2", 0, 0, 0.2, { r: 0.01 }); // sidewalk
      mesh(geo("road", () => new THREE.PlaneGeometry(60, 5)), mat("#4a4d55"), 0, 0.03, -3.4, g, { cast: false }).rotation.x = -PI / 2;
      for (let i = -14; i <= 14; i++) mesh(geo("dash", () => new THREE.PlaneGeometry(1.0, 0.12)), mat("#f2e6a6"), i * 2.2, 0.035, -3.4, g, { cast: false }).rotation.x = -PI / 2;
      const hc = ["#f4a261", "#e9c46a", "#a8dadc", "#f6bd60", "#cdb4db", "#90be6d", "#ffafcc"], rc = ["#8d3b2f", "#5a4636", "#3d405b", "#6d4c41"];
      for (let i = -3; i <= 3; i++) house(g, i * 5.2 + (rand() - 0.5), -9.5, 3.8 + rand() * 0.8, hc[(i + 7 + Math.floor(rand() * 3)) % hc.length], rc[Math.floor(rand() * rc.length)], night, rand);
      for (let i = -3; i <= 3; i++) treeInto(g, i * 5.2 + 2.5, -7, rand);
      for (const x of [-5, 5]) streetlight(g, x, -1.2, night);
      placeProp("mailbox", 3.2, -0.9);
      clouds(g, rand, night);
      add("door", 0, -7.7); add("bench", 2.2, -0.4);
      break;
    }
    case "park": {
      ground("#6fae52");
      mesh(geo("path", () => new THREE.PlaneGeometry(2.2, 40)), mat("#d9c3a0"), -2.5, 0.02, -5, g, { cast: false }).rotation.x = -PI / 2;
      const b = placeProp("bench", 1.8, -0.6); add("bench", 1.8, -0.55, { seat: b.userData.seat });
      for (let i = 0; i < 14; i++) { const a = rand() * PI * 2, r = 6 + rand() * 8; treeInto(g, Math.cos(a) * r, -Math.abs(Math.sin(a) * r) - 2, rand); }
      const pond = mesh(geo("pond", () => new THREE.CircleGeometry(2.4, 24)), mat("#5aa9d6", { rough: 0.1, metal: 0.2 }), 5, 0.02, -6, g, { cast: false }); pond.rotation.x = -PI / 2;
      for (let i = 0; i < 5; i++) placeProp("flowers", -6 + rand() * 12, -3 - rand() * 4);
      streetlight(g, -4, -1.5, night); clouds(g, rand, night);
      break;
    }
    case "house_inside": {
      room({ floor: "#b98a5b", wall: "#efe6d8", wall2: "#e3d7c3" });
      const s = placeProp("sofa", -1.6, -3.6, 0, { c: "#9c4f46" }); add("sofa", -1.6, -3.4, { seat: s.userData.seat });
      const ch = placeProp("chair", 2.6, -2.4, -0.6); add("chair", 2.6, -2.35, { seat: ch.userData.seat, rotY: -0.6 });
      placeProp("tv", 2.4, -4.2, -0.2, { on: night }); placeProp("lamp", -3.4, -3.8);
      const rug = mesh(geo("rug", () => new THREE.PlaneGeometry(3.2, 2.2)), mat("#c9a26b"), -0.5, 0.012, -2.2, g, { cast: false }); rug.rotation.x = -PI / 2;
      block(g, 1.0, 0.35, 0.6, "#8b5e3c", -1.5, 0, -2.3);
      for (const x of [-2.6, -0.4]) block(g, 0.7, 0.5, 0.04, ["#e76f51", "#2a9d8f"][x < -1 ? 0 : 1], x, 1.7, -4.36, { r: 0.01 });
      const dr = placeProp("door", -4.38, -1.2, PI / 2); add("door", -3.6, -1.2);
      add("table", 0.3, -1.6); add("window", 1.8, -3.6);
      break;
    }
    case "bedroom": {
      room({ floor: "#a98262", wall: "#c9d8ee", wall2: "#b9cbe6" });
      const b = placeProp("bed", 1.9, -3.0, 0, { blanket: "#e07a5f" }); add("bed", 1.9, -2.7, { seat: b.userData.seat, lie: b.userData.lie });
      block(g, 0.5, 0.5, 0.45, "#8b5e3c", 0.9, 0, -3.9); placeProp("lamp", 0.9, -3.9, 0, {}).scale.setScalar(0.5);
      block(g, 1.3, 2.0, 0.6, "#7d5a44", -3.4, 0, -3.8);
      const d = placeProp("desk", -1.4, -3.9); add("desk", -1.4, -3.3); const c = placeProp("chair", -1.4, -3.3, PI); add("chair", -1.4, -3.3, { seat: c.userData.seat, rotY: PI });
      for (const [i, x] of [-0.4, 0.4].entries()) block(g, 0.55, 0.75, 0.03, ["#f4a261", "#9b5de5"][i], x + 0.0, 1.55, -4.37, { r: 0.01 });
      const rug = mesh(geo("rug2", () => new THREE.CircleGeometry(1.2, 24)), mat("#f2cc8f"), 0, 0.012, -1.6, g, { cast: false }); rug.rotation.x = -PI / 2;
      add("window", 1.8, -3.6); add("door", -3.6, -1.2);
      break;
    }
    case "bathroom": {
      const tile = tex("btile", 128, 128, (c, W) => { c.fillStyle = "#dfeef0"; c.fillRect(0, 0, W, W); c.strokeStyle = "#b8cfd3"; c.lineWidth = 3; for (let i = 0; i <= W; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, W); c.moveTo(0, i); c.lineTo(W, i); c.stroke(); } }, { repeat: [4, 2] });
      room({ floor: "#d6dbe0", wall: "#dfeef0", floorTex: "tile", w: 7, d: 6, windowBack: false });
      mesh(geo("btw", () => new THREE.PlaneGeometry(7, 3.2)), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.4 }), 0, 1.6, -3.39, g, { cast: false });
      block(g, 1.1, 0.85, 0.55, "#ffffff", 0, 0, -3.15, { r: 0.05 }); block(g, 0.5, 0.08, 0.35, "#e9eef2", 0, 0.85, -3.1, { r: 0.03 });
      if (!ctx.inMirror) {
        block(g, 1.3, 1.3, 0.05, "#7a6a5a", 0, 1.15, -3.35, { r: 0.03 });
        mesh(rbox(1.16, 1.16, 0.02, 0.01), mat("#cfe3ec", { rough: 0.05, metal: 0.9 }), 0, 1.8, -3.31, g, { cast: false });
      } else {
        // cut a mirror-shaped opening; behind it a darker copy of the room = the world inside the mirror
        ctx.g.children.filter((o) => o.position.z < -3.3 && o.position.z > -3.6 && o.geometry?.parameters?.width >= 6.9).forEach((o) => o.visible = false);
        const wm = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.4 });
        for (const [w2, h2, x2, y2] of [[2.8, 3.2, -2.1, 1.6], [2.8, 3.2, 2.1, 1.6], [1.4, 1.15, 0, 0.575], [1.4, 0.95, 0, 2.725]]) mesh(rbox(w2, h2, 0.2, 0.01), wm, x2, y2, -3.4, g);
        const fr = mat("#7a6a5a"); for (const [w2, h2, x2, y2] of [[1.5, 0.1, 0, 2.25], [1.5, 0.1, 0, 1.15], [0.1, 1.2, -0.72, 1.7], [0.1, 1.2, 0.72, 1.7]]) mesh(rbox(w2, h2, 0.1, 0.02), fr, x2, y2, -3.28, g);
        const back2 = mesh(rbox(7, 3.2, 0.2, 0.01), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.4, color: "#9fb4c4" }), 0, 1.6, -5.6, g);
        for (const sx of [-1, 1]) mesh(rbox(0.2, 3.2, 2.2, 0.01), mat("#9fb4c4"), sx * 3.5, 1.6, -4.5, g);
        const fl2 = mesh(geo("mfl", () => new THREE.PlaneGeometry(7, 2.2)), mat("#aeb6bf"), 0, 0.001, -4.5, g, { cast: false }); fl2.rotation.x = -PI / 2;
        mesh(geo("mglass", () => new THREE.PlaneGeometry(1.4, 1.1)), new THREE.MeshStandardMaterial({ color: "#d7ecf5", roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }), 0, 1.7, -3.3, g, { cast: false, receive: false });
        const ml = new THREE.PointLight("#bcd8ff", 3, 5, 2); ml.position.set(0, 2.2, -4.6); g.add(ml);
      }
      block(g, 1.7, 0.6, 0.8, "#ffffff", 2.5, 0, -2.9, { r: 0.18 });
      block(g, 0.5, 0.4, 0.06, "#7fb7be", -1.6, 1.3, -3.35, { r: 0.02 });
      add("mirror", 0, -2.3, { rotY: PI }); add("in_mirror", 0, -4.15, { inMirror: true, y: 0.25 }); add("door", -3.0, -1.2);
      break;
    }
    case "kitchen": {
      room({ floor: "#e8e2d6", wall: "#f6e7cf", floorTex: "tile" });
      for (let i = -3; i <= 1; i++) { block(g, 1.0, 0.9, 0.65, "#ffffff", i * 1.0, 0, -4.0, { r: 0.02 }); block(g, 1.02, 0.05, 0.68, "#6b6b6b", i * 1.0, 0.9, -4.0, { r: 0.01 }); block(g, 1.0, 0.7, 0.4, "#ffffff", i * 1.0, 1.7, -4.2, { r: 0.02 }); }
      block(g, 0.95, 2.0, 0.7, "#d9dde1", 2.9, 0, -3.9, { r: 0.05, metal: 0.4, rough: 0.35 });
      const t = placeProp("table", 0.2, -1.8); add("table", 0.2, -1.2);
      for (const [x, z, r] of [[-0.8, -1.8, PI / 2], [1.2, -1.8, -PI / 2]]) placeProp("chair", x, z, r);
      add("chair", -0.8, -1.8, { seat: 0.5, rotY: PI / 2 }); add("window", 1.8, -3.6);
      break;
    }
    case "classroom": {
      room({ floor: "#c7b299", wall: "#f0e9d8", w: 10, d: 8, windowBack: false });
      block(g, 4.2, 1.6, 0.06, "#2f4f3e", 0, 0.9, -5.4, { r: 0.02 });
      block(g, 4.3, 0.08, 0.15, "#8b5e3c", 0, 0.85, -5.35);
      const td = placeProp("desk", 2.6, -4.4, 0); add("desk", 2.6, -3.8);
      for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c++) { placeProp("desk", c * 2.0, -3.0 + r * 1.6); placeProp("chair", c * 2.0, -2.5 + r * 1.6, PI); }
      add("chair", 0, -2.5 + 1.6, { seat: 0.5, rotY: PI }); add("desk", 0, -1.4);
      for (const z of [-4.5, -2.0]) windowOn(g, -4.88, 1.7, z, ctx, PI / 2);
      placeProp("clock", 3.6, -5.33).position.y = 2.5;
      break;
    }
    case "school_hall": {
      room({ floor: "#d9d4c7", wall: "#e8e3d6", w: 10, d: 9, floorTex: "tile", windowBack: false });
      const lc = ["#3a86ff", "#3a86ff", "#3a86ff", "#ef476f"];
      for (let i = -9; i <= 9; i++) { block(g, 0.55, 1.9, 0.5, lc[Math.abs(i) % 4], i * 0.58 * 0.5 - 0.0, 0, -6.2, { r: 0.02, rough: 0.5, metal: 0.3 }); }
      placeProp("door", 4.88, -3.5, -PI / 2); add("door", 4.0, -3.5);
      break;
    }
    case "stadium": {
      const grass = tex("pitch", 256, 256, (c, W) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#4e9a45" : "#58a74c"; c.fillRect(0, i * 32, W, 32); } }, { repeat: [1, 6] });
      ground(null, 80, 80, grass);
      const line = (w, d, x, z) => mesh(geo(`ln${w}x${d}`, () => new THREE.PlaneGeometry(w, d)), mat("#ffffff"), x, 0.02, z, g, { cast: false }).rotation.x = -PI / 2;
      line(16, 0.1, 0, -6); line(8, 0.1, 0, -2.0); line(0.1, 4.0, -4, -4.0); line(0.1, 4.0, 4, -4.0);
      mesh(geo("spot", () => new THREE.CircleGeometry(0.12, 16)), mat("#ffffff"), 0, 0.021, -0.5, g, { cast: false }).rotation.x = -PI / 2;
      const goal = placeProp("goal", 0, -6.05); add("goal", 0, -5.6); add("penalty_spot", 0, 0.1);
      const bm = mat("#7b8794");
      for (let r = 0; r < 7; r++) block(g, 40, 0.5, 1.0, r % 2 ? "#6c7a89" : "#7b8794", 0, r * 0.5, -12 - r * 1.0, { r: 0.01 });
      for (let r = 0; r < 7; r++) for (const sx of [-1, 1]) { const st = block(g, 1.0, 0.5, 24, r % 2 ? "#6c7a89" : "#7b8794", sx * (13 + r * 1.0), r * 0.5, -2, { r: 0.01 }); }
      ctx.crowd = crowd(g, 420, { x0: -18, x1: 18, y0: 0.5, dy: 0.5, z0: -12.0, dz: 1.0, rows: 7 }, rand);
      block(g, 18, 0.7, 0.1, "#1d3557", 0, 0, -8.5, { r: 0.01 }); block(g, 6, 0.7, 0.11, "#e63946", -6, 0, -8.48, { r: 0.01 });
      for (const sx of [-14, 14]) { block(g, 0.4, 14, 0.4, "#555", sx, 0, -16); mesh(rbox(3, 1.4, 0.3, 0.05), mat("#fff", { emissive: "#ffffff", ei: night ? 3 : 0.4 }), sx, 14.3, -15.8, g, { cast: false }); }
      block(g, 6, 2.4, 0.3, "#111", 9, 9, -19, { r: 0.05 });
      add("stands", 4.0, -14.0, { y: 1.5, seat: 1.5 + 0.0, rotY: 0 });
      if (night) { const fl = new THREE.SpotLight("#ffffff", 140, 60, 0.6, 0.6, 1.2); fl.position.set(-14, 15, -14); fl.target.position.set(0, 0, -3); g.add(fl, fl.target); }
      break;
    }
    case "hospital": {
      room({ floor: "#dfe6e9", wall: "#d8eeea", floorTex: "tile" });
      const b = placeProp("bed", 0.8, -2.6, 0, { blanket: "#cfe3f0" }); add("bed", 0.8, -2.4, { seat: b.userData.seat, lie: b.userData.lie });
      b.children.forEach((m) => { if (m.material?.color?.getHexString?.() === "7a5132") m.material = mat("#c9ced3", { metal: 0.6, rough: 0.35 }); });
      placeProp("monitor", 2.0, -3.4, -0.4);
      block(g, 0.05, 1.9, 0.05, "#aab2b8", -0.4, 0, -3.2); block(g, 0.25, 0.35, 0.08, "#e8f4ff", -0.4, 1.6, -3.2, { opacity: 0.8 });
      const ch = placeProp("chair", -0.9, -1.8, 0.4, { c: "#7aa3b8" }); add("chair", -0.9, -1.8, { seat: 0.5, rotY: 0.4 });
      block(g, 0.05, 2.3, 3.4, "#b9e0dc", -3.0, 0, -2.6, { r: 0.01, opacity: 0.9 });
      add("window", 1.8, -3.6); add("door", -3.6, -1.2);
      break;
    }
    case "attic": {
      const f = tex("woodA", 256, 256, (c, W) => { c.fillStyle = "#8a6a4a"; c.fillRect(0, 0, W, W); for (let i = 0; i < 8; i++) { c.fillStyle = "rgba(0,0,0,0.2)"; c.fillRect(0, i * 32 + 30, W, 2); } }, { repeat: [3, 3] });
      const fl = mesh(geo("af", () => new THREE.PlaneGeometry(10, 9)), new THREE.MeshStandardMaterial({ map: f, roughness: 0.9 }), 0, 0, -2, g, { cast: false }); fl.rotation.x = -PI / 2;
      for (const sx of [-1, 1]) { const r = mesh(rbox(0.15, 6.5, 9, 0.01), mat("#6e5236"), sx * 2.7, 2.2, -2, g); r.rotation.z = sx * 0.75; }
      for (let i = 0; i < 6; i++) { const bm2 = mesh(rbox(0.2, 0.2, 5.5, 0.02), mat("#5b432c"), 0, 3.85, -2, g); bm2.position.z = -5 + i * 1.6; bm2.rotation.y = PI / 2; }
      block(g, 8, 3.8, 0.2, "#6e5236", 0, 0, -6.3);
      windowOn(g, 0, 2.2, -6.18, ctx, 0, 0.8);
      const bx = [[-2.2, -4.5], [-1.6, -4.8], [-2.0, -4.6], [1.8, -3.8], [2.2, -4.6]];
      bx.forEach(([x, z], i) => { const p = placeProp("box", x, z, rand() * 0.4); if (i === 2) p.position.y = 0.45; });
      add("box", 1.8, -3.0); ctx.inside = true; ctx.dusty = true;
      block(g, 0.9, 0.06, 0.9, "#3f2e20", 0, 0, 0.4); add("hatch", 0, 0.4);
      const l = new THREE.PointLight("#ffd9a0", 3, 8, 2); l.position.set(0, 3, -2); g.add(l);
      break;
    }
    case "night_road": {
      ground("#2f4a2f");
      mesh(geo("road2", () => new THREE.PlaneGeometry(6, 80)), mat("#3a3c42"), 0, 0.02, -20, g, { cast: false }).rotation.x = -PI / 2;
      for (let i = 0; i < 20; i++) mesh(geo("dash2", () => new THREE.PlaneGeometry(0.15, 1.4)), mat("#f2e6a6"), 0, 0.03, 2 - i * 4, g, { cast: false }).rotation.x = -PI / 2;
      for (let i = 0; i < 6; i++) streetlight(g, i % 2 ? 3.6 : -3.6, -i * 9, true).rotation.y = i % 2 ? PI : 0;
      for (let i = 0; i < 20; i++) treeInto(g, (rand() < 0.5 ? -1 : 1) * (6 + rand() * 8), -rand() * 50, rand, { kind: "pine" });
      const car = placeProp("car", 1.5, -6, 0, { night: true }); add("car", 0.3, -4.2);
      break;
    }
    case "forest": {
      ground("#3f6b3a");
      for (let i = 0; i < 40; i++) { const x = (rand() - 0.5) * 30, z = -2 - rand() * 25; if (Math.abs(x) < 2.2 && z > -6) continue; treeInto(g, x, z, rand, { kind: rand() < 0.6 ? "pine" : "round" }); }
      block(g, 1.6, 0.35, 0.35, "#5b3a24", -1.8, 0, -1.2, { r: 0.12 }); add("log", -1.8, -1.0, { seat: 0.35 });
      for (let i = 0; i < 6; i++) { block(g, 0.06, 0.12, 0.06, "#eee", (rand() - 0.5) * 6, 0, -rand() * 5); block(g, 0.16, 0.06, 0.16, "#d62828", (rand() - 0.5) * 6, 0.1, -rand() * 5, { r: 0.03 }); }
      ctx.fogExtra = 1;
      break;
    }
    case "graveyard": {
      ground("#4d6b45");
      for (let i = 0; i < 14; i++) { const p = placeProp("grave", -6 + (i % 7) * 2.0 + (rand() - 0.5) * 0.4, -3 - Math.floor(i / 7) * 3, (rand() - 0.5) * 0.2); }
      add("grave", 0, -2.0); placeProp("fence", 0, -10);
      treeInto(g, 5, -6, rand, { dead: true }); treeInto(g, -6, -8, rand, { dead: true });
      ctx.fogExtra = 1;
      break;
    }
    case "store": {
      room({ floor: "#e4e4e4", wall: "#f5f5f0", floorTex: "tile", w: 10, d: 8, windowBack: false });
      const cs = ["#e63946", "#f1c40f", "#2a9d8f", "#457b9d", "#f4a261", "#8e44ad"];
      for (const x of [-3, 0, 3]) { block(g, 2.2, 1.8, 0.6, "#cfd4da", x, 0, -4.5, { r: 0.02, metal: 0.3 }); for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) block(g, 0.3, 0.32, 0.3, cs[(k + r + Math.abs(x)) % 6], x - 0.9 + k * 0.36, 0.25 + r * 0.55, -4.3, { r: 0.02 }); }
      block(g, 2.2, 1.0, 0.7, "#8b5e3c", 2.6, 0, -1.8); add("counter", 2.6, -1.1);
      break;
    }
    case "rooftop": {
      ground("#8d8f94");
      for (const [x, w] of [[-6, 0.3], [6, 0.3]]) block(g, w, 0.9, 20, "#a3a6ab", x, 0, -4);
      block(g, 12.3, 0.9, 0.3, "#a3a6ab", 0, 0, -8);
      const bc = ["#3d405b", "#4a4e69", "#22223b", "#5c677d"];
      for (let i = 0; i < 26; i++) { const w = 2 + rand() * 3, h = 6 + rand() * 18, x = -30 + i * 2.4 + rand(), z = -20 - rand() * 25; const b = block(g, w, h, w, bc[i % 4], x, -10, z, { r: 0.02 }); if (night) for (let k = 0; k < 6; k++) mesh(rbox(0.3, 0.4, 0.02, 0.005), mat("#ffd27a", { emissive: "#ffc061", ei: 2 }), x - w / 3 + (k % 3) * w / 3, -10 + h * (0.3 + 0.2 * Math.floor(k / 3)), z + w / 2 + 0.02, g, { cast: false }); }
      block(g, 1.6, 2.2, 1.6, "#7a5c45", -4, 0, -6);
      add("ledge", 0, -7.4);
      break;
    }
    case "beach": {
      ground("#e9d3a1");
      const sea = mesh(geo("sea", () => new THREE.PlaneGeometry(120, 60, 1, 1)), mat("#3a9bd9", { rough: 0.15, metal: 0.2 }), 0, 0.02, -36, g, { cast: false }); sea.rotation.x = -PI / 2; ctx.sea = sea;
      placeProp("umbrella", 2.6, -1.8, 0, { c: "#ff6b6b" }); block(g, 1.6, 0.04, 0.8, "#4dabf7", 2.6, 0, -1.4, { r: 0.01 });
      clouds(g, rand, night);
      break;
    }
    default: { // void: an empty dreamlike space with a pool of light
      ground("#1a1c26");
      const disc = mesh(geo("disc", () => new THREE.CircleGeometry(3.2, 40)), mat("#2c3044", { rough: 0.6 }), 0, 0.01, 0, g, { cast: false }); disc.rotation.x = -PI / 2;
      ctx.voidSet = true;
    }
  }
  // default anchors
  const slots = { center: [0, 0], left: [-0.85, 0], right: [0.85, 0], far_left: [-1.8, 0.2], far_right: [1.8, 0.2], front: [0, 1.0],
    back: [0, -2.2], back_left: [-1.2, -2.2], back_right: [1.2, -2.2] };
  for (const [k, [x, z]] of Object.entries(slots)) if (!A[k]) add(k, x, z);
  for (const want of propsWanted) if (!ctx.props[want]) {
    const spot = { bench: [1.8, -0.6], bed: [1.9, -2.8], chair: [-1.5, -0.8], box: [1.6, -1.2], mirror: [0, -2.6], car: [3.5, -3], goal: [0, -6], door: [-2.5, -3] }[want] || [((Object.keys(ctx.props).length % 2) ? 1 : -1) * (1.6 + (Object.keys(ctx.props).length % 3) * 0.5), -1.0 - (Object.keys(ctx.props).length % 2)];
    const p = placeProp(want, spot[0], spot[1], 0);
    if (p && !A[want]) add(want, spot[0], spot[1] + (p.userData.seat ? 0.05 : 0.6), { seat: p.userData.seat, lie: p.userData.lie });
  }
  return A;
}
function windowOn(g, x, y, z, ctx, rotY = 0, s = 1) {
  const w = new THREE.Group(); w.position.set(x, y, z); w.rotation.y = rotY; g.add(w);
  const skyC = ctx.night ? "#1b2550" : ctx.time === "sunset" ? "#ffb07a" : "#bfe3ff";
  mesh(rbox(1.4 * s, 1.2 * s, 0.05, 0.01), mat(skyC, { emissive: skyC, ei: ctx.night ? 0.35 : 0.9 }), 0, 0, 0, w, { cast: false });
  for (const [ww, hh, xx, yy] of [[1.55, 0.08, 0, 0.62], [1.55, 0.08, 0, -0.62], [0.08, 1.3, -0.74, 0], [0.08, 1.3, 0.74, 0], [0.06, 1.2, 0, 0], [1.4, 0.06, 0, 0]])
    mesh(rbox(ww * s, hh * s, 0.1, 0.01), mat("#ffffff"), xx * s, yy * s, 0.03, w);
  if (!ctx.night) { const l = new THREE.SpotLight(ctx.time === "sunset" ? "#ffb27a" : "#fff4dc", 30, 12, 0.7, 0.8, 1.5); l.position.set(x + Math.sin(rotY) * 0.3, y + 0.6, z + Math.cos(rotY) * 0.3); l.target.position.set(x + Math.sin(rotY) * 4, 0, z + Math.cos(rotY) * 4); l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0005; g.add(l, l.target); }
}
function clouds(g, rand, night) {
  if (night) return;
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Group(); c.position.set(-25 + i * 8 + rand() * 4, 13 + rand() * 4, -30 - rand() * 10); g.add(c);
    for (let k = 0; k < 4; k++) mesh(rbox(2 + rand() * 2, 1 + rand() * 0.6, 1.6, 0.4), mat("#ffffff", { emissive: "#ffffff", ei: 0.25 }), k * 1.4 - 2, rand() * 0.5, rand() * 0.5, c, { cast: false });
  }
}

// ---------- sky + lighting
function skyTexture(time, mood) {
  return tex(`sky${time}${mood}`, 4, 256, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    const P = {
      day: ["#5aa6ff", "#a9d4ff", "#eaf6ff"], sunset: ["#2e3a78", "#ff8a5c", "#ffd59e"], night: ["#04061a", "#0f1a40", "#22305e"],
      dawn: ["#4b6cc1", "#f7a7a3", "#ffe1c4"],
    }[time] || ["#5aa6ff", "#a9d4ff", "#eaf6ff"];
    g.addColorStop(0, P[0]); g.addColorStop(0.55, P[1]); g.addColorStop(1, P[2]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    if (mood === "eerie_green") { c.fillStyle = "rgba(60,255,160,0.12)"; c.fillRect(0, 0, W, H); }
    if (mood === "red_alert") { c.fillStyle = "rgba(255,40,40,0.18)"; c.fillRect(0, 0, W, H); }
  });
}
function starsInto(scene, rand) {
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = rand() * PI * 2, e = 0.15 + rand() * 1.2; pos[i * 3] = Math.cos(a) * Math.cos(e) * 90; pos[i * 3 + 1] = Math.sin(e) * 90; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 90 - 20; }
  const geom = new THREE.BufferGeometry(); geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geom, new THREE.PointsMaterial({ color: "#ffffff", size: 0.35, sizeAttenuation: true, fog: false })));
  const moon = mesh(geo("moon", () => new THREE.SphereGeometry(3, 24, 16)), new THREE.MeshBasicMaterial({ color: "#f3f1e7", fog: false }), -30, 40, -70, scene, { cast: false });
}
function lightScene(scene, shot, ctx) {
  const time = shot.time, mood = shot.mood_light || "normal";
  const L = {
    day: { sky: "#cfe6ff", gnd: "#8c7b5c", hi: 1.25, sun: "#fff1dc", si: 2.6, sp: [6, 11, 7] },
    sunset: { sky: "#ffb38a", gnd: "#4a3550", hi: 0.85, sun: "#ff9a5c", si: 2.4, sp: [-9, 4.5, 4] },
    night: { sky: "#5a78c0", gnd: "#1a1d33", hi: 0.6, sun: "#a9c1ff", si: 0.75, sp: [-6, 9, 6] },
    dawn: { sky: "#ffc6b0", gnd: "#4b4a66", hi: 0.8, sun: "#ffd0a8", si: 1.7, sp: [8, 4, 5] },
  }[time] || null;
  const l = L || { sky: "#cfe6ff", gnd: "#8c7b5c", hi: 1.2, sun: "#fff1dc", si: 2.5, sp: [6, 11, 7] };
  const tint = { warm: "#ffb070", cold: "#7fb2ff", eerie_green: "#5dffb0", red_alert: "#ff3b3b", dreamy: "#d7a8ff" }[mood];
  const hemi = new THREE.HemisphereLight(l.sky, l.gnd, ctx.inside ? l.hi * 0.8 : l.hi); scene.add(hemi);
  const sun = new THREE.DirectionalLight(l.sun, ctx.inside ? l.si * 0.35 : l.si);
  sun.position.set(...l.sp); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 0.5; sc.far = 60;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(tint || (time === "night" ? "#6f8cff" : "#ffe6cc"), tint ? 1.3 : 0.45); fill.position.set(-4, 3, 8); scene.add(fill);
  const rim = new THREE.DirectionalLight(time === "night" ? "#88aaff" : "#ffffff", time === "night" ? 0.9 : 0.6); rim.position.set(0, 5, -9); scene.add(rim);
  if (ctx.voidSet) { const sp = new THREE.SpotLight(tint || "#ffffff", 38, 20, 0.45, 0.6, 1.3); sp.position.set(0, 9, 2); sp.target.position.set(0, 0, 0); sp.castShadow = true; scene.add(sp, sp.target); hemi.intensity = 0.15; sun.intensity = 0.2; }
  let pulse = null;
  if (mood === "red_alert") { pulse = new THREE.PointLight("#ff2020", 0, 14, 2); pulse.position.set(0, 2.8, 0); scene.add(pulse); }
  return { hemi, sun, fill, rim, pulse };
}

// ---------- particles
function particles(scene, kind, n, area, rand) {
  const pos = new Float32Array(n * 3), seeds = [];
  for (let i = 0; i < n; i++) { seeds.push([area.x0 + rand() * (area.x1 - area.x0), area.y0 + rand() * (area.y1 - area.y0), area.z0 + rand() * (area.z1 - area.z0), rand()]); }
  const geom = new THREE.BufferGeometry(); geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const M = {
    snow: { color: "#ffffff", size: 0.07 }, rain: { color: "#b8d4ff", size: 0.05 }, dust: { color: "#ffe9b8", size: 0.035 },
    sparkles: { color: "#ffe066", size: 0.08 }, fireflies: { color: "#e8ff8a", size: 0.09 },
  }[kind];
  const dot = tex("dot", 64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.8)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const pts = new THREE.Points(geom, new THREE.PointsMaterial({ map: dot, alphaTest: 0.01, color: M.color, size: M.size * 1.6, transparent: true, opacity: kind === "dust" ? 0.6 : 0.95, depthWrite: false, blending: kind === "rain" ? THREE.NormalBlending : THREE.AdditiveBlending }));
  scene.add(pts);
  let streaks = null;
  if (kind === "rain") {
    streaks = new THREE.InstancedMesh(geo("drop", () => new THREE.BoxGeometry(0.012, 0.35, 0.012)), new THREE.MeshBasicMaterial({ color: "#b9cfef", transparent: true, opacity: 0.55 }), n);
    scene.add(streaks); pts.visible = false;
  }
  const m4 = new THREE.Matrix4(), H = area.y1 - area.y0;
  return (t) => {
    for (let i = 0; i < n; i++) {
      const [x, y, z, s] = seeds[i];
      let px = x, py = y, pz = z;
      if (kind === "snow") { py = area.y0 + ((y - area.y0 - t * (0.5 + s * 0.4)) % H + H) % H; px = x + Math.sin(t * 0.8 + s * 10) * 0.25; }
      else if (kind === "rain") { py = area.y0 + ((y - area.y0 - t * (9 + s * 3)) % H + H) % H; }
      else if (kind === "sparkles") { py = area.y0 + ((y - area.y0 + t * (0.4 + s * 0.5)) % H + H) % H; px = x + Math.sin(t * 2 + s * 9) * 0.15; }
      else { px = x + Math.sin(t * 0.3 + s * 20) * 0.4; py = y + Math.sin(t * 0.4 + s * 13) * 0.3; pz = z + Math.cos(t * 0.25 + s * 7) * 0.4; }
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
      if (streaks) { m4.makeTranslation(px, py, pz); streaks.setMatrixAt(i, m4); }
    }
    geom.attributes.position.needsUpdate = true; if (streaks) streaks.instanceMatrix.needsUpdate = true;
    if (kind === "fireflies" || kind === "sparkles") pts.material.opacity = 0.6 + Math.sin(t * 3) * 0.35;
  };
}

// ---------- one shot = one scene of the story
function parseRef(s) { const m = String(s || "").split(":"); return { name: m[0].trim(), arg: (m[1] || "").trim() }; }
function buildShot(dir, shot, i) {
  const rand = rng(hash(JSON.stringify(shot)) + i);
  const scene = new THREE.Scene();
  const time = VOCAB.times.includes(shot.time) ? shot.time : "day", night = time === "night";
  const fx = (shot.fx || []).map((x) => String(x).toLowerCase());
  const has = (n) => fx.some((f) => f === n || f.startsWith(n + ":"));
  const chars = (shot.characters || []).filter((c) => c && c.id);
  const ctx = { g: new THREE.Group(), rand, night, time, props: {}, propsWanted: (shot.props || []).map(String), inside: false,
    inMirror: chars.some((c) => c.pos === "in_mirror") };
  scene.add(ctx.g);
  const setName = VOCAB.sets.includes(shot.set) ? shot.set : "void";
  const A = buildSet(setName, ctx);
  // sky / background / fog
  const sky = skyTexture(time, shot.mood_light);
  scene.background = ctx.voidSet ? new THREE.Color("#0b0c12") : sky;
  const fogC = new THREE.Color(ctx.voidSet ? "#0b0c12" : ({ day: "#d6ebff", sunset: "#f6b48b", night: "#141c3a", dawn: "#f2c6b4" }[time]));
  const foggy = has("fog") || shot.weather === "fog" || ctx.fogExtra;
  scene.fog = new THREE.Fog(fogC, ctx.inside ? 12 : foggy ? 3 : 16, ctx.inside ? 40 : foggy ? 22 : 70);
  if (night && !ctx.inside && !ctx.voidSet) starsInto(scene, rand);
  const lights = lightScene(scene, { ...shot, time }, ctx);
  // characters
  const cast = new Map((dir.cast || []).map((c) => [c.id, c]));
  const actors = [];
  chars.forEach((cs, k) => {
    const spec = { ...(cast.get(cs.id) || { id: cs.id, name: cs.id }) };
    if (has("button_grey")) spec.chest_button = spec.chest_button && spec.chest_button !== "none" ? "grey" : spec.chest_button;
    const c = buildCharacter(spec, rng(hash(cs.id)));
    const anchorName = parseRef(cs.pos).name;
    const an = A[anchorName] || A[["center", "left", "right", "far_left", "far_right"][k % 5]];
    c.base = an.p.clone(); if (an.y) c.base.y = an.y;
    const sharing = chars.filter((o) => (A[parseRef(o.pos).name] || null) === an), idx = sharing.indexOf(cs);
    if (sharing.length > 1 && idx >= 0) c.base.x += (idx - (sharing.length - 1) / 2) * (an.seat ? 0.62 : 0.8);
    c.anchor = an; c.cs = cs;
    c.pose = VOCAB.poses.includes(cs.pose) ? cs.pose : (an.lie && /sleep/.test(cs.action) ? "lie" : an.seat && cs.pose !== "stand" && /bench|bed|chair|sofa|stands|log/.test(anchorName) ? "sit" : "stand");
    c.root.position.copy(c.base);
    if (has(`ghost:${cs.id}`) || an.inMirror) ghostify(c);
    if (has("silhouette")) c.root.traverse((o) => { if (o.isMesh) o.material = mat("#0a0a10", { rough: 1 }); });
    ctx.g.add(c.root); actors.push(c);
  });
  const byId = new Map(actors.map((c) => [c.id, c]));
  // things held in hands
  for (const c of actors) {
    const hname = String(c.cs.holding || "none");
    if (hname !== "none") { const p = buildProp(hname, rand, { night }); if (p) { p.position.set(0, -0.06, 0.1); p.scale.setScalar(hname === "umbrella" ? 0.9 : 1); c.arms[1].hand.add(p); c.held = p; } }
  }
  // effects
  const updaters = [];
  const area = { x0: -9, x1: 9, y0: 0, y1: 8, z0: -10, z1: 4 };
  if (has("snow") || shot.weather === "snow") updaters.push(particles(scene, "snow", 900, area, rand));
  if (has("rain") || shot.weather === "rain" || shot.weather === "storm") updaters.push(particles(scene, "rain", 900, area, rand));
  if (has("dust") || ctx.dusty || has("god_rays")) updaters.push(particles(scene, "dust", 260, { x0: -3, x1: 3, y0: 0.3, y1: 3, z0: -4, z1: 1 }, rand));
  if (has("sparkles")) updaters.push(particles(scene, "sparkles", 220, { x0: -3, x1: 3, y0: 0, y1: 4, z0: -3, z1: 2 }, rand));
  if (has("fireflies")) updaters.push(particles(scene, "fireflies", 70, { x0: -5, x1: 5, y0: 0.3, y1: 2.6, z0: -6, z1: 1 }, rand));
  let spot = null;
  if (has("spotlight")) { spot = new THREE.SpotLight("#ffffff", 40, 20, 0.32, 0.55, 1.3); spot.position.set(0, 8, 2); spot.castShadow = true; scene.add(spot, spot.target); lights.hemi.intensity *= 0.25; lights.sun.intensity *= 0.2; }
  let police = null;
  if (has("police_lights")) { police = [new THREE.PointLight("#ff2030", 0, 16, 2), new THREE.PointLight("#2050ff", 0, 16, 2)]; police[0].position.set(-3, 2.5, 1); police[1].position.set(3, 2.5, 1); scene.add(...police); }
  if (has("god_rays") || (ctx.dusty && !night)) {
    const cone = mesh(geo("ray", () => new THREE.CylinderGeometry(0.4, 2.2, 7, 24, 1, true)), new THREE.MeshBasicMaterial({ color: "#fff1c9", transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }), 0.6, 2.8, -3.6, scene, { cast: false, receive: false });
    cone.rotation.x = 0.55; cone.rotation.z = -0.2;
  }
  // tears
  const tearSets = [];
  for (const c of actors) if (/cry/.test(c.cs.action || "") || c.cs.expression === "crying" || has("tears")) {
    if (!(/cry/.test(c.cs.action || "") || c.cs.expression === "crying")) continue;
    const drops = [];
    for (let k = 0; k < 6; k++) { const d = mesh(geo("tear", () => new THREE.SphereGeometry(0.018, 8, 6)), new THREE.MeshStandardMaterial({ color: "#9fd3ff", emissive: "#6fb6ff", emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.9 }), 0, 0, 0, scene, { cast: false }); drops.push({ d, ph: k / 6, side: k % 2 ? 1 : -1 }); }
    tearSets.push({ c, drops });
  }
  return { scene, actors, byId, A, ctx, fx, has, lights, updaters, spot, police, tearSets, shot, setName, rand, night };
}
const GHOST = new Map();
function ghostify(c) {
  c.root.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => { if (!GHOST.has(m)) { const g2 = m.clone(); g2.transparent = true; g2.opacity = 0.68; g2.emissive = new THREE.Color("#8fc2ff"); g2.emissiveIntensity = 0.55; g2.depthWrite = false; GHOST.set(m, g2); } return GHOST.get(m); };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.castShadow = false;
  });
  c.ghost = true;
  // keep the face texture swap working on the ghost face material
  const fm = c.head.children[0].material[4]; c.faceM = fm;
  c.setFace = (expr, blink) => { const m = faceTexture(c.skin, expr, blink ? 1 : 0, c.extras, c.hairCol); if (fm.map !== m) { fm.map = m; fm.needsUpdate = true; } };
}

// "Cheat to camera": people facing each other also turn partly toward the lens so their faces read
function cheat(yaw, k) { const y = Math.atan2(Math.sin(yaw), Math.cos(yaw)); if (Math.abs(y) > PI * 0.75) return y; return y * (1 - k); }
// ---------- animating a shot at time t (seconds) of dur
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function facingYaw(c, shot, S) {
  const f = String(c.cs.facing || "camera");
  if (f.startsWith("other:") || S.byId.has(f)) { const o = S.byId.get(f.replace("other:", "")); if (o) return cheat(Math.atan2(o.root.position.x - c.root.position.x, o.root.position.z - c.root.position.z), 0.4); }
  if (/^-?\d+(\.\d+)?$/.test(f)) return (Number(f) * PI) / 180;   // an exact angle in degrees (0 = toward camera)
  if (c.anchor.rotY != null && f === "camera") return c.anchor.rotY;
  return { camera: 0, left: -PI / 2, right: PI / 2, away: PI, back: PI }[f] ?? 0;
}
function animate(S, t, dur) {
  const slow = S.has("slowmo") ? 0.45 : 1, rew = S.has("rewind");
  const p0 = clamp(t / dur), p = rew ? 1 - p0 : p0, T = rew ? (dur - t) * slow : t * slow;
  const freeze = S.has("freeze");
  // first place everyone at their base so "look at" and "hug" use current positions
  for (const c of S.actors) { c.reset(); c.root.position.copy(c.base); }
  for (const c of S.actors) {
    const cs = c.cs, act = parseRef(cs.action || "idle"), D = c.D;
    let yaw = facingYaw(c, S.shot, S), expr = VOCAB.expressions.includes(cs.expression) ? cs.expression : "neutral";
    const tt = freeze && act.name !== "stare" ? 0.0 : T;
    const breathe = Math.sin(tt * 2.1 + c.seed % 7) * 0.012;
    c.spine.rotation.x += breathe; c.arms[0].g.rotation.z = 0.06 + breathe; c.arms[1].g.rotation.z = -0.06 - breathe;
    c.neck.rotation.y = noise(tt * 0.35, c.seed % 13) * 0.12;
    // pose
    const seatY = c.anchor.seat ?? 0;
    const sit = (k = 1) => {
      const hipY = seatY > 0 ? seatY : D.legW * 0.6;
      c.body.position.y = lerp(0, hipY - D.legH, k);
      for (const l of c.legs) l.rotation.x = -PI / 2 * k + (seatY > 0.3 ? 0.0 : 0);
      if (seatY > 0.3) { for (const l of c.legs) l.rotation.x = -PI / 2 * k; }
    };
    if (c.pose === "sit") sit(1);
    if (c.pose === "kneel") { c.body.position.y = -D.legH * 0.55; for (const l of c.legs) l.rotation.x = PI * 0.45; }
    if (c.pose === "lie") { const ly = c.anchor.lie ?? 0.05; c.root.rotation.x = -PI / 2; c.root.position.y = ly + D.torsoD * 0.5; c.root.position.z = c.base.z + (c.anchor.lie ? 0.6 : 0.5); }
    // walking helpers
    const walk = (k, speed = 7, amp = 0.55) => { const ph = tt * speed; c.legs[0].rotation.x = Math.sin(ph) * amp * k; c.legs[1].rotation.x = -Math.sin(ph) * amp * k; c.arms[0].g.rotation.x = -Math.sin(ph) * amp * 0.8 * k; c.arms[1].g.rotation.x = Math.sin(ph) * amp * 0.8 * k; c.body.position.y += Math.abs(Math.sin(ph)) * 0.045 * k; };
    const travel = (from, to, a, b, speed, run) => {
      const k = seg(p, a, b), e = ease(k);
      c.root.position.lerpVectors(from, to, e);
      const moving = k > 0 && k < 1;
      if (moving) { walk(1, speed, run ? 0.85 : 0.55); yaw = Math.atan2(to.x - from.x, to.z - from.z); if (run) c.spine.rotation.x += 0.18; }
      return k;
    };
    const R = c.arms[1].g, Lf = c.arms[0].g;
    switch (act.name) {
      case "walk_in": case "run_in": { const side = c.base.x <= 0 ? -1 : 1; const from = c.base.clone().add(tmpV.set(side * 5, 0, 0.3)); const k = travel(from, c.base, 0, act.name === "run_in" ? 0.4 : 0.65, act.name === "run_in" ? 12 : 7, act.name === "run_in"); if (k >= 1) yaw = facingYaw(c, S.shot, S); break; }
      case "walk_out": { const side = c.base.x < 0 ? -1 : 1; travel(c.base, c.base.clone().add(tmpV.set(side * 5.5, 0, 0)), 0.2, 1, 7); break; }
      case "walk_toward_camera": { const k = travel(c.base.clone().add(tmpV.set(0, 0, -4)), c.base, 0, 0.85, 7); if (k >= 1) yaw = 0; break; }
      case "walk_away": { travel(c.base, c.base.clone().add(tmpV.set(0, 0, -5)), 0.15, 1, 6); break; }
      case "run_away": { travel(c.base, c.base.clone().add(tmpV.set(0, 0, -7)), 0.1, 1, 12, true); break; }
      case "wave": R.rotation.z = -2.55 + Math.sin(tt * 9) * 0.35; R.rotation.x = -0.2; if (expr === "neutral") expr = "smile"; break;
      case "point": { const k = ease(seg(p, 0.1, 0.3)); R.rotation.x = -1.45 * k; R.rotation.z = -0.1 * k; break; }
      case "reach": { const k = ease(seg(p, 0.05, 0.8)); R.rotation.x = -1.35 * k; Lf.rotation.x = -0.6 * k; c.spine.rotation.x += 0.12 * k; break; }
      case "press_button": {
        const k = ease(seg(p, 0.15, 0.4)); R.rotation.x = -0.95 * k; R.rotation.z = 0.85 * k; R.rotation.y = -0.3 * k;
        if (c.button && p > 0.38) { c.button.position.z = c.D.torsoD / 2 + 0.02 - 0.015 * Math.min(1, (p - 0.38) * 20); }
        break;
      }
      case "kick": {
        const run = seg(p, 0.0, 0.42), sw = seg(p, 0.42, 0.55), fol = seg(p, 0.55, 0.8);
        if (run > 0 && run < 1) { c.root.position.z = c.base.z + 1.4 * (1 - ease(run)); walk(1, 11, 0.7); }
        else if (run < 1e-6) { c.root.position.z = c.base.z + 1.4; }
        const leg = c.legs[1];
        if (sw > 0) leg.rotation.x = lerp(0.9, -1.4, ease(sw)) * (1 - fol) + (-0.2) * fol;
        if (sw > 0) { R.rotation.z = -0.9; Lf.rotation.z = 0.7; c.spine.rotation.x -= 0.15 * (1 - fol); }
        yaw = PI; // facing the goal (away from camera)
        break;
      }
      case "cry": case "hide_face": { c.neck.rotation.x += 0.42; R.rotation.x = -2.25; R.rotation.z = 0.55; Lf.rotation.x = -2.25; Lf.rotation.z = -0.55; c.spine.rotation.x += 0.15; c.spine.rotation.z = Math.sin(tt * 18) * 0.025 * (act.name === "cry" ? 1 : 0); if (expr === "neutral") expr = "crying"; break; }
      case "hug": case "tap_shoulder": {
        const o = S.byId.get(act.arg) || S.actors.find((x) => x !== c);
        if (o) {
          const target = o.base.clone(); const dirv = tmpV2.subVectors(c.base, target); dirv.y = 0; const dl = dirv.length() || 1; dirv.multiplyScalar(1 / dl);
          const stop = target.clone().add(dirv.multiplyScalar(act.name === "hug" ? 0.5 : 0.75));
          const k = travel(c.base, stop, 0, 0.45, 6);
          yaw = cheat(Math.atan2(target.x - c.root.position.x, target.z - c.root.position.z), 0.22);
          if (k >= 1) { const h2 = ease(seg(p, 0.45, 0.6)); if (act.name === "hug") { R.rotation.x = -1.35 * h2; R.rotation.z = 0.45 * h2; Lf.rotation.x = -1.35 * h2; Lf.rotation.z = -0.45 * h2; c.spine.rotation.x += 0.1 * h2; } else { R.rotation.x = -1.6 * h2; } }
        }
        break;
      }
      case "nod": c.neck.rotation.x += Math.max(0, Math.sin(tt * 5.5)) * 0.3 * (p < 0.75 ? 1 : 0); break;
      case "shake_head": c.neck.rotation.y = Math.sin(tt * 7) * 0.38 * (p < 0.8 ? 1 : 0); if (expr === "neutral") expr = "sad"; break;
      case "look_around": c.neck.rotation.y = Math.sin(tt * 1.4) * 0.75; c.neck.rotation.x += Math.sin(tt * 0.9) * 0.1; if (expr === "neutral") expr = "worried"; break;
      case "look_up": c.neck.rotation.x -= 0.45 * ease(seg(p, 0, 0.3)); break;
      case "look_down": c.neck.rotation.x += 0.45 * ease(seg(p, 0, 0.3)); break;
      case "jump": { const k = Math.max(0, Math.sin(tt * 4.5)); c.body.position.y += k * 0.55; R.rotation.z = -2.3 * k; Lf.rotation.z = 2.3 * k; for (const l of c.legs) l.rotation.x = -0.3 * k; break; }
      case "cheer": { const k = Math.abs(Math.sin(tt * 5)); c.body.position.y += k * 0.25; R.rotation.z = -2.8; Lf.rotation.z = 2.8; R.rotation.x = Lf.rotation.x = Math.sin(tt * 10) * 0.2; if (expr === "neutral") expr = "happy"; break; }
      case "dance": { c.body.position.y += Math.abs(Math.sin(tt * 6)) * 0.12; c.body.rotation.z = Math.sin(tt * 6) * 0.12; R.rotation.z = -1.5 - Math.sin(tt * 6) * 0.8; Lf.rotation.z = 1.5 - Math.sin(tt * 6 + 1) * 0.8; if (expr === "neutral") expr = "happy"; break; }
      case "clap": { R.rotation.x = -1.2; Lf.rotation.x = -1.2; const k = Math.abs(Math.sin(tt * 9)); R.rotation.z = 0.35 + 0.35 * k; Lf.rotation.z = -0.35 - 0.35 * k; if (expr === "neutral") expr = "happy"; break; }
      case "fall": { const k = ease(seg(p, 0.25, 0.55)); c.root.rotation.x = PI / 2 * k * 0.98; c.root.position.y = 0.17 * k; c.root.position.z = c.base.z + k * 0.6; R.rotation.z = -1.2 * k; Lf.rotation.z = 1.2 * k; if (expr === "neutral") expr = "shocked"; break; }
      case "hold_object": R.rotation.x = -0.95; Lf.rotation.x = -0.95; R.rotation.z = 0.3; Lf.rotation.z = -0.3; c.neck.rotation.x += 0.25; break;
      case "think": R.rotation.x = -1.9; R.rotation.z = 0.75; c.neck.rotation.x -= 0.08; c.neck.rotation.z = 0.12; if (expr === "neutral") expr = "confused"; break;
      case "hands_on_head": R.rotation.z = -2.6; R.rotation.x = -0.5; Lf.rotation.z = 2.6; Lf.rotation.x = -0.5; if (expr === "neutral") expr = "shocked"; break;
      case "shiver": c.body.position.x = Math.sin(tt * 45) * 0.012; R.rotation.x = -1.0; R.rotation.z = 1.0; Lf.rotation.x = -1.0; Lf.rotation.z = -1.0; if (expr === "neutral") expr = "scared"; break;
      case "turn_around": { const k = ease(seg(p, 0.2, 0.55)); yaw = lerp(facingYaw(c, S.shot, S) + PI, facingYaw(c, S.shot, S), k); break; }
      case "sit_down": { sit(ease(seg(p, 0.15, 0.55))); break; }
      case "stand_up": { sit(1 - ease(seg(p, 0.2, 0.6))); break; }
      case "sleep": expr = "eyes_closed"; break;
      case "push_door": { const k = ease(seg(p, 0.1, 0.5)); R.rotation.x = -1.4 * k; c.root.position.z = c.base.z - 0.4 * k; break; }
      case "stare": break;
      default: break;
    }
    c.root.rotation.y = yaw;
    // the button glows when pressed or asked
    if (c.button && c.button.material.emissiveIntensity != null && c.spec.chest_button !== "grey") {
      const glow = S.has("glow_button") || act.name === "press_button" ? 0.95 + Math.sin(tt * 6) * 0.35 : 0.55;
      c.button.material.emissiveIntensity = glow; if (c.buttonLight) c.buttonLight.intensity = glow * 0.12;
    }
    // blinking (never while eyes are closed)
    const bt = (tt + (c.seed % 97) / 31) % 3.4;
    c.setFace(expr, expr !== "eyes_closed" && !freeze && bt < 0.13);
    if (c.held?.userData?.float) c.held.position.y = Math.sin(tt * 1.5) * 0.05;
  }
  // props that move
  const ballP = S.ctx.props.ball;
  const kicker = S.actors.find((c) => parseRef(c.cs.action).name === "kick");
  if (ballP && kicker) {
    const b = ballP, start = kicker.base.clone().add(tmpV.set(0, 0, -0.25));
    const goal = S.ctx.props.goal; const post = goal ? goal.localToWorld(goal.userData.post.clone()) : start.clone().add(tmpV2.set(-1.8, 1.1, -6));
    const miss = S.has("ball_hits_post") || !S.has("goal_scored"), into = goal ? goal.localToWorld(new THREE.Vector3(1.0, 0.9, -0.8)) : post;
    const k1 = seg(p, 0.5, 0.68), k2 = seg(p, 0.68, 1);
    if (k1 <= 0) b.position.copy(start);
    else if (k1 < 1 || !miss) { const to = miss ? post : into; const k = !miss ? seg(p, 0.5, 0.75) : k1; b.position.lerpVectors(start, to, k); b.position.y = lerp(start.y, to.y, k) + Math.sin(k * PI) * 0.6; b.rotation.x -= 0.3; }
    else { const bounce = post.clone().add(tmpV2.set(1.2 * k2 + 0.4, 0, 2.2 * k2)); b.position.lerpVectors(post, bounce, k2); b.position.y = Math.max(0.0, post.y * (1 - k2) + Math.sin(k2 * PI) * 0.5) * (1 - k2 * 0.6); }
  } else if (ballP && !ballP.userData.placed) { ballP.userData.placed = true; }
  for (const [n, p2] of Object.entries(S.ctx.props)) {
    if (p2.userData.animal) { const a = p2.userData.animal; a.tail.rotation.y = Math.sin(T * 12) * 0.6; a.hd.rotation.y = Math.sin(T * 0.8) * 0.3; a.body.position.y = Math.abs(Math.sin(T * 2.2)) * 0.01; }
    if (p2.userData.flicker) p2.userData.flicker.intensity = (n === "campfire" ? 10 : 2.5) * (0.85 + 0.15 * noise(T * 6, 3));
    if (p2.userData.fire) p2.userData.fire.scale.y = 1 + noise(T * 8, 2) * 0.18;
    if (p2.userData.swing) p2.userData.swing.rotation.x = Math.sin(T * 1.8) * 0.35;
    if (p2.userData.ekg) drawEKG(p2.userData.ekg, T, S.has("flatline") ? 0.35 : 2);
    if (p2.userData.hands) { p2.userData.hands[1].rotation.z = -T * 0.5; p2.userData.hands[0].rotation.z = -T * 0.04; }
  }
  if (S.ctx.crowd) S.ctx.crowd(T, S.has("crowd_cheer"));
  if (S.ctx.sea) S.ctx.sea.position.y = 0.02 + Math.sin(T * 0.8) * 0.02;
  for (const u of S.updaters) u(T);
  for (const ts of S.tearSets) {
    const hw = ts.c.headWorld(tmpV.clone());
    ts.drops.forEach((d) => { const k = ((T * 0.9 + d.ph) % 1); d.d.position.set(hw.x + d.side * ts.c.D.head * 0.17, hw.y - ts.c.D.head * 0.52 - k * 0.5, hw.z + ts.c.D.head * 0.44); d.d.material.opacity = 0.9 * (1 - k); });
  }
  if (S.lights.pulse) S.lights.pulse.intensity = 9 * (0.5 + 0.5 * Math.sin(T * 5));
  if (S.police) { const k = Math.floor(T * 4) % 2; S.police[0].intensity = k ? 22 : 0; S.police[1].intensity = k ? 0 : 22; }
  if (S.has("lightning")) { const f = (T % 3.7) < 0.08 || ((T + 0.15) % 3.7) < 0.05; S.lights.hemi.intensity = f ? 4 : (S.night ? 0.38 : 0.7); }
  if (S.spot) { const tg = S.actors[0]; if (tg) { S.spot.target.position.copy(tg.root.position); S.spot.position.set(tg.root.position.x, 8, tg.root.position.z + 2); } }
}
let ekgLast = new WeakMap();
function drawEKG(t, T, bpm) {
  const c = t.image.getContext("2d"), W = 256, H = 160;
  c.fillStyle = "#06140c"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(60,255,140,0.15)"; c.lineWidth = 1; for (let x = 0; x < W; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  c.strokeStyle = "#3dff8c"; c.lineWidth = 4; c.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const s = (x / W) * 2.2 + T * 0.9, ph = (s * bpm) % 1;
    const y = bpm < 1 ? 0 : ph > 0.42 && ph < 0.46 ? -55 : ph > 0.46 && ph < 0.5 ? 30 : ph > 0.6 && ph < 0.7 ? -10 * Math.sin((ph - 0.6) * 31) : 0;
    x ? c.lineTo(x, H / 2 + y) : c.moveTo(x, H / 2 + y);
  }
  c.stroke();
  c.fillStyle = "#3dff8c"; c.font = "bold 28px sans-serif"; c.fillText(bpm < 1 ? "0" : "72", W - 54, 34);
  t.needsUpdate = true;
}

// ---------- camera
const SHOT = { establishing: { d: 13, h: 3.2, fov: 42 }, wide: { d: 7.5, h: 1.3, fov: 40 }, medium: { d: 3.6, h: 0.3, fov: 36 },
  close: { d: 2.9, h: 0.08, fov: 30 }, extreme_close: { d: 1.75, h: 0.03, fov: 28 }, over_shoulder: { d: 2.2, h: 0.2, fov: 34 },
  low_angle: { d: 2.6, h: -1.0, fov: 38 }, high_angle: { d: 4.2, h: 3.2, fov: 36 }, top_down: { d: 0.3, h: 7.5, fov: 45 }, pov: { d: 1.2, h: 0.0, fov: 50 } };
function placeCamera(cam, S, t, dur) {
  const camS = S.shot.camera || {}, kind = SHOT[camS.shot] ? camS.shot : "medium", move = camS.move || "static", cfg = SHOT[kind];
  const p = clamp(t / dur), e = ease(p);
  const target = S.byId.get(camS.target) || S.actors[0];
  let look = new THREE.Vector3(0, 1.1, -1.5);
  if (target) {
    const close = kind === "close" || kind === "extreme_close" || kind === "pov";
    look = close ? target.headWorld(new THREE.Vector3()).add(tmpV.set(0, -target.D.head * 0.45, 0)) : target.chestWorld(new THREE.Vector3()).add(tmpV.set(0, kind === "wide" || kind === "establishing" ? 0.1 : 0.25, 0));
  } else if (kind === "medium") look.set(0, 1.2, -2);
  const group = kind === "wide" || kind === "establishing" || kind === "high_angle" || kind === "top_down";
  if (group && S.actors.length > 1) { const c0 = new THREE.Vector3(); for (const a of S.actors) c0.add(a.chestWorld(new THREE.Vector3())); c0.multiplyScalar(1 / S.actors.length); look.lerp(c0, 0.75); }
  let yawT = target ? target.root.rotation.y : 0; yawT = Math.atan2(Math.sin(yawT), Math.cos(yawT));
  const away = Math.abs(yawT) > PI * 0.6;
  const otherId = target && (S.byId.has(String(target.cs.facing || "").replace("other:", "")) ? String(target.cs.facing).replace("other:", "") : null);
  const partner = target && (S.byId.get(otherId) || S.actors.find((x) => x !== target && /^(hug|tap_shoulder)/.test(x.cs.action || "") && parseRef(x.cs.action).arg === target.id) ||
    (/^(hug|tap_shoulder)/.test(target.cs.action || "") ? S.byId.get(parseRef(target.cs.action).arg) : null));
  const facesOther = !!partner;
  if (partner && kind !== "close" && kind !== "extreme_close" && kind !== "over_shoulder") {
    // two people interacting: frame both from the side so neither blocks the other
    look.lerp(partner.chestWorld(new THREE.Vector3()).add(tmpV.set(0, 0.25, 0)), 0.5);
    const dx = partner.root.position.x - target.root.position.x, dz = partner.root.position.z - target.root.position.z;
    S.pairAng = Math.atan(-dz / (Math.abs(dx) < 1e-6 ? 1e-6 : dx));
  } else S.pairAng = null;
  let d = cfg.d, h = cfg.h, ang = (away ? clamp(Math.atan2(Math.sin(yawT - PI), Math.cos(yawT - PI)) * 0.3, -0.35, 0.35) : clamp(yawT * (facesOther ? 0.22 : 0.45), -0.7, 0.7)) + (S.rand2 ?? 0);
  // close-ups always show the face: if they face away, the camera goes around to their front
  const closeish = kind === "close" || kind === "extreme_close" || kind === "pov";
  if (away && closeish && target && !/^(kick|walk_away|run_away)/.test(target.cs.action || "")) { ang = yawT + (S.rand2 ?? 0) * 0.5; }
  if (S.pairAng != null) ang = clamp(S.pairAng, -0.5, 0.5) + (S.rand2 ?? 0) * 0.5 + (move === "orbit" ? (e - 0.5) * 0.6 : 0);
  if (away && (kind === "wide" || kind === "medium")) look.add(tmpV.set(-Math.sin(yawT) * -1.5, 0, Math.cos(yawT) * -1.5).multiplyScalar(-1)).setY(look.y);
  if (move === "push_in") d *= 1.25 - 0.4 * e;
  if (move === "pull_out") d *= 0.8 + 0.5 * e;
  if (move === "orbit" && S.pairAng == null) ang += (e - 0.5) * 0.9;
  if (move === "crane_up") h += 2.2 * e;
  let side = 0;
  if (move === "pan_left") side = 0.9 - 1.8 * e; if (move === "pan_right") side = -0.9 + 1.8 * e;
  const pos = new THREE.Vector3(look.x + Math.sin(ang) * d + Math.cos(ang) * side, look.y + h, look.z + Math.cos(ang) * d - Math.sin(ang) * side);
  if (kind === "over_shoulder") {
    const other = S.actors.find((x) => x !== target);
    if (other) { const oh = other.headWorld(new THREE.Vector3()); const dirv = tmpV2.subVectors(oh, look).setY(0).normalize(); pos.copy(oh).add(dirv.clone().multiplyScalar(1.15)).add(new THREE.Vector3(-dirv.z, 0, dirv.x).multiplyScalar(0.62)); pos.y = oh.y + 0.12; }
  }
  if (kind === "top_down") pos.set(look.x, look.y + cfg.h, look.z + 0.6);
  if (kind === "low_angle") pos.y = Math.max(0.25, look.y + cfg.h);
  if (S.ctx.inside && S.ctx.roomBack != null) pos.z = Math.max(pos.z, S.ctx.roomBack + 0.8);
  pos.y = Math.max(0.15, pos.y);
  if (move === "tilt_up") look.y += -0.7 + 0.9 * e; if (move === "tilt_down") look.y += 0.7 - 0.9 * e;
  if (move === "handheld" || S.has("shake")) { const a = S.has("shake") ? 0.05 : 0.018; pos.x += noise(t * 1.3, 1) * a; pos.y += noise(t * 1.1, 4) * a; look.x += noise(t * 0.9, 7) * a; }
  cam.fov = cfg.fov; cam.updateProjectionMatrix();
  cam.position.copy(pos); cam.up.set(0, 1, 0);
  if (move === "dutch") cam.up.set(Math.sin(0.15), Math.cos(0.15), 0);
  cam.lookAt(look);
  return pos.distanceTo(look);
}

// ---------- the stage: renders any shot at any time into a canvas
export function createStage(W, H) {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const cam = new THREE.PerspectiveCamera(36, W / H, 0.05, 220);
  const composer = new EffectComposer(renderer); composer.setSize(W, H);
  const rp = new RenderPass(new THREE.Scene(), cam); composer.addPass(rp);
  const bokeh = new BokehPass(new THREE.Scene(), cam, { focus: 3, aperture: 0.002, maxblur: 0.006 }); composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.25, 0.4, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let dir = null; const shots = new Map();
  function get(i) {
    if (!shots.has(i)) {
      const sh = dir.shots.find((s) => Number(s.i) === i) || dir.shots[i] || { set: "void" };
      let S;
      try { S = buildShot(dir, sh, i); } catch (e) { console.warn("shot", i, e); S = buildShot(dir, { set: "void", characters: [] }, i); }
      S.rand2 = (rng(hash("cam" + i))() - 0.5) * 0.5;
      shots.set(i, S);
      if (shots.size > 64) { const old = shots.keys().next().value; if (old !== i) disposeShot(shots.get(old)), shots.delete(old); }
    }
    return shots.get(i);
  }
  return {
    canvas,
    setDirection(d) { for (const S of shots.values()) disposeShot(S); shots.clear(); dir = normalizeDirection(d); },
    get direction() { return dir; },
    render(i, t, dur) {
      if (!dir) return canvas;
      const S = get(i);
      animate(S, t, dur);
      const dist = placeCamera(cam, S, t, dur);
      rp.scene = S.scene; bokeh.scene = S.scene;
      const kind = S.shot.camera?.shot || "medium";
      const dof = kind === "close" || kind === "extreme_close" || kind === "over_shoulder" || kind === "pov" || (kind === "medium" ? 0.5 : 0);
      bokeh.enabled = !!dof;
      bokeh.uniforms.focus.value = dist; bokeh.uniforms.aperture.value = (dof === 0.5 ? 0.0008 : 0.0022) * (W / 720); bokeh.uniforms.maxblur.value = 0.007;
      bloom.strength = S.night ? 0.42 : 0.22;
      renderer.toneMappingExposure = S.night ? 1.1 : 1.0;
      composer.render();
      return canvas;
    },
    prepare(i) { if (!dir) return; const S = get(i); try { renderer.compile(S.scene, cam); } catch {} },
    // a still for thumbnails
    snapshot(i, dur, tw = 180) { this.render(i, dur * 0.55, dur); const c = document.createElement("canvas"); c.width = tw; c.height = Math.round(tw * H / W); c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.8); },
    dispose() { for (const S of shots.values()) disposeShot(S); shots.clear(); composer.dispose?.(); renderer.dispose(); },
  };
}
function disposeShot(S) { S.scene.traverse((o) => { if (o.isPoints || o.isInstancedMesh) { o.geometry?.dispose?.(); } }); }
export function normalizeDirection(d) {
  const out = { cast: Array.isArray(d?.cast) ? d.cast : [], shots: Array.isArray(d?.shots) ? d.shots : [] };
  out.cast = out.cast.filter((c) => c && c.id).map((c) => ({ ...c, id: String(c.id).toLowerCase().replace(/\s+/g, "_") }));
  out.shots = out.shots.map((s, k) => ({ ...s, i: s.i ?? k, characters: (s.characters || []).map((c) => ({ ...c, id: String(c.id || "").toLowerCase().replace(/\s+/g, "_") })) }));
  return out;
}
