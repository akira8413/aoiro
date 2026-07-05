import { chromium } from "@playwright/test";

const url = process.env.AOIRO_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);

const text = await page.locator("body").innerText();
console.log(text.includes("青色申告") ? "ok: app rendered" : "ng: app text missing");

await browser.close();
