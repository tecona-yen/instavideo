/* Instavideo app.js - UI/UX fixes (start controls, drawer isolation, sound, like/dislike, transitions)
   Note: This version assumes index.html provides the IDs used below.
*/

const PERSONALIZATION_KEY = "instavideo_state";
const SOUND_PREF_KEY = "instavideo_sound_enabled";
const RECENT_VIDEO_BAN = 5;
const RECENT_TAG_WINDOW = 10;
const MAX_TAGS_PER_VIDEO = 10;

const SCORE = { alpha: 1.0, beta: 0.7, delta: 0.8, gamma: 0.15 };

const ui = {
  startScreen: document.getElementById("start-screen"),
  feedScreen: document.getElementById("feed-screen"),
  startButton: document.getElementById("start-button"),
  startControlsButton: document.getElementById("start-controls-button"),

  stage: document.getElementById("video-stage"),
  hashtags: document.getElementById("hashtags"),

  likeButton: document.getElementById("like-button"),
  dislikeButton: document.getElementById("dislike-button"),
  soundButton: document.getElementById("sound-button"),

  controlsButton: document.getElementById("controls-button"),
  controlsDrawer: document.getElementById("controls-drawer"),
  closeControls: document.getElementById("close-controls"),

  strengthSlider: document.getElementById("strength-slider"),
  explorationSlider: document.getElementById("exploration-slider"),
  strengthValue: document.getElementById("strength-value"),
  explorationValue: document.getElementById("exploration-value"),
  overrideToggle: document.getElementById("override-toggle"),
  shuffleToggle: document.getElementById("shuffle-toggle"),

  tagSearch: document.getElementById("tag-search"),
  tagList: document.getElementById("tag-list"),

  resetOverrides: document.getElementById("reset-overrides"),
  randomizeOverrides: document.getElementById("randomize-overrides"),
  resetProfile: document.getElementById("reset-profile"),
  resetHistory: document.getElementById("reset-history"),
};

const appState = {
  validTags: new Set(),
  videos: [],
  model: null,

  timeline: [],
  cursor: -1,
  currentView: null,
  renderedSlides: new Map(),

  selectionBusy: false,
  touchStartY: null,
  lastDirection: 1,

  soundEnabled: true,
};

init();

async function init() {
  assertUI();

  appState.soundEnabled = loadSoundPref(); // default true
  syncSoundIcon();

  const [validTagText, tagsText] = await Promise.all([
    fetch("./valid_tags.txt").then(reqTextOrThrow("valid_tags.txt")),
    fetch("./tags.txt").then(reqTextOrThrow("tags.txt")),
  ]);

  appState.validTags = parseValidTags(validTagText);
  appState.model = loadModel(appState.validTags);

  const parsedVideos = parseTagsFile(tagsText, appState.validTags);
  appState.videos = await filterLoadableVideos(parsedVideos);

  if (appState.videos.length === 0) {
    ui.startButton.disabled = true;
    ui.startButton.textContent = "No loadable videos";
    return;
  }

  bindEvents();
  renderControls();
  removeDuplicateSoundButtons();
}

function assertUI() {
  const required = ["startScreen","feedScreen","startButton","stage","controlsDrawer"];
  for (const k of required) if (!ui[k]) throw new Error("Missing element: " + k);
}
function reqTextOrThrow(name){ return async r => { if(!r.ok) throw new Error("Failed fetch " + name); return r.text(); }; }

/* ---------- Parsing ---------- */
function parseValidTags(text){
  const set = new Set();
  text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(t=>{ if(t.startsWith("#")) set.add(t); });
  return set;
}
function parseTagsFile(text, validTags){
  const list = [];
  const seen = new Set();
  text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(line=>{
    const idx = line.indexOf(":");
    if(idx === -1) return;
    const fileName = line.slice(0, idx).trim();
    if(!fileName.endsWith(".mp4") || seen.has(fileName)) return;

    const tags = Array.from(new Set(
      line.slice(idx+1).split(",").map(t=>t.trim()).filter(t=>validTags.has(t))
    )).slice(0, MAX_TAGS_PER_VIDEO);

    if(tags.length === 0) return;

    seen.add(fileName);
    list.push({ id: fileName, src: `./videos/${fileName}`, tags });
  });
  return list;
}

async function filterLoadableVideos(videos){
  const out = await Promise.all(videos.map(async v => (await canLoadVideo(v.src)) ? v : null));
  return out.filter(Boolean);
}
function canLoadVideo(src){
  return new Promise(resolve=>{
    const v = document.createElement("video");
    let done = false;
    const finish = ok => { if(done) return; done=true; try{ v.removeAttribute("src"); v.load(); }catch{} resolve(ok); };
    const timer = setTimeout(()=>finish(false), 8000);

    v.preload = "metadata";
    v.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(v.duration) && v.duration > 0 && v.duration <= 1200); };
    v.onerror = () => { clearTimeout(timer); finish(false); };
    v.src = src;
  });
}

/* ---------- Storage ---------- */
function defaultModel(validTags){
  const tagModel = {}, override = {};
  validTags.forEach(tag=>{ tagModel[tag] = {a:1,b:1,w:0}; override[tag]=0; });
  return { tagModel, controls:{ strength:0.7, exploration:0.2, overrideEnabled:true, shuffleMode:false, override }, recentVideos:[], recentTagCounts:{}, history:[] };
}
function loadModel(validTags){
  const fallback = defaultModel(validTags);
  const raw = localStorage.getItem(PERSONALIZATION_KEY);
  if(!raw){ persistModel(fallback); return fallback; }
  try{
    const parsed = JSON.parse(raw);
    const model = defaultModel(validTags);

    model.controls.strength = clamp(parsed?.controls?.strength ?? model.controls.strength, 0,1);
    model.controls.exploration = clamp(parsed?.controls?.exploration ?? model.controls.exploration, 0,1);
    model.controls.overrideEnabled = Boolean(parsed?.controls?.overrideEnabled ?? model.controls.overrideEnabled);
    model.controls.shuffleMode = Boolean(parsed?.controls?.shuffleMode ?? model.controls.shuffleMode);

    model.recentVideos = Array.isArray(parsed?.recentVideos) ? parsed.recentVideos.slice(-RECENT_VIDEO_BAN) : [];
    model.history = Array.isArray(parsed?.history) ? parsed.history : [];
    model.recentTagCounts = parsed?.recentTagCounts && typeof parsed.recentTagCounts === "object" ? parsed.recentTagCounts : {};

    validTags.forEach(tag=>{
      const row = parsed?.tagModel?.[tag] || {};
      model.tagModel[tag] = {
        a: Math.max(1, Number.isFinite(row.a) ? row.a : 1),
        b: Math.max(1, Number.isFinite(row.b) ? row.b : 1),
        w: clamp(Number.isFinite(row.w) ? row.w : 0, -3, 3),
      };
      model.controls.override[tag] = clamp(parsed?.controls?.override?.[tag] ?? 0, -3,3);
    });

    persistModel(model);
    return model;
  }catch{
    persistModel(fallback);
    return fallback;
  }
}
function persistModel(model){ localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(model, null, 2)); }

/* ---------- Sound pref ---------- */
function loadSoundPref(){
  const raw = localStorage.getItem(SOUND_PREF_KEY);
  if(raw === null) return true; // default ON
  return raw === "1";
}
function saveSoundPref(enabled){ localStorage.setItem(SOUND_PREF_KEY, enabled ? "1" : "0"); }
function syncSoundIcon(){ if(ui.soundButton) ui.soundButton.textContent = appState.soundEnabled ? "🔊" : "🔇"; }
function applySoundToVideo(video){ video.muted = !appState.soundEnabled; video.volume = 1; }
function toggleSound(){
  appState.soundEnabled = !appState.soundEnabled;
  saveSoundPref(appState.soundEnabled);
  syncSoundIcon();
  const id = appState.currentView?.videoId;
  const slide = id ? appState.renderedSlides.get(id) : null;
  const video = slide?.querySelector("video");
  if(video){ applySoundToVideo(video); video.play().catch(()=>{}); }
}

/* ---------- Events ---------- */
function bindEvents(){
  ui.startButton.addEventListener("click", startFeed);

  // FIX: Home "Customize algorithm" opens drawer
  ui.startControlsButton?.addEventListener("click", () => toggleControls(true));

  ui.controlsButton?.addEventListener("click", () => toggleControls(true));
  ui.closeControls?.addEventListener("click", () => toggleControls(false));

  // FIX: drawer scroll should not scroll feed behind it (mobile + desktop)
  const stop = e => e.stopPropagation();
  ui.controlsDrawer.addEventListener("wheel", stop, { passive:true });
  ui.controlsDrawer.addEventListener("touchstart", stop, { passive:true });
  ui.controlsDrawer.addEventListener("touchmove", stop, { passive:true });
  ui.controlsDrawer.addEventListener("touchend", stop, { passive:true });

  // FIX: like/dislike wiring + animation
  ui.likeButton?.addEventListener("click", () => { registerVote("like"); });
  ui.dislikeButton?.addEventListener("click", () => { registerVote("dislike"); });

  // FIX: single working sound button on side
  ui.soundButton?.addEventListener("click", () => toggleSound());

  ui.strengthSlider?.addEventListener("input", () => { appState.model.controls.strength = Number(ui.strengthSlider.value); persistModel(appState.model); renderControlsHeader(); });
  ui.explorationSlider?.addEventListener("input", () => { appState.model.controls.exploration = Number(ui.explorationSlider.value); persistModel(appState.model); renderControlsHeader(); });
  ui.overrideToggle?.addEventListener("change", () => { appState.model.controls.overrideEnabled = ui.overrideToggle.checked; persistModel(appState.model); });
  ui.shuffleToggle?.addEventListener("change", () => { appState.model.controls.shuffleMode = ui.shuffleToggle.checked; persistModel(appState.model); });

  ui.tagSearch?.addEventListener("input", renderTagRows);
  ui.resetOverrides?.addEventListener("click", handleResetOverrides);
  ui.randomizeOverrides?.addEventListener("click", handleRandomizeOverrides);
  ui.resetProfile?.addEventListener("click", handleResetProfile);
  ui.resetHistory?.addEventListener("click", handleResetHistory);

  window.addEventListener("wheel", (e)=>{
    if(!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if(!ui.controlsDrawer.hidden) return;
    if(e.deltaY>0) scheduleTransition(1);
    if(e.deltaY<0) scheduleTransition(-1);
  }, { passive:true });

  window.addEventListener("keydown", (e)=>{
    if(!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if(!ui.controlsDrawer.hidden) return;
    if(e.key==="ArrowDown") scheduleTransition(1);
    if(e.key==="ArrowUp") scheduleTransition(-1);
  });

  window.addEventListener("touchstart", (e)=>{
    if(!ui.feedScreen.classList.contains("active")) return;
    if(!ui.controlsDrawer.hidden) return;
    appState.touchStartY = e.changedTouches[0]?.clientY ?? null;
  }, { passive:true });

  window.addEventListener("touchend", (e)=>{
    if(!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if(!ui.controlsDrawer.hidden) return;
    if(appState.touchStartY===null) return;
    const endY = e.changedTouches[0]?.clientY;
    if(typeof endY!=="number") return;
    const delta = appState.touchStartY - endY;
    if(delta>35) scheduleTransition(1);
    if(delta<-35) scheduleTransition(-1);
    appState.touchStartY = null;
  }, { passive:true });
}

async function toggleControls(show){
  ui.controlsDrawer.hidden = !show;
  if(show){
    try{
      await refreshTagsFromDisk();
    }catch(e){
      console.warn("Tag refresh failed:", e);
    }
  }
}


/* ---------- Controls UI ---------- */
function renderControls(){ renderControlsHeader(); renderTagRows(); }
function renderControlsHeader(){
  if(ui.strengthSlider) ui.strengthSlider.value = String(appState.model.controls.strength);
  if(ui.explorationSlider) ui.explorationSlider.value = String(appState.model.controls.exploration);
  if(ui.overrideToggle) ui.overrideToggle.checked = appState.model.controls.overrideEnabled;
  if(ui.shuffleToggle) ui.shuffleToggle.checked = Boolean(appState.model.controls.shuffleMode);
  if(ui.strengthValue) ui.strengthValue.textContent = appState.model.controls.strength.toFixed(2);
  if(ui.explorationValue) ui.explorationValue.textContent = appState.model.controls.exploration.toFixed(2);
}
function renderTagRows(){
  if(!ui.tagList) return;
  const q = (ui.tagSearch?.value ?? "").trim().toLowerCase();
  ui.tagList.innerHTML = "";
  const tags = Array.from(appState.validTags).sort().filter(t=>t.toLowerCase().includes(q));
  for(const tag of tags){
    const row = appState.model.tagModel[tag];
    const p = row.a/(row.a+row.b);
    const learned = SCORE.alpha*(p-0.5)*Math.log(1+row.a+row.b) + SCORE.beta*row.w;

    const item = document.createElement("div");
    item.className = "tag-row";

    const meta = document.createElement("div");
    meta.className = "tag-meta";
    meta.innerHTML = `<strong>${escapeHtml(tag)}</strong><span>Learned ${learned.toFixed(2)}</span>`;

    const slider = document.createElement("input");
    slider.type="range"; slider.min="-3"; slider.max="3"; slider.step="0.1";
    slider.value = String(appState.model.controls.override[tag] ?? 0);

    const value = document.createElement("span");
    value.textContent = `Override ${Number(slider.value).toFixed(1)}`;

    slider.addEventListener("input", ()=>{
      appState.model.controls.override[tag] = Number(slider.value);
      value.textContent = `Override ${Number(slider.value).toFixed(1)}`;
      persistModel(appState.model);
    });

    item.append(meta, slider, value);
    ui.tagList.appendChild(item);
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function handleResetOverrides(){ for(const t of Object.keys(appState.model.controls.override)) appState.model.controls.override[t]=0; persistModel(appState.model); renderTagRows(); }
function handleRandomizeOverrides(){ for(const t of Object.keys(appState.model.controls.override)) appState.model.controls.override[t]=clamp(Number((Math.random()-0.5).toFixed(2)),-3,3); persistModel(appState.model); renderTagRows(); }
function handleResetProfile(){ for(const t of Object.keys(appState.model.tagModel)) appState.model.tagModel[t]={a:1,b:1,w:0}; persistModel(appState.model); renderTagRows(); }
function handleResetHistory(){ appState.model.recentVideos=[]; appState.model.recentTagCounts={}; appState.model.history=[]; persistModel(appState.model); }

/* ---------- Feed ---------- */
function startFeed(){
  ui.startScreen.classList.remove("active");
  ui.feedScreen.classList.add("active");

  // FIX: desktop background should disappear; prevent scrolling behind feed
  document.body.classList.add("feed-active");

  if(appState.cursor !== -1) return;

  const first = selectNextVideo();
  appState.timeline.push(first.id);
  appState.cursor = 0;
  showVideo(first.id, 1, true); // user gesture
}

function scheduleTransition(direction){
  appState.selectionBusy = true;
  appState.lastDirection = direction;
  requestAnimationFrame(()=>{
    if(direction>0) goNext();
    else goPrev();
    appState.selectionBusy = false;
  });
}

function goNext(){
  finalizeCurrentWatch();
  if(appState.cursor < appState.timeline.length-1){
    appState.cursor += 1;
    showVideo(appState.timeline[appState.cursor], 1, false);
    return;
  }
  const next = selectNextVideo();
  appState.timeline.push(next.id);
  appState.cursor += 1;
  showVideo(next.id, 1, false);
}

function goPrev(){
  if(appState.cursor<=0) return;
  finalizeCurrentWatch();
  appState.cursor -= 1;
  showVideo(appState.timeline[appState.cursor], -1, false);
}

function showVideo(videoId, direction, userGesture){
  const meta = getVideoMeta(videoId);
  if(!meta) return;

  // Pause and deactivate all other slides to prevent multiple videos playing
  appState.renderedSlides.forEach((slide, id)=>{
    if(!slide){ appState.renderedSlides.delete(id); return; }
    if(id === videoId) return;
    slide.classList.remove("active");
    slide.querySelector("video")?.pause();
  });

  const slide = getOrCreateSlide(meta);
  slide.classList.add("active");

  // hashtags at bottom
  if(ui.hashtags) ui.hashtags.textContent = meta.tags.join(" ");

  const video = slide.querySelector("video");
  if(video){
    applySoundToVideo(video);
    video.currentTime = 0;
    video.load();

    const attemptPlay = async ()=>{
      try{
        await video.play();
      }catch(err){
        console.error("video.play() failed:", err);
        // fallback if sound blocked
        if(appState.soundEnabled){
          appState.soundEnabled = false;
          saveSoundPref(false);
          syncSoundIcon();
          applySoundToVideo(video);
          try{ await video.play(); }catch{}
        }
      }
    };

    if(userGesture) attemptPlay();
    else if(video.readyState>=2) attemptPlay();
    else video.addEventListener("canplay", attemptPlay, { once:true });
  }

  appState.currentView = { videoId, startedAt: performance.now(), accumulatedSeconds: 0 };
  registerExposure(meta);
  maintainSlides();
  warmAdjacent();
}


function getOrCreateSlide(meta){
  const existing = appState.renderedSlides.get(meta.id);
  if(existing) return existing;

  const slide = document.createElement("article");
  slide.className = "video-slide";

  const video = document.createElement("video");
  video.src = meta.src;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline","");
  video.setAttribute("webkit-playsinline","");

  slide.appendChild(video);
  ui.stage.appendChild(slide);
  appState.renderedSlides.set(meta.id, slide);
  return slide;
}

function warmAdjacent(){
  [appState.timeline[appState.cursor-1], appState.timeline[appState.cursor+1]].filter(Boolean).forEach(id=>{
    const m = getVideoMeta(id);
    if(m) getOrCreateSlide(m);
  });
}
function maintainSlides(){
  const keep = new Set([appState.timeline[appState.cursor-1], appState.timeline[appState.cursor], appState.timeline[appState.cursor+1]]);
  appState.renderedSlides.forEach((slide,id)=>{
    if(!slide){ appState.renderedSlides.delete(id); return; }
    if(keep.has(id)) return;
    slide.remove();
    appState.renderedSlides.delete(id);
  });
}

/* ---------- Votes + Watch ---------- */
function finalizeCurrentWatch(){
  if(!appState.currentView) return;
  const meta = getVideoMeta(appState.currentView.videoId);
  const slide = appState.renderedSlides.get(appState.currentView.videoId);
  const video = slide?.querySelector("video");
  if(!meta || !video){ appState.currentView=null; return; }

  const elapsed = (performance.now()-appState.currentView.startedAt)/1000;
  appState.currentView.accumulatedSeconds += Math.max(0, elapsed);

  const duration = Number.isFinite(video.duration) && video.duration>0 ? video.duration : 1200;
  const r = clamp(appState.currentView.accumulatedSeconds/duration, 0,1);
  const s = watchSignal(r);

  meta.tags.forEach(tag=>{
    const row = appState.model.tagModel[tag];
    if(!row) return;
    row.w = clamp(row.w + 0.10*s, -3,3);
    row.w *= 0.995;
  });

  persistModel(appState.model);
  appState.currentView = null;
}

function watchSignal(r){
  if(r<0.2) return -1.0*(0.2-r)/0.2;
  if(r<0.5) return 0.2*(r-0.2)/0.3;
  return 0.2 + 0.8*(r-0.5)/0.5;
}

function registerVote(type){
  const view = appState.currentView;
  if(!view) return;
  const meta = getVideoMeta(view.videoId);
  if(!meta) return;

  meta.tags.forEach(tag=>{
    const row = appState.model.tagModel[tag];
    if(!row) return;
    if(type==="like") row.a += 1;
    if(type==="dislike") row.b += 1;
  });
  persistModel(appState.model);
}

function registerExposure(meta){
  appState.model.recentVideos = (appState.model.recentVideos||[]).filter(v=>v!==meta.id);
  appState.model.recentVideos.push(meta.id);
  appState.model.recentVideos = appState.model.recentVideos.slice(-RECENT_VIDEO_BAN);

  appState.model.history = Array.isArray(appState.model.history) ? appState.model.history : [];
  appState.model.history.push(meta.id);
  if(appState.model.history.length>2000) appState.model.history = appState.model.history.slice(-2000);

  const windowIds = appState.model.history.slice(-RECENT_TAG_WINDOW);
  const counts = {};
  windowIds.forEach(id=>{
    const m = getVideoMeta(id);
    if(!m) return;
    m.tags.forEach(t=>{ counts[t] = (counts[t]||0)+1; });
  });
  appState.model.recentTagCounts = counts;

  persistModel(appState.model);
}

/* ---------- Ranking ---------- */
function selectNextVideo(){
  const banned = new Set(appState.model.recentVideos||[]);
  const candidates = appState.videos.filter(v=>!banned.has(v.id));
  const pool = candidates.length ? candidates : appState.videos;

  if(appState.model.controls.shuffleMode){
    const seen = new Set(appState.model.history||[]);
    const unseen = pool.filter(v=>!seen.has(v.id));
    if(unseen.length) return unseen[Math.floor(Math.random()*unseen.length)];
    appState.model.history = [];
    persistModel(appState.model);
  }

  const exploration = clamp(appState.model.controls.exploration ?? 0.2, 0,1);
  if(Math.random() < exploration) return pool[Math.floor(Math.random()*pool.length)];

  const tau = 0.4 + exploration*0.8;
  const scores = pool.map(v=>finalScore(v));
  const probs = softmax(scores, tau);
  return pool[sampleIndex(probs)];
}

function finalScore(videoMeta){
  const tags = videoMeta.tags || [];
  if(!tags.length) return -Infinity;

  const strength = clamp(appState.model.controls.strength ?? 0.7, 0,1);
  const overrideEnabled = Boolean(appState.model.controls.overrideEnabled ?? true);
  const overrides = appState.model.controls.override || {};
  const recent = appState.model.recentTagCounts || {};

  let base=0, penalty=0;
  tags.forEach(t=>{
    const row = appState.model.tagModel[t];
    if(!row) return;
    const p = row.a/(row.a+row.b);
    const c = Math.log(1+row.a+row.b);
    const learned = SCORE.alpha*(p-0.5)*c + SCORE.beta*row.w;
    const manual = overrideEnabled ? SCORE.delta*clamp(overrides[t] ?? 0, -3,3) : 0;
    base += (strength*learned + manual);
    penalty += (recent[t] || 0);
  });

  base /= tags.length;
  penalty = SCORE.gamma*(penalty/tags.length);
  return base - penalty;
}

/* ---------- Misc ---------- */
function clamp(n,lo,hi){ return Math.min(hi, Math.max(lo,n)); }
function softmax(scores,tau){
  const max = Math.max(...scores);
  const exps = scores.map(s=>Math.exp((s-max)/tau));
  const sum = exps.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(sum) || sum<=0){
    const u = 1/scores.length;
    return scores.map(()=>u);
  }
  return exps.map(e=>e/sum);
}
function sampleIndex(probs){
  let r = Math.random();
  for(let i=0;i<probs.length;i++){ r -= probs[i]; if(r<=0) return i; }
  return probs.length-1;
}
function getVideoMeta(id){ return appState.videos.find(v=>v.id===id) || null; }

function removeDuplicateSoundButtons(){
  // keep only #sound-button if present
  const keep = document.getElementById("sound-button");
  const candidates = Array.from(document.querySelectorAll("button")).filter(b=>{
    const label = (b.getAttribute("aria-label")||"").toLowerCase();
    return label.includes("sound") || label.includes("audio") || (b.textContent||"").includes("🔊") || (b.textContent||"").includes("🔇");
  });
  for(const b of candidates){
    if(keep && b===keep) continue;
    // remove older injected ones that are not the keep button
    if(b !== keep && (b.textContent||"").match(/[🔊🔇]/)) b.remove();
  }
}
