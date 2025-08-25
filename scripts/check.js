const fs = require("fs");
const puppeteer = require("puppeteer");

const BATCH_SIZE = 20;   // сколько вкладок одновременно
const TIMEOUT = 15000;   // таймаут на один канал

// читаем список каналов из channels.json
const channels = JSON.parse(fs.readFileSync("channels.json", "utf-8"));

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

async function checkAllChannels() {
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

  fs.writeFileSync("data/channels.json", JSON.stringify(results, null, 2));
  console.log("✅ Done! data/channels.json updated");
}

checkAllChannels();
