const fs = require("fs");
const util = require("util");
const exec = require("child_process");

const execAsync = util.promisify(exec);

const playlistUrl = "https://iptv-org.github.io/iptv/index.m3u";
const TIMEOUT_MS = 10000;
const CONCURRENT = 20;

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
      channels.push({ name: currentName, url: l, tvgId: currentTvgId });
      currentName = "";
      currentTvgId = "";
    }
  }
  return channels;
}

// проверка через ffmpeg, скачиваем 3 сегмента
async function checkChannel(ch) {
  try {
    const cmd = `ffmpeg -loglevel error -timeout 5000000 -i "${ch.url}" -t 1 -f null -`;
    await execAsync(cmd, { timeout: TIMEOUT_MS });
    ch.working = true;
    console.log(`✅ ${ch.name}`);
  } catch (e) {
    ch.working = false;
    console.log(`❌ ${ch.name} (${e.message})`);
  }
  return ch;
}

async function checkAllChannels(channels) {
  const results = [];
  for (let i = 0; i < channels.length; i += CONCURRENT) {
    const batch = channels.slice(i, i + CONCURRENT);
    const checked = await Promise.all(batch.map(ch => checkChannel(ch)));
    results.push(...checked);
  }
  return results;
}

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

main().catch(e => {
  console.error(e);
  process.exit(1);
});
