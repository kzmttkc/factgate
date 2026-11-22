// Compose docs/thumbnail.png (1280x720) from existing screenshots via headless Chromium.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEFT = path.join(ROOT, "screenshots/block-glossy-stay-1440.png");
const RIGHT_PEER = path.join(ROOT, "..", "factgate-peers/screenshots/steward-booked-vs0001-1440.png");
const RIGHT_ALLOW = path.join(ROOT, "screenshots/allow-agent402-1440.png");
const OUT = path.join(ROOT, "docs/thumbnail.png");

async function pickRight() {
  try {
    await readFile(RIGHT_PEER);
    return RIGHT_PEER;
  } catch {
    return RIGHT_ALLOW;
  }
}

async function main() {
  const leftB64 = (await readFile(LEFT)).toString("base64");
  const rightB64 = (await readFile(await pickRight())).toString("base64");
  const html = `<!DOCTYPE html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 720px; font-family: Helvetica, Arial, sans-serif; background: #1a1a1a; color: #fff; display: flex; flex-direction: column; }
  .top { padding: 28px 40px 12px; font-size: 42px; font-weight: 600; text-align: center; letter-spacing: -0.02em; }
  .row { flex: 1; display: flex; gap: 8px; padding: 0 12px 12px; min-height: 0; }
  .row img { flex: 1; width: 50%; object-fit: cover; object-position: top; border: 1px solid #444; border-radius: 4px; }
  .bottom { padding: 16px 40px 24px; font-size: 26px; text-align: center; color: #e0e0e0; }
</style></head><body>
  <div class="top">The nicer hotel was the trap.</div>
  <div class="row">
    <img src="data:image/png;base64,${leftB64}" alt="Glossy Stay BLOCK"/>
    <img src="data:image/png;base64,${rightB64}" alt="ALLOW or booked stay"/>
  </div>
  <div class="bottom">FactGate · code decides, the model explains</div>
</body></html>`;
  await mkdir(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: OUT, type: "png" });
  await browser.close();
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});