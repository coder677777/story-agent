// Story Agent: Video Studio. Turns a script into a vertical video right in the browser:
// a plan for the pictures, a voiceover (free Gemini voice), pictures (AI, your own, or text cards),
// timing, an animated preview, and an MP4 export. Every step shows live progress and logs what happened.
import { VOICES, VOICE_STYLE, OLD_VOICE_STYLES, ART_STYLE, artPlanPrompt, clipPrompt, directorPrompt, shotPrompt } from "./prompts.js?v=1.7";
import { createStage, VOCAB, normalizeDirection } from "./anim3d.js?v=1.7";
import { alignVoice } from "./align.js?v=1.7";
import { changeVoice } from "./voicefx.js?v=1.7";

export function setupVideo(ctx) {
  const { $, $$, LS, log, copy, toast, esc, ask, cfg, GBASE, report, sleep, fmt, Cancelled, openScript } = ctx;

  // ---------- storage for voice + pictures (IndexedDB, this browser only)
  let dbp;
  const db = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("story-agent", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction("blobs", mode); const req = fn(tx.objectStore("blobs"));
      tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error);
    });
  }
  const put = (k, v) => idb("readwrite", (s) => s.put(v, k));
  const get = (k) => idb("readonly", (s) => s.get(k));
  const del = (k) => idb("readwrite", (s) => s.delete(k));

  // ---------- page
  const view = $("#view-video");
  view.innerHTML = `
    <button class="btn small ghost back" id="vBack">← Back to script</button>
    <div class="vhead">
      <div><span class="pill red" id="vPart"></span><h1 id="vTitle"></h1>
        <p class="muted" style="margin:0">Makes a ready-to-post vertical video: voice, pictures, motion, captions and music.</p></div>
    </div>
    <div class="vgrid">
      <div>
        <div class="card">
          <p class="label">Voice</p>
          <div class="row" style="gap:10px;align-items:center">
            <select class="text" id="vVoice" style="width:auto"></select>
            <button class="btn small" id="vVoiceUp">⬆ Use my own recording</button>
          </div>
          <div class="row" style="margin-top:14px">
            <div><p class="label">Speed <b id="vSpeedV"></b></p><input type="range" class="vrange" id="vSpeed" min="0.85" max="1.5" step="0.05"></div>
            <div><p class="label">Pitch <b id="vPitchV"></b></p><input type="range" class="vrange" id="vPitch" min="-3" max="4" step="0.5"></div>
          </div>
          <div style="margin-top:8px"><button class="btn small" id="vHear" disabled>▶ Hear the voice</button> <span class="hint" style="margin-left:6px">Changes are instant and free: no new recording.</span></div>
          <p class="label" style="margin-top:14px">How it should sound (for new recordings)</p>
          <input class="text" id="vVoiceStyle" maxlength="200" placeholder="e.g. quiet, emotional, like a kid telling a true story">
          <p class="hint">Free with your Gemini key: about 10 voices a day. Each video uses 1.</p>

          <p class="label" style="margin-top:16px">Pictures</p>
          <div class="seg wrap" id="vPics"><button data-v="3d">🧊 3D animation (free)</button><button data-v="clips">🎬 AI video clips</button><button data-v="ai">AI pictures</button><button data-v="mine">My pictures/clips</button><button data-v="cards">Text cards</button></div>
          <p class="hint" id="vPicsHint"></p>
          <div id="vClipOpts" class="hidden"><p class="label" style="margin-top:12px">Clip quality</p>
            <div class="seg" id="vClipRes"><button data-v="360p">360p draft (~2¢/sec)</button><button data-v="720p">720p (~7¢/sec)</button></div></div>

          <div class="row" style="margin-top:14px">
            <div><p class="label">Music</p><div class="seg" id="vMusic"><button data-v="pad">Soft piano pad</button><button data-v="none">None</button><button data-v="mine">My file</button></div></div>
            <div><p class="label">Quality</p><div class="seg" id="vQual"><button data-v="720">720p</button><button data-v="1080">1080p</button></div></div>
            <div><p class="label">Smoothness</p><div class="seg" id="vFps"><button data-v="60">60 fps</button><button data-v="30">30 fps</button></div></div>
          </div>
          <div class="go" style="margin-top:18px"><button class="btn primary" id="vMake">🎬 Make the video</button><button class="btn hidden" id="vStop">Stop</button></div>
        </div>

        <div class="card">
          <div class="prog-top"><p class="label" style="margin:0">Progress</p><span class="prog-time" id="vTime"></span></div>
          <ol class="steps" id="vSteps"></ol>
          <div class="prog-err hidden" id="vErr"></div>
          <details class="prog-log"><summary>Details (what's happening behind the scenes)</summary><pre id="vLog"></pre></details>
          <div style="margin-top:10px"><button class="btn small" id="vReport">📋 Copy report for Claude</button></div>
        </div>
      </div>

      <div class="card vprev">
        <canvas id="vCanvas" width="720" height="1280"></canvas>
        <div class="vctl">
          <button class="btn small" id="vPlay" disabled>▶ Play</button>
          <input type="range" id="vSeek" min="0" max="1000" value="0" disabled>
          <span class="muted" id="vClock">0:00</span>
        </div>
        <button class="btn primary" id="vExport" disabled>⬇️ Export video</button>
        <div class="vbar hidden" id="vBarWrap"><div id="vBar"></div></div>
        <p class="hint" id="vExportHint"></p>
        <div id="vOut"></div>
      </div>
    </div>

    <div class="section-h"><h2>Scenes</h2><span class="muted" id="vPicCount"></span></div>
    <p class="muted" style="margin:0">Upload a picture or a short clip for any scene (Roblox recordings look best). Empty scenes become text cards.</p>
    <div class="vtiles" id="vTiles"></div>
    <input type="file" id="vFile" accept="image/*,video/*" hidden>
    <input type="file" id="vAudioFile" accept="audio/*" hidden>
    <input type="file" id="vMusicFile" accept="audio/*" hidden>`;

  $("#vVoice").innerHTML = Object.entries(VOICES).map(([k, d]) => `<option value="${k}">${k} (${d})</option>`).join("");

  // ---------- state
  const DEF = Object.assign({ voice: "Leda", speed: 1.12, pitch: 1, voiceStyle: VOICE_STYLE, pics: "3d", music: "pad", quality: 720, clipRes: "720p", fps: 60 }, LS.get("videoDefaults", {}));
  const RATE = { "360p": 0.023, "720p": 0.07 }, PIC_COST = 0.05;
  let cur = null;   // the script
  let vs = null;    // this video's saved state
  let run = null;   // the job that's running
  const media = {}; // scene index -> { kind, el, url }
  const failedClips = new Set();
  let voiceBuf = null, rawVoice = null, musicBuf = null;
  const key = (k) => `${cur.id}:${k}`;
  const save = () => LS.set("video." + cur.id, vs);

  function setSeg(id, val) { $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(val))); }
  function bindSeg(id, prop, after) {
    $$(`#${id} button`).forEach((b) => b.onclick = () => {
      vs[prop] = prop === "quality" || prop === "fps" ? Number(b.dataset.v) : b.dataset.v;
      setSeg(id, vs[prop]); save(); LS.set("videoDefaults", { ...LS.get("videoDefaults", {}), [prop]: vs[prop] }); after?.();
    });
  }
  bindSeg("vPics", "pics", () => { picsHint(); renderTiles(); });
  bindSeg("vMusic", "music", () => { if (vs.music === "mine") $("#vMusicFile").click(); });
  bindSeg("vQual", "quality");
  bindSeg("vFps", "fps");
  bindSeg("vClipRes", "clipRes", () => picsHint());
  $("#vVoice").onchange = () => { vs.voice = $("#vVoice").value; save(); LS.set("videoDefaults", { ...LS.get("videoDefaults", {}), voice: vs.voice }); };
  $("#vVoiceStyle").onchange = () => { vs.voiceStyle = $("#vVoiceStyle").value.trim() || VOICE_STYLE; save(); };
  function picsHint() {
    $("#vClipOpts").classList.toggle("hidden", vs.pics !== "clips");
    if (vs.pics === "clips") {
      const secs = vs.timing ? vs.timing.scenes.reduce((a, s) => a + clipSecs(s.dur), 0) : cur.scenes.length * 5;
      $("#vPicsHint").textContent = `Real moving animation, the closest to @pov.deadlinestories. Each scene gets a picture, then Google animates it. ` +
        `Paid on your Google key (billing must be on): about $${(secs * RATE[vs.clipRes] + cur.scenes.length * PIC_COST).toFixed(2)} for this video. You'll confirm before anything is charged.`;
      return;
    }
    if (vs.pics === "3d") {
      $("#vPicsHint").textContent = "Free. The AI directs every scene (cast, set, acting, camera, lighting, effects) and your computer animates it in 3D. " +
        "Characters look identical in every shot. Press 🧊 Redo shot on any scene to re-direct just that one, or upload your own picture/clip over it.";
      return;
    }
    $("#vPicsHint").textContent = {
      mine: "Upload a screenshot or a clip for each scene below. Free, and the best-looking option.",
      cards: "Free. Moody animated backgrounds with big captions. Upload pictures for any scene to mix them in.",
      ai: "Google charges for AI pictures (about 3–7¢ each, roughly 50¢ a video) and needs billing turned on in AI Studio.",
    }[vs.pics];
  }

  // ---------- steps + log
  const STEPS = [["plan", "Plan the pictures"], ["voice", "Record the voice"], ["pics", "Get the pictures"], ["timing", "Line up the timing"], ["ready", "Preview ready"]];
  $("#vSteps").innerHTML = STEPS.map(([k, l]) => `<li data-step="${k}"><span class="ic"></span><span class="lb">${l}</span><span class="sub"></span></li>`).join("");
  const stepT = {};
  function vstep(k, st, sub) {
    const li = $(`#vSteps [data-step="${k}"]`);
    li.className = st || "";
    if (st === "on") stepT[k] = Date.now(); else delete stepT[k];
    if (sub !== undefined) li.querySelector(".sub").textContent = sub;
    li.dataset.base = sub ?? li.dataset.base ?? "";
  }
  setInterval(() => {
    for (const [k, t] of Object.entries(stepT)) {
      const li = $(`#vSteps [data-step="${k}"]`);
      li.querySelector(".sub").textContent = `${li.dataset.base}${li.dataset.base ? " · " : ""}${fmt(Date.now() - t)}`;
    }
    if (run) $("#vTime").textContent = fmt(Date.now() - run.t0);
  }, 500);
  function vlog(msg, bad) {
    log(msg, bad);
    const el = $("#vLog");
    el.textContent += (el.textContent ? "\n" : "") + `${new Date().toLocaleTimeString()}  ${bad ? "✗ " : ""}${msg}`;
    el.scrollTop = el.scrollHeight;
  }
  function vErr(msg) { const e = $("#vErr"); if (!msg) { e.classList.add("hidden"); return; } e.innerHTML = `<b>Stopped here:</b> ${esc(msg)}`; e.classList.remove("hidden"); }
  $("#vReport").onclick = () => copy(report() + `\n\nVideo: pics=${vs?.pics} voice=${vs?.voice} music=${vs?.music} quality=${vs?.quality}`, "Report copied. Paste it to Claude.");

  // ---------- Google calls with a watchdog
  let allModels = null;
  async function models() {
    if (allModels) return allModels;
    const r = await fetch(GBASE + "models?pageSize=1000&key=" + encodeURIComponent(cfg.key));
    if (!r.ok) throw new Error(`Couldn't get Google's model list (HTTP ${r.status}). Check your key in Settings.`);
    const d = await r.json();
    allModels = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.split("/").pop());
    return allModels;
  }
  const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  async function ttsModels() {
    const all = (await models()).filter((n) => n.includes("tts") && !n.includes("pro"));
    all.sort((a, b) => (ver(b) - ver(a)) || (a.includes("lite") - b.includes("lite")) || (a.includes("preview") - b.includes("preview")));
    return all.length ? all : ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
  }
  async function imageModels() {
    const all = (await models()).filter((n) => n.includes("image") && !n.includes("imagen") && !n.includes("pro"));
    const rank = (n) => (n.includes("lite") ? 0 : n.includes("banana") ? 1 : 2) - ver(n) / 100;
    all.sort((a, b) => rank(a) - rank(b));
    return all.length ? all : ["gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1", "gemini-3.1-flash-image"];
  }
  async function call(model, body, ms) {
    const ctrl = new AbortController(); let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
    run.abort = () => ctrl.abort();
    try {
      const r = await fetch(`${GBASE}models/${model}:generateContent?key=${encodeURIComponent(cfg.key)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, ok: r.ok, text, json };
    } catch {
      if (run.cancelled) throw new Cancelled();
      return { status: timedOut ? "timeout" : "network", ok: false, text: "" };
    } finally { clearTimeout(t); }
  }
  const short = (s) => String(s).replace(/\s+/g, " ").slice(0, 220);
  const isDaily = (low) => /per ?day|perday|requestsperday|limit:\s*0\b/.test(low);
  async function waitRetry(text, k, label) {
    const d = parseInt((text.match(/"retryDelay":\s*"(\d+)/) || [])[1] || "20", 10);
    for (let s = Math.min(Math.max(d, 5), 60) + 2; s > 0; s--) {
      if (run.cancelled) throw new Cancelled();
      $(`#vSteps [data-step="${k}"]`).dataset.base = `${label}: free limit, waiting ${s}s`; await sleep(1000);
    }
  }
  const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  function fromB64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  // ---------- open
  async function open(script) {
    stop();
    cur = script;
    $("#vLog").textContent = ""; $("#vTime").textContent = "";
    vs = Object.assign({ ...DEF, plan: null, voiceSrc: null, timing: null, media: {}, stamp: script.updated }, LS.get("video." + script.id, {}));
    if (vs.stamp !== script.updated) {
      vlog("The script changed since last time, so the voice and timing will be redone.");
      vs.plan = null; vs.direction = null; vs.voiceSrc = null; vs.timing = null; vs.stamp = script.updated; await del(key("voice")); save();
    }
    $("#vPart").textContent = "PART " + script.part;
    $("#vTitle").textContent = script.title;
    $("#vVoice").value = vs.voice;
    if (!vs.voiceStyle || /^Read this like a kid/.test(vs.voiceStyle)) { vs.voiceStyle = VOICE_STYLE; save(); }
    if (OLD_VOICE_STYLES.includes(vs.voiceStyle)) { vs.voiceStyle = VOICE_STYLE; save(); }
    $("#vVoiceStyle").value = vs.voiceStyle;
    $("#vSpeed").value = vs.speed ?? 1; $("#vPitch").value = vs.pitch ?? 0; fxLabels();
    setSeg("vPics", vs.pics); setSeg("vMusic", vs.music); setSeg("vQual", vs.quality); setSeg("vClipRes", vs.clipRes); setSeg("vFps", vs.fps || 60);
    picsHint(); vErr(""); $("#vOut").innerHTML = ""; $("#vExportHint").textContent = "";
    for (const k of Object.keys(media)) { if (media[k].url) URL.revokeObjectURL(media[k].url); delete media[k]; }
    failedClips.clear();
    for (const k of Object.keys(thumbs)) delete thumbs[k];
    if (stage) { stage.dispose(); stage = null; }
    voiceBuf = null;
    await loadMedia();
    const vb = await get(key("voice"));
    if (vb) { try { await setVoice(await decode(vb)); } catch { vs.voiceSrc = null; } }
    if (voiceBuf && vs.voiceSrc && vs.voiceSrc !== "your recording" && !vs.voiceV) {
      vlog("This voice was recorded the old way (the style instructions got read out loud at the start). It will be re-recorded when you press Make the video.", true);
      await del(key("voice")); voiceBuf = null; rawVoice = null; vs.voiceSrc = null; vs.timing = null; save();
    }
    if (voiceBuf && vs.timing && vs.timing.fx !== fxKey()) { vlog("Re-syncing captions for the current speed and pitch"); await computeTiming(); }
    if (voiceBuf && vs.timing && !vs.timing.scenes.some((s) => s.caps)) { vlog("Re-lining up the captions with the voice (new, more accurate timing)"); await computeTiming(); }
    const mb = await get("music:file"); musicBuf = null;
    if (mb) { try { musicBuf = await decode(mb); } catch {} }
    refreshSteps();
    renderTiles();
    await prepPlayer();
    if (vs.pics === "3d" && vs.direction && vs.timing) { for (let i = 0; i < cur.scenes.length; i++) if (media[i]?.kind === "3d") { await thumb3d(i); await sleep(5); } }
  }
  function vlogReset() { $("#vLog").textContent = ""; }
  function refreshSteps() {
    const needPlan = vs.pics === "ai" || vs.pics === "clips";
    if (vs.pics === "3d") vstep("plan", vs.direction ? "done" : "", vs.direction ? `Directed: ${vs.direction.shots.length} shots, ${vs.direction.cast.length} characters` : "The AI directs every shot (free)");
    else vstep("plan", !needPlan ? "skip" : vs.plan ? "done" : "", !needPlan ? "Only needed for AI pictures or clips" : vs.plan ? `${vs.plan.scenes.length} picture ideas` : "");
    vstep("voice", voiceBuf ? "done" : "", voiceBuf ? `${fmt(voiceBuf.duration * 1000)} · ${vs.voiceSrc} · ${Number(vs.speed ?? 1).toFixed(2)}x` : "");
    $("#vHear").disabled = !voiceBuf;
    const n = cur.scenes.filter((_, i) => media[i]).length, nc = cur.scenes.filter((_, i) => media[i]?.kind === "video").length;
    vstep("pics", n || vs.pics === "cards" ? "done" : "", `${n} of ${cur.scenes.length} scenes have a picture or clip${nc ? ` (${nc} moving)` : ""}${n < cur.scenes.length ? ", the rest become text cards" : ""}`);
    vstep("timing", vs.timing && voiceBuf ? "done" : "", vs.timing && voiceBuf ? `${fmt(vs.timing.total * 1000)} total` : "");
    vstep("ready", vs.timing && voiceBuf ? "done" : "", vs.timing && voiceBuf ? "Press Play, then Export" : "");
  }

  // ---------- scene tiles
  let pickFor = null;
  function renderTiles() {
    const n = cur.scenes.filter((_, i) => media[i]).length;
    $("#vPicCount").textContent = `${n}/${cur.scenes.length} with pictures`;
    $("#vTiles").innerHTML = cur.scenes.map((s, i) => {
      const m = media[i];
      const thumb = m?.kind === "3d" ? (thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : `<div class="ph">🧊 ${esc(vs.direction?.shots?.[i]?.set || "3D")}</div>`)
        : m ? (m.kind === "video" ? `<video src="${m.url}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${m.url}" alt="">`)
        : `<div class="ph">${esc(s.visual || "Text card")}</div>`;
      return `<div class="vtile" data-i="${i}">
        <div class="vthumb">${thumb}<span class="vnum">${i + 1}</span><span class="vst${failedClips.has(i) ? " bad" : ""}" data-st="${i}">${failedClips.has(i) ? "clip failed" : m?.kind === "video" && vs.pics === "clips" ? "🎬" : ""}</span></div>
        <p class="vvo">${esc(s.vo || "(no voiceover)")}</p>
        <div class="vbtns">
          <button class="btn small" data-up="${i}">⬆ ${m && m.kind !== "3d" ? "Replace" : "Upload"}</button>
          ${vs.pics === "3d" && vs.direction ? `<button class="btn small" data-redo3d="${i}" title="Re-direct this shot">🧊 Redo shot</button>` : ""}
          ${vs.pics === "ai" || vs.pics === "clips" ? `<button class="btn small" data-ai="${i}" title="Make an AI picture for this scene">✨ Pic</button>` : ""}
          ${vs.pics === "clips" ? `<button class="btn small" data-clip="${i}" title="Animate this scene into a video clip">🎬 Clip</button>` : ""}
          ${m && m.kind !== "3d" ? `<button class="btn small ghost" data-rm="${i}" title="Remove">✕</button>` : ""}
        </div></div>`;
    }).join("");
    $$("[data-up]").forEach((b) => b.onclick = () => { pickFor = Number(b.dataset.up); $("#vFile").value = ""; $("#vFile").click(); });
    $$("[data-rm]").forEach((b) => b.onclick = async () => { const i = Number(b.dataset.rm); await del(key("m" + i)); delete vs.media[i]; save(); dropMedia(i); if (vs.pics === "3d" && vs.direction) media[i] = { kind: "3d" }; renderTiles(); refreshSteps(); });
    $$("[data-redo3d]").forEach((b) => b.onclick = () => runJob(async () => {
      const i = Number(b.dataset.redo3d);
      const note = prompt(`What should change in shot ${i + 1}? (optional, e.g. "closer on Grandpa's face", "make it night", "he hugs her")`, "");
      if (note === null) throw new Cancelled();
      vstep("plan", "on", `Re-directing shot ${i + 1}`);
      const shot = await ask(shotPrompt({ script: cur, direction: vs.direction, i, note: note.trim(), vocab: VOCAB }), { temperature: 0.8, title: `Re-directing shot ${i + 1}…`,
        norm: (d) => { const s2 = d.shot || d; if (!s2 || !s2.set) throw new Error("The new shot came back empty. Press Try again."); return s2; } });
      shot.i = i; vs.direction.shots[i] = shot; vs.direction = normalizeDirection(vs.direction); save();
      vlog(`Shot ${i + 1} re-directed: ${shot.set}, ${shot.camera?.shot || ""} ${shot.camera?.move || ""}${note.trim() ? ` ("${note.trim()}")` : ""}`);
      stage3d(true); await thumb3d(i); vstep("plan", "done", `Shot ${i + 1} updated`); await prepPlayer();
    }));
    $$("[data-ai]").forEach((b) => b.onclick = () => runJob(async () => { await ensurePlan(); await genImage(Number(b.dataset.ai), true); }));
    $$("[data-clip]").forEach((b) => b.onclick = () => runJob(async () => {
      const i = Number(b.dataset.clip);
      if (!voiceBuf) await makeVoice();
      if (!vs.timing) await computeTiming();
      const cost = clipSecs(vs.timing.scenes[i].dur) * RATE[vs.clipRes] + (media[i] ? 0 : PIC_COST);
      if (!confirm(`Make a moving clip for scene ${i + 1}? About $${cost.toFixed(2)} on your Google bill.`)) throw new Cancelled();
      await ensurePlan();
      vstep("pics", "on", `Scene ${i + 1}`);
      if (!(await keyframe(i))) await genImage(i, false);
      await genClip(i);
      vstep("pics", "done", `Scene ${i + 1} is moving`);
      await prepPlayer();
    }));
  }
  function tileStatus(i, text, bad) { const el = $(`[data-st="${i}"]`); if (el) { el.textContent = text; el.classList.toggle("bad", !!bad); } }
  $("#vFile").onchange = async () => {
    const f = $("#vFile").files[0]; if (!f || pickFor == null) return;
    const kind = f.type.startsWith("video") ? "video" : "image";
    await put(key("m" + pickFor), f); vs.media[pickFor] = kind; save();
    await loadOne(pickFor, f, kind); vlog(`Scene ${pickFor + 1}: you added a ${kind} (${(f.size / 1e6).toFixed(1)} MB)`);
    renderTiles(); refreshSteps();
  };
  async function loadMedia() {
    for (const [i, kind] of Object.entries(vs.media)) { const b = await get(key("m" + i)); if (b) await loadOne(Number(i), b, kind); else delete vs.media[i]; }
    if (vs.pics === "3d" && vs.direction) cur.scenes.forEach((_, i) => { if (!media[i]) media[i] = { kind: "3d" }; });
  }
  async function loadOne(i, blob, kind) {
    dropMedia(i);
    const url = URL.createObjectURL(blob);
    if (kind === "video") {
      const el = document.createElement("video"); el.src = url; el.muted = true; el.playsInline = true; el.preload = "auto";
      await new Promise((r) => { el.onloadeddata = r; el.onerror = r; setTimeout(r, 4000); });
      media[i] = { kind, el, url };
    } else {
      try { media[i] = { kind, el: await createImageBitmap(blob), url }; }
      catch { URL.revokeObjectURL(url); vlog(`Scene ${i + 1}: that picture couldn't be opened`, true); }
    }
  }
  function dropMedia(i) { if (media[i]) { if (media[i].url) URL.revokeObjectURL(media[i].url); delete media[i]; } }

  // ---------- own voice / music files
  $("#vVoiceUp").onclick = () => { $("#vAudioFile").value = ""; $("#vAudioFile").click(); };
  $("#vAudioFile").onchange = async () => {
    const f = $("#vAudioFile").files[0]; if (!f) return;
    try { await setVoice(await decode(f)); } catch { toast("That audio file couldn't be opened. Try an MP3 or WAV."); return; }
    await put(key("voice"), f); vs.voiceSrc = "your recording"; vs.timing = null; save();
    vlog(`You added your own voice recording (${fmt(voiceBuf.duration * 1000)})`);
    await computeTiming(); refreshSteps(); await prepPlayer();
  };
  $("#vMusicFile").onchange = async () => {
    const f = $("#vMusicFile").files[0]; if (!f) return;
    try { musicBuf = await decode(f); await put("music:file", f); vlog(`Music file added (${fmt(musicBuf.duration * 1000)})`); }
    catch { toast("That music file couldn't be opened."); vs.music = "pad"; setSeg("vMusic", "pad"); save(); }
  };

  // ---------- the job runner
  async function runJob(fn) {
    if (run) return;
    if (!cfg.key) { toast("Add your Gemini key in Settings first."); return; }
    stopPlay();
    run = { t0: Date.now(), cancelled: false, abort: null };
    vErr(""); $("#vMake").disabled = true; $("#vExport").disabled = true; $("#vStop").classList.remove("hidden");
    try { await fn(); }
    catch (e) {
      const k = Object.keys(stepT)[0];
      if (k) vstep(k, e instanceof Cancelled ? "" : "bad");
      if (e instanceof Cancelled) vlog("You pressed Stop");
      else { vErr(e.message || String(e)); vlog(e.message || String(e), true); }
    } finally {
      for (const k of Object.keys(stepT)) delete stepT[k];
      run = null; $("#vMake").disabled = false; $("#vStop").classList.add("hidden");
      $("#vExport").disabled = !(vs.timing && voiceBuf);
      renderTiles();
    }
  }
  $("#vStop").onclick = () => { if (run) { run.cancelled = true; run.abort?.(); } };
  $("#vMake").onclick = () => runJob(makeAll);

  async function makeAll() {
    vlog(`— Make the video: "${cur.title}" part ${cur.part} (pictures: ${vs.pics}, voice: ${vs.voice})`);
    vstep("timing", "", ""); vstep("ready", "", "");
    if (vs.pics === "3d") {
      if (!voiceBuf) await makeVoice(); else vlog("Voice already recorded, keeping it (remove it with ↻ Redo voice)");
      await computeTiming();
      if (!vs.direction) {
        vstep("plan", "on", "The AI is directing every shot: cast, sets, acting, camera…");
        vs.direction = await ask(directorPrompt({ script: cur, durations: vs.timing.scenes.map((s) => s.dur), vocab: VOCAB }), { temperature: 0.7, title: "Directing the 3D scenes…",
          unit: { re: /"camera"\s*:/g, label: "shots" },
          norm: (d) => { const n = normalizeDirection(d); if (!n.shots.length) throw new Error("The AI's shot list came back empty. Press Try again."); return n; } });
        save();
        vlog(`Directed ${vs.direction.shots.length} shots with ${vs.direction.cast.length} characters: ${vs.direction.cast.map((c) => c.name || c.id).join(", ")}`);
      }
      vstep("plan", "done", `Directed: ${vs.direction.shots.length} shots, ${vs.direction.cast.length} characters`);
      vstep("pics", "on", "Building the 3D scenes…");
      stage3d(true);
      for (let i = 0; i < cur.scenes.length; i++) {
        if (run.cancelled) throw new Cancelled();
        if (!media[i] || media[i].kind === "3d") media[i] = { kind: "3d" };
        $(`#vSteps [data-step="pics"]`).dataset.base = `Building scene ${i + 1} of ${cur.scenes.length}`;
        await thumb3d(i); await sleep(10);
      }
      renderTiles();
      vstep("pics", "done", `${cur.scenes.length} animated 3D scenes`);
    } else if (vs.pics === "clips") {
      if (!voiceBuf) await makeVoice(); else vlog("Voice already recorded, keeping it (remove it with ↻ Redo voice)");
      await computeTiming();
      const todo = cur.scenes.map((_, i) => i).filter((i) => media[i]?.kind !== "video");
      const secs = todo.reduce((a, i) => a + clipSecs(vs.timing.scenes[i].dur), 0);
      const cost = secs * RATE[vs.clipRes] + todo.filter((i) => !media[i]).length * PIC_COST;
      if (todo.length && !confirm(`Make ${todo.length} moving clips (${secs}s of video at ${vs.clipRes})?\nAbout $${cost.toFixed(2)} will go on your Google bill. Each clip takes about 1–2 minutes.`)) throw new Cancelled();
      if (todo.length) vlog(`Making ${todo.length} clips, ${secs}s at ${vs.clipRes}, estimated $${cost.toFixed(2)}`);
      await ensurePlan();
      vstep("pics", "on", "Starting…");
      let made = 0, failed = [], spent = 0;
      for (const i of todo) {
        if (run.cancelled) throw new Cancelled();
        const base = (what) => { $(`#vSteps [data-step="pics"]`).dataset.base = `Scene ${i + 1} of ${cur.scenes.length}: ${what} · ${made} done · ~$${spent.toFixed(2)} so far`; };
        try {
          if (!(await keyframe(i))) { base("drawing the picture"); await genImage(i, false); spent += PIC_COST; renderTiles(); }
          base("animating (1–2 min)");
          await genClip(i); spent += clipSecs(vs.timing.scenes[i].dur) * RATE[vs.clipRes]; made++;
          renderTiles(); await prepPlayer();
        } catch (e) {
          if (e instanceof Cancelled || e instanceof BillingError) throw e;
          failed.push(i + 1); vlog(`Scene ${i + 1} failed: ${e.message}. Moving on; it will use its picture instead.`, true);
        }
      }
      vstep("pics", failed.length ? "bad" : "done", `${made} clips made (~$${spent.toFixed(2)})${failed.length ? `. Failed: scene ${failed.join(", ")}. Press 🎬 Clip on those to retry.` : ""}`);
    } else if (vs.pics === "ai") await ensurePlan();
    if (!voiceBuf) await makeVoice();
    else if (vs.pics !== "clips" && vs.pics !== "3d") vlog("Voice already recorded, keeping it (remove it with ↻ Redo voice)");
    if (vs.pics === "ai") {
      vstep("pics", "on", "Starting…");
      let made = 0;
      for (let i = 0; i < cur.scenes.length; i++) {
        if (run.cancelled) throw new Cancelled();
        if (media[i]) continue;
        $(`#vSteps [data-step="pics"]`).dataset.base = `Picture ${i + 1} of ${cur.scenes.length}`;
        await genImage(i, false); made++;
        renderTiles();
      }
      vstep("pics", "done", `${made} new AI pictures`);
    } else if (vs.pics !== "clips" && vs.pics !== "3d") refreshSteps();
    await computeTiming();
    await prepPlayer();
    vstep("ready", "done", "Press Play to watch, then Export");
    vlog(`Ready in ${fmt(Date.now() - run.t0)}`);
    toast("Preview ready. Press Play.");
  }

  async function ensurePlan() {
    if (vs.plan) return;
    vstep("plan", "on", "Asking the AI to plan each picture…");
    try {
      vs.plan = await ask(artPlanPrompt({ script: cur }), { temperature: 0.7, title: "Planning the pictures…", unit: { re: /"prompt"\s*:/g, label: "pictures" },
        norm: (d) => { if (!Array.isArray(d.scenes) || !d.scenes.length) throw new Error("The picture plan came back empty. Press Try again."); return d; } });
    } catch (e) { if (e instanceof Cancelled || e?.message === "CANCELLED") throw new Cancelled(); throw e; }
    save();
    vlog(`Picture plan: ${vs.plan.scenes.length} pictures, characters: ${(vs.plan.characters || []).map((c) => c.name).join(", ")}`);
    vstep("plan", "done", `${vs.plan.scenes.length} picture ideas`);
  }

  // ---------- voice: one request for the whole voiceover (the free tier allows ~10 a day)
  // Only the script's own words are sent as text, so nothing else gets read out loud.
  // Newer voice models (Gemini 3.8+) take the delivery style in a separate field; older ones get a short "Say ...:" lead-in.
  const isNewTTS = (m) => /gemini-(3\.[5-9]|[4-9])/.test(m);
  function voiceBodies(m, scenesText, style) {
    if (!isNewTTS(m)) {
      const text = scenesText.join("\n\n");
      return [{ kind: "gc", body: { contents: [{ role: "user", parts: [{ text: style ? `Say in a ${style} voice:\n\n${text}` : text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vs.voice } } } } } }];
    }
    const text = scenesText.join(" <short pause>\n\n");
    const mk = (annotations) => ({ kind: "ia", body: { model: m, input: [{ type: "user_input", content: [{ type: "text", text, ...(annotations ? { annotations } : {}) }] }],
      response_format: { type: "audio" }, generation_config: { speech_config: [{ voice: vs.voice }] }, store: false } });
    return style
      ? [mk([{ speech_metadata: { style } }]), mk([{ type: "speech_metadata", speech_metadata: { style } }]), mk([{ type: "speech_metadata", style }]), mk(null)]
      : [mk(null)];
  }
  function audioFrom(kind, json) {
    if (kind === "ia") {
      const part = (json?.steps || []).filter((s) => s.type === "model_output").flatMap((s) => s.content || []).find((c) => c.type === "audio" && c.data);
      return part ? { data: part.data, mime: part.mime_type || "audio/wav" } : null;
    }
    const p = json?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
    return p ? { data: p.inlineData.data, mime: p.inlineData.mimeType || "" } : null;
  }
  async function makeVoice() {
    const scenesText = cur.scenes.map((x) => (x.vo || "").trim()).filter(Boolean);
    if (!scenesText.length) throw new Error("This script has no voiceover lines.");
    const words = scenesText.join(" ").split(/\s+/).length;
    const style = (vs.voiceStyle || "").trim().slice(0, 200);
    const order = await ttsModels();
    vlog(`Voice models to try: ${order.join(", ")}`);
    let usedUp = [];
    for (const m of order) {
      const bodies = voiceBodies(m, scenesText, style);
      let bi = 0;
      for (let attempt = 1; attempt <= 4 && bi < bodies.length; attempt++) {
        if (run.cancelled) throw new Cancelled();
        const { kind, body } = bodies[bi];
        vstep("voice", "on", `Google is recording ${words} words with ${vs.voice} (${m}). Usually 15–60s`);
        vlog(`Recording the voice with ${m}, voice ${vs.voice}${kind === "ia" ? `, style in its own field${bi ? ` (format ${bi + 1})` : ""}` : ""}${attempt > 1 ? ` (try ${attempt})` : ""}`);
        let r;
        if (kind === "ia") {
          try { const res = await post("interactions", body, 180e3); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} r = { ok: res.ok, status: res.status, text, json }; }
          catch (e) { if (e instanceof Cancelled) throw e; r = { ok: false, status: /longer than/.test(e.message) ? "timeout" : "network", text: "" }; }
        } else r = await call(m, body, 180e3);
        if (r.ok) {
          const a = audioFrom(kind, r.json);
          if (!a) { vlog(`${m} answered without audio: ${short(r.text)}`, true); break; }
          let blob;
          if (/wav|mpeg|mp3|ogg/.test(a.mime)) blob = new Blob([fromB64(a.data)], { type: a.mime });
          else blob = pcmToWav(fromB64(a.data), parseInt((a.mime.match(/rate=(\d+)/) || [])[1] || "24000", 10));
          await setVoice(await decode(blob));
          await put(key("voice"), blob);
          vs.voiceSrc = `${vs.voice} · ${m}`; vs.voiceV = 2; vs.timing = null; save();
          vlog(`Voice done: ${fmt(voiceBuf.duration * 1000)} long (${(blob.size / 1e6).toFixed(1)} MB)`);
          vstep("voice", "done", `${fmt(voiceBuf.duration * 1000)} · ${vs.voiceSrc}`);
          return;
        }
        const low = r.text.toLowerCase();
        if (r.status === "timeout") { vlog(`${m} took longer than 3 minutes. Trying the next voice model.`, true); break; }
        if (r.status === "network") { vlog("Couldn't reach Google", true); if (attempt >= 2) throw new Error("Couldn't reach Google. Check your internet and press Make the video again."); await sleep(3000); continue; }
        vlog(`${m}: HTTP ${r.status} ${short(r.text)}`, true);
        if (r.status === 429) { if (isDaily(low) || attempt >= 2) { usedUp.push(m); break; } await waitRetry(r.text, "voice", m); continue; }
        if (r.status === 400 && kind === "ia" && /annotation|speech_metadata|unknown name|invalid json|cannot find field|unknown field/.test(low) && bi < bodies.length - 1) { bi++; attempt--; continue; }
        if (r.status === 404 || (r.status === 400 && /not found|not supported|unsupported|no longer|voice/.test(low) && !/api key/.test(low))) break;
        if ([400, 401, 403].includes(r.status) && /api key|api_key|permission/.test(low)) throw new Error("Google rejected your key. Check it in Settings.");
        if (r.status >= 500) { await sleep(4000 * attempt); continue; }
        throw new Error(`Google's voice error ${r.status}: ${short(r.text)}`);
      }
    }
    throw new Error(usedUp.length
      ? "Google's free voice is used up for today (about 10 a day). It resets at 2 AM Texas time. You can also press “Use my own recording” and upload an MP3."
      : "None of Google's voice models worked. Press Copy report for Claude.");
  }
  function pcmToWav(pcm, rate) {
    const h = new ArrayBuffer(44), v = new DataView(h);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length, true);
    return new Blob([h, pcm], { type: "audio/wav" });
  }
  let actx = null;
  const audioCtx = () => actx ||= new AudioContext();
  async function decode(blob) { return audioCtx().decodeAudioData(await blob.arrayBuffer()); }
  // speed + pitch are applied to the original recording, so they can be changed any time without re-recording
  const fxKey = () => `${vs.speed ?? 1}|${vs.pitch ?? 0}`;
  function applyVoiceFx() {
    if (!rawVoice) { voiceBuf = null; return; }
    const sp = Number(vs.speed ?? 1), pi = Number(vs.pitch ?? 0);
    if (Math.abs(sp - 1) < 0.001 && Math.abs(pi) < 0.001) { voiceBuf = rawVoice; return; }
    let ch = rawVoice.getChannelData(0);
    if (rawVoice.numberOfChannels > 1) { const r = rawVoice.getChannelData(1); ch = ch.map((x, i) => (x + r[i]) / 2); }
    const out = changeVoice(ch, rawVoice.sampleRate, sp, pi);
    const b = audioCtx().createBuffer(1, out.length, rawVoice.sampleRate); b.copyToChannel(out, 0);
    voiceBuf = b;
  }
  async function setVoice(buf) { rawVoice = buf; applyVoiceFx(); }
  function fxLabels() {
    $("#vSpeedV").textContent = `${Number(vs.speed ?? 1).toFixed(2)}x`;
    const p = Number(vs.pitch ?? 0); $("#vPitchV").textContent = p === 0 ? "normal" : `${p > 0 ? "+" : ""}${p} (${p > 0 ? "lighter" : "deeper"})`;
  }
  let hearNode = null;
  $("#vHear").onclick = () => {
    if (hearNode) { try { hearNode.stop(); } catch {} hearNode = null; $("#vHear").textContent = "▶ Hear the voice"; return; }
    if (!voiceBuf) return;
    stopPlay(); const ac = audioCtx(); ac.resume();
    hearNode = ac.createBufferSource(); hearNode.buffer = voiceBuf; hearNode.connect(ac.destination);
    hearNode.start(0, 0, Math.min(8, voiceBuf.duration)); $("#vHear").textContent = "■ Stop";
    hearNode.onended = () => { hearNode = null; $("#vHear").textContent = "▶ Hear the voice"; };
  };
  for (const id of ["vSpeed", "vPitch"]) {
    $("#" + id).oninput = () => { vs[id === "vSpeed" ? "speed" : "pitch"] = Number($("#" + id).value); fxLabels(); };
    $("#" + id).onchange = async () => {
      const prop = id === "vSpeed" ? "speed" : "pitch";
      vs[prop] = Number($("#" + id).value); save(); LS.set("videoDefaults", { ...LS.get("videoDefaults", {}), [prop]: vs[prop] });
      if (!rawVoice || run) return;
      stopPlay(); applyVoiceFx();
      vlog(`Voice set to ${Number(vs.speed).toFixed(2)}x speed, pitch ${vs.pitch > 0 ? "+" : ""}${vs.pitch}: ${fmt(voiceBuf.duration * 1000)} long`);
      await computeTiming(); refreshSteps(); await prepPlayer();
      toast("Voice updated and captions re-synced.");
    };
  }

  // ---------- AI pictures
  class BillingError extends Error {}
  async function genImage(i, single) {
    if (!vs.plan) await ensurePlan();
    if (single) vstep("pics", "on", `Picture for scene ${i + 1}`);
    const scene = cur.scenes[i];
    const idea = vs.plan.scenes.find((x) => Number(x.i) === i)?.prompt || scene.visual;
    const cast = (vs.plan.characters || []).map((c) => `${c.name}: ${c.look}`).join("; ");
    const text = `${ART_STYLE}\nCharacters (draw them exactly like this every time): ${cast}\nThis picture: ${idea}`;
    let rb = null;
    for (let k = 0; k < cur.scenes.length && !rb; k++) if (k !== i) rb = (await get(key("k" + k))) || (vs.media[k] === "image" ? await get(key("m" + k)) : null);
    const parts = [{ text }];
    {
      if (rb) parts.unshift({ inlineData: { mimeType: rb.type || "image/png", data: await b64(rb) } }, { text: "Reference picture: keep the same characters and art style." });
    }
    const order = await imageModels();
    tileStatus(i, "making…");
    let lastErr = "";
    for (const m of order) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (run.cancelled) throw new Cancelled();
        const gc = attempt === 1 ? { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } : { responseModalities: ["TEXT", "IMAGE"] };
        vlog(`Scene ${i + 1}: making a picture with ${m}`);
        const r = await call(m, { contents: [{ role: "user", parts }], generationConfig: gc }, 120e3);
        if (r.ok) {
          const p = r.json?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
          if (!p) { lastErr = `${m} returned no picture (${r.json?.candidates?.[0]?.finishReason || "no reason"})`; vlog(lastErr, true); break; }
          const blob = new Blob([fromB64(p.inlineData.data)], { type: p.inlineData.mimeType || "image/png" });
          await put(key("m" + i), blob); await put(key("k" + i), blob); vs.media[i] = "image"; save();
          await loadOne(i, blob, "image");
          tileStatus(i, "");
          vlog(`Scene ${i + 1}: picture done`);
          if (single) { vstep("pics", "done", `Scene ${i + 1} updated`); renderTiles(); }
          return;
        }
        const low = r.text.toLowerCase();
        vlog(`${m}: HTTP ${r.status} ${short(r.text)}`, true);
        if (r.status === "timeout") { lastErr = `${m} took over 2 minutes`; break; }
        if (r.status === "network") { if (attempt >= 2) throw new Error("Couldn't reach Google. Check your internet."); await sleep(3000); continue; }
        if (r.status === 429 && (isDaily(low) || /billing|paid/.test(low))) {
          tileStatus(i, "needs billing", true);
          throw new BillingError("Google doesn't give AI pictures for free. Turn on billing for your key in AI Studio (about 3–7¢ a picture, roughly 50¢ a video), or switch Pictures to “My pictures/clips” or “Text cards” (both free).");
        }
        if (r.status === 429) { await waitRetry(r.text, "pics", `Scene ${i + 1}`); continue; }
        if (r.status === 400 && attempt === 1 && /modalit|imageconfig|aspect/.test(low)) continue;
        if (r.status === 400 && /billing|paid|free tier/.test(low)) throw new BillingError("AI pictures need billing turned on for your key in AI Studio (about 3–7¢ a picture). Or switch Pictures to a free option.");
        if (r.status === 404 || r.status === 400) { lastErr = short(r.text); break; }
        if (r.status >= 500) { await sleep(4000 * attempt); continue; }
        lastErr = short(r.text); break;
      }
    }
    tileStatus(i, "failed", true);
    throw new Error(`Couldn't make a picture for scene ${i + 1}. ${lastErr}`);
  }

  // ---------- free 3D animation
  let stage = null, lite = null, fastPreview = false; const thumbs = {};
  function stage3d(reset) {
    if (stage && (stage.canvas.width !== cv.width || stage.canvas.height !== cv.height)) { stage.dispose(); stage = null; }
    if (!stage) { stage = createStage(cv.width, cv.height); reset = true; vlog(`3D stage ready (${cv.width}x${cv.height})`); }
    if (reset && vs.direction) { stage.setDirection(vs.direction); if (lite) { lite.dispose(); lite = null; } }
    return stage;
  }
  // a half-resolution stage used only for live preview on computers that can't keep up (export is always full quality)
  function liteStage() {
    if (!lite) { lite = createStage(Math.round(cv.width / 2), Math.round(cv.height / 2)); lite.setDirection(vs.direction); }
    return lite;
  }
  async function thumb3d(i) {
    if (!vs.direction || !vs.timing) return;
    try { thumbs[i] = stage3d().snapshot(i, vs.timing.scenes[i].dur); }
    catch (e) { vlog(`Scene ${i + 1}: 3D preview failed (${e.message})`, true); }
    const img = $(`.vtile[data-i="${i}"] .vthumb`);
    if (img && thumbs[i]) { img.querySelector("img, .ph, video")?.remove(); img.insertAdjacentHTML("afterbegin", `<img src="${thumbs[i]}" alt="">`); }
  }

  // ---------- AI video clips (Gemini Omni through the Interactions API)
  function clipSecs(d) { return Math.min(15, Math.max(3, Math.ceil(d + 0.3))); }
  async function keyframe(i) { return (await get(key("k" + i))) || (vs.media[i] === "image" ? await get(key("m" + i)) : null); }
  async function post(path, body, ms) {
    const ctrl = new AbortController(); let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
    run.abort = () => ctrl.abort();
    try {
      const r = await fetch(`${GBASE}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(cfg.key)}`,
        { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      return r;
    } catch (e) {
      if (run.cancelled) throw new Cancelled();
      if (timedOut) throw new Error("Google took longer than " + Math.round(ms / 60000) + " minutes");
      throw new Error("Couldn't reach Google. Check your internet.");
    } finally { clearTimeout(t); }
  }
  async function clipModels() {
    let all = [];
    try { all = (await models()).filter((n) => n.includes("omni")); } catch {}
    const listed = all.sort((a, b) => ver(b) - ver(a));
    return [...new Set([...listed, "gemini-omni-1.2-flash", "gemini-omni-1.1-flash"])];
  }
  async function genClip(i) {
    const kb = await keyframe(i);
    if (!kb) throw new Error(`Scene ${i + 1} has no picture to animate`);
    const dur = clipSecs(vs.timing.scenes[i].dur);
    const motion = vs.plan?.scenes?.find((x) => Number(x.i) === i)?.motion || `${cur.scenes[i].visual}. ${cur.scenes[i].camera || "slow push-in"}`;
    const input = [{ type: "image", data: await b64(kb), mime_type: kb.type || "image/png" }, { type: "text", text: clipPrompt({ motion }) }];
    tileStatus(i, "animating…");
    let uri = false, lastErr = "";
    for (const m of await clipModels()) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (run.cancelled) throw new Cancelled();
        vlog(`Scene ${i + 1}: animating ${dur}s at ${vs.clipRes} with ${m}${uri ? " (file delivery)" : ""}`);
        const t0 = Date.now();
        const rf = { type: "video", duration: `${dur}s`, aspect_ratio: "9:16", resolution: vs.clipRes };
        if (uri) rf.delivery = "uri";
        const r = await post("interactions", { model: m, input, response_format: rf, store: false }, 6 * 60e3);
        const text = await r.text(); const low = text.toLowerCase();
        if (r.ok) {
          let j; try { j = JSON.parse(text); } catch { lastErr = "Google's answer wasn't readable"; break; }
          const part = (j.steps || []).filter((s) => s.type === "model_output").flatMap((s) => s.content || []).find((c) => c.type === "video");
          if (!part) { lastErr = `no video came back (${j.status || "no status"})`; vlog(`${m}: ${lastErr} ${short(text)}`, true); break; }
          let blob;
          if (part.data) blob = new Blob([fromB64(part.data)], { type: part.mime_type || "video/mp4" });
          else if (part.uri) blob = await downloadFile(part.uri, i);
          else { lastErr = "the video had no data"; break; }
          await put(key("m" + i), blob); vs.media[i] = "video"; save();
          await loadOne(i, blob, "video");
          tileStatus(i, ""); failedClips.delete(i);
          vlog(`Scene ${i + 1}: clip done in ${fmt(Date.now() - t0)} (${(blob.size / 1e6).toFixed(1)} MB)`);
          return;
        }
        vlog(`${m}: HTTP ${r.status} ${short(text)}`, true);
        if (r.status === 429 && (isDaily(low) || /billing|paid|free tier|free_tier/.test(low))) {
          tileStatus(i, "needs billing", true);
          throw new BillingError("AI video clips need billing turned on for your key in Google AI Studio (Settings → Billing). Nothing was charged. Or pick a free Pictures option.");
        }
        if ((r.status === 400 || r.status === 403) && /billing|paid tier|free tier|not available on the free/.test(low)) {
          tileStatus(i, "needs billing", true);
          throw new BillingError("AI video clips need billing turned on for your key in Google AI Studio. Nothing was charged. Or pick a free Pictures option.");
        }
        if (r.status === 429) { await waitRetry(text, "pics", `Scene ${i + 1}`); continue; }
        if (!uri && /too large|exceeds|4 ?mb|size limit|payload/.test(low)) { uri = true; continue; }
        if (r.status === 404 || (r.status === 400 && /model/.test(low) && /not found|not supported|unknown/.test(low))) { lastErr = `${m} isn't available`; break; }
        if (/safety|blocked|policy|prohibited/.test(low)) { lastErr = "Google's safety filter blocked this scene. Try ✨ Pic for a new picture, then 🎬 Clip again"; break; }
        if (r.status >= 500) { await sleep(5000 * attempt); continue; }
        lastErr = short(text); break;
      }
      if (/safety/.test(lastErr)) break;
    }
    failedClips.add(i); tileStatus(i, "clip failed", true);
    throw new Error(lastErr || "no clip came back");
  }
  async function downloadFile(uri, i) {
    const id = (uri.split("files/")[1] || "").split(/[?:/]/)[0];
    if (!id) throw new Error("Google gave a file link that couldn't be read");
    for (let k = 0; k < 90; k++) {
      if (run.cancelled) throw new Cancelled();
      const r = await post(`files/${id}`, null, 30e3);
      const j = await r.json().catch(() => ({}));
      if (j.state === "ACTIVE") break;
      if (j.state === "FAILED") throw new Error("Google's video file failed to process");
      tileStatus(i, "saving…"); await sleep(3000);
    }
    const r = await post(`files/${id}:download?alt=media`, null, 120e3);
    if (!r.ok) throw new Error(`Couldn't download the clip (HTTP ${r.status})`);
    return await r.blob();
  }

  // ---------- timing: split the voice at its natural pauses so each scene gets its own lines
  async function computeTiming() {
    if (!voiceBuf) return;
    vstep("timing", "on", "Matching every sentence to the voice…");
    await sleep(20);
    let ch = voiceBuf.getChannelData(0);
    if (voiceBuf.numberOfChannels > 1) { const r = voiceBuf.getChannelData(1); ch = ch.map((x, i) => (x + r[i]) / 2); }
    const A = alignVoice(ch, voiceBuf.sampleRate, cur.scenes);
    if (!A) throw new Error("This script has no voiceover lines to line up.");
    vs.timing = { scenes: A.scenes, endStart: A.endStart, total: A.total, fx: fxKey() };
    save();
    vlog(`Timing: ${A.scenes.length} scenes, ${A.pauses} pauses in the voice, ${A.matched} of ${A.boundaries} sentence breaks matched, video ${fmt(A.total * 1000)}`);
    vstep("timing", "done", `${fmt(A.total * 1000)} total, captions matched to the voice`);
    picsHint();
  }

  // ---------- drawing
  const cv = $("#vCanvas"), g = cv.getContext("2d");
  const MOODS = {
    sad: ["#1B2440", "#3B4A7A", "#0B0E1A"], warm: ["#3A2414", "#B7652B", "#140B06"], tense: ["#2A0F14", "#7A1E2B", "#0A0405"],
    eerie: ["#0E2420", "#1F5A4F", "#040A09"], hopeful: ["#1C2F3F", "#5FA0C8", "#0A1218"],
  };
  const has = (s, re) => re.test([s.visual, s.camera, s.sound, s.text, s.vo].join(" ").toLowerCase());
  const IMPACT = /clang|bang|crash|slam|smash|thud|boom|gunshot|explod|shatter|scream|flatline|long beep/;
  const REWIND = /rewind|rewinds|rewound|⏪|vhs|time (?:goes|went|runs) back/;
  let grain = null;
  function makeGrain() {
    grain = document.createElement("canvas"); grain.width = grain.height = 256;
    const gg = grain.getContext("2d"), id = gg.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gg.putImageData(id, 0, 0);
  }
  function motion(s, i) {
    const c = (s.camera || "").toLowerCase();
    if (/pull|zoom out|reveal|wide/.test(c)) return { s0: 1.16, s1: 1.02, x0: 0, x1: 0 };
    if (/pan left|left/.test(c)) return { s0: 1.12, s1: 1.12, x0: 0.04, x1: -0.04 };
    if (/pan right|right|track/.test(c)) return { s0: 1.12, s1: 1.12, x0: -0.04, x1: 0.04 };
    if (/push|close|zoom in|dolly in/.test(c)) return { s0: 1.02, s1: 1.18, x0: 0, x1: 0 };
    return i % 2 ? { s0: 1.04, s1: 1.12, x0: 0.015, x1: -0.015 } : { s0: 1.12, s1: 1.04, x0: -0.015, x1: 0.015 };
  }
  const ease = (p) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  // effects that look random (shake, film grain) are seeded by the frame time, so preview and export match exactly
  let R = Math.random;
  function seeded(n) { let a = (n * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  function cover(el, sc, ox, oy) {
    const W = cv.width, H = cv.height;
    const iw = el.videoWidth || el.width, ih = el.videoHeight || el.height;
    if (!iw || !ih) return;
    const k = Math.max(W / iw, H / ih) * sc;
    g.drawImage(el, (W - iw * k) / 2 + ox * W, (H - ih * k) / 2 + oy * H, iw * k, ih * k);
  }
  function drawBg(i, p, local, t) {
    const W = cv.width, H = cv.height, s = cur.scenes[i], m = media[i];
    if (m?.kind === "3d" && vs.direction && vs.timing) {
      const st = playing && fastPreview ? liteStage() : stage3d(), dur = vs.timing.scenes[i].dur;
      let ox = 0, oy = 0;
      if (has(s, IMPACT) && local < 0.5) { const a = 0.012 * (1 - local / 0.5); ox = (R() - 0.5) * a * W; oy = (R() - 0.5) * a * H; }
      g.drawImage(st.render(i, Math.min(local, dur), dur), ox - (ox ? W * 0.01 : 0), oy - (oy ? H * 0.01 : 0), W * (ox ? 1.02 : 1), H * (oy ? 1.02 : 1));
    } else if (m) {
      const mo = motion(s, i), e = ease(Math.min(1, Math.max(0, p)));
      let ox = mo.x0 + (mo.x1 - mo.x0) * e, oy = 0;
      if (has(s, IMPACT) && local < 0.5) { const a = 0.018 * (1 - local / 0.5); ox += (R() - 0.5) * a; oy += (R() - 0.5) * a; }
      cover(m.el, m.kind === "video" ? 1.0 + 0.04 * e : mo.s0 + (mo.s1 - mo.s0) * e, ox, oy);
    } else {
      const pal = MOODS[vs.plan?.mood] || MOODS[moodGuess()] || MOODS.sad;
      const gr = g.createRadialGradient(W * (0.5 + 0.15 * Math.sin(t * 0.25 + i)), H * 0.75, 20, W / 2, H * 0.6, H * 0.9);
      gr.addColorStop(0, pal[1]); gr.addColorStop(0.55, pal[0]); gr.addColorStop(1, pal[2]);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,0.35)";
      for (let d = 0; d < 26; d++) { const x = (Math.sin(d * 91.7) * 0.5 + 0.5) * W, y = ((d * 0.137 + t * (0.01 + (d % 5) * 0.004)) % 1) * H; g.globalAlpha = 0.15 + (d % 4) * 0.08; g.fillRect(x, H - y, 3, 3); }
      g.globalAlpha = 1;
    }
  }
  function moodGuess() { const txt = cur.scenes.map((s) => s.sound).join(" ").toLowerCase(); return /eerie|creep|drone|dark/.test(txt) ? "eerie" : /warm|hope|bright/.test(txt) ? "warm" : "sad"; }
  function wrap(text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = []; let line = "";
    for (const w of words) { const tl = line ? line + " " + w : w; if (g.measureText(tl).width > maxW && line) { lines.push(line); line = w; } else line = tl; }
    if (line) lines.push(line); return lines;
  }
  function bigText(text, y, size, weight = 900, color = "#fff", scale = 1) {
    const W = cv.width;
    g.save(); g.translate(W / 2, y); g.scale(scale, scale);
    g.font = `${weight} ${size}px Poppins, "Segoe UI", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = size * 0.2; g.strokeStyle = "rgba(0,0,0,0.9)";
    const lines = wrap(text, W * 0.86), lh = size * 1.12, y0 = -((lines.length - 1) * lh) / 2;
    lines.forEach((l, k) => { g.strokeText(l, 0, y0 + k * lh); g.fillStyle = color; g.fillText(l, 0, y0 + k * lh); });
    g.restore();
  }
  function chunks(vo) {
    const words = String(vo || "").split(/\s+/).filter(Boolean), out = []; let c = [];
    for (const w of words) { c.push(w); if (c.length >= 4 || /[.!?,…:;]$/.test(w) && c.length >= 2) { out.push(c); c = []; } }
    if (c.length === 1 && out.length) out[out.length - 1].push(c[0]); else if (c.length) out.push(c);
    return out.map((x) => x.join(" "));
  }
  function draw(t) {
    R = seeded(Math.floor(t * 240) + 7);
    const W = cv.width, H = cv.height, tm = vs.timing;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (!tm) { bigText("Make the video to see the preview", H / 2, W * 0.055, 800, "#9AA0AD"); return; }
    const ending = t >= tm.endStart;
    let i = tm.scenes.findIndex((s) => t >= s.start && t < s.start + s.dur);
    if (i < 0) i = ending ? tm.scenes.length - 1 : 0;
    const sc = tm.scenes[i], local = ending ? sc.dur : Math.max(0, t - sc.start), p = local / sc.dur, s = cur.scenes[i];
    drawBg(i, p, local, t);
    if (!ending && i > 0 && local < 0.22 && media[i]?.kind !== "3d" && media[i - 1]?.kind !== "3d") { g.globalAlpha = 1 - local / 0.22; drawBg(i - 1, 1, 9, t); g.globalAlpha = 1; }
    // vignette + grain
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    if (grain) { g.globalAlpha = 0.05; g.drawImage(grain, -R() * 128, -R() * 128, W + 256, H + 256); g.globalAlpha = 1; }
    if (!ending) {
      if (has(s, REWIND)) {
        g.fillStyle = "rgba(120,160,255,0.10)"; g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(0,0,0,0.18)"; for (let y = (t * 120) % 6; y < H; y += 6) g.fillRect(0, y, W, 2);
        if (Math.floor(t * 2) % 2 === 0) bigText("◀◀", H * 0.08, W * 0.07, 900, "#fff");
      }
      if (has(s, IMPACT) && local < 0.16) { g.fillStyle = `rgba(255,255,255,${0.55 * (1 - local / 0.16)})`; g.fillRect(0, 0, W, H); }
      if (s.text && !/^\s*(empty( string)?|none|null|n\/?a|blank|no text|-+|—)\s*$/i.test(s.text)) { const pop = Math.min(1, local / 0.18); bigText(s.text, H * 0.2, W * 0.115, 900, "#FFE500", 0.7 + 0.3 * ease(pop)); }
      // captions follow the actual spoken words (times come from lining up the voice)
      const caps = sc.caps || [];
      let cap = null;
      for (let k = 0; k < caps.length; k++) { if (local >= caps[k].t0 - 0.05) cap = caps[k]; else break; }
      if (cap && local > cap.t1 + 0.6 && cap === caps[caps.length - 1]) cap = null;
      if (cap) {
        const card = !media[i], pop = Math.min(1, (local - cap.t0 + 0.05) / 0.12);
        bigText(cap.text, card ? H * 0.5 : H * 0.7, card ? W * 0.1 : W * 0.078, card ? 900 : 800, "#fff", 0.9 + 0.1 * ease(Math.max(0, pop)));
      }
    } else {
      const e = Math.min(1, (t - tm.endStart) / 0.5);
      g.fillStyle = `rgba(0,0,0,${0.62 * e})`; g.fillRect(0, 0, W, H);
      g.globalAlpha = e;
      bigText(cur.ending_text || "Rewatch it.", H * 0.45, W * 0.085, 900, "#fff");
      if (cur.next_part) bigText(`Part ${cur.part + 1} soon. Follow 👀`, H * 0.62, W * 0.05, 800, "#FFE500");
      g.globalAlpha = 1;
    }
  }

  // ---------- sound: voice segments, music pad, hit sounds
  let playing = null;
  function buildAudio(from, out, acIn, offline) {
    const ac = acIn || audioCtx(), tm = vs.timing, t0 = offline ? 0 : ac.currentTime + 0.12, nodes = [];
    const master = ac.createGain(); master.gain.value = 1; master.connect(out); if (!offline && out !== ac.destination) master.connect(ac.destination);
    nodes.push(master);
    if (voiceBuf) for (const s of tm.scenes) {
      if (s.a0 == null || s.start + s.dur <= from) continue;
      const skip = Math.max(0, from - s.start), src = ac.createBufferSource();
      src.buffer = voiceBuf; src.connect(master);
      src.start(t0 + Math.max(0, s.start - from), s.a0 + skip, Math.max(0.01, s.a1 - s.a0 - skip)); nodes.push(src);
    }
    const mg = ac.createGain(); mg.connect(master); nodes.push(mg);
    const endAt = t0 + (tm.total - from);
    // Music follows the story: it drops out right before the big moment and comes back after, then swells on the end card.
    const envelope = (B) => {
      const at = (s) => t0 + s - from, g0 = mg.gain;
      g0.setValueAtTime(B, t0);
      tm.scenes.forEach((s, i) => {
        if (!has(cur.scenes[i], IMPACT) || i === 0) return;
        const p = tm.scenes[i - 1], down = at(p.start + p.dur * 0.4), up = at(s.start + s.dur + 0.4);
        if (up <= t0) return;
        g0.setValueAtTime(B, Math.max(t0, down)); g0.linearRampToValueAtTime(0.0001, Math.max(t0, down) + 0.5);
        g0.setValueAtTime(0.0001, Math.max(t0, up)); g0.linearRampToValueAtTime(B, Math.max(t0, up) + 1.5);
      });
      const e = at(tm.endStart);
      if (e > t0) { g0.setValueAtTime(B, e); g0.linearRampToValueAtTime(B * 1.7, e + 0.8); }
      g0.setValueAtTime(B * 1.7, Math.max(t0, endAt - 1.2)); g0.linearRampToValueAtTime(0.0001, endAt);
    };
    // Sound from the clips themselves (footsteps, wind, crowd), kept low under the voice
    const cg = ac.createGain(); cg.gain.value = 0.32; cg.connect(master); nodes.push(cg);
    for (const [k, m] of Object.entries(media)) {
      if (m.kind !== "video") continue;
      if (offline) {
        const s = tm.scenes[k]; if (!m.abuf || !s || s.start + s.dur <= from) continue;
        const src = ac.createBufferSource(); src.buffer = m.abuf; src.connect(cg);
        src.start(t0 + Math.max(0, s.start - from), Math.max(0, from - s.start), Math.min(s.dur, m.abuf.duration)); nodes.push(src);
        continue;
      }
      try { if (!m.src) { m.el.muted = false; m.src = ac.createMediaElementSource(m.el); } m.src.connect(cg); nodes.push(m.src); } catch {}
    }
    if (vs.music === "mine" && musicBuf) {
      const src = ac.createBufferSource(); src.buffer = musicBuf; src.loop = true; src.connect(mg);
      envelope(0.16);
      src.start(t0, from % musicBuf.duration); src.stop(endAt + 0.1); nodes.push(src);
    } else if (vs.music !== "none") {
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.connect(mg); nodes.push(lp);
      envelope(0.055);
      const minor = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], major = [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
      const prog = /warm|hopeful/.test(vs.plan?.mood || moodGuess()) ? major : minor, len = 4;
      for (let c = Math.floor(from / len); c * len < tm.total; c++) {
        const st = t0 + c * len - from, chord = prog[c % prog.length];
        for (const n of chord) for (const [type, oct] of [["sine", 0], ["triangle", 12]]) {
          const o = ac.createOscillator(), e = ac.createGain();
          o.type = type; o.frequency.value = 440 * Math.pow(2, (n + oct - 69) / 12); o.detune.value = (((c * 7 + n) % 5) - 2) * 2;
          const a = Math.max(ac.currentTime, st);
          e.gain.setValueAtTime(0, a); e.gain.linearRampToValueAtTime(type === "sine" ? 0.5 : 0.12, a + 0.9); e.gain.linearRampToValueAtTime(0, st + len + 0.6);
          o.connect(e); e.connect(lp); o.start(a); o.stop(st + len + 0.7); nodes.push(o, e);
        }
      }
    }
    for (const [i, s] of tm.scenes.entries()) {
      if (!has(cur.scenes[i], IMPACT) || s.start < from) continue;
      const at = t0 + s.start - from;
      for (const [f, v] of [[880, 0.25], [1330, 0.15], [62, 0.6]]) {
        const o = ac.createOscillator(), e = ac.createGain(); o.frequency.value = f; o.type = f < 100 ? "sine" : "triangle";
        e.gain.setValueAtTime(v, at); e.gain.exponentialRampToValueAtTime(0.001, at + (f < 100 ? 0.5 : 0.9));
        o.connect(e); e.connect(master); o.start(at); o.stop(at + 1); nodes.push(o, e);
      }
    }
    return { t0, nodes, master };
  }
  function stopAudio(a) { for (const n of a?.nodes || []) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} } }

  let seekT = 0;
  async function prepPlayer() {
    const q = vs.quality === 1080 ? [1080, 1920] : [720, 1280];
    if (cv.width !== q[0]) { cv.width = q[0]; cv.height = q[1]; }
    if (!grain) makeGrain();
    try { await document.fonts.load("900 40px Poppins"); await document.fonts.load("800 40px Poppins"); } catch {}
    const ok = !!(vs.timing && voiceBuf);
    $("#vPlay").disabled = !ok; $("#vSeek").disabled = !ok; $("#vExport").disabled = !ok;
    seekT = 0; draw(0); clock(0);
  }
  function clock(t) { $("#vClock").textContent = `${fmt(t * 1000)} / ${fmt((vs.timing?.total || 0) * 1000)}`; if (vs.timing) $("#vSeek").value = Math.round((t / vs.timing.total) * 1000); }
  function syncVideos(t) {
    const tm = vs.timing;
    for (const [k, m] of Object.entries(media)) {
      if (m.kind !== "video") continue;
      const s = tm.scenes[k], on = t >= s.start && t < s.start + s.dur;
      if (on && m.el.paused) { m.el.currentTime = Math.min(Math.max(0, t - s.start), (m.el.duration || 99) - 0.05); m.el.play().catch(() => {}); }
      if (!on && !m.el.paused) m.el.pause();
    }
  }
  function play(from, out, onEnd) {
    stopPlay();
    const ac = audioCtx(); ac.resume();
    const a = buildAudio(from, out || ac.destination);
    playing = { a, from, raf: 0, slow: 0, frames: 0 };
    const tick = () => {
      if (!playing) return;
      const t = from + Math.max(0, ac.currentTime - a.t0);
      const d0 = performance.now();
      syncVideos(t); draw(t); clock(t); seekT = t;
      const dt = performance.now() - d0; playing.frames++;
      if (!fastPreview && out == null && vs.pics === "3d") {
        playing.slow = playing.slow * 0.9 + (dt > 30 ? 1 : 0) * 0.1;
        if (playing.frames > 12 && playing.slow > 0.5) {
          fastPreview = true;
          vlog(`Preview was drawing slowly (${dt.toFixed(0)} ms a frame), switched to a lighter preview. The export is still full quality and perfectly smooth.`);
          $("#vExportHint").textContent = "Preview is running lighter on this computer so it plays smoothly. Export is full quality, every frame rendered.";
        }
      }
      if (t >= vs.timing.total) { const cb = onEnd; stopPlay(); seekT = 0; cb?.(); return; }
      playing.raf = requestAnimationFrame(tick);
      playing.onTick?.(t);
    };
    playing.raf = requestAnimationFrame(tick);
    $("#vPlay").textContent = "❚❚ Pause";
    return playing;
  }
  function stopPlay() {
    if (!playing) return;
    cancelAnimationFrame(playing.raf); stopAudio(playing.a); playing = null;
    for (const m of Object.values(media)) if (m.kind === "video") m.el.pause();
    $("#vPlay").textContent = "▶ Play";
  }
  $("#vPlay").onclick = async () => {
    if (playing) { stopPlay(); return; }
    if (vs.pics === "3d" && vs.direction && vs.timing) {   // build every 3D scene before playing so nothing hitches mid-video
      const st = stage3d(); $("#vPlay").textContent = "Loading…";
      for (let i = 0; i < cur.scenes.length; i++) { if (media[i]?.kind === "3d") { st.prepare(i); if (fastPreview) liteStage().prepare(i); } if (i % 3 === 2) await sleep(0); }
    }
    play(seekT >= (vs.timing?.total || 0) - 0.1 ? 0 : seekT);
  };
  $("#vSeek").oninput = () => { stopPlay(); seekT = (Number($("#vSeek").value) / 1000) * vs.timing.total; syncVideos(seekT); draw(seekT); clock(seekT); };

  // ---------- export (records the preview in real time)
  function pickMime() {
    for (const m of ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"])
      if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
    return "";
  }
  // ---------- frame-perfect export: every frame is drawn at its exact time and encoded, so the video is perfectly
  // smooth no matter how fast this computer is (a slower computer just takes longer)
  async function exportFrames() {
    const fps = vs.fps || 60, W = cv.width, H = cv.height, total = vs.timing.total, N = Math.ceil(total * fps);
    const { Muxer, ArrayBufferTarget } = await import("./lib/mp4-muxer.mjs");
    let vcfg = null;
    const codecs = W >= 1080 ? ["avc1.640032", "avc1.640028", "avc1.4d4028"] : ["avc1.640020", "avc1.4d401f", "avc1.42e01f", "avc1.640028"];
    outer: for (const codec of codecs) for (const hw of ["prefer-hardware", "no-preference"]) {
      const c = { codec, width: W, height: H, bitrate: (W >= 1080 ? 12e6 : 7e6) * (fps >= 60 ? 1.4 : 1), framerate: fps, hardwareAcceleration: hw, avc: { format: "avc" } };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) { vcfg = c; break outer; } } catch {}
    }
    if (!vcfg) throw new Error("NO_WEBCODECS");
    // Sound: AAC (what Instagram prefers), or Opus if this browser can't make AAC
    let acfg = null, aMux = null;
    for (const [c, m] of [[{ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }, "aac"], [{ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }, "opus"]]) {
      try { if (window.AudioEncoder && (await AudioEncoder.isConfigSupported(c)).supported) { acfg = c; aMux = m; break; } } catch {}
    }
    const audioOk = !!acfg;
    if (!audioOk) throw new Error("NO_WEBCODECS");   // never make a silent video: fall back to live recording
    vlog(`Frame-perfect export: ${W}x${H}, ${fps} fps, ${N} frames, ${vcfg.codec}, ${aMux.toUpperCase()} sound`);
    if (aMux === "opus") vlog("This browser can't make AAC sound, so the sound is Opus. If Instagram rejects the file, export from Chrome or Edge on Windows.", true);
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: fps },
      audio: { codec: aMux, numberOfChannels: 2, sampleRate: 48000 }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
    let encErr = null;
    // 1) sound: mix the whole soundtrack in one go
    $("#vExportHint").textContent = "Mixing the sound…";
    for (const [k, m] of Object.entries(media)) if (m.kind === "video" && !m.abuf) { try { const b = await get(key("m" + k)); if (b) m.abuf = await decode(b); } catch { m.abuf = null; } }
    const oac = new OfflineAudioContext(2, Math.ceil((total + 0.5) * 48000), 48000);
    buildAudio(0, oac.destination, oac, true);
    const mix = await oac.startRendering();
    if (audioOk) {
      const aenc = new AudioEncoder({ output: (c, meta) => muxer.addAudioChunk(c, meta), error: (e) => { encErr = e; } });
      aenc.configure(acfg);
      const L = mix.getChannelData(0), Rt = mix.getChannelData(1);
      for (let i = 0; i < mix.length; i += 1024) {
        const n = Math.min(1024, mix.length - i), data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(Rt.subarray(i, i + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
    }
    // 2) picture: every frame at its exact time
    const venc = new VideoEncoder({ output: (c, meta) => muxer.addVideoChunk(c, meta), error: (e) => { encErr = e; } });
    venc.configure(vcfg);
    for (const m of Object.values(media)) if (m.kind === "video") m.el.pause();
    const t0 = performance.now();
    // Background tabs slow down timers, so wait with message ports and encoder events instead (they keep full speed)
    const yieldUI = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
    const drain = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; venc.addEventListener?.("dequeue", f, { once: true }); yieldUI().then(() => { if (venc.encodeQueueSize <= 8) f(); }); });
    for (let n = 0; n < N; n++) {
      if (run.cancelled) { try { venc.close(); } catch {} throw new Cancelled(); }
      if (encErr) throw encErr;
      const t = n / fps;
      await seekVideos(t);
      draw(t);
      const vf = new VideoFrame(cv, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: n % (fps * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 8) await drain();
      if (n % 4 === 0) {
        const el = (performance.now() - t0) / 1000, rate = (n + 1) / Math.max(el, 0.001), left = (N - n - 1) / Math.max(rate, 0.1);
        $("#vBar").style.width = `${((n + 1) / N) * 100}%`;
        $("#vExportHint").textContent = `Frame ${n + 1} of ${N} · ${rate.toFixed(0)} frames/sec · about ${fmt(left * 1000)} left. Keep this tab open (other tabs and apps are fine).`;
        await yieldUI();
      }
    }
    await venc.flush(); venc.close();
    if (encErr) throw encErr;
    muxer.finalize();
    vlog(`Rendered ${N} frames in ${fmt(performance.now() - t0)} (${(N / ((performance.now() - t0) / 1000)).toFixed(0)} frames/sec)`);
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  }
  async function seekVideos(t) {
    const tm = vs.timing, waits = [];
    for (const [k, m] of Object.entries(media)) {
      if (m.kind !== "video") continue;
      const s = tm.scenes[k]; if (!s || t < s.start || t >= s.start + s.dur) continue;
      const target = Math.min(Math.max(0, t - s.start), (m.el.duration || 99) - 0.04);
      if (Math.abs(m.el.currentTime - target) < 0.002) continue;
      waits.push(new Promise((res) => { const done = () => { m.el.removeEventListener("seeked", done); res(); }; m.el.addEventListener("seeked", done); setTimeout(done, 1500); m.el.currentTime = target; }));
    }
    if (waits.length) await Promise.all(waits);
  }
  $("#vExport").onclick = async () => {
    if (run) return;
    if (window.VideoEncoder && window.VideoFrame && window.OfflineAudioContext) {
      stopPlay();
      run = { t0: Date.now(), cancelled: false, abort: null };
      $("#vMake").disabled = true; $("#vExport").disabled = true; $("#vStop").classList.remove("hidden"); vErr("");
      $("#vOut").innerHTML = ""; $("#vBarWrap").classList.remove("hidden"); $("#vBar").style.width = "0";
      let fallback = false;
      try {
        const blob = await exportFrames();
        showResult(blob, "mp4");
        $("#vExportHint").textContent = "Done. Every frame rendered, so it plays perfectly smooth. Watch it once before you post.";
      } catch (e) {
        if (e instanceof Cancelled) { vlog("Export stopped"); $("#vExportHint").textContent = "Export stopped."; }
        else if (e?.message === "NO_WEBCODECS") { fallback = true; vlog("This browser can't encode MP4 frame by frame, using live recording instead", true); }
        else { vErr(`Export failed: ${e.message || e}`); vlog(`Export failed: ${e.message || e}`, true); }
      } finally {
        $("#vBarWrap").classList.add("hidden");
        run = null; $("#vMake").disabled = false; $("#vExport").disabled = false; $("#vStop").classList.add("hidden");
      }
      if (!fallback) return;
    }
    return exportRealtime();
  };
  function showResult(blob, ext) {
    const url = URL.createObjectURL(blob);
    const name = `${cur.title.replace(/[^\w\- ]+/g, "").trim() || "story"} - Part ${cur.part}.${ext}`;
    $("#vOut").innerHTML = `<video src="${url}" controls playsinline class="vresult"></video>
      <a class="btn primary" href="${url}" download="${esc(name)}">⬇️ Download ${ext.toUpperCase()} (${(blob.size / 1e6).toFixed(1)} MB)</a>
      ${ext === "webm" ? `<p class="hint">This browser saved WebM. Instagram wants MP4: export from Chrome or Edge on your PC to get MP4.</p>` : ""}`;
    vlog(`Export done: ${name}, ${(blob.size / 1e6).toFixed(1)} MB`);
  }
  async function exportRealtime() {
    if (run) return;
    const mime = pickMime();
    if (!mime) { vErr("This browser can't record video. Use Chrome or Edge on your PC."); return; }
    stopPlay();
    run = { t0: Date.now(), cancelled: false, abort: null };
    $("#vMake").disabled = true; $("#vExport").disabled = true; $("#vStop").classList.remove("hidden"); vErr("");
    $("#vOut").innerHTML = ""; $("#vBarWrap").classList.remove("hidden"); $("#vBar").style.width = "0";
    const total = vs.timing.total;
    vlog(`Export started: ${cv.width}x${cv.height}, ${mime}, ${fmt(total * 1000)} long`);
    $("#vExportHint").textContent = `Recording in real time, takes ${fmt(total * 1000)}. Keep this tab open and in front.`;
    const hid = () => { if (document.hidden) vlog("The tab was hidden during export. The video may stutter; export again with the tab in front.", true); };
    document.addEventListener("visibilitychange", hid);
    try {
      const ac = audioCtx(); await ac.resume();
      const dest = ac.createMediaStreamDestination();
      const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: cv.width >= 1080 ? 9e6 : 5e6, audioBitsPerSecond: 160e3 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      draw(0); rec.start(1000);
      await sleep(150);
      await new Promise((res) => {
        const p = play(0, dest, res);
        p.onTick = (t) => { $("#vBar").style.width = `${(t / total) * 100}%`; $("#vExportHint").textContent = `Recording ${fmt(t * 1000)} / ${fmt(total * 1000)}. Keep this tab open and in front.`; };
        const chk = setInterval(() => { if (run?.cancelled) { clearInterval(chk); stopPlay(); res(); } if (!playing) clearInterval(chk); }, 200);
      });
      await sleep(300); rec.stop(); await done;
      stream.getTracks().forEach((tr) => tr.stop());
      if (run.cancelled) throw new Cancelled();
      const type = mime.split(";")[0], ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(parts, { type });
      const url = URL.createObjectURL(blob);
      const name = `${cur.title.replace(/[^\w\- ]+/g, "").trim() || "story"} - Part ${cur.part}.${ext}`;
      $("#vOut").innerHTML = `<video src="${url}" controls playsinline class="vresult"></video>
        <a class="btn primary" href="${url}" download="${esc(name)}">⬇️ Download ${ext.toUpperCase()} (${(blob.size / 1e6).toFixed(1)} MB)</a>
        ${ext === "webm" ? `<p class="hint">This browser saved WebM. Instagram wants MP4: export from Chrome on your PC to get MP4.</p>` : ""}`;
      $("#vExportHint").textContent = "Done. Watch it once before you post.";
      vlog(`Export done: ${name}, ${(blob.size / 1e6).toFixed(1)} MB`);
    } catch (e) {
      if (e instanceof Cancelled) { vlog("Export stopped"); $("#vExportHint").textContent = "Export stopped."; }
      else { vErr(`Export failed: ${e.message || e}`); vlog(`Export failed: ${e.message || e}`, true); }
    } finally {
      document.removeEventListener("visibilitychange", hid);
      $("#vBarWrap").classList.add("hidden");
      run = null; $("#vMake").disabled = false; $("#vExport").disabled = false; $("#vStop").classList.add("hidden");
    }
  };

  // redo buttons
  $("#vSteps").insertAdjacentHTML("afterend", `<div class="vredo"><button class="btn small ghost" id="vRedoVoice">↻ Redo voice</button><button class="btn small ghost" id="vRedoPlan">↻ Redo plan / 3D direction</button></div>`);
  $("#vRedoVoice").onclick = async () => { if (run) return; await del(key("voice")); voiceBuf = null; rawVoice = null; vs.voiceSrc = null; vs.timing = null; save(); refreshSteps(); await prepPlayer(); runJob(async () => { await makeVoice(); await computeTiming(); await prepPlayer(); refreshSteps(); }); };
  $("#vRedoPlan").onclick = () => { if (run) return; vs.plan = null; vs.direction = null; save(); refreshSteps(); toast("The plan / 3D direction will be redone next time you press Make the video."); };

  $("#vBack").onclick = () => { stop(); openScript(cur.id); };
  function stop() { stopPlay(); if (run) { run.cancelled = true; run.abort?.(); } }
  return { open, stop };
}
