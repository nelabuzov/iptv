import fs from "fs";

// === Настройки ===
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const TIMEOUT_MS = 3000;    // таймаут на один запрос
const RETRIES = 1;          // повторы при сетевой ошибке
const CONCURRENCY = 100;    // параллельных воркеров

// === Утилиты ===
function hasCorsHeader(res) {
  const v = res.headers.get("access-control-allow-origin");
  return v && v.trim() !== "";
}

function looksLikeM3U8(url, res) {
  const u = url.toLowerCase();
  if (u.endsWith(".m3u8")) return true;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/vnd.apple.mpegurl") || ct.includes("application/x-mpegurl");
}

function firstUriFromM3U8(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // master?
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith("#")) return lines[j];
      }
    }
  }
  // media: первая строка без '#'
  for (const l of lines) if (!l.startsWith("#")) return l;
  return null;
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

// === Загрузка и парсинг плейлиста iptv-org ===
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

// === Проверка канала: НЕрабочий только если нет CORS ===
async function checkChannelOnce(ch) {
  // 1) сам плейлист/ресурс
  const res = await fetchWithTimeout(ch.url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Range": "bytes=0-1"
    }
  });

  if (!hasCorsHeader(res)) throw new Error("no-cors:playlist");

  // 2) если это m3u8 — проверяем первую «дочку» (вариант/сегмент)
  if (looksLikeM3U8(ch.url, res)) {
    const text = await res.text();
    const ref = firstUriFromM3U8(text);
    if (ref) {
      const childUrl = new URL(ref, ch.url).href;
      const childRes = await fetchWithTimeout(childUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Range": "bytes=0-1"
        }
      });
      if (!hasCorsHeader(childRes)) throw new Error("no-cors:child");
    }
  }

  return true; // CORS есть — ок
}

async function checkChannel(ch) {
  try {
    const ok = await checkChannelOnce(ch);
    ch.working = true;
    console.log(`✅ ${ch.name}`);
  } catch (e) {
    // если ошибка CORS — считаем канал нерабочим
    if (String(e?.message || "").startsWith("no-cors")) {
      ch.working = false;
      console.log(`❌ ${ch.name}`);
    }
  }
  return ch;
}

// === Параллельная очередь ===
async function checkAllChannels(channels) {
  let i = 0;
  const total = channels.length;
  const out = new Array(total);

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= total) break;
      out[idx] = await checkChannel(channels[idx]);
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
