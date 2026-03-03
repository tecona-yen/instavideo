const PERSONALIZATION_KEY = "instavideo_state_v1";
const RECENT_VIDEO_BAN = 3;
const RECENT_TAG_WINDOW = 10;

const ui = {
  startScreen: document.getElementById("start-screen"),
  feedScreen: document.getElementById("feed-screen"),
  startButton: document.getElementById("start-button"),
  stage: document.getElementById("video-stage"),
  hashtags: document.getElementById("hashtags"),
  likeButton: document.getElementById("like-button"),
  dislikeButton: document.getElementById("dislike-button"),
  resetButton: document.getElementById("reset-personalization"),
  toggleDebug: document.getElementById("toggle-debug"),
  debugPanel: document.getElementById("debug-panel"),
};

const appState = {
  validTags: new Set(),
  videoMeta: [],
  model: null,
  order: [],
  cursor: -1,
  currentView: null,
  rendered: new Map(),
  touchStartY: null,
  debugMode: false,
};

async function init() {
  try {
    const [validTagText, tagsText] = await Promise.all([
      fetch("valid_tags.txt").then((r) => r.text()),
      fetch("tags.txt").then((r) => r.text()),
    ]);

    appState.validTags = parseValidTags(validTagText);
    appState.videoMeta = parseTagsFile(tagsText, appState.validTags);
    appState.model = loadModel(appState.validTags);

    if (appState.videoMeta.length === 0) {
      ui.startButton.disabled = true;
      ui.startButton.textContent = "No videos available";
      return;
    }

    bindEvents();
    beginMetadataPreload(appState.videoMeta);
  } catch {
    ui.startButton.disabled = true;
    ui.startButton.textContent = "Failed to load data";
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
  const videos = [];
  const seen = new Set();

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [rawFile, rawTags] = line.split(":");
      if (!rawFile || !rawTags) {
        return;
      }

      const file = rawFile.trim();
      if (!file.endsWith(".mp4") || seen.has(file)) {
        return;
      }

      const tags = rawTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => validTags.has(tag))
        .slice(0, 10);

      if (tags.length === 0) {
        return;
      }

      seen.add(file);
      videos.push({
        id: file,
        src: `videos/${file}`,
        tags,
      });
    });

  return videos;
}

function defaultModel(validTags) {
  const tagModel = {};
  for (const tag of validTags) {
    tagModel[tag] = { a: 1, b: 1, w: 0 };
  }
  return {
    tagModel,
    recentVideos: [],
    recentTagCounts: {},
    recentTagWindow: [],
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
    const normalized = {
      tagModel: {},
      recentVideos: Array.isArray(parsed.recentVideos) ? parsed.recentVideos.slice(-RECENT_VIDEO_BAN) : [],
      recentTagCounts: parsed.recentTagCounts && typeof parsed.recentTagCounts === "object" ? parsed.recentTagCounts : {},
      recentTagWindow: Array.isArray(parsed.recentTagWindow) ? parsed.recentTagWindow.slice(-RECENT_TAG_WINDOW) : [],
    };

    for (const tag of validTags) {
      const existing = parsed.tagModel?.[tag];
      normalized.tagModel[tag] = {
        a: Number.isFinite(existing?.a) ? Math.max(1, existing.a) : 1,
        b: Number.isFinite(existing?.b) ? Math.max(1, existing.b) : 1,
        w: Number.isFinite(existing?.w) ? clamp(existing.w, -3, 3) : 0,
      };
    }

    persistModel(normalized);
    return normalized;
  } catch {
    persistModel(fallback);
    return fallback;
  }
}

function persistModel(model) {
  localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(model));
}

function bindEvents() {
  ui.startButton.addEventListener("click", startFeed);
  ui.likeButton.addEventListener("click", () => applyVote("like"));
  ui.dislikeButton.addEventListener("click", () => applyVote("dislike"));
  ui.resetButton.addEventListener("click", resetPersonalization);
  ui.toggleDebug.addEventListener("click", toggleDebugMode);

  window.addEventListener(
    "wheel",
    (event) => {
      if (!ui.feedScreen.classList.contains("active")) {
        return;
      }
      if (event.deltaY > 0) {
        goNext();
      } else if (event.deltaY < 0) {
        goPrev();
      }
    },
    { passive: true }
  );

  window.addEventListener("keydown", (event) => {
    if (!ui.feedScreen.classList.contains("active")) {
      return;
    }
    if (event.key === "ArrowDown") {
      goNext();
    }
    if (event.key === "ArrowUp") {
      goPrev();
    }
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
      if (!ui.feedScreen.classList.contains("active") || appState.touchStartY === null) {
        return;
      }
      const endY = event.changedTouches[0]?.clientY;
      if (typeof endY !== "number") {
        return;
      }
      const delta = appState.touchStartY - endY;
      if (delta > 35) {
        goNext();
      } else if (delta < -35) {
        goPrev();
      }
      appState.touchStartY = null;
    },
    { passive: true }
  );
}

function startFeed() {
  ui.startScreen.classList.remove("active");
  ui.feedScreen.classList.add("active");
  if (appState.cursor === -1) {
    const first = selectNextVideo();
    appState.order.push(first.id);
    appState.cursor = 0;
    showVideo(first.id);
  }
}

function getVideoMetaById(id) {
  return appState.videoMeta.find((video) => video.id === id);
}

function goNext() {
  if (!ui.feedScreen.classList.contains("active")) {
    return;
  }

  finalizeCurrentWatch();

  if (appState.cursor < appState.order.length - 1) {
    appState.cursor += 1;
    showVideo(appState.order[appState.cursor]);
    return;
  }

  const next = selectNextVideo();
  appState.order.push(next.id);
  appState.cursor += 1;
  showVideo(next.id);
}

function goPrev() {
  if (!ui.feedScreen.classList.contains("active") || appState.cursor <= 0) {
    return;
  }
  finalizeCurrentWatch();
  appState.cursor -= 1;
  showVideo(appState.order[appState.cursor]);
}

function showVideo(videoId) {
  const activeMeta = getVideoMetaById(videoId);
  if (!activeMeta) {
    return;
  }

  for (const [id, node] of appState.rendered.entries()) {
    if (id !== videoId) {
      node.classList.remove("active");
      const v = node.querySelector("video");
      if (v) {
        v.pause();
      }
    }
  }

  const slide = getOrCreateSlide(activeMeta);
  slide.classList.add("active");
  const video = slide.querySelector("video");
  if (video) {
    video.currentTime = 0;
    video.play().catch(() => {});
  }

  ui.hashtags.textContent = activeMeta.tags.join(" ");
  appState.currentView = {
    videoId,
    startedAt: performance.now(),
    accumulatedSeconds: 0,
    seenAtLeastOneFrame: false,
  };

  video?.addEventListener(
    "timeupdate",
    () => {
      if (appState.currentView?.videoId === videoId) {
        appState.currentView.seenAtLeastOneFrame = true;
      }
    },
    { once: true }
  );

  registerExposure(activeMeta);
  cleanupRenderedSlides();
  warmAdjacentSlides();
  renderDebug();
}

function getOrCreateSlide(meta) {
  const existing = appState.rendered.get(meta.id);
  if (existing) {
    return existing;
  }

  const slide = document.createElement("article");
  slide.className = "video-slide";
  slide.dataset.videoId = meta.id;

  const video = document.createElement("video");
  video.src = meta.src;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  slide.appendChild(video);
  ui.stage.appendChild(slide);
  appState.rendered.set(meta.id, slide);
  return slide;
}

function warmAdjacentSlides() {
  const prevId = appState.order[appState.cursor - 1];
  const nextId = appState.order[appState.cursor + 1];
  [prevId, nextId]
    .filter(Boolean)
    .forEach((id) => {
      const meta = getVideoMetaById(id);
      if (meta) {
        getOrCreateSlide(meta);
      }
    });
}

function cleanupRenderedSlides() {
  const keep = new Set([
    appState.order[appState.cursor - 1],
    appState.order[appState.cursor],
    appState.order[appState.cursor + 1],
  ]);

  for (const [id, node] of appState.rendered.entries()) {
    if (!keep.has(id)) {
      node.remove();
      appState.rendered.delete(id);
    }
  }
}

function finalizeCurrentWatch() {
  if (!appState.currentView) {
    return;
  }

  const meta = getVideoMetaById(appState.currentView.videoId);
  const slide = appState.rendered.get(appState.currentView.videoId);
  const video = slide?.querySelector("video");

  if (!meta || !video) {
    appState.currentView = null;
    return;
  }

  const elapsed = (performance.now() - appState.currentView.startedAt) / 1000;
  appState.currentView.accumulatedSeconds += Math.max(0, elapsed);

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 120;
  const watchedSeconds = Math.min(appState.currentView.accumulatedSeconds, duration);
  const r = clamp(watchedSeconds / duration, 0, 1);
  const s = watchSignal(r);

  meta.tags.forEach((tag) => {
    const slot = appState.model.tagModel[tag];
    slot.w = clamp(slot.w + 0.1 * s, -3, 3);
    slot.w *= 0.995;
    slot.a = 1 + (slot.a - 1) * 0.999;
    slot.b = 1 + (slot.b - 1) * 0.999;
  });

  persistModel(appState.model);
  appState.currentView = null;
}

function watchSignal(r) {
  if (r < 0.2) {
    return -1 * ((0.2 - r) / 0.2);
  }
  if (r < 0.5) {
    return 0.2 * ((r - 0.2) / 0.3);
  }
  return 0.2 + 0.8 * ((r - 0.5) / 0.5);
}

function applyVote(type) {
  const currentId = appState.order[appState.cursor];
  const meta = getVideoMetaById(currentId);
  if (!meta) {
    return;
  }

  meta.tags.forEach((tag) => {
    if (type === "like") {
      appState.model.tagModel[tag].a += 1;
    } else {
      appState.model.tagModel[tag].b += 1;
    }

    appState.model.tagModel[tag].w *= 0.995;
    appState.model.tagModel[tag].a = 1 + (appState.model.tagModel[tag].a - 1) * 0.999;
    appState.model.tagModel[tag].b = 1 + (appState.model.tagModel[tag].b - 1) * 0.999;
  });

  persistModel(appState.model);
  renderDebug();
}

function registerExposure(videoMeta) {
  appState.model.recentVideos.push(videoMeta.id);
  appState.model.recentVideos = appState.model.recentVideos.slice(-RECENT_VIDEO_BAN);

  const windowList = appState.model.recentTagWindow;
  windowList.push(videoMeta.id);
  while (windowList.length > RECENT_TAG_WINDOW) {
    windowList.shift();
  }

  const counts = {};
  windowList.forEach((id) => {
    const meta = getVideoMetaById(id);
    meta?.tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  appState.model.recentTagCounts = counts;
  persistModel(appState.model);
}

function selectNextVideo() {
  const banned = new Set(appState.model.recentVideos);
  const candidates = appState.videoMeta.filter((video) => !banned.has(video.id));
  const pool = candidates.length > 0 ? candidates : appState.videoMeta;

  if (Math.random() < 0.2) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const scored = pool.map((video) => ({
    video,
    score: scoreVideo(video),
  }));

  const temperature = 0.7;
  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const exps = scored.map((entry) => Math.exp((entry.score - maxScore) / temperature));
  const total = exps.reduce((sum, x) => sum + x, 0);

  let draw = Math.random() * total;
  for (let i = 0; i < scored.length; i += 1) {
    draw -= exps[i];
    if (draw <= 0) {
      return scored[i].video;
    }
  }
  return scored[scored.length - 1].video;
}

function scoreVideo(video) {
  const perTag = video.tags.map((tag) => {
    const row = appState.model.tagModel[tag] || { a: 1, b: 1, w: 0 };
    const p = row.a / (row.a + row.b);
    const c = Math.log(1 + row.a + row.b);
    return (p - 0.5) * c + 0.7 * row.w;
  });

  const base = perTag.reduce((sum, n) => sum + n, 0) / video.tags.length;
  const overexposure =
    0.15 *
    (video.tags.reduce((sum, tag) => sum + (appState.model.recentTagCounts[tag] || 0), 0) / video.tags.length);

  return base - overexposure;
}

function resetPersonalization() {
  appState.model = defaultModel(appState.validTags);
  persistModel(appState.model);
  renderDebug();
}

function toggleDebugMode() {
  appState.debugMode = !appState.debugMode;
  ui.toggleDebug.textContent = `Debug: ${appState.debugMode ? "On" : "Off"}`;
  ui.debugPanel.hidden = !appState.debugMode;
  renderDebug();
}

function renderDebug() {
  if (!appState.debugMode) {
    return;
  }

  const topTags = Object.entries(appState.model.tagModel)
    .sort((a, b) => b[1].w - a[1].w)
    .slice(0, 20)
    .map(([tag, values]) => `${tag.padEnd(14)} a=${values.a.toFixed(2)} b=${values.b.toFixed(2)} w=${values.w.toFixed(3)}`)
    .join("\n");

  ui.debugPanel.textContent = [
    "Top tag affinities (by w):",
    topTags,
    "",
    `Recent videos: ${appState.model.recentVideos.join(", ") || "(none)"}`,
  ].join("\n");
}

function beginMetadataPreload(videos) {
  let index = 0;

  const preloadChunk = () => {
    const upper = Math.min(index + 8, videos.length);
    for (; index < upper; index += 1) {
      const v = document.createElement("video");
      v.src = videos[index].src;
      v.preload = "metadata";
    }

    if (index < videos.length) {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(preloadChunk);
      } else {
        window.setTimeout(preloadChunk, 20);
      }
    }
  };

  preloadChunk();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

init();
