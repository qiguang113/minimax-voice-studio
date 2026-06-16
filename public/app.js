const STORAGE_KEY = "minimax-voice-studio-state";

const demoText = [
  "在6月12日，SpaceX正式登陆纳斯达克，AI和航天两大叙事叠加，让这次IPO刷新了全球纪录。",
  "顺应人类命运共同体大势，分析讲解战略性新兴产业，欢迎回到因势分解，我是解读人之光，今天我们就来看看这场历史级的IPO吧。",
  "从2002年拿着PayPal套现的1亿美元创办SpaceX，到2026年SpaceX成功上市，马斯克用了整整24年。",
  "SpaceX这次的IPO发行价定在了每股135美元，一共发行约5.56亿股股票，募资规模达到了750亿美元。",
  "不过，老马的缺席丝毫没有影响资本市场的热情。上市首日，SpaceX股价在盘中最高到达了170美元左右。"
];

const state = loadState() || {
  projectName: "MiniMax 口播项目",
  selectedVoiceId: "male-qn-qingse",
  currentChapterId: "chapter-1",
  chapters: [
    {
      id: "chapter-1",
      title: "默认章节",
      segments: demoText.map((text) => ({ id: crypto.randomUUID(), text }))
    }
  ],
  lastAudioUrl: "",
  clips: [],
  durationMs: 0
};

state.clips ||= [];
state.durationMs ||= 0;
state.lastAudioUrl ||= "";

let voices = [];
let selectedSegmentId = state.chapters[0]?.segments[0]?.id || "";
let saveTimer = 0;
let knownDurationMs = state.durationMs || 0;
let clipPlaybackIndex = -1;
let clipPlaybackMode = false;

const els = {
  keyStatus: document.querySelector("#keyStatus"),
  chapterList: document.querySelector("#chapterList"),
  scriptEditor: document.querySelector("#scriptEditor"),
  chapterTitleInput: document.querySelector("#chapterTitleInput"),
  autosaveLabel: document.querySelector("#autosaveLabel"),
  projectNameInput: document.querySelector("#projectNameInput"),
  generateButton: document.querySelector("#generateButton"),
  importDemoButton: document.querySelector("#importDemoButton"),
  addChapterButton: document.querySelector("#addChapterButton"),
  tabs: document.querySelectorAll(".tab"),
  tabPages: document.querySelectorAll(".tab-page"),
  voiceList: document.querySelector("#voiceList"),
  voiceSearchInput: document.querySelector("#voiceSearchInput"),
  syncVoicesButton: document.querySelector("#syncVoicesButton"),
  saveManualVoiceButton: document.querySelector("#saveManualVoiceButton"),
  manualVoiceName: document.querySelector("#manualVoiceName"),
  manualVoiceId: document.querySelector("#manualVoiceId"),
  cloneButton: document.querySelector("#cloneButton"),
  cloneNameInput: document.querySelector("#cloneNameInput"),
  cloneVoiceIdInput: document.querySelector("#cloneVoiceIdInput"),
  clonePromptInput: document.querySelector("#clonePromptInput"),
  cloneDemoInput: document.querySelector("#cloneDemoInput"),
  audioFileInput: document.querySelector("#audioFileInput"),
  modelSelect: document.querySelector("#modelSelect"),
  speedInput: document.querySelector("#speedInput"),
  speedValue: document.querySelector("#speedValue"),
  volumeInput: document.querySelector("#volumeInput"),
  volumeValue: document.querySelector("#volumeValue"),
  pitchInput: document.querySelector("#pitchInput"),
  pitchValue: document.querySelector("#pitchValue"),
  sampleRateSelect: document.querySelector("#sampleRateSelect"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  groupIdInput: document.querySelector("#groupIdInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  clearConfigButton: document.querySelector("#clearConfigButton"),
  configNote: document.querySelector("#configNote"),
  audioPlayer: document.querySelector("#audioPlayer"),
  playButton: document.querySelector("#playButton"),
  timeLabel: document.querySelector("#timeLabel"),
  waveform: document.querySelector("#waveform"),
  downloadButton: document.querySelector("#downloadButton"),
  toast: document.querySelector("#toast")
};

boot();

async function boot() {
  bindEvents();
  renderAll();
  await Promise.all([loadConfig(), loadVoices()]);
  if (state.lastAudioUrl) {
    setAudio(state.lastAudioUrl, state.durationMs || 0);
  }
}

function bindEvents() {
  els.projectNameInput.addEventListener("input", () => {
    state.projectName = els.projectNameInput.value;
    queueSave();
  });

  els.chapterTitleInput.addEventListener("input", () => {
    currentChapter().title = els.chapterTitleInput.value;
    renderChapters();
    queueSave();
  });

  els.addChapterButton.addEventListener("click", () => {
    const chapter = {
      id: crypto.randomUUID(),
      title: `新章节 ${state.chapters.length + 1}`,
      segments: [{ id: crypto.randomUUID(), text: "" }]
    };
    state.chapters.push(chapter);
    state.currentChapterId = chapter.id;
    selectedSegmentId = chapter.segments[0].id;
    renderAll();
    queueSave();
  });

  els.importDemoButton.addEventListener("click", () => {
    const chapter = currentChapter();
    chapter.title = "SpaceX IPO 口播";
    chapter.segments = demoText.map((text) => ({ id: crypto.randomUUID(), text }));
    selectedSegmentId = chapter.segments[0].id;
    renderAll();
    queueSave();
    toast("示例脚本已载入。");
  });

  els.generateButton.addEventListener("click", generateSpeech);
  els.playButton.addEventListener("click", togglePlayback);
  els.downloadButton.addEventListener("click", downloadAudio);

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  els.voiceSearchInput.addEventListener("input", renderVoices);
  els.syncVoicesButton.addEventListener("click", syncVoices);
  els.saveManualVoiceButton.addEventListener("click", saveManualVoice);
  els.cloneButton.addEventListener("click", cloneVoice);
  els.saveConfigButton.addEventListener("click", saveConfig);
  els.clearConfigButton.addEventListener("click", clearConfig);

  bindRange(els.speedInput, els.speedValue, (value) => `${Number(value).toFixed(2)}x`);
  bindRange(els.volumeInput, els.volumeValue, (value) => Number(value).toFixed(1));
  bindRange(els.pitchInput, els.pitchValue, (value) => String(value));

  els.audioPlayer.addEventListener("timeupdate", updateTime);
  els.audioPlayer.addEventListener("loadedmetadata", updateTime);
  els.audioPlayer.addEventListener("ended", handleAudioEnded);
}

async function loadConfig() {
  try {
    const config = await apiGet("/api/config");
    els.keyStatus.classList.toggle("ready", config.hasApiKey);
    els.keyStatus.classList.toggle("missing", !config.hasApiKey);
    els.keyStatus.textContent = config.hasApiKey ? "MiniMax Key 已连接" : "等待设置 MiniMax Key";
    els.groupIdInput.value = config.groupId || "";
    els.baseUrlInput.value = config.baseUrl || "https://api.minimaxi.com";
    els.apiKeyInput.value = "";
    els.apiKeyInput.dataset.hasLocalKey = config.apiKeySource === "local" ? "true" : "false";
    els.configNote.textContent = config.hasApiKey
      ? `当前来源：${config.apiKeySource === "env" ? "环境变量" : "本地文件"}${config.savedAt ? ` · 已保存于 ${formatLocalTime(config.savedAt)}` : ""}`
      : "密钥只保存在本机项目目录。";
  } catch {
    els.keyStatus.classList.add("missing");
    els.keyStatus.textContent = "无法读取配置";
  }
}

async function loadVoices() {
  try {
    const data = await apiGet("/api/voices");
    voices = data.voices || [];
    if (!voices.some((voice) => voice.id === state.selectedVoiceId)) {
      state.selectedVoiceId = voices[0]?.id || "";
    }
    renderVoices();
  } catch (error) {
    toast(error.message || "音色列表读取失败。");
  }
}

function renderAll() {
  els.projectNameInput.value = state.projectName;
  renderChapters();
  renderEditor();
  renderWaveform();
}

function renderChapters() {
  const chapter = currentChapter();
  els.chapterTitleInput.value = chapter.title;
  els.chapterList.replaceChildren(
    ...state.chapters.map((item) => {
      const button = document.createElement("button");
      button.className = `chapter-item${item.id === state.currentChapterId ? " active" : ""}`;
      button.type = "button";
      button.innerHTML = `
        <span>
          <strong>${escapeHtml(item.title || "未命名章节")}</strong>
          <span>${item.segments.length} 段口播</span>
        </span>
        <span class="chapter-count">${countWords(item.segments)} 字</span>
      `;
      button.addEventListener("click", () => {
        state.currentChapterId = item.id;
        selectedSegmentId = item.segments[0]?.id || "";
        renderAll();
        queueSave();
      });
      return button;
    })
  );
}

function renderEditor() {
  const chapter = currentChapter();
  els.scriptEditor.replaceChildren(
    ...chapter.segments.map((segment, index) => {
      const row = document.createElement("div");
      row.className = "script-row";
      row.innerHTML = `
        <div class="avatar" aria-hidden="true"></div>
        <article class="segment${segment.id === selectedSegmentId ? " active" : ""}" data-segment-id="${segment.id}">
          <textarea aria-label="口播段落 ${index + 1}" placeholder="输入这一段口播文案...">${escapeHtml(segment.text)}</textarea>
          <div class="segment-actions">
            <button class="pill-button regenerate-segment" type="button">重生成本段</button>
            <button class="pill-button add-after" type="button">新增段落</button>
            <button class="pill-button split-segment" type="button">按句拆分</button>
            <button class="pill-button delete-segment" type="button">删除</button>
          </div>
        </article>
      `;
      const textarea = row.querySelector("textarea");
      const segmentCard = row.querySelector(".segment");
      textarea.addEventListener("focus", () => {
        markActiveSegment(segment.id);
      });
      textarea.addEventListener("input", () => {
        segment.text = textarea.value;
        autoGrow(textarea);
        renderChapters();
        renderWaveform();
        queueSave();
      });
      textarea.addEventListener("paste", (event) => {
        handleSegmentPaste(event, index, segment, textarea);
      });
      row.querySelector(".regenerate-segment").addEventListener("click", (event) => {
        regenerateSegment(index, segment, event.currentTarget);
      });
      row.querySelector(".add-after").addEventListener("click", () => addSegmentAfter(index));
      row.querySelector(".split-segment").addEventListener("click", () => splitSegment(index));
      row.querySelector(".delete-segment").addEventListener("click", () => deleteSegment(index));
      segmentCard.addEventListener("click", () => {
        markActiveSegment(segment.id);
      });
      queueMicrotask(() => autoGrow(textarea));
      return row;
    })
  );
}

function markActiveSegment(segmentId) {
  selectedSegmentId = segmentId;
  els.scriptEditor.querySelectorAll(".segment").forEach((card) => {
    card.classList.toggle("active", card.dataset.segmentId === segmentId);
  });
}

function handleSegmentPaste(event, index, segment, textarea) {
  const pastedText = event.clipboardData?.getData("text/plain") || "";
  const parts = splitPastedText(pastedText);
  if (parts.length <= 1) return;

  event.preventDefault();

  const chapter = currentChapter();
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const insertedSegments = parts.slice(1).map((text, partIndex, allParts) => ({
    id: crypto.randomUUID(),
    text: partIndex === allParts.length - 1 ? `${text}${after}` : text
  }));

  segment.text = `${before}${parts[0]}`;
  chapter.segments.splice(index + 1, 0, ...insertedSegments);
  selectedSegmentId = segment.id;

  renderAll();
  queueSave();
  toast(`已按段落拆成 ${parts.length} 段。`);
}

function splitPastedText(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map(cleanPastedPart)
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  const lines = normalized
    .split(/\n+/)
    .map(cleanPastedPart)
    .filter(Boolean);
  return lines.length > 1 ? lines : [normalized];
}

function cleanPastedPart(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderVoices() {
  const keyword = els.voiceSearchInput.value.trim().toLowerCase();
  const filtered = voices.filter((voice) => {
    const haystack = `${voice.name} ${voice.id} ${voice.note}`.toLowerCase();
    return haystack.includes(keyword);
  });

  els.voiceList.replaceChildren(
    ...filtered.map((voice) => {
      const card = document.createElement("button");
      card.className = `voice-card${voice.id === state.selectedVoiceId ? " active" : ""}`;
      card.type = "button";
      card.innerHTML = `
        <div class="voice-card-top">
          <div class="avatar" aria-hidden="true"></div>
          <div>
            <strong>${escapeHtml(voice.name)}</strong>
            <p>${escapeHtml(voice.id)}</p>
          </div>
        </div>
        <p>${escapeHtml(voice.note || "MiniMax 音色")}</p>
        <div class="voice-meta">
          <span>${escapeHtml(voice.language || "ZH")}</span>
          <span>${escapeHtml(voice.gender || "通用")}</span>
          <span>${voice.source === "clone" ? "克隆" : voice.source === "manual" ? "自定义" : "预设"}</span>
        </div>
      `;
      card.addEventListener("click", () => {
        state.selectedVoiceId = voice.id;
        renderVoices();
        queueSave();
      });
      return card;
    })
  );
}

function renderWaveform() {
  const text = collectText();
  const clips = getTimelineClips();
  const hasGeneratedAudio = clips.some((clip) => clip.audioUrl);

  if (!hasGeneratedAudio) {
    els.waveform.innerHTML = `<div class="wave-placeholder">${text ? "生成后会在这里看到口播片段" : "先写几段口播文案"}</div>`;
    return;
  }

  const total = clips.reduce((sum, clip) => sum + getClipWeight(clip), 0) || 1;

  els.waveform.innerHTML = `
    <div class="wave-track">
      ${clips.map((clip, index) => renderClip(clip, index, total)).join("")}
    </div>
    <div class="wave-playhead" aria-hidden="true"></div>
  `;

  els.waveform.querySelectorAll("[data-clip-index]").forEach((clipButton) => {
    clipButton.addEventListener("click", () => {
      playClipAt(Number(clipButton.dataset.clipIndex || 0));
    });
  });
}

function renderClip(clip, index, total) {
  const weight = getClipWeight(clip);
  const bars = Array.from({ length: 34 }, (_, barIndex) => {
    const height = 18 + Math.round(Math.abs(Math.sin((index + 1) * (barIndex + 2) * 0.61) * 46));
    return `<i style="height:${height}px"></i>`;
  }).join("");

  const playable = Boolean(clip.audioUrl);
  const className = [
    "wave-clip",
    "segment-clip",
    playable ? "is-ready" : "is-empty",
    clip.stale ? "is-stale" : ""
  ].filter(Boolean).join(" ");
  const duration = playable ? formatTimeMs(getClipDurationMs(clip)) : "未生成";

  return `
    <button class="${className}" type="button" data-clip-index="${index}" ${playable ? "" : "disabled"} style="flex-basis:${Math.max(12, (weight / total) * 100)}%">
      <div class="wave-bars">${bars}</div>
      <div class="wave-caption">${index + 1}. ${escapeHtml((clip.text || "未生成文案").slice(0, 48))}</div>
      <div class="wave-duration">${duration}</div>
    </button>
  `;
}

function getTimelineClips() {
  const clipMap = new Map((state.clips || []).map((clip) => [clip.id, clip]));
  return currentChapter()
    .segments.map((segment, index) => {
      const text = segment.text.trim();
      const clip = clipMap.get(segment.id);
      return {
        id: segment.id,
        index,
        text: text || clip?.text || "",
        audioUrl: clip?.audioUrl || "",
        durationMs: clip?.durationMs || 0,
        wordCount: clip?.wordCount || text.replace(/\s/g, "").length,
        stale: Boolean(clip?.audioUrl && text && clip.text && text !== String(clip.text).trim())
      };
    })
    .filter((clip) => clip.text || clip.audioUrl);
}

function normalizeClips(clips, segments) {
  const segmentMap = new Map(segments.map((segment, index) => [segment.id, { ...segment, index }]));
  return clips
    .filter((clip) => segmentMap.has(clip.id))
    .map((clip) => {
      const segment = segmentMap.get(clip.id);
      return {
        id: clip.id,
        index: segment.index,
        text: clip.text || segment.text,
        audioUrl: clip.audioUrl || "",
        durationMs: clip.durationMs || 0,
        wordCount: clip.wordCount || segment.text.replace(/\s/g, "").length
      };
    })
    .sort((a, b) => a.index - b.index);
}

function replaceClip(nextClip) {
  const previous = new Map((state.clips || []).map((clip) => [clip.id, clip]));
  previous.set(nextClip.id, nextClip);

  state.clips = currentChapter()
    .segments.map((segment, index) => {
      const clip = previous.get(segment.id);
      return clip?.audioUrl ? { ...clip, index } : null;
    })
    .filter(Boolean);
}

function recalculateDuration() {
  state.durationMs = (state.clips || []).reduce((sum, clip) => sum + getClipDurationMs(clip), 0);
  knownDurationMs = state.durationMs || knownDurationMs || 0;
}

function getClipDurationMs(clip) {
  const duration = Number(clip?.durationMs || 0);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function getClipWeight(clip) {
  return getClipDurationMs(clip) || Math.max(1, (clip.text || "").length);
}

async function hydrateClipDurations(clips) {
  await Promise.all(
    clips
      .filter((clip) => clip.audioUrl && !getClipDurationMs(clip))
      .map(async (clip) => {
        const durationMs = await readAudioDuration(clip.audioUrl);
        if (durationMs) {
          clip.durationMs = durationMs;
        }
      })
  );
}

function readAudioDuration(audioUrl) {
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const timer = window.setTimeout(() => done(0), 5000);
    const done = (durationMs = 0) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      resolve(durationMs);
    };

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      done(duration);
    }, { once: true });
    audio.addEventListener("error", () => done(0), { once: true });
    audio.src = audioUrl;
    audio.load();
  });
}

async function rebuildCombinedAudio() {
  const previous = new Map((state.clips || []).map((clip) => [clip.id, clip]));
  const clips = currentChapter()
    .segments.map((segment, index) => {
      const clip = previous.get(segment.id);
      return clip?.audioUrl ? { ...clip, index } : null;
    })
    .filter(Boolean);
  if (!clips.length) {
    state.lastAudioUrl = "";
    return;
  }

  state.clips = clips;
  recalculateDuration();

  if (clips.length === 1) {
    state.lastAudioUrl = clips[0].audioUrl;
    return;
  }

  const data = await apiPost("/api/audio/combine", {
    audioUrls: clips.map((clip) => clip.audioUrl),
    durationMs: state.durationMs,
    format: "mp3"
  });
  state.lastAudioUrl = data.audioUrl;
}

async function generateSpeech() {
  const segments = currentChapter()
    .segments.map((segment) => ({
      id: segment.id,
      text: segment.text.trim()
    }))
    .filter((segment) => segment.text);

  if (!segments.length) {
    toast("先写一段口播文案，再生成音频。");
    return;
  }
  if (!state.selectedVoiceId) {
    toast("先选择一个 MiniMax 音色。");
    return;
  }

  setBusy(els.generateButton, true, "生成中");
  try {
    const data = await apiPost("/api/tts/batch", {
      ...buildTtsPayload(),
      segments
    });
    state.lastAudioUrl = data.audioUrl;
    state.clips = normalizeClips(data.clips || [], segments);
    state.durationMs = data.durationMs || 0;
    await hydrateClipDurations(state.clips);
    recalculateDuration();
    setAudio(data.audioUrl, state.durationMs);
    renderWaveform();
    queueSave();
    toast(`已生成 ${state.clips.length || segments.length} 段口播。`);
  } catch (error) {
    toast(error.message || "生成失败，请检查 MiniMax Key 和音色 ID。");
  } finally {
    setBusy(els.generateButton, false, "逐段生成");
  }
}

async function regenerateSegment(index, segment, button) {
  const text = segment.text.trim();
  if (!text) {
    toast("这一段还是空的，先写文案再生成。");
    return;
  }
  if (!state.selectedVoiceId) {
    toast("先选择一个 MiniMax 音色。");
    return;
  }

  markActiveSegment(segment.id);
  setBusy(button, true, "生成中");
  try {
    const data = await apiPost("/api/tts", buildTtsPayload({ text }));
    const clip = {
      id: segment.id,
      index,
      text,
      audioUrl: data.audioUrl,
      durationMs: data.durationMs || 0,
      wordCount: data.wordCount || text.replace(/\s/g, "").length
    };

    await hydrateClipDurations([clip]);
    replaceClip(clip);
    recalculateDuration();
    await rebuildCombinedAudio();
    setAudio(state.lastAudioUrl || clip.audioUrl, state.durationMs);
    renderWaveform();
    queueSave();
    toast(`第 ${index + 1} 段已重新生成。`);
  } catch (error) {
    toast(error.message || "本段生成失败，请检查 MiniMax Key 和音色 ID。");
  } finally {
    setBusy(button, false, "重生成本段");
  }
}

function buildTtsPayload(extra = {}) {
  return {
    voiceId: state.selectedVoiceId,
    model: els.modelSelect.value,
    speed: els.speedInput.value,
    volume: els.volumeInput.value,
    pitch: els.pitchInput.value,
    sampleRate: els.sampleRateSelect.value,
    format: "mp3",
    ...extra
  };
}

async function cloneVoice() {
  const file = els.audioFileInput.files?.[0];
  if (!file) {
    toast("请先选择一段参考音频。");
    return;
  }

  const voiceId = els.cloneVoiceIdInput.value.trim() || `voice${Date.now()}`;
  const formData = new FormData();
  formData.append("name", els.cloneNameInput.value.trim() || "我的专属口播声");
  formData.append("voiceId", voiceId);
  formData.append("promptText", els.clonePromptInput.value.trim());
  formData.append("demoText", els.cloneDemoInput.value.trim());
  formData.append("model", els.modelSelect.value);
  formData.append("audio", file);

  setBusy(els.cloneButton, true, "克隆中");
  try {
    const data = await fetch("/api/clone", {
      method: "POST",
      body: formData
    }).then(parseResponse);
    voices = data.voices || [data.voice, ...voices];
    state.selectedVoiceId = data.voice.id;
    if (data.demoAudio) {
      state.lastAudioUrl = data.demoAudio;
      state.clips = [];
      state.durationMs = 0;
      setAudio(data.demoAudio, 0);
      renderWaveform();
    }
    renderVoices();
    switchTab("voice");
    queueSave();
    toast("克隆音色已加入音色库。");
  } catch (error) {
    toast(error.message || "克隆失败，请检查参考音频和 MiniMax 配置。");
  } finally {
    setBusy(els.cloneButton, false, "开始克隆");
  }
}

async function syncVoices() {
  setBusy(els.syncVoicesButton, true, "刷新中");
  try {
    const data = await apiPost("/api/voices/sync", {});
    voices = data.voices || [];
    if (!voices.some((voice) => voice.id === state.selectedVoiceId)) {
      state.selectedVoiceId = voices[0]?.id || "";
    }
    renderVoices();
    queueSave();
    toast(`已同步 ${data.remoteCount || 0} 个账号音色。`);
  } catch (error) {
    toast(error.message || "同步音色失败，请检查 MiniMax Key。");
  } finally {
    setBusy(els.syncVoicesButton, false, "刷新账号音色");
  }
}

async function saveConfig() {
  const apiKey = els.apiKeyInput.value.trim();
  const groupId = els.groupIdInput.value.trim();
  const baseUrl = els.baseUrlInput.value.trim();

  if (!apiKey && els.apiKeyInput.dataset.hasLocalKey !== "true") {
    toast("请粘贴 MiniMax API Key 后再保存到本地。");
    return;
  }

  setBusy(els.saveConfigButton, true, "保存中");
  try {
    await apiPost("/api/config", { apiKey, groupId, baseUrl });
    els.apiKeyInput.value = "";
    await loadConfig();
    toast("已保存到本地。");
  } catch (error) {
    toast(error.message || "保存失败。");
  } finally {
    setBusy(els.saveConfigButton, false, "保存到本地");
  }
}

async function clearConfig() {
  setBusy(els.clearConfigButton, true, "清除中");
  try {
    await fetch("/api/config", { method: "DELETE" }).then(parseResponse);
    els.apiKeyInput.value = "";
    await loadConfig();
    toast("本地密钥已清除。");
  } catch (error) {
    toast(error.message || "清除失败。");
  } finally {
    setBusy(els.clearConfigButton, false, "清除本地密钥");
  }
}

async function saveManualVoice() {
  const name = els.manualVoiceName.value.trim();
  const id = els.manualVoiceId.value.trim();
  if (!name || !id) {
    toast("请填写音色名称和 voice_id。");
    return;
  }
  setBusy(els.saveManualVoiceButton, true, "保存中");
  try {
    const data = await apiPost("/api/voices", { name, id, source: "manual" });
    voices = data.voices;
    state.selectedVoiceId = id;
    els.manualVoiceName.value = "";
    els.manualVoiceId.value = "";
    renderVoices();
    queueSave();
    toast("音色已保存。");
  } catch (error) {
    toast(error.message || "保存失败。");
  } finally {
    setBusy(els.saveManualVoiceButton, false, "保存音色");
  }
}

function switchTab(tabName) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  els.tabPages.forEach((page) => page.classList.toggle("active", page.id === `${tabName}Tab`));
}

function addSegmentAfter(index) {
  const chapter = currentChapter();
  const segment = { id: crypto.randomUUID(), text: "" };
  chapter.segments.splice(index + 1, 0, segment);
  selectedSegmentId = segment.id;
  renderAll();
  queueSave();
}

function splitSegment(index) {
  const chapter = currentChapter();
  const segment = chapter.segments[index];
  const parts = segment.text
    .split(/(?<=[。！？!?；;])\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    toast("这一段还不够拆分。");
    return;
  }
  const next = parts.map((text) => ({ id: crypto.randomUUID(), text }));
  chapter.segments.splice(index, 1, ...next);
  selectedSegmentId = next[0].id;
  renderAll();
  queueSave();
}

function deleteSegment(index) {
  const chapter = currentChapter();
  if (chapter.segments.length === 1) {
    chapter.segments[0].text = "";
    renderAll();
    queueSave();
    return;
  }
  chapter.segments.splice(index, 1);
  selectedSegmentId = chapter.segments[Math.max(0, index - 1)]?.id || "";
  renderAll();
  queueSave();
}

function currentChapter() {
  return state.chapters.find((chapter) => chapter.id === state.currentChapterId) || state.chapters[0];
}

function collectText() {
  return currentChapter()
    .segments.map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
}

function countWords(segments) {
  return segments.reduce((total, segment) => total + segment.text.replace(/\s/g, "").length, 0);
}

function setAudio(url, durationMs = 0) {
  els.audioPlayer.src = url;
  knownDurationMs = durationMs || 0;
  clipPlaybackMode = false;
  clipPlaybackIndex = -1;
  els.downloadButton.disabled = false;
  updateTime();
}

function togglePlayback() {
  const playableClips = getTimelineClips().filter((clip) => clip.audioUrl);
  if (!els.audioPlayer.src && !playableClips.length) {
    toast("先生成一段音频。");
    return;
  }

  if (playableClips.length) {
    if (clipPlaybackMode && !els.audioPlayer.paused) {
      els.audioPlayer.pause();
      updatePlayIcon(false);
      return;
    }

    startClipPlayback();
    return;
  }

  if (els.audioPlayer.paused) {
    els.audioPlayer.play();
    updatePlayIcon(true);
  } else {
    els.audioPlayer.pause();
    updatePlayIcon(false);
  }
}

function updatePlayIcon(isPlaying) {
  els.playButton.innerHTML = isPlaying
    ? `<svg viewBox="0 0 24 24"><path d="M8 5v14"/><path d="M16 5v14"/></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg>`;
}

function startClipPlayback() {
  if (!clipPlaybackMode) {
    playClipAt(findPlayableClipIndex(0));
    return;
  }

  els.audioPlayer.play().then(() => updatePlayIcon(true)).catch(() => {
    updatePlayIcon(false);
  });
}

function playClipAt(index) {
  const timelineClips = getTimelineClips();
  const playableIndex = findPlayableClipIndex(index, timelineClips);
  const clip = timelineClips[playableIndex];
  if (!clip) {
    clipPlaybackMode = false;
    clipPlaybackIndex = -1;
    if (state.lastAudioUrl) {
      setAudio(state.lastAudioUrl, state.durationMs || 0);
    }
    updatePlayIcon(false);
    return;
  }

  clipPlaybackMode = true;
  clipPlaybackIndex = playableIndex;
  els.audioPlayer.src = clip.audioUrl;
  knownDurationMs = state.durationMs || 0;
  els.audioPlayer.play().then(() => updatePlayIcon(true)).catch(() => {
    updatePlayIcon(false);
  });
  updateTime();
}

function handleAudioEnded() {
  const nextIndex = findPlayableClipIndex(clipPlaybackIndex + 1);
  if (clipPlaybackMode && nextIndex >= 0) {
    playClipAt(nextIndex);
    return;
  }

  updatePlayIcon(false);
  if (state.lastAudioUrl) {
    setAudio(state.lastAudioUrl, state.durationMs || 0);
  }
}

function updateTime() {
  const clipOffsetMs = clipPlaybackMode ? getClipOffsetMs(clipPlaybackIndex) : 0;
  const currentMs = clipOffsetMs + (els.audioPlayer.currentTime || 0) * 1000;
  const current = formatTimeMs(currentMs);
  const mediaDuration = Number.isFinite(els.audioPlayer.duration) ? els.audioPlayer.duration * 1000 : 0;
  const totalMs = knownDurationMs || mediaDuration || 0;
  const duration = formatTimeMs(totalMs);
  els.timeLabel.textContent = `${current} / ${duration}`;
  updatePlayhead(totalMs ? currentMs / totalMs : 0);
}

function getClipOffsetMs(index) {
  const clips = getTimelineClips();
  if (!clips.length || index <= 0) return 0;
  return clips.slice(0, index).reduce((sum, clip) => sum + getClipDurationMs(clip), 0);
}

function findPlayableClipIndex(startIndex, clips = getTimelineClips()) {
  if (!clips.length) return -1;
  const start = Math.max(0, Number.isFinite(startIndex) ? startIndex : 0);
  const index = clips.findIndex((clip, clipIndex) => clipIndex >= start && clip.audioUrl);
  return index >= 0 ? index : -1;
}

function updatePlayhead(progress) {
  const playhead = els.waveform.querySelector(".wave-playhead");
  if (!playhead) return;

  const track = els.waveform.querySelector(".wave-track");
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const waveformWidth = els.waveform.clientWidth || 1;
  const trackLeft = 18;
  const trackWidth = track ? Math.max(track.clientWidth, track.scrollWidth) : waveformWidth - 36;
  const scrolledX = trackLeft + trackWidth * safeProgress - (track?.scrollLeft || 0);
  const x = Math.max(trackLeft, Math.min(waveformWidth - trackLeft, scrolledX));
  playhead.style.left = `${x}px`;

  els.waveform.querySelectorAll("[data-clip-index]").forEach((clip) => {
    clip.classList.toggle("is-playing", clipPlaybackMode && Number(clip.dataset.clipIndex) === clipPlaybackIndex);
  });
}

function downloadAudio() {
  if (!state.lastAudioUrl) {
    toast("还没有可导出的音频。");
    return;
  }
  const link = document.createElement("a");
  link.href = state.lastAudioUrl;
  link.download = `${state.projectName || "minimax-voice"}.mp3`;
  link.click();
}

function bindRange(input, output, formatter) {
  const update = () => {
    output.textContent = formatter(input.value);
  };
  input.addEventListener("input", update);
  update();
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(50, textarea.scrollHeight)}px`;
}

function setBusy(button, busy, label) {
  if (!button.dataset.idleHtml) {
    button.dataset.idleHtml = button.innerHTML;
  }
  button.disabled = busy;
  button.innerHTML = busy ? label : button.dataset.idleHtml || label;
}

function queueSave() {
  els.autosaveLabel.textContent = "保存中";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    els.autosaveLabel.textContent = "已保存";
  }, 260);
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
  } catch {
    return null;
  }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3600);
}

async function apiGet(path) {
  return fetch(path).then(parseResponse);
}

async function apiPost(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(parseResponse);
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail ? ` ${JSON.stringify(data.detail)}` : "";
    throw new Error(`${data.error || "请求失败。"}${detail}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatTimeMs(milliseconds) {
  return formatTime((milliseconds || 0) / 1000);
}

function formatLocalTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}
