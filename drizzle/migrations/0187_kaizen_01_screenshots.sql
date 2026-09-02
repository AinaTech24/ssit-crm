-- Attach the product screenshots to KAIZEN #1.
-- Images already live in S3 under kb/kaizen-01/ (uploaded out-of-band); this
-- only records the keys + captions. Guarded so it never overwrites screenshots
-- an admin has since added through Super Admin → Knowledge Base.
UPDATE kb_articles
   SET screenshots = $shots$[
        {
          "storageKey": "kb/kaizen-01/1-pipeline-overdue.png",
          "caption": "Every open lead on one board, with an Overdue badge the moment a follow-up slips. Source and owning RM sit on each card.",
          "alt": "SSIT CRM lead pipeline board filtered to overdue follow-ups, cards showing source tags and RM names"
        },
        {
          "storageKey": "kb/kaizen-01/2-funnel-source.png",
          "caption": "By source: referrals convert at 44%, existing clients at 75% — paid ads at 11-12%. Conversion %, not lead count, is where the decision lives.",
          "alt": "Lead Funnel and Conversion report showing conversion percentage by lead source"
        },
        {
          "storageKey": "kb/kaizen-01/3-funnel-rm.png",
          "caption": "By RM: conversion % and overdue follow-ups side by side — then where open leads are piling up by stage.",
          "alt": "Lead Funnel report showing per-RM conversion rates, overdue follow-ups and open pipeline by stage"
        },
        {
          "storageKey": "kb/kaizen-01/4-new-lead-source.png",
          "caption": "Source is a fixed list on the new-lead form. That single constraint is what makes month-end maths possible.",
          "alt": "SSIT CRM new lead form with the fixed Source dropdown"
        },
        {
          "storageKey": "kb/kaizen-01/5-lead-forms.png",
          "caption": "Website enquiries create themselves through a public form — with the source already set, so nothing is typed by hand.",
          "alt": "Lead capture form builder for embedding an enquiry form on the firm website"
        }
      ]$shots$::jsonb,
       updated_at = now()
 WHERE slug = 'lead-tracking-follow-up-source-rm'
   AND (screenshots IS NULL OR jsonb_array_length(screenshots) = 0);
