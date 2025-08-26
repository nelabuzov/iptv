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
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// Парсим M3U, фильтруем по tvg-id
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let currentName = "";
  let currentTvgId = "";
  let currentLogo = "";
  let currentGroup = "";

  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      // Название
      currentName = line.split(",").slice(1).join(",").trim();
      if (currentName.includes("Gecko")) {
        currentName = currentName.split(",").pop().trim(); // оставляем текст после запятой
      }
      // удаляем скобки и содержимое
      currentName = currentName.replace(/\(.*?\)/g, "").trim();
      // нормализуем пробелы
      currentName = currentName.replace(/\s+/g, " ");

      // tvg-id
      const mId = line.match(/tvg-id="([^"]*)"/i);
      currentTvgId = mId ? mId[1] : "";

      // tvg-logo
      const mLogo = line.match(/tvg-logo="([^"]*)"/i);
      currentLogo = mLogo ? mLogo[1] : "";

      // group-title
      const mGroup = line.match(/group-title="([^"]*)"/i);
      currentGroup = mGroup ? mGroup[1] : "";
    } else if (line.startsWith("http") && currentName && currentTvgId) {
      channels.push({
        name: currentName,
        tvgId: currentTvgId,
        url: line.trim(),
        tvgLogo: currentLogo,
        groupTitle: currentGroup
      });
      currentName = "";
      currentTvgId = "";
      currentLogo = "";
      currentGroup = "";
    }
  }
  return channels;
}

// Проверка потока через ffmpeg
async function checkStream(ch) {
  try {
	await execPromise(
	  `ffmpeg -v error -stimeout 5000000 -i "${ch.url}" -c copy -t 1 -f null -`,
	  { timeout: 15000, maxBuffer: 10 * 1024 } // 15 сек на команду
	);
    ch.working = true;
    console.log(`✅ ${ch.name}`);
  } catch (err) {
    const msg = (err.stderr || err.message || "").trim();
    let shortMsg = "";
    if (!msg || !/(Error opening input|Forbidden|Not Found)/i.test(msg)) {
      ch.working = true;
      console.log(`✅ ${ch.name}`);
    } else {
      // убираем "Error opening input files:" если оно есть
      shortMsg = msg.split("\n").pop().replace(/.*Error opening input files:\s*/, "").trim();
      ch.working = false;
      console.log(`❌ ${ch.name} {${shortMsg}}`);
    }
  }
  return ch;
}

// Пакетная проверка с лимитом параллельности
async function checkAll(channels) {
  const results = [];
  let checkedCount = 0;

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);

    // запускаем с ограничением (например, по 5 одновременно)
    const checked = [];
    for (let j = 0; j < batch.length; j += 5) {
      const smallBatch = batch.slice(j, j + 5);
      const res = await Promise.all(smallBatch.map(ch => checkStream(ch)));
      checked.push(...res);
    }

    results.push(...checked);
    checkedCount += batch.length;
    console.log(`📊 Прогресс: ${checkedCount}/${channels.length}`);
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
