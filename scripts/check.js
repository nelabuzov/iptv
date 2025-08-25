const fs = require("fs");
const https = require("https");
const { exec } = require("child_process");
const util = require("util");

const execPromise = util.promisify(exec);

const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";
const OUTPUT_FILE = "data/channels.json";
const BATCH_SIZE = 20;

// Скачиваем плейлист
function fetchPlaylist(url) {
  return new Promise((resolve, reject) => {
    let data = "";
    https.get(url, (res) => {
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// Парсим M3U, оставляем только с tvg-id
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let currentName = "";
  let currentTvgId = "";

  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      currentName = line.split(",").slice(1).join(",").trim();
      const mId = line.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : "";
    } else if (line.startsWith("http") && currentName && currentTvgId) {
      channels.push({ name: currentName, url: line.trim(), tvgId: currentTvgId });
      currentName = "";
      currentTvgId = "";
    }
  }
  return channels;
}

// Проверяем поток через ffmpeg
async function checkStream(ch) {
  try {
    await execPromise(
      `ffmpeg -loglevel error -timeout 5000000 -i "${ch.url}" -t 1 -f null -`
    );
    ch.working = true;
    console.log(`✅ ${ch.name}`);
  } catch (err) {
    const msg = (err.stderr || err.message || "").trim();
    if (!msg || !/Error opening input|Forbidden|Not Found/i.test(msg)) {
      // нет явной ошибки — считаем рабочим
      ch.working = true;
      console.log(`✅ ${ch.name}`);
    } else {
      const lastLine = msg.split("\n").pop();
      ch.working = false;
      console.log(`❌ ${ch.name} {${lastLine}}`);
    }
  }
  return ch;
}

// Пакетная проверка
async function checkAll(channels) {
  const results = [];
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const checked = await Promise.all(batch.map(ch => checkStream(ch)));
    results.push(...checked);
  }
  return results;
}

// Основная функция
(async () => {
  console.log("📥 Загружаю плейлист...");
  const m3uText = await fetchPlaylist(PLAYLIST_URL);
  const channels = parseM3U(m3uText);
  console.log(`📺 Найдено каналов с tvg-id: ${channels.length}`);

  const results = await checkAll(channels);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`✅ Готово! Результаты сохранены в ${OUTPUT_FILE}`);
})();
