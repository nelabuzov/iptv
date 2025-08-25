const fs = require("fs");
const puppeteer = require("puppeteer");

// === Настройки ===
const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";
const BATCH_SIZE = 20;   // сколько вкладок одновременно
const TIMEOUT = 15000;   // таймаут на один канал

// === Утилиты ===
// Парсим M3U и возвращаем массив каналов {name, url, tvgId}
async function loadPlaylist(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.status}`);
  const text = await res.text();

  const channels = [];
  let currentName = "";
  let currentTvgId = "";

  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith("#EXTINF")) {
      currentName = l.split(",").slice(1).join(",").trim();
      const mId = l.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : "";
    } else if (l.startsWith("http") && currentName) {
      if (currentTvgId) {
        channels.push({ name: currentName, url: l, tvgId: currentTvgId });
      }
      currentName = "";
      currentTvgId = "";
    }
  }

  return channels;
}

// Проверка одного канала через Puppeteer
async function checkChannel(page, ch) {
  try {
    const response = await page.goto(ch.url, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT
    });

    if (!response) {
      ch.working = false;
      console.log(`❌ ${ch.name} (no response)`);
    } else if (!response.ok()) {
      ch.working = false;
      console.log(`❌ ${ch.name} (status ${response.status()})`);
    } else {
      ch.working = true;
      console.log(`✅ ${ch.name}`);
    }
  } catch (e) {
    ch.working = false;
    console.log(`❌ ${ch.name} (${e.message})`);
  }

  return ch;
}

// Проверка всех каналов пачками
async function checkAllChannels(channels) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const results = [];

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const pages = await Promise.all(batch.map(() => browser.newPage()));

    const checked = await Promise.all(
      batch.map((ch, idx) => checkChannel(pages[idx], ch))
    );

    await Promise.all(pages.map(p => p.close()));
    results.push(...checked);
  }

  await browser.close();
  return results;
}

// === Main ===
(async () => {
  try {
    console.log("Loading playlist...");
    const channels = await loadPlaylist(PLAYLIST_URL);
    console.log(`Total channels to check: ${channels.length}`);

    console.log("Checking channels...");
    const results = await checkAllChannels(channels);

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/channels.json", JSON.stringify(results, null, 2));
    console.log("✅ Done! data/channels.json updated");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();

