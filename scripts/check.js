// check.js
const { exec } = require("child_process");
const util = require("util");
const https = require("https");

const execAsync = util.promisify(exec);
const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";

// скачать m3u по https
function fetchPlaylist(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// парсер m3u
function parseM3U(data) {
  const lines = data.split("\n");
  const channels = [];
  let name = "";

  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      // достаём имя канала
      const match = line.match(/,(.*)$/);
      if (match) {
        name = match[1].trim();
      }
    } else if (line.trim() && !line.startsWith("#")) {
      // сама ссылка
      channels.push({ name, url: line.trim() });
      name = "";
    }
  }
  return channels;
}

// проверка канала
async function checkChannel(url, name) {
  try {
    await execAsync(
      `ffmpeg -loglevel error -i "${url}" -t 3 -c copy -f null -`,
      { timeout: 20000 }
    );
    console.log(`✅ ${name}`);
  } catch (err) {
    let reason = "Неизвестная ошибка";

    if (err.killed) {
      reason = "Превышен таймаут";
    } else if (err.signal) {
      reason = `Сигнал ${err.signal}`;
    } else if (err.stderr && err.stderr.trim()) {
      const lines = err.stderr.trim().split("\n");
      reason = lines[lines.length - 1] || reason;
      console.log(`❌ ${name} {${reason}}`);
      return;
    } else {
      console.log(`✅ ${name} (⚠️ stderr пустой, может быть ложная ошибка)`);
      return;
    }
  }
}

(async () => {
  console.log("📥 Загружаю плейлист...");
  try {
    const data = await fetchPlaylist(PLAYLIST_URL);
    const channels = parseM3U(data);

    console.log(`📺 Найдено каналов: ${channels.length}`);

    // ограничим первые 20 чтобы быстро проверить
    for (const ch of channels.slice(0, 20)) {
      await checkChannel(ch.url, ch.name);
    }
  } catch (e) {
    console.error("Ошибка загрузки плейлиста:", e.message);
  }
})();
