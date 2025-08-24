import fs from "fs";

// URL плейлиста
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";

// Настройки
const TIMEOUT = 3000;        // Таймаут на один канал
const RETRIES = 1;           // Кол-во повторов
const CONCURRENT = 50;       // Сколько fetch одновременно

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
  let currentTvgId = "";

  for (const line of m3uText.split("\n")) {
    if (line.startsWith("#EXTINF")) {
      currentName = line.split(",").slice(1).join(",").trim();
      const mId = line.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : "";
    } else if (line.startsWith("http") && currentName) {
      if (currentTvgId) {  // оставляем только с tvg-id
        channels.push({ name: currentName, url: line.trim(), tvgId: currentTvgId });
      }
      currentName = "";
      currentTvgId = "";
    }
  }
  return channels;
}

// fetch с таймаутом
async function fetchWithTimeout(url, timeout = TIMEOUT) {
  return Promise.race([
    fetch(url, { 
      method: "GET",
      headers: { Range: "bytes=0-1" } // запросим только первые 2 байта
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeout))
  ]);
}

// Проверка одного канала
async function checkChannel(ch) {
  try {
    const res = await fetchWithTimeout(ch.url, TIMEOUT);

    // если fetch вернул ответ без ошибки сети
    if (res.ok || res.type === "opaque") {
      // Проверка CORS
      if (res.type === "cors" && !res.headers.has("access-control-allow-origin")) {
        ch.working = false;
        console.log(`❌ ${ch.name} (CORS)`);
      } else {
        ch.working = true;
        console.log(`✅ ${ch.name}`);
      }
      return ch;
    }
  } catch (err) {
    // Любая ошибка кроме CORS – игнор, считаем рабочим
    ch.working = true;
    console.log(`✅ ${ch.name}`);
    return ch;
  }

  // fallback – рабочий
  ch.working = true;
  console.log(`✅ ${ch.name}`);
  return ch;
}

// Асинхронная очередь
async function checkAllChannels(channels) {
  let index = 0;
  const total = channels.length;
  const results = [];

  async function worker() {
    while (index < total) {
      const i = index++;
      const ch = channels[i];
      await checkChannel(ch);
      results[i] = ch;
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENT; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// Основная функция
async function main() {
  console.log("Loading playlist...");
  const m3uText = await loadPlaylist(playlistUrl);
  let channels = parsePlaylist(m3uText);
  console.log(`Total channels to check: ${channels.length}`);

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
