import { createServer } from "node:http";
import { chmod, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { extname, join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = resolve("public");
const DATA_DIR = resolve(".studio-data");
const AUDIO_DIR = join(DATA_DIR, "audio");
const VOICES_FILE = join(DATA_DIR, "voices.json");
const CONFIG_FILE = join(DATA_DIR, "config.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4"
};

await mkdir(AUDIO_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, {
      error: error.status ? error.message : "服务器开小差了，请稍后再试。",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MiniMax Voice Studio is running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    const config = await getRuntimeConfig();
    sendJson(res, 200, {
      hasApiKey: Boolean(config.apiKey),
      apiKeySource: config.apiKeySource,
      groupId: config.groupId,
      baseUrl: config.baseUrl,
      savedAt: config.savedAt
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    const body = await readJson(req);
    const existing = await readStudioConfig();
    const apiKey = String(body.apiKey || "").trim() || existing.apiKey || "";
    const groupId = String(body.groupId || "").trim();
    const baseUrl = String(body.baseUrl || "").trim() || "https://api.minimaxi.com";

    if (!apiKey) {
      sendJson(res, 400, { error: "请填写 MiniMax API Key。" });
      return;
    }

    try {
      new URL(baseUrl);
    } catch {
      sendJson(res, 400, { error: "API 域名格式不正确。" });
      return;
    }

    await writeStudioConfig({
      apiKey,
      groupId,
      baseUrl,
      updatedAt: new Date().toISOString()
    });

    const config = await getRuntimeConfig();
    sendJson(res, 200, {
      hasApiKey: Boolean(config.apiKey),
      apiKeySource: config.apiKeySource,
      groupId: config.groupId,
      baseUrl: config.baseUrl,
      savedAt: config.savedAt
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/config") {
    await writeStudioConfig({
      apiKey: "",
      groupId: "",
      baseUrl: "https://api.minimaxi.com",
      updatedAt: new Date().toISOString()
    });
    const config = await getRuntimeConfig();
    sendJson(res, 200, {
      hasApiKey: Boolean(config.apiKey),
      apiKeySource: config.apiKeySource,
      groupId: config.groupId,
      baseUrl: config.baseUrl,
      savedAt: config.savedAt
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/voices") {
    sendJson(res, 200, { voices: await readVoices() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voices/sync") {
    const result = await syncMiniMaxVoices();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/audio/")) {
    await serveAudio(url.pathname, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/audio/combine") {
    const body = await readJson(req);
    const result = await combineAudio(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/voices") {
    const body = await readJson(req);
    const voice = {
      id: String(body.id || body.voiceId || "").trim(),
      name: String(body.name || "").trim(),
      note: String(body.note || "").trim(),
      gender: String(body.gender || "未知"),
      language: String(body.language || "ZH"),
      source: String(body.source || "manual"),
      createdAt: new Date().toISOString()
    };

    if (!voice.id || !voice.name) {
      sendJson(res, 400, { error: "请填写音色 ID 和名称。" });
      return;
    }

    const voices = await readVoices();
    const next = [voice, ...voices.filter((item) => item.id !== voice.id)];
    await writeJson(VOICES_FILE, next);
    sendJson(res, 200, { voice, voices: next });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/voices/")) {
    const voiceId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const voices = (await readVoices()).filter((voice) => voice.id !== voiceId);
    await writeJson(VOICES_FILE, voices);
    sendJson(res, 200, { voices });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tts") {
    const body = await readJson(req);
    const result = await createSpeech(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tts/batch") {
    const body = await readJson(req);
    const result = await createSpeechBatch(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/clone") {
    const result = await cloneVoice(req);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "没有找到这个接口。" });
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requested = resolve(PUBLIC_DIR, `.${decodeURIComponent(cleanPath)}`);
  if (!requested.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(requested);
    if (!fileStat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    const file = await readFile(requested);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(requested)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function serveAudio(pathname, res) {
  const filename = basename(decodeURIComponent(pathname.split("/").pop() || ""));
  const filepath = resolve(AUDIO_DIR, filename);
  if (!filepath.startsWith(AUDIO_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filepath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filepath)] || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    sendText(res, 404, "Audio not found");
  }
}

async function createSpeech(input) {
  const file = await createSpeechFile(input);
  return {
    audioUrl: file.audioUrl,
    durationMs: file.durationMs,
    wordCount: file.wordCount,
    meta: file.meta
  };
}

async function createSpeechBatch(input) {
  const segments = Array.isArray(input.segments)
    ? input.segments
        .map((segment, index) => ({
          id: String(segment.id || `segment-${index + 1}`),
          text: String(segment.text || "").trim()
        }))
        .filter((segment) => segment.text)
    : [];

  if (!segments.length) {
    throw httpError(400, "请先输入要生成的口播文本。");
  }

  const clips = [];
  const buffers = [];

  for (const [index, segment] of segments.entries()) {
    const file = await createSpeechFile({
      ...input,
      text: segment.text
    });

    buffers.push(file.buffer);
    clips.push({
      id: segment.id,
      index,
      text: segment.text,
      audioUrl: file.audioUrl,
      durationMs: file.durationMs,
      wordCount: file.wordCount
    });
  }

  const format = input.format || "mp3";
  const combinedBuffer = Buffer.concat(buffers);
  const filename = `${Date.now()}-${randomUUID()}-combined.${format}`;
  await writeFile(join(AUDIO_DIR, filename), combinedBuffer);

  return {
    audioUrl: `/api/audio/${filename}`,
    durationMs: clips.reduce((total, clip) => total + (clip.durationMs || 0), 0),
    clips
  };
}

async function combineAudio(input) {
  const audioUrls = Array.isArray(input.audioUrls)
    ? input.audioUrls.map((url) => String(url || "").trim()).filter(Boolean)
    : [];

  if (!audioUrls.length) {
    throw httpError(400, "没有可合并的音频片段。");
  }

  const buffers = [];
  for (const audioUrl of audioUrls) {
    buffers.push(await readFile(resolveAudioUrl(audioUrl)));
  }

  const format = sanitizeAudioFormat(input.format || "mp3");
  const filename = `${Date.now()}-${randomUUID()}-combined.${format}`;
  await writeFile(join(AUDIO_DIR, filename), Buffer.concat(buffers));

  return {
    audioUrl: `/api/audio/${filename}`,
    durationMs: Number(input.durationMs || 0),
    clipCount: buffers.length
  };
}

function resolveAudioUrl(audioUrl) {
  let pathname = "";
  try {
    pathname = new URL(audioUrl, "http://localhost").pathname;
  } catch {
    throw httpError(400, "音频地址格式不正确。");
  }

  if (!pathname.startsWith("/api/audio/")) {
    throw httpError(400, "只能合并本地生成的音频片段。");
  }

  const filename = basename(decodeURIComponent(pathname.split("/").pop() || ""));
  const filepath = resolve(AUDIO_DIR, filename);
  if (!filepath.startsWith(AUDIO_DIR)) {
    throw httpError(403, "音频路径无效。");
  }
  return filepath;
}

function sanitizeAudioFormat(format) {
  const value = String(format || "mp3").toLowerCase();
  return ["mp3", "wav", "m4a"].includes(value) ? value : "mp3";
}

async function createSpeechFile(input) {
  const { apiKey } = await requireMiniMaxConfig();
  const text = String(input.text || "").trim();
  const voiceId = String(input.voiceId || "").trim();

  if (!text) {
    throw httpError(400, "请先输入要生成的口播文本。");
  }

  if (!voiceId) {
    throw httpError(400, "请选择或填写一个 MiniMax 音色 ID。");
  }

  const payload = {
    model: input.model || "speech-2.8-hd",
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId,
      speed: clampNumber(input.speed, 0.5, 2, 1),
      vol: clampNumber(input.volume, 0.1, 10, 1),
      pitch: clampNumber(input.pitch, -12, 12, 0)
    },
    audio_setting: {
      sample_rate: Number(input.sampleRate || 32000),
      bitrate: Number(input.bitrate || 128000),
      format: input.format || "mp3",
      channel: Number(input.channel || 1)
    }
  };

  const response = await minimaxFetch("/v1/t2a_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    await throwMiniMaxError(response);
  }

  if (contentType.includes("application/json")) {
    const data = await response.json();
    assertMiniMaxOk(data);
    const audio = extractAudio(data);
    if (!audio) {
      throw httpError(502, "MiniMax 已响应，但没有返回可识别的音频数据。", data);
    }

    const format = payload.audio_setting.format;
    const buffer = decodeAudio(audio);
    const filename = `${Date.now()}-${randomUUID()}.${format}`;
    const filepath = join(AUDIO_DIR, filename);
    await writeFile(filepath, buffer);
    return {
      buffer,
      audioUrl: `/api/audio/${filename}`,
      durationMs: extractDurationMs(data),
      wordCount: data?.extra_info?.word_count || 0,
      meta: data
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const filename = `${Date.now()}-${randomUUID()}.${payload.audio_setting.format}`;
  const buffer = Buffer.from(arrayBuffer);
  await writeFile(join(AUDIO_DIR, filename), buffer);
  return {
    buffer,
    audioUrl: `/api/audio/${filename}`,
    durationMs: 0,
    wordCount: 0
  };
}

async function cloneVoice(req) {
  const { apiKey } = await requireMiniMaxConfig();
  const form = await toWebRequest(req).formData();
  const voiceName = String(form.get("name") || "我的克隆音色").trim();
  const customVoiceId = String(form.get("voiceId") || `voice${Date.now()}`).trim();
  const promptText = String(form.get("promptText") || "").trim();
  const demoText = String(form.get("demoText") || "").trim();
  const model = String(form.get("model") || "speech-2.8-hd").trim();
  const accuracy = Number(form.get("accuracy") || 0.8);
  const file = form.get("audio");

  validateVoiceId(customVoiceId);

  if (!file || typeof file === "string") {
    throw httpError(400, "请上传一段用于克隆的音频。");
  }

  const uploadForm = new FormData();
  uploadForm.append("purpose", "voice_clone");
  uploadForm.append("file", file, file.name || "voice-sample.wav");

  const uploadResponse = await minimaxFetch("/v1/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: uploadForm
  });

  if (!uploadResponse.ok) {
    await throwMiniMaxError(uploadResponse);
  }

  const uploadData = await uploadResponse.json();
  assertMiniMaxOk(uploadData);
  const fileId = extractFileId(uploadData);
  if (!fileId) {
    throw httpError(502, "音频上传成功，但没有拿到 MiniMax file_id。", uploadData);
  }

  const clonePayload = {
    file_id: fileId,
    voice_id: customVoiceId,
    language_boost: "Chinese",
    text: demoText || undefined,
    model: demoText ? model : undefined,
    text_validation: promptText.slice(0, 200) || undefined,
    accuracy: promptText ? accuracy : undefined,
    need_noise_reduction: true,
    need_volume_normalization: true
  };

  const cloneResponse = await minimaxFetch("/v1/voice_clone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(clonePayload)
  });

  if (!cloneResponse.ok) {
    await throwMiniMaxError(cloneResponse);
  }

  const cloneData = await cloneResponse.json();
  assertMiniMaxOk(cloneData);
  const voice = {
    id: extractVoiceId(cloneData) || customVoiceId,
    name: voiceName,
    note: "MiniMax 克隆音色",
    gender: "自定义",
    language: "ZH",
    source: "clone",
    createdAt: new Date().toISOString()
  };

  const voices = await readVoices();
  const next = [voice, ...voices.filter((item) => item.id !== voice.id)];
  await writeJson(VOICES_FILE, next);

  return {
    voice,
    voices: next,
    demoAudio: cloneData?.demo_audio || "",
    upload: uploadData,
    clone: cloneData
  };
}

function toWebRequest(req) {
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: "half"
  });
}

async function minimaxFetch(path, init) {
  const { baseUrl, groupId } = await getRuntimeConfig();
  const url = new URL(path, baseUrl);
  if (groupId) {
    url.searchParams.set("GroupId", groupId);
  }
  return fetch(url, init);
}

async function getRuntimeConfig() {
  const saved = await readStudioConfig();
  const apiKey = process.env.MINIMAX_API_KEY || saved.apiKey || "";
  const groupId = process.env.MINIMAX_GROUP_ID || saved.groupId || "";
  const baseUrl = process.env.MINIMAX_BASE_URL || saved.baseUrl || "https://api.minimaxi.com";

  return {
    apiKey,
    apiKeySource: process.env.MINIMAX_API_KEY ? "env" : saved.apiKey ? "local" : "missing",
    groupId,
    baseUrl,
    savedAt: saved.updatedAt || ""
  };
}

async function requireMiniMaxConfig() {
  const config = await getRuntimeConfig();
  if (!config.apiKey) {
    throw httpError(401, "请先在本地密钥里保存 MiniMax API Key。");
  }
  return config;
}

async function readStudioConfig() {
  try {
    const content = await readFile(CONFIG_FILE, "utf8");
    const config = JSON.parse(content);
    return {
      apiKey: String(config.apiKey || ""),
      groupId: String(config.groupId || ""),
      baseUrl: String(config.baseUrl || "https://api.minimaxi.com"),
      updatedAt: String(config.updatedAt || "")
    };
  } catch {
    return {
      apiKey: "",
      groupId: "",
      baseUrl: "https://api.minimaxi.com",
      updatedAt: ""
    };
  }
}

async function writeStudioConfig(config) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600);
}

async function syncMiniMaxVoices() {
  const { apiKey } = await requireMiniMaxConfig();
  const response = await minimaxFetch("/v1/get_voice", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ voice_type: "all" })
  });

  if (!response.ok) {
    await throwMiniMaxError(response);
  }

  const data = await response.json();
  assertMiniMaxOk(data);

  const remoteVoices = normalizeRemoteVoices(data);
  const localVoices = await readVoices();
  const next = mergeVoices(remoteVoices, localVoices);
  await writeJson(VOICES_FILE, next);

  return {
    voices: next,
    remoteCount: remoteVoices.length,
    raw: data
  };
}

async function readVoices() {
  const defaults = [
    {
      id: "male-qn-qingse",
      name: "青涩青年音色",
      note: "官方中文普通话音色，适合清爽口播",
      gender: "男性",
      language: "ZH",
      source: "preset",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "female-yujie",
      name: "御姐音色",
      note: "官方中文普通话音色，适合成熟品牌口播",
      gender: "女性",
      language: "ZH",
      source: "preset",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "Chinese (Mandarin)_News_Anchor",
      name: "新闻女声",
      note: "适合财经、科技、资讯口播",
      gender: "女性",
      language: "ZH",
      source: "preset",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "Chinese (Mandarin)_Gentleman",
      name: "温润男声",
      note: "适合商业解说、知识视频",
      gender: "男性",
      language: "ZH",
      source: "preset",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "Chinese (Mandarin)_Warm_Girl",
      name: "温柔女声",
      note: "适合品牌故事、生活方式口播",
      gender: "女性",
      language: "ZH",
      source: "preset",
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ];

  try {
    const content = await readFile(VOICES_FILE, "utf8");
    const voices = JSON.parse(content);
    const savedVoices = Array.isArray(voices) ? voices.filter((voice) => voice.source !== "preset") : [];
    return mergeVoices(savedVoices, defaults);
  } catch {
    await writeJson(VOICES_FILE, defaults);
    return defaults;
  }
}

function mergeVoices(voices, defaults) {
  const seen = new Set();
  return [...voices, ...defaults].filter((voice) => {
    if (!voice?.id || seen.has(voice.id)) return false;
    seen.add(voice.id);
    return true;
  });
}

function normalizeRemoteVoices(data) {
  const groups = [
    ["system_voice", "system"],
    ["voice_cloning", "clone"],
    ["voice_generation", "generated"]
  ];

  return groups.flatMap(([key, source]) => {
    const list = Array.isArray(data?.[key]) ? data[key] : [];
    return list
      .map((item) => ({
        id: String(item.voice_id || "").trim(),
        name: String(item.voice_name || item.voice_id || "").trim(),
        note: String(item.description || (source === "clone" ? "MiniMax 克隆音色" : "MiniMax 音色")),
        gender: "通用",
        language: "ZH",
        source,
        createdAt: new Date().toISOString()
      }))
      .filter((voice) => voice.id);
  });
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractAudio(data) {
  return (
    data?.data?.audio ||
    data?.audio ||
    data?.result?.audio ||
    data?.data?.audio_data ||
    data?.audio_file
  );
}

function extractDurationMs(data) {
  const duration = Number(
    data?.extra_info?.audio_length ||
      data?.data?.audio_length ||
      data?.result?.audio_length ||
      0
  );
  return Number.isFinite(duration) ? duration : 0;
}

function decodeAudio(audio) {
  const text = String(audio || "");
  if (/^[\da-f]+$/i.test(text) && text.length % 2 === 0) {
    return Buffer.from(text, "hex");
  }
  return Buffer.from(text, "base64");
}

function assertMiniMaxOk(data) {
  const code = data?.base_resp?.status_code ?? data?.base_resp?.code;
  if (code && Number(code) !== 0) {
    throw httpError(502, data?.base_resp?.status_msg || "MiniMax 接口返回错误。", data);
  }
}

function extractFileId(data) {
  return data?.file?.file_id || data?.file_id || data?.data?.file_id || data?.data?.file?.file_id;
}

function extractVoiceId(data) {
  return data?.voice_id || data?.data?.voice_id || data?.result?.voice_id;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function validateVoiceId(voiceId) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId)) {
    throw httpError(400, "voice_id 需为 8-256 位，以英文字母开头，只能包含字母、数字、-、_，且不能以 - 或 _ 结尾。");
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw httpError(401, `请先设置 ${name} 环境变量。`);
  }
  return value;
}

function httpError(status, message, detail) {
  const error = new Error(message);
  error.status = status;
  error.detail = detail;
  return error;
}

async function throwMiniMaxError(response) {
  const text = await response.text();
  let detail = text;
  try {
    detail = JSON.parse(text);
  } catch {
    // Keep plain text when MiniMax does not return JSON.
  }
  throw httpError(response.status, "MiniMax 接口返回错误。", detail);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}
