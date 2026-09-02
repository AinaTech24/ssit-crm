/**
 * KYC & Profile tab — nominees, referrals, the full master record (identity /
 * contact / profile / compliance / second holder / bank groups), profile
 * completeness, captured KYC data, and risk-profile history.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase } from "../../../lib/format";
import { Section, FieldRow, FieldGroup, Empty } from "./primitives";

export function ProfileTab({ d }: { d: any }) {
  const i = d.investor ?? {};
  const addr = i.address ?? {};
  const nominees: any[] = i.nominees?.length ? i.nominees : i.nomineeName ? [{ name: i.nomineeName, relation: i.nomineeRelation, dob: i.nomineeDob }] : [];
  const referrals: any[] = i.referrals ?? [];
  const banks: any[] = i.bankAccounts?.length ? i.bankAccounts : i.bankName ? [{ bankName: i.bankName, accountMasked: i.bankAccountNumberMasked, ifsc: i.bankIfsc }] : [];
  const kycData = i.kycData && typeof i.kycData === "object" ? Object.entries(i.kycData) : [];
  const comp = d.completeness ?? {};

  return (
    <View>
      {/* Nominees */}
      <Section title="Nominees" icon="users">
        {nominees.length === 0 ? <Empty text="No nominees on record." /> : nominees.map((n, idx) => (
          <View key={idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Name" value={n.name} />
            <FieldRow label="Relation" value={titleCase(n.relation)} />
            {n.dob ? <FieldRow label="DOB" value={fmtDate(n.dob)} /> : null}
            {n.mobile ? <FieldRow label="Mobile" value={n.mobile} /> : null}
            {n.pan ? <FieldRow label="PAN" value={n.pan} /> : null}
            {n.sharePct != null ? <FieldRow label="Share %" value={`${n.sharePct}%`} /> : null}
          </View>
        ))}
      </Section>

      {/* Referrals */}
      <Section title="Referrals" icon="share-2">
        {referrals.length === 0 ? <Empty text="No referrals recorded." /> : referrals.map((r, idx) => (
          <View key={idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Name" value={r.name} />
            <FieldRow label="Relation" value={titleCase(r.relation)} />
            {r.mobile ? <FieldRow label="Mobile" value={r.mobile} /> : null}
            {r.email ? <FieldRow label="Email" value={r.email} /> : null}
            {r.note ? <FieldRow label="Note" value={r.note} /> : null}
          </View>
        ))}
      </Section>

      {/* Master record */}
      <Section title="Client details" icon="file-text">
        <FieldGroup title="Identity" rows={[
          ["Client ID", String(i.id ?? "").slice(0, 8)],
          ["PAN", i.pan],
          ["Name", i.name],
          ["Name as per PAN", i.nameAsPerPan],
          ["Date of birth", fmtDate(i.dob)],
          ["Gender", i.gender === "M" ? "Male" : i.gender === "F" ? "Female" : i.gender === "O" ? "Other" : "—"],
          ["Marital status", titleCase(i.maritalStatus)],
          ["Mother's name", i.motherName],
          ["Place of birth", i.birthPlace],
          ["Aadhaar (last 4)", i.aadhaarLast4],
          ["Client since", fmtDate(i.onboardedAt)],
          ["Anniversary", fmtDate(i.anniversaryDate)],
        ]} />
        <FieldGroup title="Contact" rows={[
          ["Mobile", i.phone],
          ["Mobile belongs to", i.mobileRelation],
          ["Alternate mobile", i.alternatePhone],
          ["Email", i.email],
          ["Email belongs to", i.emailRelation],
          ["WhatsApp", i.whatsappPhone],
          ["Address", [addr.line1, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(", ")],
        ]} />
        <FieldGroup title="Profile" rows={[
          ["Occupation", i.occupation],
          ["Employer", i.employerName],
          ["Income range", i.incomeRange],
          ["Entity type", titleCase(i.investorCategory)],
          ["Client type", i.segmentTag],
          ["Client category", i.clientCategory],
          ["Mode of holding", i.modeOfHolding],
          ["Household type", i.householdType],
          ["Family head", i.familyOwnerName],
          ["Referral client", i.referralClientName],
          ["Assigned RM", d.rm?.name],
          ["Family group", d.family?.familyName ?? d.family?.headName],
        ]} />
        <FieldGroup title="Compliance" rows={[
          ["KYC status", titleCase(i.kycStatus)],
          ["Residential status", titleCase(i.residencyStatus)],
          ["Tax status", i.taxStatus],
          ["PAN–Aadhaar link", titleCase(i.panAadhaarLinkStatus)],
          ["CKYC number", i.ckycNumber],
          ["CKYC expiry", fmtDate(i.ckycExpiryAt)],
          ["KYC validated", fmtDate(i.kycValidatedAt)],
          ["KRA", i.kraName],
          ["FATCA status", titleCase(i.fatcaStatus)],
          ["FATCA expiry", fmtDate(i.fatcaExpiryAt)],
          ["Risk profile", titleCase(i.riskProfile)],
          ["BSE UCC", i.bseUccCode],
          ["NSE CAN", i.nseCanCode],
          ["Mandate status", titleCase(i.mandateStatus)],
          ["Mandate ref", i.mandateRefNo],
          ["Mandate amount", i.mandateAmount != null ? inr(i.mandateAmount) : null],
        ]} />
        {banks.length > 0 && (
          <FieldGroup title="Bank" rows={banks.flatMap((b, idx) => [
            [`Bank${banks.length > 1 ? ` ${idx + 1}` : ""}`, b.bankName],
            ["Account", b.accountMasked],
            ["IFSC", b.ifsc],
          ] as [string, any][])} />
        )}
        {(i.secondHolderFirstName || i.secondHolderLastName) && (
          <FieldGroup title="Second / joint holder" rows={[
            ["Name", [i.secondHolderFirstName, i.secondHolderLastName].filter(Boolean).join(" ")],
            ["Occupation", i.secondHolderOccupation],
            ["Company", i.secondHolderCompanyName],
            ["Birth place", i.secondHolderBirthPlace],
            ["Mother's name", i.secondHolderMotherName],
            ["Marital status", titleCase(i.secondHolderMaritalStatus)],
          ]} />
        )}
        {i.notes ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={{ fontWeight: fontWeight.semibold as any, marginBottom: 2 }}>Notes</Text>
            <Text variant="caption" tone="muted">{i.notes}</Text>
          </View>
        ) : null}
      </Section>

      {/* Completeness */}
      <Section title="Profile completeness" icon="check-circle">
        <View style={styles.compHead}>
          <Text style={{ fontSize: 22, fontWeight: fontWeight.bold as any }}>{comp.pct ?? comp.score ?? 0}%</Text>
          <View style={styles.compTrack}><View style={[styles.compFill, { width: `${comp.pct ?? comp.score ?? 0}%` }]} /></View>
        </View>
        {(comp.missing ?? []).length > 0 ? <Text variant="caption" tone="muted">Missing: {(comp.missing ?? []).join(", ")}</Text> : <Text variant="caption" tone="muted">All key fields captured.</Text>}
      </Section>

      {/* KYC data */}
      {kycData.length > 0 && (
        <Section title="Captured KYC data" icon="database">
          {kycData.map(([k, v]) => <FieldRow key={k} label={titleCase(k)} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />)}
        </Section>
      )}

      {/* Risk history */}
      <Section title="Risk profile history" icon="activity">
        {(d.riskHistory ?? []).length === 0 ? <Empty text="No risk profile history." /> : (d.riskHistory ?? []).map((r: any, idx: number) => (
          <View key={r.id ?? idx} style={idx > 0 ? styles.sep : undefined}>
            <FieldRow label="Profiled" value={fmtDate(r.profileDate ?? r.signedAt)} />
            <FieldRow label="Category" value={titleCase(r.finalCategory)} />
            <FieldRow label="Score" value={r.totalScore != null ? String(r.totalScore) : "—"} />
            {r.signedByName ? <FieldRow label="Signed by" value={r.signedByName} /> : null}
            {r.rmRemarks ? <FieldRow label="RM remarks" value={r.rmRemarks} /> : null}
          </View>
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  sep: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.line },
  compHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  compTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  compFill: { height: 8, borderRadius: 4, backgroundColor: palette.success },
});
