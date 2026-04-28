import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Best-effort display name for a lead in any state.
// - Enriched lead: returns full_name
// - Partially-seeded lead: returns "first_name last_name"
// - URL-only lead (no name yet): returns the LinkedIn slug
// - Nothing at all: returns "Unnamed lead"
export function leadDisplayName(lead: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url?: string | null;
}): string {
  if (lead.full_name) return lead.full_name;
  const parts = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  if (parts) return parts;
  if (lead.linkedin_url) {
    const m = lead.linkedin_url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m) return m[1].replace(/-/g, " ");
  }
  return "Unnamed lead";
}
