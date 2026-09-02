/**
 * SSIT CRM Copilot — scope gate.
 *
 * Classifies each request BEFORE any tool or LLM runs. Off-topic requests
 * (general knowledge, sports, jokes, etc.) get a standard refusal — never
 * answered from model knowledge, never sent to a tool, never learned.
 * Investment-advice requests get the compliant "authorized advisor" decline.
 *
 * Deliberately conservative: any CRM/business signal keeps the request in scope,
 * so we don't wrongly refuse a real question the engine happens to phrase-miss.
 */

export type Scope = "in_scope" | "out_of_scope" | "investment_advice";

export const REFUSAL_TEXT =
  "I can only help with SSIT CRM activities and legitimate business communications — clients, leads, AUM, SIPs, KYC, tasks, meetings, insurance, business reports, and customer emails / WhatsApp / SMS drafts.";

export const ADVICE_TEXT =
  "I can summarise the relevant CRM information, but investment recommendations (which fund to buy, expected returns, suitability, or allocation) require review by an authorised advisor under the firm's approved process.";

// Strong off-topic markers (only refuse when NO CRM signal is present).
const OUT_MARKERS =
  /\b(weather|forecast|temperature|sports?|cricket|football|soccer|ipl|world\s*cup|match|who\s+won|scoreline|news|headline|politic|election|prime\s+minister|president|movie|film|actor|actress|song|lyrics|joke|riddle|poem|story|shayari|recipe|cook|travel|hotel|flight|horoscope|astrology|zodiac|capital\s+of|translate\s+to|homework|assignment|essay|write\s+code|python|javascript|celebrity|love\s+letter|chatgpt|chat\s*gpt|open\s*ai|gpt-?\d|\bgemini\b|\bgrok\b|large\s+language\s+model|\bllm\b|\bchatbot\b|who\s+(made|built|created|trained)\s+you|what\s+(ai\s+)?model|bitcoin|ethereum|\bcrypto|dogecoin)\b/i;

// Investment-advice markers → compliant decline (not a blanket refusal).
const ADVICE_MARKERS =
  /\b(which\s+(fund|scheme|stock)\s+(is\s+)?(best|good|should)|best\s+(fund|scheme|mutual\s*fund)|recommend\s+(a\s+)?(fund|scheme|stock|investment)|should\s+i\s+(buy|sell|invest|redeem)|will\s+.*\b(go\s+up|rise|fall|crash|double)|market\s+(prediction|forecast|outlook)|expected\s+return|suggest\s+.*\b(scheme|fund|investment)|(portfolio|asset)\s+allocation|nifty\s+(target|tomorrow|forecast)|sensex\s+(target|tomorrow|forecast))\b/i;

// Any CRM / business-communication signal → in scope.
const CRM_MARKERS =
  /\b(client|investor|customer|lead|prospect|contact|account|aum|sip|kyc|nominee|ucc|folio|task|meeting|review|follow.?up|insurance|policy|policies|premium|renewal|business|redemption|lumpsum|inflow|net\s*sales|portfolio|holding|transaction|report|dashboard|mis|segment|hni|affluent|retail|nri|dormant|onboard|rm|relationship\s+manager|branch|tier|email|whatsapp|sms|message|reminder|draft|firm|revenue|commission)\b/i;

export function classifyScope(question: string): Scope {
  const s = question.toLowerCase();
  if (ADVICE_MARKERS.test(s)) return "investment_advice";
  if (CRM_MARKERS.test(s)) return "in_scope";
  if (OUT_MARKERS.test(s)) return "out_of_scope";
  return "in_scope"; // default in-scope — the engine will answer, help, or (optionally) hand to the LLM
}
