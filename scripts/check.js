// scripts/check.js
import fs from "fs";

// === Настройки ===
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const TIMEOUT = Number(process.env.TIMEOUT_MS || 3000);
const CONCURRENT = Number(process.env.CONCURRENT || 50);
// без ретраев — один проход
const RETRIES = 0;

// Укажи origin твоего фронта (HTTPS без пути)
const PAGES_ORIGIN = process.env.PAGES_ORIGIN || "https://nelabuzov.github.io";

// === Вспомогательные функции ===
function hasCorsHeader(res) {
  const v = res.headers.get("access-control-allow-origin");
  return !!v && v.trim() !== "";
}
function corsAllows(res) {
  const v = (res.headers.get("access-control-allow-origin") || "").trim();
  if (!v) return false;
  if (v === "*") return true;
  // разрешаем, если точно совпадает или содержит наш origin
  return v === PAGES_ORIGIN || v.includes(PAGES_ORIGIN);
}
function looksLikeM3U8(url, res) {
  const u = (url || "").toLowerCase();
  if (u.endsWith(".m3u8")) return true;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/vnd.apple.mpegurl") || ct.includes("application/x-mpegurl");
}
function firstUriFromM3U8(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith("#")) return lines[j];
      }
    }
  }
  for (const l of lines) if (!l.startsWith("#")) return l;
  return null;
}

async function fetchWithTimeout(url, opts = {}, timeout = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // redirect: "manual" — чтобы отловить 302
    return await fetch(url, { redirect: "manual", ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// === Парсер плейлиста (как у тебя) ===
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

// === Основная проверка: только перечисленные ошибки => нерабочий ===
async function checkChannelOnce(ch) {
  // GET с Origin — чтобы сервер мог вернуть ACAO
  const plRes = await fetchWithTimeout(ch.url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/x-mpegURL,application/vnd.apple.mpegurl,video/*;q=0.9,*/*;q=0.8",
      "Origin": PAGES_ORIGIN,
      "Referer": PAGES_ORIGIN,
      "Range": "bytes=0-1"
    }
  });

  // статусы, которые ты указал считать нерабочими
  const badStatuses = new Set([302, 403, 404, 503]);
  if (badStatuses.has(plRes.status)) {
    throw new Error(`blocked:status:${plRes.status}`);
  }

  // отсутствие заголовка CORS или несоответствие — считаем CORS-падением
  if (!hasCorsHeader(plRes) || !corsAllows(plRes)) {
    throw new Error("no-cors:playlist");
  }

  // если это m3u8 — проверяем первую "дочку"
  if (looksLikeM3U8(ch.url, plRes)) {
    const text = await plRes.text();
    const ref = firstUriFromM3U8(text);
    if (ref) {
      const segUrl = new URL(ref, ch.url).href;
      const segRes = await fetchWithTimeout(segUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "video/*;q=0.9,*/*;q=0.8",
          "Origin": PAGES_ORIGIN,
          "Referer": ch.url,
          "Range": "bytes=0-1"
        }
      });

      if (badStatuses.has(segRes.status)) {
        throw new Error(`blocked:status:${segRes.status}`);
      }
      if (!hasCorsHeader(segRes) || !corsAllows(segRes)) {
        throw new Error("no-cors:segment");
      }
    }
  }

  return true;
}

// === Обёртка: ловим специфичные маркеры ошибок в catch ===
async function checkChannel(ch) {
  try {
    await checkChannelOnce(ch);
    ch.working = true;
    console.log(`✅ ${ch.name}`);
    return ch;
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();

    // маркеры, которые ты просил считать НЕ рабочими:
    const isNoCors = msg.startsWith("no-cors");
    const isBlockedStatus = msg.startsWith("blocked:status");
    const explicitMarkers = [
      "ns_binding_aborted",
      "ns_binding_aborted".toLowerCase(),
      "failed to perform",
      "не удалось выполнить запрос cors",
      "(null)"
    ];
    const hasExplicit = explicitMarkers.some(m => msg.includes(m));

    if (isNoCors || isBlockedStatus || hasExplicit) {
      ch.working = false;
      console.log(`❌ ${ch.name}`);
      return ch;
    }

    // все прочие ошибки (таймауты, временные сетевые фэйл/abort и т.п.)
    // считаем рабочими по твоей политике
    ch.working = true;
    console.log(`✅ ${ch.name}`);
    return ch;
  }
}

// === Параллельная очередь ===
async function checkAllChannels(channels) {
  let idx = 0;
  const total = channels.length;
  const out = new Array(total);

  async function worker(workerId) {
    while (true) {
      const i = idx++;
      if (i >= total) break;
      out[i] = await checkChannel(channels[i]);
      if ((i + 1) % 100 === 0) console.log(`Progress: ${i + 1}/${total}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENT }, (_, i) => worker(i)));
  return out;
}

// === main ===
async function main() {
  console.log("Loading playlist...");
  const res = await fetch(playlistUrl);
  if (!res.ok) throw new Error(`Failed to fetch playlist ${res.status}`);
  const m3u = await res.text();

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
