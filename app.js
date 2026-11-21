import {
  STYLES, TWEAKS, ideasPrompt, ideasFromPromptPrompt, scriptPrompt, nextPartPrompt, tweakPrompt,
} from "./prompts.js?v=1.1";

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

// ---------- activity log (saved in this browser so you can copy it for Claude)
const VERSION = "1.1";
const LOG = LS.get("log", []);
function log(msg, bad = false) {
  const line = `${new Date().toLocaleTimeString()}  ${bad ? "✗ " : ""}${msg}`;
  LOG.push(line);
  if (LOG.length > 400) LOG.splice(0, LOG.length - 400);
  LS.set("log", LOG);
  if (job) {
    const el = $("#progLog");
    el.textContent += (el.textContent ? "\n" : "") + line;
    el.scrollTop = el.scrollHeight;
  }
}

// ---------- progress window: real steps, a timer, cancel, retry, and a report to copy
const STEPS = [
  ["model", "Connect to Gemini"],
  ["send", "Send your request"],
  ["think", "AI is thinking"],
  ["recv", "Writing it out"],
  ["check", "Check the answer"],
];
// How long to wait before giving up on a step (can be changed for testing via localStorage "sa.timeouts")
const T = Object.assign({ headers: 45e3, first: 150e3, idle: 45e3 }, LS.get("timeouts", {}));
let job = null;
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
class Cancelled extends Error { constructor() { super("CANCELLED"); } }

function startJob(title) {
  job = { title, t0: Date.now(), stepT: Date.now(), cur: null, cancelled: false, abort: null, err: null };
  $("#progH").textContent = title;
  $("#progSteps").innerHTML = STEPS.map(([k, l]) =>
    `<li data-step="${k}"><span class="ic"></span><span class="lb">${l}</span><span class="sub"></span></li>`).join("");
  $("#progLog").textContent = "";
  $("#progHint").textContent = "";
  hide("#progErr"); show("#progRun"); hide("#progDone");
  $("#progress").classList.remove("failed");
  clearInterval(job.tick);
  job.tick = setInterval(tickJob, 500);
  tickJob();
  show("#progress");
  log(`— ${title}  (Story Agent v${VERSION})`);
}
function tickJob() {
  if (!job || job.err) return;
  $("#progTime").textContent = fmt(Date.now() - job.t0);
  const inStep = Date.now() - job.stepT;
  let hint = "";
  if (job.cur === "think" && inStep > 25e3) hint = `Long scripts can take Google 1–2 minutes. It gives up and tries another model at ${fmt(T.first)}.`;
  if (job.cur === "send" && inStep > 15e3) hint = "Google is slow to pick up. Hang on…";
  $("#progHint").textContent = hint;
}
function step(k, sub) {
  if (!job) return;
  const keys = STEPS.map((s) => s[0]);
  const idx = keys.indexOf(k);
  if (k !== job.cur) { job.cur = k; job.stepT = Date.now(); }
  keys.forEach((kk, i) => {
    const li = $(`#progSteps [data-step="${kk}"]`);
    li.className = i < idx ? "done" : i === idx ? "on" : "";
  });
  if (sub !== undefined) stepSub(k, sub);
}
function stepSub(k, sub) { const el = job && $(`#progSteps [data-step="${k}"] .sub`); if (el) el.textContent = sub; }
function endJob() { if (job) clearInterval(job.tick); job = null; hide("#progress"); }
function cancelJob() { if (!job) return; job.cancelled = true; log("You pressed Cancel"); job.abort?.(); job.onChoice?.("close"); }
function report() {
  const label = (STEPS.find((s) => s[0] === job?.cur) || [])[1] || "";
  const sub = job?.cur ? $(`#progSteps [data-step="${job.cur}"] .sub`)?.textContent : "";
  return [
    `Story Agent v${VERSION} report`,
    `When: ${new Date().toLocaleString()}`,
    job ? `Task: ${job.title}` : "",
    job ? `Step: ${label}${sub ? ` (${sub})` : ""} after ${fmt(Date.now() - job.t0)}` : "",
    job?.err ? `Error: ${job.err.message}` : "",
    `Browser: ${navigator.userAgent}`,
    "", "Log:", ...LOG.slice(-60),
  ].filter((l) => l !== "").join("\n");
}
// Show the error in the window and wait for Try again / Close
function failJob(e) {
  job.err = e;
  clearInterval(job.tick);
  const li = job.cur && $(`#progSteps [data-step="${job.cur}"]`);
  if (li) li.className = "bad";
  $("#progress").classList.add("failed");
  $("#progErrMsg").textContent = e.message || String(e);
  show("#progErr"); hide("#progRun"); show("#progDone");
  $("#progHint").textContent = "";
  log(e.message || String(e), true);
  return new Promise((res) => { job.onChoice = res; });
}
$("#progCancel").onclick = cancelJob;
$("#progClose").onclick = () => job?.onChoice?.("close");
$("#progRetry").onclick = () => job?.onChoice?.("retry");
$$(".progCopy").forEach((b) => b.onclick = () => copy(report(), "Report copied. Paste it to Claude."));

// Read Gemini's streamed answer piece by piece so we can show real progress
async function readStream(r, watch, unit) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", finish = "", blocked = "";
  const t0 = Date.now();
  const handle = (line) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    let d;
    try { d = JSON.parse(line.slice(5)); } catch { return; }
    if (d.error) throw new Error(`Gemini error: ${d.error.message || JSON.stringify(d.error).slice(0, 200)}`);
    if (d.promptFeedback?.blockReason) blocked = d.promptFeedback.blockReason;
    const c = d.candidates?.[0];
    if (c?.finishReason) finish = c.finishReason;
    const t = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!t) return;
    if (!out) { step("recv"); log(`First words arrived after ${Math.round((Date.now() - t0) / 1000)}s of thinking`); }
    out += t;
    watch(T.idle, "idle");
    const n = unit ? (out.match(unit.re) || []).length : 0;
    stepSub("recv", `${out.length.toLocaleString()} characters${unit ? ` · ${n} ${unit.label}` : ""}`);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  log(`Finished: ${out.length.toLocaleString()} characters, reason ${finish || "none given"}`);
  if (blocked) throw new Error(`Google blocked this request (${blocked}). Try rewording your prompt.`);
  if (finish === "MAX_TOKENS") throw new Error("The answer got cut off because it was too long. Press Try again, or pick a shorter video length.");
  if (finish && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(finish)) throw new Error(`Gemini stopped early (reason: ${finish}). Try again or reword your prompt.`);
  if (!out.trim()) throw new Error("Gemini sent back an empty answer. Press Try again.");
  return out;
}

async function gemini(prompt, temperature, unit) {
  if (!cfg.key) throw new Error("NO_KEY");
  step("model", "Checking your key…");
  for (const [m, t] of Object.entries(doneToday)) if (Date.now() - t > 6 * 3600e3) delete doneToday[m];
  const avail = await listModels(cfg.key);
  let order = [...new Set([LS.get("goodModel", ""), cfg.model.trim(), ...avail].filter(Boolean))];
  order = order.filter((m) => !doneToday[m]).length ? order.filter((m) => !doneToday[m]) : order;
  log(`Models to try: ${order.slice(0, 4).join(", ")}${order.length > 4 ? "…" : ""}`);
  stepSub("model", `${order.length} models ready`);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature },
  });
  let limited = false, gone = [], slow = [];
  for (const m of order) {
    let minuteWaits = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (job?.cancelled) throw new Cancelled();
      step("send", m + (attempt > 1 ? ` (try ${attempt})` : ""));
      log(`Sending to ${m}${attempt > 1 ? ` (try ${attempt})` : ""}`);
      const ctrl = new AbortController();
      let timer, why = "";
      const watch = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
      job.abort = () => ctrl.abort();
      watch(T.headers, "headers");
      let r;
      try {
        r = await fetch(`${GBASE}models/${m}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.key)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctrl.signal });
      } catch {
        clearTimeout(timer);
        if (job?.cancelled) throw new Cancelled();
        if (why) { log(`${m} didn't pick up within ${T.headers / 1000}s`, true); slow.push(m); break; }
        log(`Couldn't reach Google (try ${attempt})`, true);
        if (attempt >= 4) throw new Error("Couldn't reach Google's AI. Check your internet and press Try again.");
        stepSub("send", "Connection hiccup, retrying…"); await sleep(4000 * attempt); continue;
      }
      log(`${m} replied: HTTP ${r.status}`);
      if (r.ok) {
        step("think", "Waiting for the first words…");
        watch(T.first, "first");
        try {
          const text = await readStream(r, watch, unit);
          clearTimeout(timer);
          LS.set("goodModel", m);
          return text;
        } catch (e) {
          clearTimeout(timer);
          if (job?.cancelled) throw new Cancelled();
          if (why === "first") { log(`${m} thought for ${T.first / 1000}s without writing anything. Trying the next model.`, true); slow.push(m); break; }
          if (why === "idle") { log(`${m} stopped mid-answer for ${T.idle / 1000}s. Trying the next model.`, true); slow.push(m); break; }
          if (e.name === "AbortError" || e.name === "TypeError") {
            log(`Connection dropped while ${m} was answering`, true);
            if (attempt >= 3) { slow.push(m); break; }
            await sleep(2000); continue;
          }
          throw e;
        }
      }
      clearTimeout(timer);
      const detail = await r.text();
      const low = detail.toLowerCase();
      log(`Google said: ${detail.replace(/\s+/g, " ").slice(0, 220)}`, true);
      if (r.status === 429) {
        const daily = /per ?day|perday|requestsperday/.test(low) || /limit:\s*0\b/.test(low);
        if (daily || minuteWaits >= 2) { doneToday[m] = Date.now(); LS.set("doneToday", doneToday); limited = true; log(`${m} is out of free uses for today`); break; }
        const d = parseInt((detail.match(/"retryDelay":\s*"(\d+)/) || [])[1] || "20", 10);
        minuteWaits++;
        for (let s = Math.min(Math.max(d, 5), 60) + 2; s > 0; s--) {
          if (job?.cancelled) throw new Cancelled();
          stepSub("send", `Free tier limit, waiting ${s}s…`); await sleep(1000);
        }
        continue;
      }
      if (r.status >= 500) { if (attempt >= 3) break; stepSub("send", "Google is busy, retrying…"); await sleep(5000 * attempt); continue; }
      if (r.status === 404 || (r.status === 400 && low.includes("model") && /not found|not supported|not available|deprecated|no longer/.test(low))) { gone.push(m); break; }
      if ([400, 401, 403].includes(r.status) && (low.includes("api key") || low.includes("api_key") || low.includes("permission"))) throw new KeyError();
      throw new Error(`Gemini error ${r.status}: ${detail.slice(0, 240)}`);
    }
  }
  if (limited && !slow.length) throw new QuotaError("Your free Gemini key has used up today's requests. Google resets them at midnight Pacific (2 AM in Texas).");
  if (slow.length) throw new Error(`Google's AI was too slow to answer (${slow.join(", ")}). Press Try again in a minute.`);
  throw new Error(`None of Gemini's models answered${gone.length ? ` (${gone.join(", ")} unavailable)` : ""}. Try again in a minute, or set a model in Settings > Advanced.`);
}

function manualAnswer(prompt, why) {
  return new Promise((resolve, reject) => {
    $("#manWhy").textContent = why;
    $("#manAnswer").value = "";
    $("#manStatus").textContent = "";
    show("#manual");
    $("#manCopy").onclick = () => copy(prompt + "\n\nReply with the JSON only.", "Prompt copied. Paste it into Claude.");
    $("#manCancel").onclick = () => { hide("#manual"); reject(new Cancelled()); };
    $("#manUse").onclick = () => {
      const t = $("#manAnswer").value.trim();
      try { parseJSON(t); } catch { $("#manStatus").textContent = "That doesn't look like the full answer. Copy everything Claude wrote, including the { } brackets."; return; }
      hide("#manual"); resolve(t);
    };
  });
}

// unit: what to count while it writes, e.g. scenes. norm: turns the answer into ideas/script (its errors show in "Check the answer").
async function ask(prompt, { temperature = 0.85, title = "Writing…", unit = null, norm = (d) => d } = {}) {
  if (cfg.provider === "manual") return norm(parseJSON(await manualAnswer(prompt, "You chose \"Paste from Claude\" in Settings.")));
  if (!cfg.key) { openSettings("Add your free Gemini key first (or switch to \"Paste from Claude\")."); throw new Cancelled(); }
  for (;;) {
    startJob(title);
    try {
      const text = await gemini(prompt, temperature, unit);
      step("check", "Reading the answer…");
      const out = norm(parseJSON(text));
      log(`Done in ${fmt(Date.now() - job.t0)}`);
      endJob();
      return out;
    } catch (e) {
      if (e instanceof Cancelled || job?.cancelled) { endJob(); throw new Cancelled(); }
      if (e instanceof QuotaError) { log(e.message, true); endJob(); return norm(parseJSON(await manualAnswer(prompt, e.message + " You can still finish this one with Claude:"))); }
      if (e instanceof KeyError) { log(e.message, true); endJob(); openSettings(e.message); throw new Cancelled(); }
      if (e?.message === "NO_KEY") { endJob(); throw e; }
      const choice = await failJob(e);
      if (choice === "retry") { log("You pressed Try again"); continue; }
      endJob(); throw new Cancelled();
    }
  }
}

function parseJSON(text) {
  const t = String(text).replace(/^```(?:json)?\s*|\s*```\s*$/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error("The AI's answer wasn't readable (it may have been cut off). Press Try again.");
}

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
const UNIT_SCENES = { re: /"vo"\s*:/g, label: "scenes" };
const UNIT_IDEAS = { re: /"twist"\s*:/g, label: "ideas" };
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
    const ideas = await ask(prompt, { temperature: 1.0, title: "Coming up with ideas…", unit: UNIT_IDEAS,
      norm: (d) => { const x = normIdeas(d); if (!x.length) throw new Error("No ideas came back. Press Try again."); return x; } });
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
    const s = await ask(scriptPrompt({ style, idea: clean, length: state.length }), { temperature: 0.8, title: `Writing “${idea.title}”…`, unit: UNIT_SCENES,
      norm: (d) => normScript(d, { style, series: idea.title, source: { idea: clean } }) });
    saveScript(s); openScript(s.id);
  } catch (e) { showError("#homeErr", e); }
}
async function writeFromPrompt() {
  hide("#homeErr");
  const text = $("#promptText").value.trim();
  if (!text) { showError("#homeErr", new Error("Paste a comment or idea first.")); return; }
  try {
    const s = await ask(scriptPrompt({ style: state.style, text, length: state.length }), { temperature: 0.8, title: "Writing your script…", unit: UNIT_SCENES,
      norm: (d) => normScript(d, { style: state.style, source: { prompt: text } }) });
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
    const n = await ask(tweakPrompt({ style: s.style, script: plain, ask: askText }), { temperature: 0.8, title: "Rewriting…", unit: UNIT_SCENES,
      norm: (d) => normScript(d, { id: s.id, created: s.created, style: s.style, series: s.series, part: s.part, source: s.source,
        prev: [...s.prev, plain].slice(-5) }) });
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
    const n = await ask(nextPartPrompt({ style: s.style, script: plain, length: s.length, note: note.trim() }), { temperature: 0.85, title: `Writing Part ${s.part + 1}…`, unit: UNIT_SCENES,
      norm: (d) => normScript(d, { style: s.style, series: s.series, part: s.part + 1, source: { after: s.id } }) });
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
function renderLog() { $("#logBox").textContent = LOG.length ? LOG.slice(-150).join("\n") : "Nothing yet."; }
$("#logDetails").ontoggle = renderLog;
$("#logCopy").onclick = () => copy(report(), "Report copied. Paste it to Claude.");
$("#logClear").onclick = () => { LOG.length = 0; LS.set("log", LOG); renderLog(); };
$("#verLabel").textContent = "Story Agent v" + VERSION;
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
