/* Instavideo - app.js (full rewrite with fixes)
   - Frontend-only feed
   - LocalStorage personalization
   - Robust slide management (no undefined Map entries)
   - Robust video playback (mobile-friendly)
*/

const PERSONALIZATION_KEY = "instavideo_state";
const RECENT_VIDEO_BAN = 3;
const RECENT_TAG_WINDOW = 10;
const MAX_TAGS_PER_VIDEO = 10;

const SCORE = {
  alpha: 1.0,
  beta: 0.7,
  delta: 0.8,
  gamma: 0.15,
};

const ui = {
  startScreen: document.getElementById("start-screen"),
  feedScreen: document.getElementById("feed-screen"),
  startButton: document.getElementById("start-button"),
  stage: document.getElementById("video-stage"),
  hashtags: document.getElementById("hashtags"),
  likeButton: document.getElementById("like-button"),
  dislikeButton: document.getElementById("dislike-button"),
  controlsButton: document.getElementById("controls-button"),
  controlsDrawer: document.getElementById("controls-drawer"),
  closeControls: document.getElementById("close-controls"),
  strengthSlider: document.getElementById("strength-slider"),
  explorationSlider: document.getElementById("exploration-slider"),
  strengthValue: document.getElementById("strength-value"),
  explorationValue: document.getElementById("exploration-value"),
  overrideToggle: document.getElementById("override-toggle"),
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
  renderedSlides: new Map(), // videoId -> HTMLElement(article.video-slide)
  touchStartY: null,
  selectionBusy: false,
};

init();

/* -----------------------------
   Init / Loading
------------------------------ */

async function init() {
  try {
    if (!ui.startButton || !ui.stage || !ui.startScreen || !ui.feedScreen) {
      throw new Error("Missing required DOM elements. Check index.html IDs.");
    }

    const [validTagText, tagsText] = await Promise.all([
      fetch("./valid_tags.txt").then((r) => {
        if (!r.ok) throw new Error("Failed to fetch valid_tags.txt");
        return r.text();
      }),
      fetch("./tags.txt").then((r) => {
        if (!r.ok) throw new Error("Failed to fetch tags.txt");
        return r.text();
      }),
    ]);

    appState.validTags = parseValidTags(validTagText);
    appState.model = loadModel(appState.validTags);

    const parsedVideos = parseTagsFile(tagsText, appState.validTags);
    appState.videos = await filterLoadableVideos(parsedVideos);

    if (appState.videos.length === 0) {
      ui.startButton.disabled = true;
      ui.startButton.textContent = "No loadable videos";
      console.warn("No loadable videos after filtering. Check ./videos paths and codecs.");
      return;
    }

    bindEvents();
    renderControls();
    preloadMetadata(appState.videos);

    // Optional: expose debug handles (safe)
    window.__instavideo = {
      appState,
      persistModel,
      selectNextVideo,
      getVideoMeta,
    };
  } catch (err) {
    console.error("Init failed:", err);
    ui.startButton.disabled = true;
    ui.startButton.textContent = "Failed to initialize";
  }
}

function parseValidTags(text) {
  const set = new Set();
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((tag) => {
      if (tag.startsWith("#")) set.add(tag);
    });
  return set;
}

function parseTagsFile(text, validTags) {
  const list = [];
  const seen = new Set();

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const splitIndex = line.indexOf(":");
      if (splitIndex === -1) return;

      const fileName = line.slice(0, splitIndex).trim();
      if (!fileName.endsWith(".mp4") || seen.has(fileName)) return;

      const tagSet = new Set(
        line
          .slice(splitIndex + 1)
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => validTags.has(tag))
      );

      const tags = Array.from(tagSet).slice(0, MAX_TAGS_PER_VIDEO);
      if (tags.length === 0) return;

      seen.add(fileName);

      // IMPORTANT: relative to index.html, NOT /videos/
      list.push({ id: fileName, src: `./videos/${fileName}`, tags });
    });

  return list;
}

async function filterLoadableVideos(videos) {
  const checks = videos.map(async (video) => {
    const ok = await canLoadVideo(video.src);
    return ok ? video : null;
  });
  const results = await Promise.all(checks);
  return results.filter(Boolean);
}

function canLoadVideo(src) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(false), 2500);

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const durationOk =
        Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120;
      finish(durationOk);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };

    video.src = src;
  });
}

/* -----------------------------
   Model Persistence
------------------------------ */

function defaultModel(validTags) {
  const tagModel = {};
  const override = {};
  validTags.forEach((tag) => {
    tagModel[tag] = { a: 1, b: 1, w: 0 };
    override[tag] = 0;
  });
  return {
    tagModel,
    controls: {
      strength: 0.7,
      exploration: 0.2,
      overrideEnabled: true,
      override,
    },
    recentVideos: [],
    recentTagCounts: {},
    history: [],
  };
}

function loadModel(validTags) {
  const fallback = defaultModel(validTags);
  const raw = localStorage.getItem(PERSONALIZATION_KEY);
  if (!raw) {
    persistModel(fallback);
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);

    const model = {
      tagModel: {},
      controls: {
        strength: clamp(parsed?.controls?.strength ?? 0.7, 0, 1),
        exploration: clamp(parsed?.controls?.exploration ?? 0.2, 0, 1),
        overrideEnabled: Boolean(parsed?.controls?.overrideEnabled ?? true),
        override: {},
      },
      recentVideos: Array.isArray(parsed?.recentVideos)
        ? parsed.recentVideos.slice(-RECENT_VIDEO_BAN)
        : [],
      recentTagCounts:
        parsed?.recentTagCounts && typeof parsed.recentTagCounts === "object"
          ? parsed.recentTagCounts
          : {},
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    };

    validTags.forEach((tag) => {
      const row = parsed?.tagModel?.[tag] || {};
      model.tagModel[tag] = {
        a: Math.max(1, Number.isFinite(row.a) ? row.a : 1),
        b: Math.max(1, Number.isFinite(row.b) ? row.b : 1),
        w: clamp(Number.isFinite(row.w) ? row.w : 0, -3, 3),
      };
      model.controls.override[tag] = clamp(parsed?.controls?.override?.[tag] ?? 0, -3, 3);
    });

    persistModel(model);
    return model;
  } catch (err) {
    console.warn("Failed parsing stored model, resetting:", err);
    persistModel(fallback);
    return fallback;
  }
}

function persistModel(model) {
  localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(model, null, 2));
}

/* -----------------------------
   UI Events
------------------------------ */

function bindEvents() {
  ui.startButton.addEventListener("click", startFeed);
  ui.likeButton?.addEventListener("click", () => registerVote("like"));
  ui.dislikeButton?.addEventListener("click", () => registerVote("dislike"));

  ui.controlsButton?.addEventListener("click", () => toggleControls(true));
  ui.closeControls?.addEventListener("click", () => toggleControls(false));

  ui.strengthSlider?.addEventListener("input", () => {
    appState.model.controls.strength = Number(ui.strengthSlider.value);
    persistModel(appState.model);
    renderControlsHeader();
  });

  ui.explorationSlider?.addEventListener("input", () => {
    appState.model.controls.exploration = Number(ui.explorationSlider.value);
    persistModel(appState.model);
    renderControlsHeader();
  });

  ui.overrideToggle?.addEventListener("change", () => {
    appState.model.controls.overrideEnabled = ui.overrideToggle.checked;
    persistModel(appState.model);
  });

  ui.tagSearch?.addEventListener("input", renderTagRows);
  ui.resetOverrides?.addEventListener("click", handleResetOverrides);
  ui.randomizeOverrides?.addEventListener("click", handleRandomizeOverrides);
  ui.resetProfile?.addEventListener("click", handleResetProfile);
  ui.resetHistory?.addEventListener("click", handleResetHistory);

  window.addEventListener(
    "wheel",
    (event) => {
      if (!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
      if (event.deltaY > 0) scheduleTransition(1);
      if (event.deltaY < 0) scheduleTransition(-1);
    },
    { passive: true }
  );

  window.addEventListener("keydown", (event) => {
    if (!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if (event.key === "ArrowDown") scheduleTransition(1);
    if (event.key === "ArrowUp") scheduleTransition(-1);
  });

  window.addEventListener(
    "touchstart",
    (event) => {
      appState.touchStartY = event.changedTouches[0]?.clientY ?? null;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchend",
    (event) => {
      if (
        !ui.feedScreen.classList.contains("active") ||
        appState.selectionBusy ||
        appState.touchStartY === null
      )
        return;

      const endY = event.changedTouches[0]?.clientY;
      if (typeof endY !== "number") return;

      const delta = appState.touchStartY - endY;
      if (delta > 35) scheduleTransition(1);
      if (delta < -35) scheduleTransition(-1);
      appState.touchStartY = null;
    },
    { passive: true }
  );
}

/* -----------------------------
   Controls UI
------------------------------ */

function renderControls() {
  renderControlsHeader();
  renderTagRows();
}

function renderControlsHeader() {
  if (ui.strengthSlider) ui.strengthSlider.value = String(appState.model.controls.strength);
  if (ui.explorationSlider)
    ui.explorationSlider.value = String(appState.model.controls.exploration);
  if (ui.overrideToggle) ui.overrideToggle.checked = appState.model.controls.overrideEnabled;

  if (ui.strengthValue) ui.strengthValue.textContent = appState.model.controls.strength.toFixed(2);
  if (ui.explorationValue)
    ui.explorationValue.textContent = appState.model.controls.exploration.toFixed(2);
}

function renderTagRows() {
  if (!ui.tagList) return;

  const q = (ui.tagSearch?.value ?? "").trim().toLowerCase();
  ui.tagList.innerHTML = "";
  const tags = Array.from(appState.validTags)
    .sort()
    .filter((tag) => tag.toLowerCase().includes(q));

  tags.forEach((tag) => {
    const row = appState.model.tagModel[tag];
    const p = row.a / (row.a + row.b);
    const learned = SCORE.alpha * (p - 0.5) * Math.log(1 + row.a + row.b) + SCORE.beta * row.w;

    const item = document.createElement("div");
    item.className = "tag-row";

    const meta = document.createElement("div");
    meta.className = "tag-meta";
    meta.innerHTML = `<strong>${tag}</strong><span>Learned ${learned.toFixed(2)}</span>`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "-3";
    slider.max = "3";
    slider.step = "0.1";
    slider.value = String(appState.model.controls.override[tag] ?? 0);

    const value = document.createElement("span");
    value.textContent = `Override ${Number(slider.value).toFixed(1)}`;

    slider.addEventListener("input", () => {
      appState.model.controls.override[tag] = Number(slider.value);
      value.textContent = `Override ${Number(slider.value).toFixed(1)}`;
      persistModel(appState.model);
    });

    item.append(meta, slider, value);
    ui.tagList.appendChild(item);
  });
}

function handleResetOverrides() {
  Object.keys(appState.model.controls.override).forEach((tag) => {
    appState.model.controls.override[tag] = 0;
  });
  persistModel(appState.model);
  renderTagRows();
}

function handleRandomizeOverrides() {
  Object.keys(appState.model.controls.override).forEach((tag) => {
    appState.model.controls.override[tag] = clamp(Number((Math.random() - 0.5).toFixed(2)), -3, 3);
  });
  persistModel(appState.model);
  renderTagRows();
}

function handleResetProfile() {
  Object.keys(appState.model.tagModel).forEach((tag) => {
    appState.model.tagModel[tag] = { a: 1, b: 1, w: 0 };
  });
  persistModel(appState.model);
  renderTagRows();
}

function handleResetHistory() {
  appState.model.recentVideos = [];
  appState.model.recentTagCounts = {};
  appState.model.history = [];
  persistModel(appState.model);
}

function toggleControls(show) {
  if (!ui.controlsDrawer) return;
  ui.controlsDrawer.hidden = !show;
}

/* -----------------------------
   Feed Flow
------------------------------ */

function startFeed() {
  ui.startScreen.classList.remove("active");
  ui.feedScreen.classList.add("active");

  // already started
  if (appState.cursor !== -1) return;

  const first = selectNextVideo();
  appState.timeline.push(first.id);
  appState.cursor = 0;
  showVideo(first.id);
}

function scheduleTransition(direction) {
  appState.selectionBusy = true;
  requestAnimationFrame(() => {
    if (direction > 0) goNext();
    if (direction < 0) goPrev();
    appState.selectionBusy = false;
  });
}

function goNext() {
  finalizeCurrentWatch();

  if (appState.cursor < appState.timeline.length - 1) {
    appState.cursor += 1;
    showVideo(appState.timeline[appState.cursor]);
    return;
  }

  const next = selectNextVideo();
  appState.timeline.push(next.id);
  appState.cursor += 1;
  showVideo(next.id);
}

function goPrev() {
  if (appState.cursor <= 0) return;
  finalizeCurrentWatch();
  appState.cursor -= 1;
  showVideo(appState.timeline[appState.cursor]);
}

function showVideo(videoId) {
  const meta = getVideoMeta(videoId);
  if (!meta) {
    console.warn("showVideo: no meta for", videoId);
    return;
  }

  // Deactivate and pause all other slides (robust: clean undefined entries)
  appState.renderedSlides.forEach((slide, id) => {
    if (!slide) {
      appState.renderedSlides.delete(id);
      return;
    }
    if (id === videoId) return;
    slide.classList.remove("active");
    slide.querySelector("video")?.pause();
  });

  const slide = getOrCreateSlide(meta);
  if (!slide) {
    console.error("Failed to create slide for", meta.id);
    return;
  }

  slide.classList.add("active");

  const video = slide.querySelector("video");
  if (video) {
    // Always restart the visible video
    video.currentTime = 0;

    // Ensure load happens before play (helps mobile)
    video.load();

    const tryPlay = () => {
      video
        .play()
        .catch((err) => console.error("video.play() failed:", err, "src:", video.currentSrc || video.src));
    };

    // If ready, play immediately. Otherwise wait for canplay once.
    if (video.readyState >= 2) {
      tryPlay();
    } else {
      video.addEventListener("canplay", tryPlay, { once: true });
    }
  }

  if (ui.hashtags) ui.hashtags.textContent = meta.tags.join(" ");

  appState.currentView = {
    videoId,
    startedAt: performance.now(),
    accumulatedSeconds: 0,
  };

  registerExposure(meta);
  maintainSlides();
  warmAdjacent();
}

function getOrCreateSlide(meta) {
  // IMPORTANT FIX:
  // Don't trust `.has()`. A Map may contain a key with undefined value.
  const existing = appState.renderedSlides.get(meta.id);
  if (existing) return existing;

  const slide = document.createElement("article");
  slide.className = "video-slide";

  const video = document.createElement("video");
  video.src = meta.src;

  // Mobile autoplay reliability
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";

  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  video.addEventListener("error", () => {
    console.error("Video element error:", meta.id, meta.src, video.error);
  });

  slide.appendChild(video);
  ui.stage.appendChild(slide);

  // Set only after slide exists
  appState.renderedSlides.set(meta.id, slide);
  return slide;
}

function warmAdjacent() {
  [appState.timeline[appState.cursor - 1], appState.timeline[appState.cursor + 1]]
    .filter(Boolean)
    .forEach((id) => {
      const meta = getVideoMeta(id);
      if (meta) getOrCreateSlide(meta);
    });
}

function maintainSlides() {
  const keep = new Set([
    appState.timeline[appState.cursor - 1],
    appState.timeline[appState.cursor],
    appState.timeline[appState.cursor + 1],
  ]);

  appState.renderedSlides.forEach((slide, id) => {
    if (!slide) {
      appState.renderedSlides.delete(id);
      return;
    }
    if (keep.has(id)) return;
    slide.remove();
    appState.renderedSlides.delete(id);
  });
}

/* -----------------------------
   Watch accounting + signals
------------------------------ */

function finalizeCurrentWatch() {
  if (!appState.currentView) return;

  const meta = getVideoMeta(appState.currentView.videoId);
  const slide = appState.renderedSlides.get(appState.currentView.videoId);
  const video = slide?.querySelector("video");

  if (!meta || !video) {
    appState.currentView = null;
    return;
  }

  const elapsed = (performance.now() - appState.currentView.startedAt) / 1000;
  appState.currentView.accumulatedSeconds += Math.max(0, elapsed);

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 120;
  const r = clamp(appState.currentView.accumulatedSeconds / duration, 0, 1);
  const s = watchSignal(r);

  meta.tags.forEach((tag) => {
    const row = appState.model.tagModel[tag];
    if (!row) return;

    row.w = clamp(row.w + 0.10 * s, -3, 3);
    row.w *= 0.995;

    // optional slow adaptation for a/b
    row.a = 1 + (row.a - 1) * 0.999;
    row.b = 1 + (row.b - 1) * 0.999;
  });

  persistModel(appState.model);
  appState.currentView = null;
}

function watchSignal(r) {
  if (r < 0.2) {
    return -1.0 * (0.2 - r) / 0.2;
  }
  if (r < 0.5) {
    return 0.2 * (r - 0.2) / 0.3;
  }
  return 0.2 + 0.8 * (r - 0.5) / 0.5;
}

function registerVote(type) {
  const view = appState.currentView;
  if (!view) return;

  const meta = getVideoMeta(view.videoId);
  if (!meta) return;

  meta.tags.forEach((tag) => {
    const row = appState.model.tagModel[tag];
    if (!row) return;
    if (type === "like") row.a += 1;
    if (type === "dislike") row.b += 1;
  });

  persistModel(appState.model);
}

function registerExposure(meta) {
  // recentVideos: avoid repeating last N
  appState.model.recentVideos = (appState.model.recentVideos || []).filter((v) => v !== meta.id);
  appState.model.recentVideos.push(meta.id);
  appState.model.recentVideos = appState.model.recentVideos.slice(-RECENT_VIDEO_BAN);

  // recentTagCounts: maintain last window (approx by history)
  appState.model.history = Array.isArray(appState.model.history) ? appState.model.history : [];
  appState.model.history.push(meta.id);
  if (appState.model.history.length > 2000) {
    appState.model.history = appState.model.history.slice(-2000);
  }

  // recompute window counts over last RECENT_TAG_WINDOW videos (simple + safe)
  const windowIds = appState.model.history.slice(-RECENT_TAG_WINDOW);
  const counts = {};
  windowIds.forEach((id) => {
    const m = getVideoMeta(id);
    if (!m) return;
    m.tags.forEach((t) => {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  appState.model.recentTagCounts = counts;

  persistModel(appState.model);
}

/* -----------------------------
   Ranking / Selection
------------------------------ */

function selectNextVideo() {
  // candidates exclude last N
  const banned = new Set(appState.model.recentVideos || []);
  const candidates = appState.videos.filter((v) => !banned.has(v.id));

  // if too strict, fall back to all
  const pool = candidates.length > 0 ? candidates : appState.videos;

  // exploration: choose random sometimes
  const exploration = clamp(appState.model.controls.exploration ?? 0.2, 0, 1);
  if (Math.random() < exploration) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // softmax
  const tau = 0.4 + exploration * 0.8; // 0.4..1.2
  const scores = pool.map((v) => finalScore(v));
  const probs = softmax(scores, tau);

  const pick = sampleIndex(probs);
  return pool[pick];
}

function finalScore(videoMeta) {
  const tags = videoMeta.tags || [];
  if (tags.length === 0) return -Infinity;

  const strength = clamp(appState.model.controls.strength ?? 0.7, 0, 1);
  const overrideEnabled = Boolean(appState.model.controls.overrideEnabled ?? true);
  const overrides = appState.model.controls.override || {};
  const recent = appState.model.recentTagCounts || {};

  let base = 0;
  let penalty = 0;

  tags.forEach((t) => {
    const row = appState.model.tagModel[t];
    if (!row) return;

    const p = row.a / (row.a + row.b);
    const c = Math.log(1 + row.a + row.b);

    const learned = SCORE.alpha * (p - 0.5) * c + SCORE.beta * row.w;
    const manual = overrideEnabled ? SCORE.delta * clamp(overrides[t] ?? 0, -3, 3) : 0;

    const blended = strength * learned + manual;
    base += blended;

    penalty += (recent[t] || 0);
  });

  base = base / tags.length;
  penalty = SCORE.gamma * (penalty / tags.length);

  return base - penalty;
}

/* -----------------------------
   Utilities
------------------------------ */

function getVideoMeta(videoId) {
  return appState.videos.find((v) => v.id === videoId) || null;
}

function preloadMetadata(videos) {
  // optional warm-up: create metadata-only elements to prime cache
  // Keep lightweight: do nothing heavy here. Placeholder for future.
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function softmax(scores, tau) {
  // numerically stable softmax
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / tau));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    const uniform = 1 / scores.length;
    return scores.map(() => uniform);
  }
  return exps.map((e) => e / sum);
}

function sampleIndex(probs) {
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}