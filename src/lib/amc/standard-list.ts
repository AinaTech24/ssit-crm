/**
 * The AMCs a distributor can pick from when adding an empanelment — the
 * firm's own AMC list, 71 houses. Merged with the tenant's
 * amc_master rows in the picker (matching names collapse to one), so an AMC the
 * firm already has keeps its code and the rest are available without anyone
 * having to seed the catalogue first.
 */
export const STANDARD_AMC_NAMES: string[] = [
  "360 ONE Mutual Fund",
  "Abakkus Mutual Fund",
  "Aditya Birla Sun Life Mutual Fund",
  "AlphaGrep Mutual Fund",
  "Angel One Mutual Fund",
  "APEX SIF Mutual Fund",
  "Arthaya SIF Mutual Fund",
  "Arudha SIF Mutual Fund",
  "ASK Mutual Fund",
  "Axis Mutual Fund",
  "Bajaj Finserv Mutual Fund",
  "Bandhan Mutual Fund",
  "Bank Of India Mutual Fund",
  "Baroda BNP Paribas Mutual Fund",
  "Canara Robeco Mutual Fund",
  "Capitalmind Mutual Fund",
  "Choice Mutual Fund",
  "DIVINITI SIF Mutual Fund",
  "DSP Mutual Fund",
  "Dyna SIF Mutual Fund",
  "Edelweiss Mutual Fund",
  "Edelweiss SIF Mutual Fund",
  "Franklin Templeton Mutual Fund",
  "Groww Mutual Fund",
  "HDFC Mutual Fund",
  "Helios Mutual Fund",
  "HSBC Mutual Fund",
  "ICICI Prudential Mutual Fund",
  "ICICI Prudential SIF Mutual Fund",
  "Infinity SIF Mutual Fund",
  "Invesco Mutual Fund",
  "ITI Mutual Fund",
  "Jio BlackRock Mutual Fund",
  "JM Financial Mutual Fund",
  "Kotak Mutual Fund",
  "Lakshya Mutual Fund",
  "LIC Mutual Fund",
  "Mahindra Manulife Mutual Fund",
  "Mirae Asset Mutual Fund",
  "Monarch Mutual Fund",
  "Motilal Oswal Mutual Fund",
  "NAVI Mutual Fund",
  "Nippon India Mutual Fund",
  "NJ Mutual Fund",
  "Old Bridge Mutual Fund",
  "PGIM India Mutual Fund",
  "Platinum SIF Mutual Fund",
  "PPFAS Mutual Fund",
  "Prism SIF Mutual Fund",
  "Quant Mutual Fund",
  "Quant SIF Mutual Fund",
  "Quantum Mutual Fund",
  "RedHex SIF Mutual Fund",
  "Samco Mutual Fund",
  "Sapphire SIF Mutual Fund",
  "SBI Mutual Fund",
  "SBI SIF Mutual Fund",
  "Shriram Mutual Fund",
  "Summit SIF Mutual Fund",
  "Sundaram Mutual Fund",
  "Tata Mutual Fund",
  "Taurus Mutual Fund",
  "The Wealth Company Mutual Fund",
  "TITANIUM SIF Mutual Fund",
  "TRUST Mutual Fund",
  "Unifi Mutual Fund",
  "Union Mutual Fund",
  "UTI Mutual Fund",
  "WhiteOak Capital Mutual Fund",
  "WSIF Mutual Fund",
  "Zerodha Mutual Fund",
];

/** Name with the noise stripped, for matching “HDFC Mutual Fund” to “HDFC”. */
export function normaliseAmcName(name: string): string {
  return name
    .toLowerCase()
    .replace(/mutual fund/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** A stable code for an AMC that has no amc_master row yet. */
export function amcCodeFromName(name: string): string {
  const base = name
    .replace(/mutual fund/gi, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "AMC").slice(0, 40);
}
