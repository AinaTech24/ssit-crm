/**
 * captureCalcResults — read the FULL rendered calculator (every input, every
 * result, every table) into a structured payload the server turns into a
 * branded multi-page PDF report. This is deliberately exhaustive:
 *
 *  - inputs : every labelled control (Field/NumberField/date/select/checkbox)
 *             plus Segmented button-groups — even ones scrolled off-screen.
 *  - blocks : every result card, section heading, insight/note AND every
 *             <table> in the calculator — the WHOLE table (all rows + columns),
 *             not just what's visible in a scroll area. React renders all rows
 *             into the DOM (no virtualisation), so reading <tbody> captures the
 *             complete dataset, including rows hidden behind an overflow scroll.
 *
 * Capture is structure-driven (not marker-driven) so it works across all ~60
 * calculators regardless of whether they use the shared primitives or raw
 * markup.
 */

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string }
  | { type: "image"; dataUrl: string; w: number; h: number };

export type CalcCapture = {
  title: string;
  inputs: { label: string; value: string; group: string }[];
  blocks: PdfBlock[];
};

const txt = (el: Element | null) => (el?.textContent || "").replace(/\s+/g, " ").trim();

/** Current value of a single form control, formatted for display. */
function controlValue(c: Element): string {
  if (c instanceof HTMLSelectElement) return c.selectedOptions[0]?.text ?? c.value;
  if (c instanceof HTMLTextAreaElement) return c.value;
  if (c instanceof HTMLInputElement) {
    if (c.type === "checkbox") return c.checked ? "Yes" : "No";
    if (c.type === "radio") return c.checked ? c.value : "";
    if (c.type === "number") {
      const n = Number(c.value);
      return c.value !== "" && Number.isFinite(n) ? n.toLocaleString("en-IN") : c.value;
    }
    return c.value;
  }
  return "";
}

/** Read a cell: an input/select inside it wins over its text (editable tables). */
function cellText(td: Element): string {
  const ctrl = td.querySelector("input, select, textarea");
  return ctrl ? controlValue(ctrl) : txt(td);
}

/** Is this <svg> a data chart (vs a small lucide UI icon)? */
function isChartSvg(svg: SVGSVGElement): boolean {
  if (svg.classList.contains("lucide")) return false;
  if (svg.closest("button")) return false;
  if (svg.getAttribute("role") === "img") return true;
  const r = svg.getBoundingClientRect();
  return r.width >= 220 && r.height >= 70;
}

/**
 * Rasterise a chart <svg> to a PNG data URL via canvas. Computed colours are
 * inlined onto the clone first so class-/currentColor-based strokes & text
 * (gridlines, axis labels) survive when the SVG is drawn standalone.
 */
async function svgToPng(svg: SVGSVGElement): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const rect = svg.getBoundingClientRect();
    const w = Math.round(rect.width) || 600;
    const h = Math.round(rect.height) || 300;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const srcEls = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))];
    const dstEls = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
    srcEls.forEach((s, i) => {
      const d = dstEls[i];
      if (!d) return;
      const cs = getComputedStyle(s);
      d.style.fill = cs.fill;
      d.style.stroke = cs.stroke;
      d.style.color = cs.color;
      if (cs.fontSize) d.style.fontSize = cs.fontSize;
      if (cs.fontFamily) d.style.fontFamily = cs.fontFamily;
      if (cs.fontWeight) d.style.fontWeight = cs.fontWeight;
    });
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(clone);
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("svg load failed"));
      img.src = src;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), w, h };
  } catch {
    return null;
  }
}

/**
 * Flatten a <thead> (which may use colSpan/rowSpan group headers) into one
 * label per leaf column, e.g. ["Year", "Regular SIP Corpus", "Regular SIP
 * Invested", …]. Falls back to a single header row when there's no grouping.
 */
function readHead(table: HTMLTableElement): string[] {
  const headRows = Array.from(table.querySelectorAll(":scope > thead > tr"));
  if (headRows.length === 0) return [];
  if (headRows.length === 1) return Array.from(headRows[0].children).map((c) => txt(c));

  const grid: string[][] = [];
  headRows.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    Array.from(tr.children).forEach((cell) => {
      while (grid[r][c] !== undefined) c++;
      const cs = parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
      const rs = parseInt(cell.getAttribute("rowspan") || "1", 10) || 1;
      const t = txt(cell);
      for (let i = 0; i < rs; i++) {
        for (let j = 0; j < cs; j++) {
          grid[r + i] = grid[r + i] || [];
          grid[r + i][c + j] = t;
        }
      }
      c += cs;
    });
  });
  const ncols = Math.max(...grid.map((row) => row.length));
  const head: string[] = [];
  for (let col = 0; col < ncols; col++) {
    const parts: string[] = [];
    for (let r = 0; r < grid.length; r++) {
      const v = grid[r]?.[col];
      if (v && !parts.includes(v)) parts.push(v);
    }
    head.push(parts.join(" "));
  }
  return head;
}

function readTable(table: HTMLTableElement): { head: string[]; rows: string[][] } {
  const head = readHead(table);
  const bodyRows = table.querySelectorAll(":scope > tbody > tr").length
    ? Array.from(table.querySelectorAll(":scope > tbody > tr"))
    : Array.from(table.querySelectorAll(":scope > tr")); // tables without an explicit tbody
  const rows = bodyRows
    .map((tr) => Array.from(tr.children).map((td) => cellText(td)))
    .filter((r) => r.some((c) => c !== ""));
  return { head, rows };
}

export async function captureCalcResults(root: HTMLElement): Promise<CalcCapture> {
  const title = txt(root.querySelector("h2")) || "Calculator";

  // ── Inputs (grouped) ──────────────────────────────────────────────────────
  // Walk inputs in document order, tracking the current group heading so inputs
  // sit under their category in the PDF. A "group heading" is a small UPPERCASE
  // bold caption (e.g. "Asset allocation", "Assumed return per class") — that's
  // how a calculator disambiguates two sets of identically-labelled fields like
  // Debt % / Hybrid % / Equity % (allocation vs returns). Input labels use
  // font-medium, headings use font-semibold, so they never collide.
  const inputs: { label: string; value: string; group: string }[] = [];
  const seenIn = new Set<string>();
  let group = "";
  const pushInput = (rawLabel: string, rawValue: string) => {
    const label = rawLabel.replace(/\s+/g, " ").trim();
    const value = rawValue.replace(/\s+/g, " ").trim();
    const key = `${group} :: ${label} :: ${value}`;
    if (!label || seenIn.has(key)) return;
    seenIn.add(key);
    inputs.push({ label, value: value || "-", group });
  };

  root.querySelectorAll<HTMLElement>("label, .uppercase.font-semibold, [data-pdf-input]").forEach((el) => {
    if (el.tagName !== "LABEL" && el.classList.contains("uppercase") && el.classList.contains("font-semibold") && !el.closest("label")) {
      const t = txt(el);
      if (t && t.length <= 48) group = t; // new category
      return;
    }
    if (el.tagName === "LABEL") {
      if (el.closest("table")) return; // editable-table cells are caught as table data
      const control = el.querySelector<HTMLElement>("input, select, textarea");
      if (!control) return;
      const labelText = txt(el.querySelector("span"));
      if (!labelText) return;
      if (control instanceof HTMLInputElement && control.type === "radio" && !control.checked) return;
      pushInput(labelText, controlValue(control));
      return;
    }
    // Segmented button-groups have no form control, so they carry a marker.
    if (el.matches("[data-pdf-input]") && !el.matches("input, select, textarea")) {
      pushInput(el.getAttribute("data-pdf-input-label") || "", el.getAttribute("data-pdf-input-value") || "");
    }
  });

  // ── Outputs (document order: sections, result cards, tables, notes) ───────
  const blocks: PdfBlock[] = [];
  const seenStat = new Set<string>();
  const pushStat = (rawLabel: string, rawValue: string, requireDigit = false) => {
    const label = rawLabel.replace(/\s+/g, " ").trim();
    const value = rawValue.replace(/\s+/g, " ").trim();
    if (!label || !value || label === value) return;
    if (requireDigit && !/\d/.test(value)) return;
    const key = `${label} :: ${value}`;
    if (seenStat.has(key)) return;
    seenStat.add(key);
    blocks.push({ type: "stat", label, value });
  };

  // Chart <svg>s are captured in document order as placeholder image blocks,
  // then rasterised to PNG after the walk (rasterising is async).
  const pendingCharts: { idx: number; svg: SVGSVGElement }[] = [];

  const SEL = 'h3, table, [data-pdf="insight"], .text-lg.font-semibold, .justify-between.text-xs, svg';
  root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    if (el instanceof SVGSVGElement) {
      if (isChartSvg(el)) {
        pendingCharts.push({ idx: blocks.length, svg: el });
        blocks.push({ type: "image", dataUrl: "", w: 0, h: 0 }); // filled in below
      }
      return;
    }
    if (el.tagName === "H3") {
      const t = el.getAttribute("data-pdf-title") || txt(el);
      if (t) blocks.push({ type: "section", text: t });
    } else if (el.tagName === "TABLE") {
      const { head, rows } = readTable(el as HTMLTableElement);
      if (head.length || rows.length) blocks.push({ type: "table", head, rows });
    } else if (el.getAttribute("data-pdf") === "insight") {
      const t = txt(el);
      if (t) blocks.push({ type: "insight", text: t });
    } else if (el.classList.contains("text-lg")) {
      // Result card value (shared across every calculator's result cards + the
      // Stat primitive). Prefer the explicit data-pdf-* attrs when present.
      const card = el.closest<HTMLElement>('[data-pdf="stat"]');
      if (card) pushStat(card.getAttribute("data-pdf-label") || "", card.getAttribute("data-pdf-value") || txt(el));
      else pushStat(txt(el.previousElementSibling), txt(el));
    } else {
      // Row (k/v) inside comparison boxes — intermediate values.
      const kids = Array.from(el.children);
      if (kids.length === 2) pushStat(txt(kids[0]), txt(kids[1]), true);
    }
  });

  // Rasterise charts; drop any that fail so a bad chart never breaks the PDF.
  for (const pc of pendingCharts) {
    const r = await svgToPng(pc.svg);
    blocks[pc.idx] = r
      ? { type: "image", dataUrl: r.dataUrl, w: r.w, h: r.h }
      : ({ type: "section", text: "" } as PdfBlock); // harmless placeholder, filtered next
  }
  const finalBlocks = blocks.filter((b) => !(b.type === "section" && !b.text) && !(b.type === "image" && !b.dataUrl));

  return { title, inputs, blocks: finalBlocks };
}
