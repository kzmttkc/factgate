// Capture submission screenshots from the deployed Vercel demos (1440 px and 390 px).
// Usage: node scripts/capture-screenshots.mjs
// Requires: playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "screenshots");
const PEERS_OUT = path.join(ROOT, "..", "factgate-peers", "screenshots");

const FACTGATE = "https://factgate.vercel.app/";
const STEWARD = "https://stay-steward-demo.vercel.app/";
const STEWARD_NETWORK = `${STEWARD}stay_steward`;

async function screenshotPair(page, baseName, dir) {
  for (const [w, suffix] of [[1440, "1440"], [390, "390"]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(dir, `${baseName}-${suffix}.png`), fullPage: true });
  }
}

async function allowFgConsentOn(page) {
  const card = page.locator(".fg-consent");
  try {
    await card.first().waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return 0;
  }
  const n = await card.first().locator(".fg-consent-rows li").count();
  await card.first().getByRole("button", { name: "Allow selected once" }).click({ timeout: 120_000 });
  await page.waitForTimeout(500);
  return n;
}

async function drainFgConsent(page, max = 14) {
  let best = 0;
  for (let i = 0; i < max; i += 1) {
    const rows = await allowFgConsentOn(page);
    if (rows === 0) {
      return best;
    }
    if (rows >= 2) {
      best = rows;
    }
  }
  return best;
}

async function factgateCheck(page, { tryButton = null, captureTwoRow, captureName, targetUrl = null }) {
  await page.goto(FACTGATE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => {
    const b = document.querySelector("#run-check");
    return b && !b.disabled;
  }, { timeout: 120_000 });
  if (targetUrl) {
    await page.locator("#target-url").fill(targetUrl);
  }
  if (tryButton) {
    await page.getByRole("button", { name: tryButton }).click();
  } else {
    await page.locator("#run-check").click();
  }
  for (let i = 0; i < 24; i += 1) {
    const visible = await page.locator("#full-result").isVisible();
    if (visible) {
      break;
    }
    const rows = await allowFgConsentOn(page);
    if (rows >= 2 && captureTwoRow && !captureTwoRow.done) {
      await screenshotPair(page, "consent-two-destinations", OUT);
      captureTwoRow.done = true;
    }
    if (rows === 0) {
      await page.waitForTimeout(800);
    }
  }
  await page.locator("#full-result").waitFor({ state: "visible", timeout: 180_000 });
  await page.locator("#full-action").waitFor({ state: "visible", timeout: 60_000 });
  await screenshotPair(page, captureName, OUT);
  return page.locator("#full-action").textContent();
}

async function drainPopupConsent(popup, max = 14) {
  for (let i = 0; i < max; i += 1) {
    if (popup.isClosed()) {
      return;
    }
    try {
      await allowFgConsentOn(popup);
      if ((await popup.locator(".fg-consent").count()) === 0) {
        return;
      }
    } catch {
      return;
    }
  }
}

async function stewardFlow(context, stayValue, captureName, statusPattern) {
  const page = await context.newPage();
  await page.goto(STEWARD, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#check-factgate").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForFunction(() => {
    const b = document.querySelector("#check-factgate");
    return b && !b.disabled;
  }, { timeout: 120_000 });
  await page.locator("#trip-stay").selectOption(stayValue);
  const popups = new Set();
  page.on("popup", (p) => popups.add(p));
  await page.locator("#check-factgate").click();

  for (let round = 0; round < 50; round += 1) {
    for (const popup of [...popups]) {
      await drainPopupConsent(popup);
      if (popup.isClosed()) {
        continue;
      }
      const guest = popup.locator("#window-guest-name");
      if ((await guest.count()) > 0) {
        await guest.fill("Kai Tanaka");
        await popup.locator("button[type='submit']").click();
        await page.waitForTimeout(800);
      }
    }
    const allow = page.locator("#ns-msgs .ns-consent .ns-consent-actions button[data-d='allow']");
    if ((await allow.count()) > 0) {
      await allow.last().click({ timeout: 30_000 });
      await page.waitForTimeout(600);
      continue;
    }
    const openBtn = page.locator("#ns-msgs .ns-action-window button[data-d='open']");
    if ((await openBtn.count()) > 0) {
      const popupWait = page.waitForEvent("popup", { timeout: 20_000 }).catch(() => null);
      await openBtn.last().click();
      const popup = await popupWait;
      if (popup) {
        popups.add(popup);
        await popup.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
      }
      await page.waitForTimeout(600);
      continue;
    }
    const status = await page.locator("#check-status").textContent();
    if (status && statusPattern.test(status)) {
      await screenshotPair(page, captureName, PEERS_OUT);
      await page.close();
      return;
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`Stay Steward (${stayValue}) did not reach expected status`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(PEERS_OUT, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-popup-blocking"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  try {
    const page = await context.newPage();
    const two = { done: false };
    const allowText = await factgateCheck(page, { captureTwoRow: two, captureName: "allow-agent402" });
    if (!allowText || !allowText.includes("Link / pay: OK")) {
      throw new Error(`ALLOW screenshot missing OK line: ${allowText}`);
    }
    if (!two.done) {
      await page.goto(FACTGATE, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Verified Stay/ }).click();
      for (let i = 0; i < 8; i += 1) {
        const card = page.locator(".fg-consent");
        if ((await card.count()) === 0) {
          break;
        }
        if ((await card.locator(".fg-consent-rows li").count()) >= 2) {
          await screenshotPair(page, "consent-two-destinations", OUT);
          break;
        }
        await card.getByRole("button", { name: "Allow selected once" }).click();
        await page.waitForTimeout(400);
      }
    }
    const blockText = await factgateCheck(page, { tryButton: /Glossy Stay/, captureName: "block-glossy-stay" });
    if (!blockText || !blockText.includes("Do not pay")) {
      throw new Error(`BLOCK screenshot missing Do not pay: ${blockText}`);
    }
    const cautionText = await factgateCheck(page, { targetUrl: STEWARD_NETWORK, captureName: "caution-stay-steward" });
    if (!cautionText || !cautionText.includes("Unchecked")) {
      throw new Error(`CAUTION screenshot missing Unchecked line: ${cautionText}`);
    }
    await stewardFlow(context, "verified_stay", "steward-booked-vs0001", /VS-0001/);
    await stewardFlow(context, "glossy_stay", "steward-stopped-glossy-block", /Do not pay|BLOCK|was not loaded/);
    console.log("OK", OUT, PEERS_OUT);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});