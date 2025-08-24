import fs from "fs";

// === Конфиг ===
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";

// Таймаут/ретраи/параллелизм
const TIMEOUT_MS   = Number(process.env.TIMEOUT_MS ?? 3000);
const RETRIES      = Number(process.env.RETRIES ?? 1);
const CONCURRENCY  = Number(process.env.CONCURRENCY ?? 100);

// Домен для проверки CORS (как у твоего фронта)
const PAGES_ORIGIN  = process.env.PAGES_ORIGIN  || "https://example.github.io";
const PAGES_REFERER = process.env.PAGES_REFERER || (PAGES_ORIGIN.endsWith("/") ? PAGES_ORIGIN : PAGES_ORIGIN + "/");

// Допустимые значения в Access-Control-Allow-Origin
const ALLOWED_ORIGINS = [
  "*",
  PAGES_ORIGIN,
  "http://localhost",
  "http://127.0.0.1"
];

// === Утилиты ===
function hasAllowedCors(res) {
  const h = res.headers.get("access-control-allow-origin");
  if (!h) return false;
  const v = h.trim();
  if (!v) return false;
  // ок, если звёздочка или явно наш origin
  if (v === "*") return true;
  return ALLOWED_ORIGINS.some(origin => v.includes(origin));
}

function isOkStatus(res) {
  // Любая не-2xx (в т.ч. 302) = ошибка
  return res.status >= 200 && res.status < 300;
}

async function fetchWithTimeout(url, opts = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

// простой парсер m3u8: первая полезная ссылка
function firstUriFromM3U8(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isMaster = lines.some(l => l.startsWith("#EXT-X-STREAM-INF"));
  if (isMaster) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith("#")) return lines[j];
        }
      }
    }
    return null;
  }
  for (const l of lines) {
    if (!l.startsWith("#")) return l;
  }
  return null;
}

// === Загрузка и парсинг исходного m3u ===
async function loadPlaylist(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.status}`);
  return await res.text();
}

function parsePlaylist(m3uText) {
  const channels = [];
  let currentName = "";
  let currentTvgId = "";

  for (const raw of m3uText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      currentName = line.split(",").slice(1).join(",").trim();
      const mId = line.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : "";
    } else if (line.startsWith("http") && currentName) {
      if (currentTvgId) {
        channels.push({ name: currentName, url: line, tvgId: currentTvgId });
      }
      currentName = "";
      currentTvgId = "";
    }
  }
  return channels;
}

// === Проверка одного канала ===
// Любая ошибка на любом шаге -> throw -> ❌
async function checkChannelOnce(ch) {
  // 1) Плейлист
  const plRes = await fetchWithTimeout(ch.url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/x-mpegURL,application/vnd.apple.mpegurl,video/*;q=0.9,*/*;q=0.8",
      "Origin": PAGES_ORIGIN,
      "Referer": PAGES_REFERER
    }
  });

  if (!isOkStatus(plRes)) throw new Error(`playlist HTTP ${plRes.status}`);
  if (!hasAllowedCors(plRes)) throw new Error(`playlist no CORS`);

  // 1a) Если это не m3u8 — считаем достаточно
  const urlLower = ch.url.toLowerCase();
  const contentType = plRes.headers.get("content-type")?.toLowerCase() || "";
  const isM3U8 = urlLower.endsWith(".m3u8") ||
                 contentType.includes("application/vnd.apple.mpegurl") ||
                 contentType.includes("application/x-mpegurl");

  if (!isM3U8) return true;

  const m3u = await plRes.text();
  const firstRef = firstUriFromM3U8(m3u);
  if (!firstRef) throw new Error("m3u8 has no uri");

  const childUrl = new URL(firstRef, ch.url).href;

  // 2) Первая «дочерняя» ссылка (вариант/сегмент)
  const segRes = await fetchWithTimeout(childUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "video/*;q=0.9,*/*;q=0.8",
      "Origin": PAGES_ORIGIN,
      "Referer": PAGES_REFERER,
      "Range": "bytes=0-1" // минимальный объём
    }
  });

  if (!isOkStatus(segRes)) throw new Error(`segment HTTP ${segRes.status}`);
  if (!hasAllowedCors(segRes)) throw new Error(`segment no CORS`);

  return true;
}

async function checkChannel(ch) {
  for (let i = 0; i <= RETRIES; i++) {
    try {
      await checkChannelOnce(ch);
      ch.working = true;
      console.log(`✅ ${ch.name}`);
      return ch;
    } catch (e) {
      // ретрай — молча
    }
  }
  ch.working = false;
  console.log(`❌ ${ch.name}`);
  return ch;
}

// === Параллельная очередь ===
async function checkAllChannels(channels) {
  let idx = 0;
  const total = channels.length;
  const out = new Array(total);

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= total) break;
      out[i] = await checkChannel(channels[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// === main ===
async function main() {
  console.log("Loading playlist...");
  const m3u = await loadPlaylist(playlistUrl);
  let channels = parsePlaylist(m3u);
  console.log(`Total channels with tvg-id: ${channels.length}`);

  channels = await checkAllChannels(channels);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/channels.json", JSON.stringify(channels, null, 2));
  console.log("Done! channels.json created in data/");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
