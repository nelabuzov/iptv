import fs from "fs";

// URL плейлиста
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";

// Таймаут для каждого запроса (мс)
const TIMEOUT = 5000;

// Размер пакета каналов, проверяемых одновременно
const BATCH_SIZE = 20;

// Загрузка плейлиста
async function loadPlaylist(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch playlist");
  return await res.text();
}

// Парсинг плейлиста
function parsePlaylist(m3uText) {
  const channels = [];
  let currentName = "";

  for (const line of m3uText.split("\n")) {
    if (line.startsWith("#EXTINF")) {
      currentName = line.split(",").slice(1).join(",").trim();
    } else if (line.startsWith("http") && currentName) {
      channels.push({ name: currentName, url: line.trim() });
      currentName = "";
    }
  }

  return channels;
}

// Функция fetch с таймаутом
function fetchWithTimeout(url, timeout = TIMEOUT) {
  return Promise.race([
    fetch(url, { method: "HEAD" }),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timeout")), timeout)
    ),
  ]);
}

// Проверка одного канала
async function checkChannel(ch, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(ch.url, TIMEOUT);
      if (res.ok || res.type === "opaque") {
        ch.working = true; // канал рабочий
        return ch;
      }
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 1000)); // пауза перед повтором
  }
  ch.working = false; // если все попытки провалились
  return ch;
}

// Проверка всех каналов пакетами
async function checkAllChannels(channels) {
  const result = [];
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE).map(checkChannel);
    const checked = await Promise.all(batch);
    result.push(...checked);
    console.log(`Checked ${Math.min(i + BATCH_SIZE, channels.length)} / ${channels.length}`);
  }
  return result;
}

// Основная функция
async function main() {
  console.log("Loading playlist...");
  const m3uText = await loadPlaylist(playlistUrl);
  let channels = parsePlaylist(m3uText);
  console.log(`Total channels found: ${channels.length}`);

  console.log("Checking channels...");
  channels = await checkAllChannels(channels);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/channels.json", JSON.stringify(channels, null, 2));
  console.log("Done! channels.json created in data/");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
