/**
 * Induction confirmation letter.
 *
 * This is an internal confirmation that a team member completed a training
 * track and passed its assessment. It is deliberately NOT worded as an offer,
 * appointment or employment contract — those are legal documents the firm's own
 * counsel should draft, not something a CRM should mint.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type LetterInput = {
  firmName: string;
  firmArn?: string | null;
  memberName: string;
  memberRole?: string | null;
  trackName: string;
  completedOn: Date;
  scorePct: number;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
};

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

export async function renderInductionLetter(input: LetterInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.11, 0.13, 0.15);
  const muted = rgb(0.42, 0.46, 0.5);
  const brand = rgb(0.11, 0.42, 0.42);

  const M = 56;
  let y = 786;

  const line = (
    text: string,
    opts: { size?: number; font?: any; color?: any; gap?: number } = {}
  ) => {
    const size = opts.size ?? 11;
    page.drawText(text, { x: M, y, size, font: opts.font ?? body, color: opts.color ?? ink });
    y -= opts.gap ?? size + 7;
  };

  // Letterhead
  line(input.firmName, { size: 18, font: bold, color: brand, gap: 22 });
  if (input.firmArn) line(`ARN: ${input.firmArn}`, { size: 9, color: muted, gap: 18 });

  page.drawLine({
    start: { x: M, y },
    end: { x: 595.28 - M, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.89),
  });
  y -= 30;

  line("CONFIRMATION OF INDUCTION TRAINING", { size: 13, font: bold, gap: 24 });
  line(`Date: ${fmtDate(new Date())}`, { size: 10, color: muted, gap: 26 });

  line("To whom it may concern,", { gap: 22 });

  const para = [
    `This is to confirm that ${input.memberName}${input.memberRole ? ` (${input.memberRole})` : ""}`,
    `has completed the induction training programme "${input.trackName}" at`,
    `${input.firmName}, and has passed the accompanying assessment with a score`,
    `of ${input.scorePct.toFixed(0)}%.`,
  ];
  for (const l of para) line(l, { gap: 17 });

  y -= 8;
  line(`Training completed on: ${fmtDate(input.completedOn)}`, { size: 10, color: muted, gap: 16 });
  line(
    "This letter confirms completion of internal training only. It does not by itself",
    { size: 9, color: muted, gap: 12 }
  );
  line("constitute an offer of employment or a contract of engagement.", {
    size: 9,
    color: muted,
    gap: 44,
  });

  line("For " + input.firmName, { size: 10, color: muted, gap: 46 });
  page.drawLine({
    start: { x: M, y: y + 8 },
    end: { x: M + 190, y: y + 8 },
    thickness: 0.8,
    color: rgb(0.75, 0.78, 0.8),
  });
  line(input.signatoryName ?? "Authorised Signatory", { size: 11, font: bold, gap: 14 });
  if (input.signatoryTitle) line(input.signatoryTitle, { size: 9, color: muted });

  return pdf.save();
}
