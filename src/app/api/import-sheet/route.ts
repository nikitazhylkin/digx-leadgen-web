import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

/**
 * Import leads from a Google Sheet CSV export.
 * Expects the Alimentaria format: Company, Brands, Event, Stand, ICP Score,
 * Own Distribution, Young Leadership, Description, ICP Fit Reasons
 *
 * Creates company-only leads (no person data yet) — user then runs "Find People"
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  try {
    const { rows } = await req.json();

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      const companyName = row.Company || row.company || row.company_name || "";
      if (!companyName.trim()) {
        skipped++;
        continue;
      }

      // Build a stable identifier from company name + event (since no LinkedIn URL yet)
      const tempLinkedinUrl = `company:${companyName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

      const leadData = {
        linkedin_url: tempLinkedinUrl,
        company_name: companyName.trim(),
        company_name_casual: companyName
          .trim()
          .replace(/\s+(Inc\.?|Incorporated|LLC|Ltd\.?|Limited|GmbH|AG|S\.r\.l\.?|S\.A\.?|B\.V\.?|PLC|Corp\.?|Corporation|Co\.?|Company|Pty|UG)$/i, "")
          .trim(),
        company_description: row.Description || row.description || null,
        company_industry: "Food & Beverage", // Alimentaria is a food trade show
        icp_score: parseInt(row["ICP Score"] || row.icp_score || "0", 10) || null,
        icp_tier: (() => {
          const score = parseInt(row["ICP Score"] || row.icp_score || "0", 10);
          if (score >= 70) return "HOT";
          if (score >= 50) return "WARM";
          if (score >= 30) return "COLD";
          return "SKIP";
        })(),
        scoring_breakdown: {
          source: "alimentaria_sheet",
          icp_fit_reasons: row["ICP Fit Reasons"] || row.icp_fit_reasons || "",
          own_distribution: row["Own Distribution"] === "✓",
          young_leadership: row["Young Leadership"] === "✓",
          event: row.Event || "Alimentaria",
          stand: row.Stand || row.stand || "",
          brands: row.Brands || row.brands || "",
        },
        outreach_status: "new",
        source: "csv_import",
        // No person data yet — will be filled by "Find People"
        first_name: null,
        last_name: null,
        full_name: null,
        headline: null,
      };

      try {
        // Upsert by temp linkedin_url (company identifier)
        const { error } = await supabase
          .from("leads")
          .upsert(leadData, { onConflict: "linkedin_url" });

        if (error) {
          console.warn(`Failed to import ${companyName}:`, error.message);
          errors++;
        } else {
          imported++;
        }
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ imported, skipped, errors, total: rows.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
