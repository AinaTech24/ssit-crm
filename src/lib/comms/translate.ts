/**
 * Translate outbound client messages to the client's preferred language.
 *
 * Indian MFD clients aren't all comfortable in English — sending the statement
 * note, reminder, or nudge in Hindi / Gujarati / Marathi / Tamil etc. is a real
 * service difference. We translate at SEND time via Haiku (fast + cheap), with
 * a strict-passthrough fallback: English, an unknown language, a missing API
 * key, or any error returns the original text unchanged so a translation
 * problem can never block or garble a send.
 *
 * Numbers, ₹ amounts, ARN, and scheme names should survive translation — the
 * prompt instructs the model to keep them verbatim.
 */

import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  mr: "Marathi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  bn: "Bengali",
  ml: "Malayalam",
  pa: "Punjabi",
};

/** Translate an array of lines, preserving order. Returns input unchanged for
 *  English / unknown lang / no key / any failure. */
export async function translateText(lines: string[], lang: string | null | undefined): Promise<string[]> {
  const code = (lang ?? "en").toLowerCase();
  if (code === "en" || !SUPPORTED_LANGUAGES[code]) return lines;
  if (!(await isAiConfigured())) return lines;
  const nonEmpty = lines.some((l) => l && l.trim());
  if (!nonEmpty) return lines;

  try {
    const client = aiMessagesClient();
    const target = SUPPORTED_LANGUAGES[code];
    const res = await client.messages.create({
      model: "fast",
      max_tokens: 1024,
      system:
        `You are a translator for an Indian mutual-fund distributor's client messages. ` +
        `Translate each input line into ${target}. Keep numbers, ₹ amounts, percentages, ARN codes, ` +
        `scheme/fund names, and URLs EXACTLY as-is. Keep it warm and professional. ` +
        `Return ONLY a JSON array of strings, one per input line, same order. No prose.`,
      messages: [{ role: "user", content: JSON.stringify(lines) }],
    });
    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1) return lines;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (Array.isArray(parsed) && parsed.length === lines.length && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
    return lines;
  } catch {
    return lines; // never let translation break a send
  }
}

/** Convenience single-string variant. */
export async function translateOne(text: string, lang: string | null | undefined): Promise<string> {
  const [out] = await translateText([text], lang);
  return out ?? text;
}
