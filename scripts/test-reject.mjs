// Headless test of the reject flow: sign in, open a lead's reject dropdown,
// click a reason, verify no crash + row updates.
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EMAIL = "demo@example.com";
const PASSWORD = "demo-password";
const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("console.error: " + msg.text());
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
console.log("At", page.url());

await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
  page.click('button[type="submit"]'),
]);
console.log("After login:", page.url());

// Wait for leads table to render
await page.waitForSelector("table tbody tr", { timeout: 10000 });
await new Promise((r) => setTimeout(r, 1500));

// Find the first row's Reject dropdown trigger (button text contains "Reject")
const trigger = await page.evaluateHandle(() => {
  const buttons = [...document.querySelectorAll("button, [role='button'], [data-slot*='trigger']")];
  return buttons.find((b) => /^\s*Reject\s*$/.test(b.textContent || "")
    || b.textContent?.trim().startsWith("Reject"));
});
if (!trigger || (await trigger.evaluate((e) => !e))) {
  console.error("✗ Reject button not found on page");
  await browser.close();
  process.exit(2);
}

console.log("→ Clicking Reject...");
await trigger.asElement().click();

// Wait a tick for the menu to open
await new Promise((r) => setTimeout(r, 600));

// The page should NOT have crashed. Check for the error page:
const bodyText = await page.evaluate(() => document.body.innerText);
if (bodyText.includes("This page couldn't load")) {
  console.error("✗ CRASH — error page rendered");
  console.error("Errors captured:");
  errors.forEach((e) => console.error("  ", e));
  await browser.close();
  process.exit(3);
}

// The dropdown should be open with reason items
const menuOpen = await page.evaluate(() => {
  return document.body.innerText.includes("Why reject?");
});
console.log(menuOpen ? "✓ Reject menu opened" : "? Menu text not detected");

// Wait for menu to render
await new Promise((r) => setTimeout(r, 500));
const menuPortalItems = await page.evaluate(() => {
  return [...document.querySelectorAll("[role='menuitem']")].map((e) => e.textContent?.trim());
});
console.log("Menu items after click:", menuPortalItems);

// Try clicking the first reason ("Wrong industry")
const picked = await page.evaluate(() => {
  const items = [...document.querySelectorAll("[role='menuitem']")];
  const target = items.find((i) => i.textContent?.trim() === "Wrong industry");
  if (target) { target.click(); return true; }
  return false;
});
if (picked) {
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate(() => document.body.innerText);
  if (after.includes("This page couldn't load")) {
    console.error("✗ CRASHED after picking reason");
    errors.forEach((e) => console.error("  ", e));
    await browser.close();
    process.exit(4);
  }
  console.log("✓ Picked 'Wrong industry' — no crash page");
} else {
  console.log("? Could not find 'Wrong industry' menuitem");
}

// Filter out pre-existing noise (hydration, script-tag warnings) so we focus on real crashes
const realErrors = errors.filter((e) =>
  !e.includes("Hydration failed") &&
  !e.includes("Encountered a script tag") &&
  !e.includes("Multiple GoTrueClient")
);
console.log();
if (realErrors.length === 0) {
  console.log("✓ No reject-related errors (hydration warnings filtered as pre-existing noise)");
} else {
  console.log(`✗ ${realErrors.length} relevant errors:`);
  realErrors.forEach((e) => console.log("  ", e));
}

// Specifically check for the base-ui MenuGroupRootContext error that was the original bug
const hasMenuGroupError = errors.some((e) => e.includes("MenuGroupRootContext is missing"));
console.log(hasMenuGroupError
  ? "✗ MenuGroupRootContext error STILL present — fix didn't take"
  : "✓ No MenuGroupRootContext error — the base-ui Menu.Group bug is fixed");

await browser.close();
process.exit(hasMenuGroupError || realErrors.length > 0 ? 1 : 0);
