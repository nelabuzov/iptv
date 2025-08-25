const fs = require("fs");
const puppeteer = require("puppeteer");
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const BATCH_SIZE = 20;      // сколько вкладок одновременно
const TIMEOUT = 15000;      // таймаут на один канал

// === Загрузка M3U плейлиста ===
async function loadPlaylist(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.status}`);
  return await res.text();
}

// === Парсинг плейлиста ===
function parseM3U(text) {
  const channels = [];
  let currentName = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXTINF")) {
      currentName = trimmed.split(",").slice(1).join(",").trim();
    } else if (trimmed.startsWith("http") && currentName) {
      channels.push({ name: currentName, url: trimmed });
      currentName = "";
    }
  }
  return channels;
}

// === Проверка одного канала через <video> ===
async function checkChannel(page, ch) {
  try {
    await page.setContent(`
      <video id="v" src="${ch.url}" crossorigin="anonymous"></video>
      <script>
        const video = document.getElementById("v");
        window.result = new Promise(resolve => {
          const done = () => resolve(true);
          const fail = () => resolve(false);
          video.addEventListener("canplay", done, { once: true });
          video.addEventListener("loadedmetadata", done, { once: true });
          video.addEventListener("error", fail, { once: true });
          setTimeout(() => resolve(false), ${TIMEOUT});
        });
      </script>
    `);

    const ok = await page.evaluate(() => window.result);
    ch.working = ok;
    console.log(`${ok ? "✅" : "❌"} ${ch.name}`);
  } catch (e) {
    ch.working = false;
    console.log(`❌ ${ch.name} (${e.message})`);
  }
  return ch;
}

// === Проверка всех каналов батчами ===
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
    const text = await loadPlaylist(playlistUrl);
    const channels = parseM3U(text);
    console.log(`Total channels: ${channels.length}`);

    console.log("Checking channels...");
    const checked = await checkAllChannels(channels);

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/channels.json", JSON.stringify(checked, null, 2));
    console.log("✅ Done! data/channels.json updated");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
