// Thin REST wrapper around the ClickUp v2 API.
// Auth: Personal API token via the `Authorization` header (no `Bearer` prefix
// per ClickUp's docs — just the raw token). Never log the token.
//
// Used by:
//  - /api/clickup/test  → validates a list ID + token by reading list metadata
//  - /api/clickup/push  → creates a task in the configured list when a lead
//                         transitions to outreach_status='replied'
//
// Scope is intentionally tiny — two functions. We don't model the full ClickUp
// schema; we only need the shape of the responses we actually consume.

const BASE = "https://api.clickup.com/api/v2";

export interface ClickUpListInfo {
  id: string;
  name: string;
  space?: { id: string; name: string };
  folder?: { id: string; name: string; hidden: boolean };
}

export interface ClickUpTaskCreated {
  id: string;
  url: string;
}

export interface CreateTaskPayload {
  name: string;
  description?: string;
  /** Status name as configured on the destination list (e.g. "Replied"). */
  status?: string;
  /** Tag names — must already exist on the Space. */
  tags?: string[];
}

/**
 * Validate a ClickUp connection by fetching the configured list's metadata.
 * Returns either { ok: true, list } or { ok: false, error: <human-readable> }.
 * Never throws — the caller can surface the error directly to the user.
 */
export async function testConnection(
  token: string,
  listId: string,
): Promise<{ ok: true; list: ClickUpListInfo } | { ok: false; error: string }> {
  if (!token || !listId) {
    return { ok: false, error: "Token and list ID are both required" };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/list/${encodeURIComponent(listId)}`, {
      headers: { Authorization: token },
      // Don't keep the token alive in node's TLS session cache between requests.
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Surface ClickUp's error message verbatim — usually OK for API debugging.
    return { ok: false, error: `${res.status}: ${body.slice(0, 200) || res.statusText}` };
  }
  const list = (await res.json()) as ClickUpListInfo;
  return { ok: true, list };
}

/**
 * Create a task in the given list. Throws on any non-2xx response so the
 * caller can decide how to handle it (we want loud failures here — a silent
 * "task didn't make it to ClickUp" would corrupt the dashboard's idea of
 * what's been handed off).
 */
export async function createTask(
  token: string,
  listId: string,
  payload: CreateTaskPayload,
): Promise<ClickUpTaskCreated> {
  const res = await fetch(`${BASE}/list/${encodeURIComponent(listId)}/task`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ClickUp task create failed (${res.status}): ${body.slice(0, 300) || res.statusText}`);
  }
  const data = await res.json();
  return { id: String(data.id), url: String(data.url) };
}
