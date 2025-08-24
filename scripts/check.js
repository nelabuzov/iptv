import fs from "fs";
import fetch from "node-fetch";

const url = "https://iptv-org.github.io/iptv/index.m3u";
const m3u = await fetch(url).then(r => r.text());

let channels = [];
let currentName = "";

for (let line of m3u.split("\n")) {
  if (line.startsWith("#EXTINF")) {
    currentName = line.split(",").slice(1).join(",");
  } else if (line.startsWith("http")) {
    if (currentName) {
      channels.push({ name: currentName.trim(), url: line.trim() });
      currentName = "";
    }
  }
}

async function checkChannel(url) {
  try {
    let res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

for (let ch of channels.slice(0, 500)) { // ограничение для теста
  ch.working = await checkChannel(ch.url);
  console.log(ch.name, ch.working ? "✅" : "❌");
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/channels.json", JSON.stringify(channels, null, 2));
