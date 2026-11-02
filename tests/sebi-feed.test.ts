import { describe, expect, it } from "vitest";
import { circularNo, isRelevantToMfd, parseSebiRss, sebiKind } from "@/lib/compliance/sebi-feed";

const XML = `<?xml version="1.0"?><rss><channel><title>SEBI RSS Feed</title>
<item><title><![CDATA[Revised KYC norms for mutual fund investors]]></title>
<link>https://www.sebi.gov.in/legal/circulars/oct-2026/revised-kyc-norms-for-mutual-fund-investors_105600.html</link>
<pubDate>Fri, 30 Oct 2026 10:00:00 +0530</pubDate></item>
<item><title>Final Order in the matter of EKI Energy Services Ltd.</title>
<link>https://www.sebi.gov.in/enforcement/orders/oct-2026/final-order-in-the-matter-of-eki-energy-services-ltd-_105524.html</link>
<pubDate>Fri, 30 Oct 2026 09:00:00 +0530</pubDate></item>
<item><title>Ease of Compliance for FPIs &amp; custodians</title>
<link>https://www.sebi.gov.in/media-and-notifications/press-releases/oct-2026/ease-of-compliance-for-fpis_105522.html</link></item>
<item><title>No link here</title></item>
</channel></rss>`;

describe("SEBI feed", () => {
  const items = parseSebiRss(XML);

  it("parses items, decodes entities and CDATA, and skips incomplete ones", () => {
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe("Revised KYC norms for mutual fund investors");
    expect(items[0].published?.toISOString()).toBe("2026-10-30T04:30:00.000Z");
    expect(items[2].title).toBe("Ease of Compliance for FPIs & custodians");
    expect(items[2].published).toBeNull();
  });

  it("keeps circulars about funds / KYC / investors and drops orders and unrelated notices", () => {
    expect(isRelevantToMfd(items[0])).toBe(true); // circular, mutual fund + KYC
    expect(isRelevantToMfd(items[1])).toBe(false); // enforcement order
    expect(isRelevantToMfd(items[2])).toBe(false); // press release, but nothing about funds/advisers
  });

  it("names the kind from the URL path and derives a stable id", () => {
    expect(sebiKind(items[0].link)).toBe("Circular");
    expect(sebiKind(items[1].link)).toBeNull();
    expect(circularNo(items[0].link)).toBe("SEBI-105600");
  });
});
