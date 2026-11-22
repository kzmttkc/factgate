// Export docs/architecture.png (1600 px wide) from docs/architecture.svg.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SVG = path.join(ROOT, "docs/architecture.svg");
const OUT = path.join(ROOT, "docs/architecture.png");

async function main() {
  const svg = await import("node:fs/promises").then((fs) => fs.readFile(SVG, "utf8"));
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f5f5f5">${svg}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: OUT, type: "png", fullPage: true });
  await browser.close();
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});