# RTA sample files (synthetic, demo-only)

These files are **synthetic** examples of what CAMS / KFintech send distributors
every day / week / month. They use the demo investors' PANs from
`src/db/seed.ts`, so uploading them into the demo tenant actually populates
rows in `transactions` / `sip_rejections` / `commission_rows` — instead of
skipping everything as "PAN not in client master."

| File | Source | Kind | Format | Maps to |
| --- | --- | --- | --- | --- |
| `cams_daily_transaction_feed.txt`        | CAMS     | daily_transaction_feed | pipe `\|` | 10 demo transactions |
| `kfintech_daily_transaction_feed.csv`    | KFintech | daily_transaction_feed | comma     | 7 demo transactions  |
| `cams_sip_rejection_report.txt`          | CAMS     | sip_rejection_report   | pipe `\|` | 7 SIP failures       |
| `cams_redemption_report.txt`             | CAMS     | redemption_report      | pipe `\|` | 5 redemptions        |
| `cams_monthly_brokerage.txt`             | CAMS     | monthly_brokerage      | pipe `\|` | 10 commission rows   |

## How to use

1. Open `/dashboard/rta-imports` and click **Upload RTA file**.
2. Pick the file kind + source.
3. Click the **Download sample** link that appears (or grab the file from this
   folder).
4. Drop it back into the dialog → click **Upload and parse**.
5. You should see `rowsImported = N` and the corresponding downstream
   table (transactions, sip_rejections, etc.) populated.

## Production data

When you receive a real file from CAMS or KFintech, drop it straight in —
PANs that don't exist in your client master will be reported in the
`Skipped` count with a row-level reason. Add those investors first, then
re-upload (the SHA-256 dedupe keeps duplicates from being inserted twice).

## Regenerating

These were hand-written for the demo seed. If you reseed with different
PANs, edit the files in-place or write a `scripts/generate-sample-rta.ts`
that pulls PANs from `seed.ts`.
