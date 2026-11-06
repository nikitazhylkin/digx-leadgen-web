-- Demo seed: 15 made-up leads. Every name, company and URL is fictional.
-- Emails and websites use the reserved example.com domain. LinkedIn URLs are placeholders.
-- Run after the migrations, in the Supabase SQL editor or with psql.
-- icp_score and icp_tier stay empty on purpose: run `npx tsx scripts/rescore-all.ts`
-- to fill them from the scoring rules in src/lib/scoring.ts.

insert into public.leads
  (linkedin_url, first_name, last_name, full_name, headline, location,
   company_name, company_name_casual, company_url, company_industry,
   company_headcount, company_hq, category, outreach_status, source)
values
  ('https://www.linkedin.com/in/example-demo-01', 'Alex', 'Morgan', 'Alex Morgan', 'Founder & CEO at Brightleaf Foods', 'Madrid, Spain', 'Brightleaf Foods', 'Brightleaf', 'https://brightleaf-foods.example.com', 'Food & Beverage Wholesale', 18, 'Madrid, Spain', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-02', 'Sam', 'Rivera', 'Sam Rivera', 'Managing Director at Northfield Distribution', 'Valencia, Spain', 'Northfield Distribution', 'Northfield', 'https://northfield-dist.example.com', 'Wholesale Distribution', 45, 'Valencia, Spain', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-03', 'Jordan', 'Lee', 'Jordan Lee', 'Head of E-commerce at Kestrel Pantry', 'Berlin, Germany', 'Kestrel Pantry', 'Kestrel Pantry', 'https://kestrel-pantry.example.com', 'Consumer Goods', 30, 'Berlin, Germany', 'Demo DTC', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-04', 'Taylor', 'Quinn', 'Taylor Quinn', 'Co-founder at Marlow Studio', 'Lisbon, Portugal', 'Marlow Studio', 'Marlow', 'https://marlow-studio.example.com', 'Marketing and Advertising', 12, 'Lisbon, Portugal', 'Demo Services', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-05', 'Casey', 'Nguyen', 'Casey Nguyen', 'COO at Tidewater Provisions', 'Amsterdam, Netherlands', 'Tidewater Provisions', 'Tidewater', 'https://tidewater-prov.example.com', 'Food & Beverage Wholesale', 60, 'Amsterdam, Netherlands', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-06', 'Riley', 'Foster', 'Riley Foster', 'Owner at Copperline Consulting', 'Dublin, Ireland', 'Copperline Consulting', 'Copperline', 'https://copperline-consulting.example.com', 'Management Consulting', 8, 'Dublin, Ireland', 'Demo Services', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-07', 'Morgan', 'Ellis', 'Morgan Ellis', 'Director of Operations at Harbor & Pine Goods', 'Warsaw, Poland', 'Harbor & Pine Goods', 'Harbor & Pine', 'https://harbor-pine.example.com', 'Retail', 75, 'Warsaw, Poland', 'Demo DTC', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-08', 'Avery', 'Brooks', 'Avery Brooks', 'CEO at Lumen Legal Partners', 'Barcelona, Spain', 'Lumen Legal Partners', 'Lumen Legal', 'https://lumen-legal.example.com', 'Legal Services', 15, 'Barcelona, Spain', 'Demo Services', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-09', 'Drew', 'Patel', 'Drew Patel', 'Commercial Director at Orchard Lane Beverages', 'Milan, Italy', 'Orchard Lane Beverages', 'Orchard Lane', 'https://orchard-lane.example.com', 'Food & Beverage Wholesale', 40, 'Milan, Italy', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-10', 'Skyler', 'Adams', 'Skyler Adams', 'Founder at Fieldnote Agency', 'Prague, Czechia', 'Fieldnote Agency', 'Fieldnote', 'https://fieldnote-agency.example.com', 'Marketing and Advertising', 10, 'Prague, Czechia', 'Demo Services', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-11', 'Jamie', 'Cole', 'Jamie Cole', 'Head of Sales at Saffron Table Co', 'Paris, France', 'Saffron Table Co', 'Saffron Table', 'https://saffron-table.example.com', 'Food & Beverage Wholesale', 25, 'Paris, France', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-12', 'Robin', 'Hayes', 'Robin Hayes', 'Managing Partner at Granite Row Advisors', 'Vienna, Austria', 'Granite Row Advisors', 'Granite Row', 'https://granite-row.example.com', 'Management Consulting', 20, 'Vienna, Austria', 'Demo Services', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-13', 'Quinn', 'Bailey', 'Quinn Bailey', 'VP Operations at Nordlicht Home', 'Copenhagen, Denmark', 'Nordlicht Home', 'Nordlicht', 'https://nordlicht-home.example.com', 'Consumer Goods', 90, 'Copenhagen, Denmark', 'Demo DTC', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-14', 'Parker', 'Diaz', 'Parker Diaz', 'Co-owner at Almacen Demo Mercado', 'Seville, Spain', 'Almacen Demo Mercado', 'Mercado Demo', 'https://mercado-demo.example.com', 'Wholesale Distribution', 22, 'Seville, Spain', 'Demo Wholesale', 'scored', 'manual'),
  ('https://www.linkedin.com/in/example-demo-15', 'Reese', 'Walker', 'Reese Walker', 'Digital Director at Blue Heron Outfitters', 'Brussels, Belgium', 'Blue Heron Outfitters', 'Blue Heron', 'https://blue-heron.example.com', 'E-commerce', 35, 'Brussels, Belgium', 'Demo DTC', 'scored', 'manual')
on conflict (linkedin_url) do nothing;
