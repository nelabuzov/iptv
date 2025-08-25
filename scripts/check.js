const fs = require("fs");
const puppeteer = require("puppeteer");
const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const BATCH_SIZE = 20;
const TIMEOUT = 15000;

// === Утилиты ===
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

// === Загрузка плейлиста ===
async function loadPlaylist(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.status}`);
  return await res.text();
}

function parsePlaylist(m3uText) {
  const channels = [];
  let currentName = "";
  let currentTvgId = "";

  for (const line of m3uText.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith("#EXTINF")) {
      currentName = l.split(",").slice(1).join(",").trim();
      const mId = l.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : "";
    } else if (l.startsWith("http") && currentName) {
      if (currentTvgId) channels.push({ name: currentName, url: l, tvgId: currentTvgId });
      currentName = "";
      currentTvgId = "";
    }
  }
  return channels;
}

// === Проверка одного канала ===
async function checkChannel(page, ch) {
  try {
    const response = await page.goto(ch.url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });

    if (!response) {
      ch.working = false;
      console.log(`❌ ${ch.name} (no response)`);
      return ch;
    }

    const status = response.status();

    // Если HTTP-ошибка или редирект — считаем нерабочим
    if (![200, 0].includes(status)) {
      ch.working = false;
      console.log(`❌ ${ch.name} (status ${status})`);
      return ch;
    }

    // Проверяем m3u8: первый сегмент
    if (ch.url.toLowerCase().endsWith(".m3u8")) {
      const m3uText = await response.text();
      const firstSeg = firstUriFromM3U8(m3uText);
      if (firstSeg) {
        const segUrl = new URL(firstSeg, ch.url).href;
        try {
          const segResp = await page.goto(segUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
          if (!segResp || ![200, 0].includes(segResp.status())) {
            ch.working = false;
            console.log(`❌ ${ch.name} (first segment failed)`);
            return ch;
          }
        } catch {
          ch.working = false;
          console.log(`❌ ${ch.name} (first segment error)`);
          return ch;
        }
      }
    }

    ch.working = true;
    console.log(`✅ ${ch.name}`);
  } catch (e) {
    ch.working = false;
    console.log(`❌ ${ch.name} (${e.message})`);
  }
  return ch;
}

// === Параллельная проверка ===
async function checkAllChannels(channels) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const results = [];
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const pages = await Promise.all(batch.map(() => browser.newPage()));
    const checked = await Promise.all(batch.map((ch, idx) => checkChannel(pages[idx], ch)));
    await Promise.all(pages.map(p => p.close()));
    results.push(...checked);
  }

  await browser.close();
  return results;
}

// === main ===
async function main() {
  console.log("Loading playlist...");
  const m3uText = await loadPlaylist(playlistUrl);
  const channels = parsePlaylist(m3uText);
  console.log(`Total channels: ${channels.length}`);

  const results = await checkAllChannels(channels);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/channels.json", JSON.stringify(results, null, 2));
  console.log("✅ Done! data/channels.json updated");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

