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
  renderedSlides: new Map(),
  touchStartY: null,
  selectionBusy: false,
};

init();

async function init() {
  try {
    const [validTagText, tagsText] = await Promise.all([
      fetch("valid_tags.txt").then((r) => r.text()),
      fetch("tags.txt").then((r) => r.text()),
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
    preloadMetadata(appState.videos);
  } catch {
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
      if (tag.startsWith("#")) {
        set.add(tag);
      }
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
      if (splitIndex === -1) {
        return;
      }

      const fileName = line.slice(0, splitIndex).trim();
      if (!fileName.endsWith(".mp4") || seen.has(fileName)) {
        return;
      }

      const tagSet = new Set(
        line
          .slice(splitIndex + 1)
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => validTags.has(tag))
      );

      const tags = Array.from(tagSet).slice(0, MAX_TAGS_PER_VIDEO);
      if (tags.length === 0) {
        return;
      }

      seen.add(fileName);
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
      const durationOk = Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120;
      finish(durationOk);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };

    video.src = src;
  });
}

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
      recentVideos: Array.isArray(parsed?.recentVideos) ? parsed.recentVideos.slice(-RECENT_VIDEO_BAN) : [],
      recentTagCounts: parsed?.recentTagCounts && typeof parsed.recentTagCounts === "object" ? parsed.recentTagCounts : {},
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
  } catch {
    persistModel(fallback);
    return fallback;
  }
}

function persistModel(model) {
  localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(model, null, 2));
}

function bindEvents() {
  ui.startButton.addEventListener("click", startFeed);
  ui.likeButton.addEventListener("click", () => registerVote("like"));
  ui.dislikeButton.addEventListener("click", () => registerVote("dislike"));
  ui.controlsButton.addEventListener("click", () => toggleControls(true));
  ui.closeControls.addEventListener("click", () => toggleControls(false));

  ui.strengthSlider.addEventListener("input", () => {
    appState.model.controls.strength = Number(ui.strengthSlider.value);
    persistModel(appState.model);
    renderControlsHeader();
  });

  ui.explorationSlider.addEventListener("input", () => {
    appState.model.controls.exploration = Number(ui.explorationSlider.value);
    persistModel(appState.model);
    renderControlsHeader();
  });

  ui.overrideToggle.addEventListener("change", () => {
    appState.model.controls.overrideEnabled = ui.overrideToggle.checked;
    persistModel(appState.model);
  });

  ui.tagSearch.addEventListener("input", renderTagRows);
  ui.resetOverrides.addEventListener("click", handleResetOverrides);
  ui.randomizeOverrides.addEventListener("click", handleRandomizeOverrides);
  ui.resetProfile.addEventListener("click", handleResetProfile);
  ui.resetHistory.addEventListener("click", handleResetHistory);

  window.addEventListener("wheel", (event) => {
    if (!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if (event.deltaY > 0) scheduleTransition(1);
    if (event.deltaY < 0) scheduleTransition(-1);
  }, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (!ui.feedScreen.classList.contains("active") || appState.selectionBusy) return;
    if (event.key === "ArrowDown") scheduleTransition(1);
    if (event.key === "ArrowUp") scheduleTransition(-1);
  });

  window.addEventListener("touchstart", (event) => {
    appState.touchStartY = event.changedTouches[0]?.clientY ?? null;
  }, { passive: true });

  window.addEventListener("touchend", (event) => {
    if (!ui.feedScreen.classList.contains("active") || appState.selectionBusy || appState.touchStartY === null) return;
    const endY = event.changedTouches[0]?.clientY;
    if (typeof endY !== "number") return;
    const delta = appState.touchStartY - endY;
    if (delta > 35) scheduleTransition(1);
    if (delta < -35) scheduleTransition(-1);
    appState.touchStartY = null;
  }, { passive: true });
}

function renderControls() {
  renderControlsHeader();
  renderTagRows();
}

function renderControlsHeader() {
  ui.strengthSlider.value = String(appState.model.controls.strength);
  ui.explorationSlider.value = String(appState.model.controls.exploration);
  ui.overrideToggle.checked = appState.model.controls.overrideEnabled;
  ui.strengthValue.textContent = appState.model.controls.strength.toFixed(2);
  ui.explorationValue.textContent = appState.model.controls.exploration.toFixed(2);
}

function renderTagRows() {
  const q = ui.tagSearch.value.trim().toLowerCase();
  ui.tagList.innerHTML = "";
  const tags = Array.from(appState.validTags).sort().filter((tag) => tag.toLowerCase().includes(q));

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
    appState.model.controls.override[tag] = Number((Math.random() - 0.5).toFixed(2));
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
  ui.controlsDrawer.hidden = !show;
}

function startFeed() {
  ui.startScreen.classList.remove("active");
  ui.feedScreen.classList.add("active");

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
  if (!meta) return;

  appState.renderedSlides.forEach((slide, id) => {
    if (id === videoId) return;
    slide.classList.remove("active");
    const v = slide.querySelector("video");
    v?.pause();
  });

  const slide = getOrCreateSlide(meta);
  slide.classList.add("active");

  const video = slide.querySelector("video");
  if (video) {
    video.currentTime = 0;
    video.play().catch(() => {});
  }

  ui.hashtags.textContent = meta.tags.join(" ");
  appState.currentView = { videoId, startedAt: performance.now(), accumulatedSeconds: 0 };

  registerExposure(meta);
  maintainSlides();
  warmAdjacent();
}

function getOrCreateSlide(meta) {
  if (appState.renderedSlides.has(meta.id)) return appState.renderedSlides.get(meta.id);

  const slide = document.createElement("article");
  slide.className = "video-slide";

  const video = document.createElement("video");
  video.src = meta.src;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";

  slide.appendChild(video);
  ui.stage.appendChild(slide);
  appState.renderedSlides.set(meta.id, slide);
  return slide;
}

function warmAdjacent() {
  [appState.timeline[appState.cursor - 1], appState.timeline[appState.cursor + 1]].filter(Boolean).forEach((id) => {
    const meta = getVideoMeta(id);
    if (meta) getOrCreateSlide(meta);
  });
}

function maintainSlides() {
  const keep = new Set([appState.timeline[appState.cursor - 1], appState.timeline[appState.cursor], appState.timeline[appState.cursor + 1]]);
  appState.renderedSlides.forEach((slide, id) => {
    if (keep.has(id)) return;
    slide.remove();
    appState.renderedSlides.delete(id);
  });
}

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
    row.w = clamp(row.w + 0.1 * s, -3, 3) * 0.995;
    row.a = 1 + (row.a - 1) * 0.999;
    row.b = 1 + (row.b - 1) * 0.999;
  });

  persistModel(appState.model);
  appState.currentView = null;
}

function watchSignal(r) {
  if (r < 0.2) return -1 * ((0.2 - r) / 0.2);
  if (r < 0.5) return 0.2 * ((r - 0.2) / 0.3);
  return 0.2 + 0.8 * ((r - 0.5) / 0.5);
}

function registerVote(type) {
  const currentId = appState.timeline[appState.cursor];
  const meta = getVideoMeta(currentId);
  if (!meta) return;

  meta.tags.forEach((tag) => {
    const row = appState.model.tagModel[tag];
    if (type === "like") row.a += 1;
    if (type === "dislike") row.b += 1;
    row.w *= 0.995;
    row.a = 1 + (row.a - 1) * 0.999;
    row.b = 1 + (row.b - 1) * 0.999;
  });

  persistModel(appState.model);
  renderTagRows();
}

function registerExposure(video) {
  appState.model.history.push(video.id);

  if (!appState.model.recentVideos.includes(video.id)) {
    appState.model.recentVideos.push(video.id);
  }
  appState.model.recentVideos = appState.model.recentVideos.slice(-RECENT_VIDEO_BAN);

  const lastTenIds = appState.model.history.slice(-RECENT_TAG_WINDOW);
  const counts = {};
  lastTenIds.forEach((id) => {
    getVideoMeta(id)?.tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  appState.model.recentTagCounts = counts;

  persistModel(appState.model);
}

function selectNextVideo() {
  const banned = new Set(appState.model.recentVideos);
  const candidates = appState.videos.filter((video) => !banned.has(video.id));
  const pool = candidates.length > 0 ? candidates : appState.videos;

  if (Math.random() < appState.model.controls.exploration) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const tau = 0.4 + appState.model.controls.exploration * 0.8;
  const scored = pool.map((video) => ({ video, score: scoreVideo(video) }));
  const maxScore = Math.max(...scored.map((v) => v.score));
  const expVals = scored.map((entry) => Math.exp((entry.score - maxScore) / tau));
  const total = expVals.reduce((sum, n) => sum + n, 0);

  let draw = Math.random() * total;
  for (let i = 0; i < scored.length; i += 1) {
    draw -= expVals[i];
    if (draw <= 0) return scored[i].video;
  }

  return scored[scored.length - 1].video;
}

function scoreVideo(video) {
  const tagScores = video.tags.map((tag) => {
    const row = appState.model.tagModel[tag] || { a: 1, b: 1, w: 0 };
    const p = row.a / (row.a + row.b);
    const c = Math.log(1 + row.a + row.b);
    const learned = SCORE.alpha * (p - 0.5) * c + SCORE.beta * row.w;
    const manual = appState.model.controls.overrideEnabled ? SCORE.delta * (appState.model.controls.override[tag] || 0) : 0;
    return appState.model.controls.strength * learned + manual;
  });

  const baseScore = tagScores.reduce((sum, n) => sum + n, 0) / video.tags.length;
  const overexposure =
    SCORE.gamma *
    (video.tags.reduce((sum, tag) => sum + (appState.model.recentTagCounts[tag] || 0), 0) / video.tags.length);

  return baseScore - overexposure;
}

function preloadMetadata(videos) {
  let i = 0;
  const chunk = () => {
    const stop = Math.min(i + 8, videos.length);
    for (; i < stop; i += 1) {
      const v = document.createElement("video");
      v.src = videos[i].src;
      v.preload = "metadata";
    }
    if (i < videos.length) window.setTimeout(chunk, 20);
  };
  chunk();
}

function getVideoMeta(id) {
  return appState.videos.find((video) => video.id === id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
