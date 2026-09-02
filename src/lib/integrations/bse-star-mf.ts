/**
 * BSE Star MF adapter — stub. Real BSE Star uses SOAP with per-tenant member
 * credentials. We define the contract here so action handlers + UI can be
 * coded against it now, and the real SOAP wiring slots in later.
 *
 * Production hookup steps (when ready):
 *   1. Each MFD tenant uploads BSE member code + user_id + password (Module 10
 *      compliance vault) — never stored in env.
 *   2. Use `soap` npm package to call BSE's WSDL. URLs:
 *        Demo:  https://bsestarmfdemo.bseindia.com/MFOrderEntry/MFOrder.svc?singleWsdl
 *        Prod:  https://bsestarmf.in/MFOrderEntry/MFOrder.svc?singleWsdl
 *   3. PASSWORD_GENERATION_REQUEST → fetch ENCRYPTED_PASSWORD (15-min TTL).
 *   4. Wrap each Order_Entry_Param / Lumpsum / SIP / Redemption operation.
 *
 * For now, every method here is a no-op that returns a deterministic stub
 * response. Wired into action handlers via the adapter interface below.
 */

export type BseCredentials = {
  memberCode: string;
  userId: string;
  password: string;
};

export type LumpsumOrder = {
  uccCode: string;
  amcCode: string;
  schemeCode: string;
  amount: number;
  euin: string;
  paymentMode?: "PHYSICAL" | "ONLINE";
};

export type SipOrder = {
  uccCode: string;
  schemeCode: string;
  amount: number;
  frequency: "MONTHLY" | "QUARTERLY";
  startDate: string; // YYYY-MM-DD
  noOfInstallments: number;
  mandateId: string;
  euin: string;
};

export type RedemptionOrder = {
  uccCode: string;
  folioNumber: string;
  schemeCode: string;
  units?: number;
  amount?: number;
  allUnits?: boolean;
  euin: string;
};

export type OrderResult = {
  orderId: string;
  status: "submitted" | "rejected";
  reasonCode?: string;
  reasonDescription?: string;
  raw?: unknown;
};

export interface BseStarAdapter {
  authenticate(creds: BseCredentials): Promise<{ token: string; expiresAt: Date }>;
  createUcc(creds: BseCredentials, params: unknown): Promise<{ uccCode: string }>;
  placeLumpsum(creds: BseCredentials, order: LumpsumOrder): Promise<OrderResult>;
  registerSip(creds: BseCredentials, order: SipOrder): Promise<OrderResult>;
  redeem(creds: BseCredentials, order: RedemptionOrder): Promise<OrderResult>;
  fetchOrderStatus(creds: BseCredentials, orderId: string): Promise<OrderResult>;
}

/**
 * Stub adapter — useful for development before BSE membership is approved.
 * Generates fake order IDs and 90% success rate.
 */
export const stubBseStar: BseStarAdapter = {
  async authenticate() {
    return { token: "stub-token", expiresAt: new Date(Date.now() + 15 * 60 * 1000) };
  },
  async createUcc(_c, _p) {
    return { uccCode: `UCC${Date.now().toString().slice(-8)}` };
  },
  async placeLumpsum(_c, order) {
    return {
      orderId: `LMP${Date.now()}`,
      status: Math.random() > 0.1 ? "submitted" : "rejected",
      reasonCode: Math.random() > 0.1 ? undefined : "INSUFFICIENT_BALANCE",
      reasonDescription: undefined,
    };
  },
  async registerSip(_c, order) {
    return {
      orderId: `SIP${Date.now()}`,
      status: "submitted",
    };
  },
  async redeem(_c, order) {
    return {
      orderId: `RED${Date.now()}`,
      status: "submitted",
    };
  },
  async fetchOrderStatus(_c, orderId) {
    return {
      orderId,
      status: "submitted",
    };
  },
};

async function callSoap(action: string, bodyXml: string): Promise<string> {
  const isLive = process.env.BSE_STAR_MODE === "live";
  const baseUrl = isLive
    ? "https://bsestarmf.in/MFOrderEntry/MFOrder.svc"
    : "https://bsestarmfdemo.bseindia.com/MFOrderEntry/MFOrder.svc";

  const xmlPayload = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bses="http://bsestarmf.in/">
   <soapenv:Header/>
   <soapenv:Body>
      ${bodyXml}
   </soapenv:Body>
</soapenv:Envelope>`;

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": `http://bsestarmf.in/IMFOrderEntry/${action}`,
    },
    body: xmlPayload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BSE Star MF SOAP call failed: ${response.statusText} - ${errorText}`);
  }

  return await response.text();
}

function extractXmlTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1] : "";
}

function jsonToXml(obj: any): string {
  if (!obj || typeof obj !== "object") return "";
  return Object.entries(obj)
    .map(([k, v]) => `<bses:${k}>${v ?? ""}</bses:${k}>`)
    .join("\n");
}

export const liveBseStar: BseStarAdapter = {
  async authenticate(creds) {
    const passkey = process.env.BSE_STAR_PASSKEY ?? "12345";
    const body = `
      <bses:getPassword>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:Password>${creds.password}</bses:Password>
        <bses:PassKey>${passkey}</bses:PassKey>
      </bses:getPassword>
    `;
    const response = await callSoap("getPassword", body);
    const result = extractXmlTag(response, "getPasswordResult");
    const parts = result.split("|");
    if (parts[0] !== "100" && parts[0] !== "0") {
      throw new Error(`BSE Star MF Authentication Failed: ${result}`);
    }
    return { token: parts[1] || result, expiresAt: new Date(Date.now() + 15 * 60 * 1000) };
  },

  async createUcc(creds, params: any) {
    const tokenResult = await this.authenticate(creds);
    const uccCode = params.uccCode || `UCC${Date.now().toString().slice(-8)}`;
    const body = `
      <bses:createUcc>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:EncryptedPassword>${tokenResult.token}</bses:EncryptedPassword>
        ${jsonToXml(params)}
      </bses:createUcc>
    `;
    await callSoap("createUcc", body);
    return { uccCode };
  },

  async placeLumpsum(creds, order) {
    const tokenResult = await this.authenticate(creds);
    const orderId = `LMP${Date.now()}`;
    const body = `
      <bses:orderEntryParam>
        <bses:TransType>NEW</bses:TransType>
        <bses:TransNo>${orderId}</bses:TransNo>
        <bses:SchemeCD>${order.schemeCode}</bses:SchemeCD>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:MemberId>${creds.memberCode}</bses:MemberId>
        <bses:ClientCode>${order.uccCode}</bses:ClientCode>
        <bses:BuySell>B</bses:BuySell>
        <bses:BuySellType>FRESH</bses:BuySellType>
        <bses:Dptxn>P</bses:Dptxn>
        <bses:Qty></bses:Qty>
        <bses:Amount>${order.amount}</bses:Amount>
        <bses:Euin>${order.euin}</bses:Euin>
        <bses:EuinVal>N</bses:EuinVal>
        <bses:EncryptedPassword>${tokenResult.token}</bses:EncryptedPassword>
        <bses:OrderValType>V</bses:OrderValType>
        <bses:IpAdd></bses:IpAdd>
        <bses:Password></bses:Password>
        <bses:PassKey></bses:PassKey>
        <bses:Par1></bses:Par1>
        <bses:Par2></bses:Par2>
        <bses:Par3></bses:Par3>
      </bses:orderEntryParam>
    `;
    const response = await callSoap("orderEntryParam", body);
    const resultText = extractXmlTag(response, "orderEntryParamResult");
    const parts = resultText.split("|");
    const status = parts[1] === "SUCCESS" || parts[0] === "100" || parts[0] === "0" ? "submitted" : "rejected";
    return {
      orderId: parts[2] || orderId,
      status,
      reasonCode: status === "rejected" ? parts[0] : undefined,
      reasonDescription: parts[3] || resultText,
    };
  },

  async registerSip(creds, order) {
    const tokenResult = await this.authenticate(creds);
    const orderId = `SIP${Date.now()}`;
    const body = `
      <bses:xsipOrderEntryParam>
        <bses:TransactionCode>NEW</bses:TransactionCode>
        <bses:SchemeCode>${order.schemeCode}</bses:SchemeCode>
        <bses:MemberId>${creds.memberCode}</bses:MemberId>
        <bses:ClientCode>${order.uccCode}</bses:ClientCode>
        <bses:TransNo>${orderId}</bses:TransNo>
        <bses:Amount>${order.amount}</bses:Amount>
        <bses:FrequencyType>${order.frequency}</bses:FrequencyType>
        <bses:StartDate>${order.startDate}</bses:StartDate>
        <bses:InstallmentAmount>${order.amount}</bses:InstallmentAmount>
        <bses:NoOfInstallment>${order.noOfInstallments}</bses:NoOfInstallment>
        <bses:MandateId>${order.mandateId}</bses:MandateId>
        <bses:Euin>${order.euin}</bses:Euin>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:EncryptedPassword>${tokenResult.token}</bses:EncryptedPassword>
        <bses:IpAddress></bses:IpAddress>
        <bses:Password></bses:Password>
        <bses:PassKey></bses:PassKey>
        <bses:Param1></bses:Param1>
        <bses:Param2></bses:Param2>
        <bses:Param3></bses:Param3>
      </bses:xsipOrderEntryParam>
    `;
    const response = await callSoap("xsipOrderEntryParam", body);
    const resultText = extractXmlTag(response, "xsipOrderEntryParamResult");
    const parts = resultText.split("|");
    const status = parts[1] === "SUCCESS" || parts[0] === "100" || parts[0] === "0" ? "submitted" : "rejected";
    return {
      orderId: parts[2] || orderId,
      status,
      reasonCode: status === "rejected" ? parts[0] : undefined,
      reasonDescription: parts[3] || resultText,
    };
  },

  async redeem(creds, order) {
    const tokenResult = await this.authenticate(creds);
    const orderId = `RED${Date.now()}`;
    const body = `
      <bses:orderEntryParam>
        <bses:TransType>NEW</bses:TransType>
        <bses:TransNo>${orderId}</bses:TransNo>
        <bses:SchemeCD>${order.schemeCode}</bses:SchemeCD>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:MemberId>${creds.memberCode}</bses:MemberId>
        <bses:ClientCode>${order.uccCode}</bses:ClientCode>
        <bses:BuySell>S</bses:BuySell>
        <bses:BuySellType>FRESH</bses:BuySellType>
        <bses:Dptxn>P</bses:Dptxn>
        <bses:Qty>${order.units ?? ""}</bses:Qty>
        <bses:Amount>${order.amount ?? ""}</bses:Amount>
        <bses:Euin>${order.euin}</bses:Euin>
        <bses:EuinVal>N</bses:EuinVal>
        <bses:EncryptedPassword>${tokenResult.token}</bses:EncryptedPassword>
        <bses:OrderValType>V</bses:OrderValType>
        <bses:IpAdd></bses:IpAdd>
        <bses:Password></bses:Password>
        <bses:PassKey></bses:PassKey>
        <bses:Par1></bses:Par1>
        <bses:Par2></bses:Par2>
        <bses:Par3></bses:Par3>
      </bses:orderEntryParam>
    `;
    const response = await callSoap("orderEntryParam", body);
    const resultText = extractXmlTag(response, "orderEntryParamResult");
    const parts = resultText.split("|");
    const status = parts[1] === "SUCCESS" || parts[0] === "100" || parts[0] === "0" ? "submitted" : "rejected";
    return {
      orderId: parts[2] || orderId,
      status,
      reasonCode: status === "rejected" ? parts[0] : undefined,
      reasonDescription: parts[3] || resultText,
    };
  },

  async fetchOrderStatus(creds, orderId) {
    const tokenResult = await this.authenticate(creds);
    const body = `
      <bses:getOrderStatus>
        <bses:UserId>${creds.userId}</bses:UserId>
        <bses:MemberId>${creds.memberCode}</bses:MemberId>
        <bses:OrderId>${orderId}</bses:OrderId>
        <bses:EncryptedPassword>${tokenResult.token}</bses:EncryptedPassword>
      </bses:getOrderStatus>
    `;
    const response = await callSoap("getOrderStatus", body);
    const resultText = extractXmlTag(response, "getOrderStatusResult");
    const parts = resultText.split("|");
    const status = parts[1] === "SUCCESS" || parts[0] === "100" || parts[0] === "0" ? "submitted" : "rejected";
    return {
      orderId,
      status,
      reasonCode: status === "rejected" ? parts[0] : undefined,
      reasonDescription: parts[3] || resultText,
    };
  },
};

/**
 * Returns the adapter chosen by env (`BSE_STAR_MODE=stub|live`).
 * Defaults to stub.
 */
export function getBseStarAdapter(): BseStarAdapter {
  if (process.env.BSE_STAR_MODE === "live") return liveBseStar;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_PROVIDERS !== "1") {
    throw new Error("BSE Star MF is not configured for live production order routing");
  }
  return stubBseStar;
}
