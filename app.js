import {
  STYLES, TWEAKS, ideasPrompt, ideasFromPromptPrompt, scriptPrompt, nextPartPrompt, tweakPrompt,
} from "./prompts.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- storage (this browser only)
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sa." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sa." + k, JSON.stringify(v)); } catch { toast("Couldn't save (browser storage is full or blocked)."); } },
};
const cfg = Object.assign({ key: "", model: "", provider: "gemini" }, LS.get("cfg", {}));
const state = {
  mode: LS.get("mode", "auto"),
  style: LS.get("style", "town"),
  count: LS.get("count", 6),
  length: LS.get("length", 75),
  ideas: LS.get("ideas", []),
  ideasSource: LS.get("ideasSource", null),
  seen: LS.get("seen", []),
  scripts: LS.get("scripts", []),
  current: null,
};

// ---------- small helpers
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastT;
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 2200);
}
async function copy(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  toast(what);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- AI: Gemini (free key) with automatic model fallback, or paste from Claude
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const SKIP = ["image", "tts", "audio", "live", "embedding", "native", "computer", "robotics", "vision", "learnlm", "aqa", "omni"];
const GBASE = "https://generativelanguage.googleapis.com/v1beta/";
let modelList = null;
const doneToday = LS.get("doneToday", {});

async function listModels(key) {
  if (modelList && Date.now() - modelList.t < 6 * 3600e3) return modelList.names;
  try {
    const r = await fetch(GBASE + "models?pageSize=1000&key=" + encodeURIComponent(key));
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const t = (await r.text()).toLowerCase();
      if (t.includes("api key") || t.includes("api_key") || t.includes("permission")) throw new KeyError();
    }
    if (!r.ok) return FALLBACK_MODELS;
    const data = await r.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.split("/").pop())
      .filter((n) => n.includes("flash") && !SKIP.some((w) => n.includes(w)));
    const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    names.sort((a, b) => (a.includes("lite") - b.includes("lite")) || (ver(b) - ver(a))
      || ((a.includes("preview") || a.includes("exp")) - (b.includes("preview") || b.includes("exp")))
      || (a.includes("latest") - b.includes("latest")) || a.localeCompare(b));
    if (names.length) { modelList = { t: Date.now(), names: [...new Set(names)] }; return modelList.names; }
  } catch (e) { if (e instanceof KeyError) throw e; }
  return FALLBACK_MODELS;
}
class KeyError extends Error { constructor() { super("Gemini rejected the API key. Check it in Settings (it starts with \"AIza\")."); } }
class QuotaError extends Error {}

async function gemini(prompt, temperature, onStatus) {
  if (!cfg.key) throw new Error("NO_KEY");
  for (const [m, t] of Object.entries(doneToday)) if (Date.now() - t > 6 * 3600e3) delete doneToday[m];
  const avail = await listModels(cfg.key);
  let order = [...new Set([LS.get("goodModel", ""), cfg.model.trim(), ...avail].filter(Boolean))];
  order = order.filter((m) => !doneToday[m]).length ? order.filter((m) => !doneToday[m]) : order;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature },
  });
  let limited = false, gone = [];
  for (const m of order) {
    let minuteWaits = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      let r;
      try {
        r = await fetch(`${GBASE}models/${m}:generateContent?key=${encodeURIComponent(cfg.key)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body });
      } catch {
        if (attempt >= 4) throw new Error("Couldn't reach Gemini. Check your internet and try again.");
        onStatus?.("Connection hiccup, retrying…"); await sleep(4000 * attempt); continue;
      }
      if (r.ok) {
        const data = await r.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!parts) throw new Error("Gemini didn't return any text (it may have blocked the request). Try rewording your prompt.");
        LS.set("goodModel", m);
        return parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
      }
      const detail = await r.text();
      const low = detail.toLowerCase();
      if (r.status === 429) {
        const daily = /per ?day|perday|requestsperday/.test(low) || /limit:\s*0\b/.test(low);
        if (daily || minuteWaits >= 2) { doneToday[m] = Date.now(); LS.set("doneToday", doneToday); limited = true; break; }
        const d = parseInt((detail.match(/"retryDelay":\s*"(\d+)/) || [])[1] || "20", 10);
        minuteWaits++;
        for (let s = Math.min(Math.max(d, 5), 60) + 2; s > 0; s--) { onStatus?.(`Gemini's free tier is catching its breath… ${s}s`); await sleep(1000); }
        continue;
      }
      if (r.status >= 500) { if (attempt >= 3) break; onStatus?.("Gemini is busy, retrying…"); await sleep(5000 * attempt); continue; }
      if (r.status === 404 || (r.status === 400 && low.includes("model") && /not found|not supported|not available|deprecated|no longer/.test(low))) { gone.push(m); break; }
      if ([400, 401, 403].includes(r.status) && (low.includes("api key") || low.includes("api_key") || low.includes("permission"))) throw new KeyError();
      throw new Error(`Gemini error ${r.status}: ${detail.slice(0, 240)}`);
    }
  }
  if (limited) throw new QuotaError("Your free Gemini key has used up today's requests. Google resets them at midnight Pacific (2 AM in Texas).");
  throw new Error(`None of Gemini's models answered${gone.length ? ` (${gone.join(", ")} unavailable)` : ""}. Try again in a minute, or set a model in Settings > Advanced.`);
}

function manualAnswer(prompt, why) {
  return new Promise((resolve, reject) => {
    $("#manWhy").textContent = why;
    $("#manAnswer").value = "";
    $("#manStatus").textContent = "";
    show("#manual");
    $("#manCopy").onclick = () => copy(prompt + "\n\nReply with the JSON only.", "Prompt copied. Paste it into Claude.");
    $("#manCancel").onclick = () => { hide("#manual"); reject(new Error("CANCELLED")); };
    $("#manUse").onclick = () => {
      const t = $("#manAnswer").value.trim();
      try { parseJSON(t); } catch { $("#manStatus").textContent = "That doesn't look like the full answer. Copy everything Claude wrote, including the { } brackets."; return; }
      hide("#manual"); resolve(t);
    };
  });
}

async function ask(prompt, { temperature = 0.85, title = "Writing…" } = {}) {
  if (cfg.provider === "manual") return parseJSON(await manualAnswer(prompt, "You chose \"Paste from Claude\" in Settings."));
  if (!cfg.key) { openSettings("Add your free Gemini key first (or switch to \"Paste from Claude\")."); throw new Error("CANCELLED"); }
  startLoading(title);
  try {
    return parseJSON(await gemini(prompt, temperature, (s) => { $("#loadP").textContent = s; }));
  } catch (e) {
    if (e instanceof QuotaError) { stopLoading(); return parseJSON(await manualAnswer(prompt, e.message + " You can still finish this one with Claude:")); }
    throw e;
  } finally { stopLoading(); }
}

function parseJSON(text) {
  const t = String(text).replace(/^```(?:json)?\s*|\s*```\s*$/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("The AI's answer wasn't readable. Press the button again.");
}

// ---------- loading overlay
const LOAD_LINES = ["Inventing a strange town rule…", "Hiding clues in the background…", "Planting the twist…",
  "Making Grandpa nod at the right moment…", "Writing the line that makes people rewatch…", "Timing the music drop…"];
let loadT;
function startLoading(title) {
  $("#loadH").textContent = title;
  let i = 0; $("#loadP").textContent = LOAD_LINES[0];
  clearInterval(loadT);
  loadT = setInterval(() => { i = (i + 1) % LOAD_LINES.length; $("#loadP").textContent = LOAD_LINES[i]; }, 2600);
  show("#loading");
}
function stopLoading() { clearInterval(loadT); hide("#loading"); }
function show(s) { $(s).classList.remove("hidden"); }
function hide(s) { $(s).classList.add("hidden"); }

function showError(where, e) {
  if (e?.message === "CANCELLED") return;
  const box = $(where);
  box.textContent = e?.message === "NO_KEY" ? "Add your Gemini key in Settings first." : (e?.message || String(e));
  box.classList.remove("hidden");
  if (e instanceof KeyError) openSettings(e.message);
}

// ---------- normalizing AI output
function normIdeas(d) {
  const arr = Array.isArray(d) ? d : d.ideas || [];
  return arr.filter((x) => x && (x.title || x.hook)).map((x) => ({
    id: uid(), title: x.title || "Untitled", hook: x.hook || "", story: x.story || "", twist: x.twist || "",
    clue: x.clue || "", emotion: x.emotion || "", why: x.why || "", characters: x.characters || "",
    cover_text: Array.isArray(x.cover_text) ? x.cover_text : [],
  }));
}
function normScript(d, extra = {}) {
  const s = d.script || d;
  if (!Array.isArray(s.scenes) || !s.scenes.length) throw new Error("The AI's script came back without scenes. Press the button again.");
  return {
    id: extra.id || uid(),
    created: extra.created || Date.now(),
    updated: Date.now(),
    style: extra.style || state.style,
    series: extra.series || s.title || "Untitled",
    title: s.title || extra.series || "Untitled",
    part: Number(s.part) || extra.part || 1,
    length: Number(s.length_seconds) || state.length,
    cover_text: Array.isArray(s.cover_text) ? s.cover_text : [s.hook || ""],
    hook: s.hook || s.scenes[0]?.vo || "",
    scenes: s.scenes.map((x) => ({
      time: x.time || "", visual: x.visual || "", camera: x.camera || "", vo: x.vo || "",
      text: x.text || "", sound: x.sound || "", clue: x.clue || "",
    })),
    clues: Array.isArray(s.clues) ? s.clues : [],
    twist: s.twist || "", ending_text: s.ending_text || "", caption: s.caption || "",
    hashtags: Array.isArray(s.hashtags) ? s.hashtags : [], pinned_comment: s.pinned_comment || "",
    next_part: s.next_part || "", why_it_works: s.why_it_works || "",
    source: extra.source || null, prev: extra.prev || [],
  };
}

// ---------- views
function go(view) {
  for (const v of ["home", "script", "library"]) $("#view-" + v).classList.toggle("hidden", v !== view);
  $$("header nav [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === view));
  if (view === "library") renderLibrary();
  if (view !== "script") { state.current = null; if (location.hash.startsWith("#s=")) history.replaceState(null, "", location.pathname); }
  window.scrollTo(0, 0);
}
$$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

// ---------- home
function renderStyles() {
  $("#styles").innerHTML = Object.entries(STYLES).map(([k, s]) =>
    `<button class="style${k === state.style ? " on" : ""}" data-style="${k}"><b>${esc(s.name)} <i>${esc(s.tag)}</i></b><span>${esc(s.blurb)}</span></button>`).join("");
  $$("#styles .style").forEach((b) => b.onclick = () => { state.style = b.dataset.style; LS.set("style", state.style); renderStyles(); });
}
function setMode(m) {
  state.mode = m; LS.set("mode", m);
  $$(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("#autoFields").classList.toggle("hidden", m !== "auto");
  $("#promptFields").classList.toggle("hidden", m !== "prompt");
  $("#goScript").classList.toggle("hidden", m !== "prompt");
  $("#goIdeas").textContent = m === "auto" ? "✨ Give me ideas" : "✨ Turn it into ideas";
}
$$(".mode").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
function seg(id, key) {
  const btns = $$(`#${id} button`);
  btns.forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.v) === state[key]);
    b.onclick = () => { state[key] = Number(b.dataset.v); LS.set(key, state[key]); btns.forEach((x) => x.classList.toggle("on", x === b)); };
  });
}

async function getIdeas(more = false) {
  hide("#homeErr");
  const text = $("#promptText").value.trim();
  if (state.mode === "prompt" && !text) { showError("#homeErr", new Error("Paste a comment or idea first.")); return; }
  const source = more && state.ideasSource ? state.ideasSource
    : { mode: state.mode, style: state.style, theme: $("#theme").value.trim(), text };
  const avoid = [...state.seen].slice(-40);
  const prompt = source.mode === "prompt"
    ? ideasFromPromptPrompt({ style: source.style, text: source.text, count: state.count }) +
      (more && avoid.length ? `\nDo NOT reuse these earlier ideas: ${avoid.map((t) => `"${t}"`).join(", ")}.` : "")
    : ideasPrompt({ style: source.style, count: state.count, theme: source.theme, avoid });
  try {
    const ideas = normIdeas(await ask(prompt, { temperature: 1.0, title: "Coming up with ideas…" }));
    if (!ideas.length) throw new Error("No ideas came back. Press the button again.");
    state.ideas = more ? [...ideas, ...state.ideas].slice(0, 30) : ideas;
    state.ideasSource = source;
    state.seen = [...new Set([...state.seen, ...ideas.map((i) => i.title)])].slice(-80);
    LS.set("ideas", state.ideas); LS.set("ideasSource", source); LS.set("seen", state.seen);
    renderIdeas();
    $("#ideasWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { showError("#homeErr", e); }
}
function renderIdeas() {
  const wrap = $("#ideasWrap");
  if (!state.ideas.length) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  const src = state.ideasSource;
  $("#ideasTitle").textContent = src?.mode === "prompt" ? "Ideas from your prompt" : src?.theme ? `Ideas: ${src.theme}` : "Pick one";
  $("#ideas").innerHTML = state.ideas.map((i) => `
    <article class="idea">
      <div class="meta"><span class="pill yellow">${esc(STYLES[src?.style || state.style]?.name || "")}</span>${i.emotion ? `<span class="pill">${esc(i.emotion)}</span>` : ""}</div>
      <h3>${esc(i.title)}</h3>
      <div class="hook">“${esc(i.hook)}”</div>
      ${i.characters ? `<p>${esc(i.characters)}</p>` : ""}
      <details class="spoil"><summary>Show the story + twist</summary><div>${esc(i.story)}${i.twist ? `<br><br><b>Twist:</b> ${esc(i.twist)}` : ""}${i.clue ? `<br><br><b>Hidden clue:</b> ${esc(i.clue)}` : ""}</div></details>
      ${i.why ? `<p class="muted">💡 ${esc(i.why)}</p>` : ""}
      <button class="btn primary" data-idea="${i.id}">Write this script →</button>
    </article>`).join("");
  $$("[data-idea]").forEach((b) => b.onclick = () => writeFromIdea(state.ideas.find((i) => i.id === b.dataset.idea)));
}
async function writeFromIdea(idea) {
  hide("#homeErr");
  const style = state.ideasSource?.style || state.style;
  const { id, ...clean } = idea;
  try {
    const s = normScript(await ask(scriptPrompt({ style, idea: clean, length: state.length }), { temperature: 0.8, title: `Writing “${idea.title}”…` }),
      { style, series: idea.title, source: { idea: clean } });
    saveScript(s); openScript(s.id);
  } catch (e) { showError("#homeErr", e); }
}
async function writeFromPrompt() {
  hide("#homeErr");
  const text = $("#promptText").value.trim();
  if (!text) { showError("#homeErr", new Error("Paste a comment or idea first.")); return; }
  try {
    const s = normScript(await ask(scriptPrompt({ style: state.style, text, length: state.length }), { temperature: 0.8, title: "Writing your script…" }),
      { style: state.style, source: { prompt: text } });
    saveScript(s); openScript(s.id);
  } catch (e) { showError("#homeErr", e); }
}
$("#goIdeas").onclick = () => getIdeas(false);
$("#moreIdeas").onclick = () => getIdeas(true);
$("#goScript").onclick = writeFromPrompt;

// ---------- scripts
function saveScript(s) {
  const i = state.scripts.findIndex((x) => x.id === s.id);
  if (i >= 0) state.scripts[i] = s; else state.scripts.unshift(s);
  LS.set("scripts", state.scripts);
  $("#libCount").textContent = state.scripts.length;
}
function openScript(id) {
  const s = state.scripts.find((x) => x.id === id);
  if (!s) { go("home"); return; }
  go("script");
  state.current = s;
  history.replaceState(null, "", "#s=" + s.id);
  renderScript();
}
function renderScript() {
  const s = state.current;
  $("#sPart").textContent = "PART " + s.part;
  $("#sStyle").textContent = STYLES[s.style]?.name || "";
  $("#sLen").textContent = "~" + s.length + "s";
  $("#sTitle").textContent = s.title;
  $("#sHook").textContent = s.hook;
  $("#c1").textContent = s.cover_text[0] || "";
  $("#c2").textContent = s.cover_text[1] || "";
  $("#nextPart").textContent = `➡️ Write Part ${s.part + 1}`;
  $("#undo").classList.toggle("hidden", !s.prev.length);
  $("#sceneCount").textContent = `${s.scenes.length} scenes`;
  $("#scenes").innerHTML = s.scenes.map((x) => `
    <div class="scene${x.clue ? " has-clue" : ""}">
      <div class="time">${esc(x.time)}</div>
      <div>
        <div class="vo">${esc(x.vo) || '<span class="muted">(no voiceover)</span>'}</div>
        <dl>
          ${x.visual ? `<dt>Visual</dt><dd>${esc(x.visual)}</dd>` : ""}
          ${x.camera ? `<dt>Camera</dt><dd>${esc(x.camera)}</dd>` : ""}
          ${x.text ? `<dt>On screen</dt><dd class="ost">${esc(x.text)}</dd>` : ""}
          ${x.sound ? `<dt>Sound</dt><dd>${esc(x.sound)}</dd>` : ""}
          ${x.clue ? `<dt>🔍 Clue</dt><dd class="clue">${esc(x.clue)}</dd>` : ""}
        </dl>
      </div>
    </div>`).join("");
  $("#sClues").innerHTML = s.clues.length
    ? s.clues.map((c) => `<li><b>${esc(c.time)}</b> ${esc(c.what)}${c.means ? ` <span class="muted">→ ${esc(c.means)}</span>` : ""}</li>`).join("")
    : '<li class="muted">No clues listed.</li>';
  $("#sTwist").textContent = s.twist;
  $("#sEnd").textContent = s.ending_text;
  $("#sCaption").textContent = captionText(s);
  $("#sPinned").textContent = s.pinned_comment;
  $("#sNext").textContent = s.next_part || "Stands alone.";
  $("#sWhy").textContent = s.why_it_works;
  $$("#view-script details.spoil").forEach((d) => { d.open = false; });
}
function captionText(s) { return [s.caption, s.hashtags.join(" ")].filter(Boolean).join("\n\n"); }
function voText(s) { return s.scenes.map((x) => x.vo).filter(Boolean).join("\n"); }
function fullText(s) {
  const L = [];
  L.push(`${s.title.toUpperCase()} — PART ${s.part} (~${s.length}s, ${STYLES[s.style]?.name || ""})`, "");
  L.push(`COVER TEXT: ${s.cover_text.join(" / ")}`, `HOOK: ${s.hook}`, "", "SCENES");
  for (const x of s.scenes) {
    L.push(`[${x.time}] VO: ${x.vo}`);
    for (const [k, v] of [["Visual", x.visual], ["Camera", x.camera], ["On screen", x.text], ["Sound", x.sound], ["CLUE", x.clue]]) if (v) L.push(`   ${k}: ${v}`);
  }
  L.push("", "HIDDEN CLUES", ...s.clues.map((c) => `- ${c.time} ${c.what}${c.means ? ` → ${c.means}` : ""}`));
  L.push("", `TWIST: ${s.twist}`, `LAST LINE ON SCREEN: ${s.ending_text}`, "", "CAPTION", captionText(s), "", `PINNED COMMENT: ${s.pinned_comment}`);
  if (s.next_part) L.push(`NEXT PART: ${s.next_part}`);
  L.push("", "VOICEOVER ONLY", voText(s));
  return L.join("\n");
}
$("#copyVO").onclick = () => copy(voText(state.current), "Voiceover copied");
$("#copyAll").onclick = () => copy(fullText(state.current), "Full script copied");
$("#download").onclick = () => {
  const s = state.current;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([fullText(s)], { type: "text/plain" }));
  a.download = `${s.title.replace(/[^\w\- ]+/g, "").trim() || "story"} - Part ${s.part}.txt`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$$("[data-copy]").forEach((b) => b.onclick = () => {
  const s = state.current;
  copy(b.dataset.copy === "caption" ? captionText(s) : s.pinned_comment, "Copied");
});

async function tweak(askText) {
  const s = state.current;
  try {
    const { prev, source, ...plain } = s;
    const n = normScript(await ask(tweakPrompt({ style: s.style, script: plain, ask: askText }), { temperature: 0.8, title: "Rewriting…" }),
      { id: s.id, created: s.created, style: s.style, series: s.series, part: s.part, source: s.source,
        prev: [...s.prev, plain].slice(-5) });
    n.part = s.part;
    saveScript(n); state.current = n; renderScript(); toast("Updated. Press Undo to go back.");
  } catch (e) { if (e?.message !== "CANCELLED") toast(e.message || String(e)); }
}
$$("[data-tweak]").forEach((b) => b.onclick = () => tweak(TWEAKS[b.dataset.tweak]));
$("#tweakGo").onclick = () => { const t = $("#tweakText").value.trim(); if (t) { tweak(t); $("#tweakText").value = ""; } };
$("#tweakText").onkeydown = (e) => { if (e.key === "Enter") $("#tweakGo").click(); };
$("#undo").onclick = () => {
  const s = state.current; if (!s.prev.length) return;
  const last = s.prev[s.prev.length - 1];
  const r = { ...last, id: s.id, prev: s.prev.slice(0, -1), source: s.source, updated: Date.now() };
  saveScript(r); state.current = r; renderScript(); toast("Went back one version");
};
$("#nextPart").onclick = async () => {
  const s = state.current;
  const note = prompt(`Anything you want in Part ${s.part + 1}? (optional, e.g. a viewer comment)`, "");
  if (note === null) return;
  try {
    const { prev, source, ...plain } = s;
    const n = normScript(await ask(nextPartPrompt({ style: s.style, script: plain, length: s.length, note: note.trim() }), { temperature: 0.85, title: `Writing Part ${s.part + 1}…` }),
      { style: s.style, series: s.series, part: s.part + 1, source: { after: s.id } });
    n.part = s.part + 1;
    n.series = s.series;
    saveScript(n); openScript(n.id);
  } catch (e) { if (e?.message !== "CANCELLED") toast(e.message || String(e)); }
};
$("#deleteScript").onclick = () => {
  if (!confirm("Delete this script?")) return;
  state.scripts = state.scripts.filter((x) => x.id !== state.current.id);
  LS.set("scripts", state.scripts); $("#libCount").textContent = state.scripts.length;
  go("library");
};

// ---------- library
function renderLibrary() {
  const lib = $("#lib");
  if (!state.scripts.length) { lib.innerHTML = '<div class="empty">No scripts yet. Make your first one on the New story page.</div>'; return; }
  const sorted = [...state.scripts].sort((a, b) => a.series.localeCompare(b.series) || a.part - b.part);
  const groups = {};
  for (const s of sorted) (groups[s.series] ||= []).push(s);
  const order = Object.keys(groups).sort((a, b) => Math.max(...groups[b].map((s) => s.updated)) - Math.max(...groups[a].map((s) => s.updated)));
  lib.innerHTML = order.flatMap((g) => groups[g]).map((s) => `
    <div class="libitem" data-open="${s.id}" tabindex="0">
      <span class="pill red">PART ${s.part}</span>
      <div class="grow"><b>${esc(s.title)}</b><div class="sub">${esc(s.hook)}</div></div>
      <span class="muted" style="font-size:13px">${new Date(s.updated).toLocaleDateString()}</span>
    </div>`).join("");
  $$("[data-open]").forEach((el) => {
    el.onclick = () => openScript(el.dataset.open);
    el.onkeydown = (e) => { if (e.key === "Enter") openScript(el.dataset.open); };
  });
}

// ---------- settings
function openSettings(msg) {
  $("#keyInput").value = cfg.key;
  $("#modelInput").value = cfg.model;
  $$("#provSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === cfg.provider));
  const st = $("#keyStatus");
  st.textContent = msg || ""; st.className = "status" + (msg ? " bad" : "");
  show("#settings");
  setTimeout(() => $("#keyInput").focus(), 50);
}
$("#openSettings").onclick = () => openSettings();
$("#closeSettings").onclick = () => hide("#settings");
$$("#provSeg button").forEach((b) => b.onclick = () => $$("#provSeg button").forEach((x) => x.classList.toggle("on", x === b)));
$("#saveSettings").onclick = () => {
  cfg.key = $("#keyInput").value.trim();
  cfg.model = $("#modelInput").value.trim();
  cfg.provider = $("#provSeg button.on")?.dataset.v || "gemini";
  LS.set("cfg", cfg); modelList = null;
  hide("#settings"); toast("Saved");
};
$("#testKey").onclick = async () => {
  const st = $("#keyStatus");
  const key = $("#keyInput").value.trim();
  if (!key) { st.textContent = "Paste a key first."; st.className = "status bad"; return; }
  st.textContent = "Checking…"; st.className = "status";
  try {
    const r = await fetch(GBASE + "models?pageSize=5&key=" + encodeURIComponent(key));
    if (r.ok) { st.textContent = "✓ Key works."; st.className = "status ok"; }
    else { st.textContent = "Google rejected this key. Copy it again from AI Studio."; st.className = "status bad"; }
  } catch { st.textContent = "Couldn't reach Google. Check your internet."; st.className = "status bad"; }
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#settings").classList.contains("hidden")) hide("#settings");
});

// ---------- start
renderStyles();
setMode(state.mode);
seg("countSeg", "count");
seg("lenSeg", "length");
renderIdeas();
$("#libCount").textContent = state.scripts.length;
if (location.hash.startsWith("#s=")) openScript(location.hash.slice(3));
else go("home");
if (!cfg.key && cfg.provider === "gemini") setTimeout(() => openSettings(), 400);
