// scripts/check.js
import fs from "fs";

// === Настройки (редактируй при необходимости) ===
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const TIMEOUT = Number(process.env.TIMEOUT_MS || 3000);
const CONCURRENT = Number(process.env.CONCURRENT || 50);
// без ретраев — проверяем один раз (по твоей просьбе)
const RETRIES = 0;

// Имитиуем Origin браузера — укажи свой (важно для проверки CORS)
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
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

// === Парсер плейлиста (как в твоём коде) ===
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

// === Основная проверка плейлиста + первой "дочки" ===
// Бросаем ошибку с префиксом, если обнаружили именно CORS/matching/status
async function checkChannelOnce(ch) {
  // делаем GET с Origin — чтобы сервер вернул ACAO если он намерен это делать
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

  // Если статус — один из явных кейсов, которые ты перечислил, считаем нерабочим
  const badStatuses = new Set([302, 403, 404, 503]);
  if (badStatuses.has(plRes.status)) {
    throw new Error(`blocked:status:${plRes.status}`);
  }

  // Если отсутствует ACAO или ACAO не разрешает наш origin — это CORS-падение
  if (!hasCorsHeader(plRes) || !corsAllows(plRes)) {
    throw new Error("no-cors:playlist");
  }

  // Если это m3u8 — проверим первую дочернюю ссылку (вариант/сегмент)
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

  return true; // если дошли сюда — CORS есть и статусы не из списка «явных проблем»
}

// === Обёртка: только перечисленные ошибки => нерабочий; остальные — рабочий ===
async function checkChannel(ch) {
  try {
    await checkChannelOnce(ch);
    ch.working = true;
    console.log(`✅ ${ch.name}`);
    return ch;
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();

    // Если это CORS-падение или один из «явных проблемных» статусов или специфические строки
    const isCors = msg.startsWith("no-cors");
    const isBlockedStatus = msg.startsWith("blocked:status");
    const explicitNetworkMarkers = ["ns_binding_aborted", "не удалось выполнить запрос cors", "cors"]; // включаем те строки, которые ты перечислил
    const isExplicitNetworkMarker = explicitNetworkMarkers.some(s => msg.includes(s));

    if (isCors || isBlockedStatus || isExplicitNetworkMarker) {
      ch.working = false;
      console.log(`❌ ${ch.name}`);
      return ch;
    }

    // Иначе: сетевые таймауты/ошибки/прочее — считаем рабочим (по твоему требованию)
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
      const ch = channels[i];
      out[i] = await checkChannel(ch);
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
