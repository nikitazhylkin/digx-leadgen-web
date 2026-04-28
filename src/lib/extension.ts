// Web → Chrome extension bridge.
//
// The /import flow uses this to ask the DigX extension (which holds the user's
// authenticated LinkedIn session) to scrape a profile URL on our behalf. The
// extension responds with a seed object that gets POSTed to /api/enrich.
//
// This bypasses LinkedIn's hostility toward server-side scraping — the scrape
// runs in the user's already-logged-in browser tab via the same Voyager API
// path the Sales Navigator scraping uses.
//
// The extension declares externally_connectable.matches in its manifest to
// allow our origin to send messages.

export interface ProfileSeed {
  full_name: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  summary?: string;
  location?: string;
  company_name?: string;
  company_name_casual?: string;
  company_url?: string | null;
  company_linkedin_url?: string | null;
  company_industry?: string | null;
  company_headcount?: number | null;
  company_hq?: string | null;
  company_description?: string | null;
  company_specialties?: string | null;
  experiences?: unknown;
}

// Public / production extension IDs. The dev (unpacked) ID is generated at
// load time by Chrome — we read it from NEXT_PUBLIC_EXTENSION_ID at runtime
// so each developer can set their own. If neither is set, we error out with
// an actionable message.
const PROD_EXTENSION_ID: string | null = null;  // TODO: paste once published to Chrome Web Store
const DEV_EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || null;

interface ChromeRuntime {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  lastError?: { message: string };
}
interface ChromeGlobal {
  runtime?: ChromeRuntime;
}

function getChromeRuntime(): ChromeRuntime | null {
  if (typeof globalThis === "undefined") return null;
  const w = globalThis as unknown as { chrome?: ChromeGlobal };
  return w.chrome?.runtime ?? null;
}

function getExtensionId(): string | null {
  return DEV_EXTENSION_ID || PROD_EXTENSION_ID;
}

export class ExtensionUnavailableError extends Error {
  constructor(public reason: "no_chrome" | "no_extension_id" | "no_response") {
    super(
      reason === "no_chrome"
        ? "Chrome extension API not available — open this page in Chrome with the DigX extension installed."
        : reason === "no_extension_id"
          ? "Extension ID is not configured. Set NEXT_PUBLIC_EXTENSION_ID in .env.local (Chrome → chrome://extensions, enable Developer mode, copy the ID)."
          : "DigX extension did not respond — make sure it's installed and enabled, then reload this page.",
    );
    this.name = "ExtensionUnavailableError";
  }
}

/**
 * Send a `ping` to the extension to verify it's installed + reachable. Returns
 * true if the extension responded, false otherwise. Used by the /import page
 * to gate the Enrich button + show a "install extension" message.
 */
export async function pingExtension(timeoutMs = 1500): Promise<boolean> {
  const runtime = getChromeRuntime();
  const extId = getExtensionId();
  if (!runtime || !extId) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, timeoutMs);
    try {
      runtime.sendMessage(extId, { action: "ping" }, (response: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (runtime.lastError) { resolve(false); return; }
        const r = response as { ok?: boolean } | undefined;
        resolve(Boolean(r?.ok));
      });
    } catch {
      if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
    }
  });
}

/**
 * Ask the extension to scrape a LinkedIn profile URL and return seed data.
 * Throws ExtensionUnavailableError if the extension isn't installed/responding,
 * or a generic Error with the extension's error message on scrape failure.
 */
export async function scrapeViaExtension(url: string, timeoutMs = 60_000): Promise<ProfileSeed> {
  const runtime = getChromeRuntime();
  if (!runtime) throw new ExtensionUnavailableError("no_chrome");
  const extId = getExtensionId();
  if (!extId) throw new ExtensionUnavailableError("no_extension_id");
  return new Promise<ProfileSeed>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new ExtensionUnavailableError("no_response"));
      }
    }, timeoutMs);
    try {
      runtime.sendMessage(
        extId,
        { action: "scrapeProfile", url },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (runtime.lastError) {
            reject(new ExtensionUnavailableError("no_response"));
            return;
          }
          const r = response as { ok?: boolean; data?: ProfileSeed; error?: string } | undefined;
          if (!r) {
            reject(new ExtensionUnavailableError("no_response"));
            return;
          }
          if (r.ok && r.data) {
            resolve(r.data);
            return;
          }
          reject(new Error(r.error || "Scrape failed"));
        },
      );
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  });
}
