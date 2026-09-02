/**
 * Onboarding wizard — the 5-step flow (Contact → KYC → Risk → Nominee → Bank),
 * saving each step via PATCH /api/investors/[id]. Parity with the web
 * OnboardingWizard.
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { Segmented } from "../../../components/ui/Segmented";
import { BottomSheet } from "../../../components/ui/BottomSheet";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useOnboardingStep } from "./subfeatures";

const KYC = [
  { key: "pending", label: "Pending" }, { key: "registered", label: "Registered" }, { key: "verified", label: "Verified" },
  { key: "hold", label: "Hold" }, { key: "rejected", label: "Rejected" }, { key: "re_kyc_required", label: "Re-KYC" },
];
const PANLINK = [{ key: "linked", label: "Linked" }, { key: "not_linked", label: "Not linked" }, { key: "pending", label: "Pending" }, { key: "not_applicable", label: "N/A" }];
const RISK = [{ key: "conservative", label: "Conservative" }, { key: "moderate", label: "Moderate" }, { key: "aggressive", label: "Aggressive" }, { key: "very_aggressive", label: "Very aggressive" }];

export function OnboardingWizardSheet({ id, visible, onClose, investor }: { id: string; visible: boolean; onClose: () => void; investor: any }) {
  const save = useOnboardingStep(id);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Record<string, any>>({});
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const val = (k: string, fallback = "") => (f[k] !== undefined ? f[k] : investor?.[k] ?? fallback);

  const STEPS = [
    {
      title: "Contact", patch: () => ({ email: val("email") || undefined, phone: val("phone") || undefined, whatsappPhone: val("whatsappPhone") || undefined }),
      body: (
        <>
          <TextField label="Email" value={val("email")} onChangeText={(v) => set("email", v)} keyboardType="email-address" />
          <TextField label="Mobile" value={val("phone")} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" />
          <TextField label="WhatsApp" value={val("whatsappPhone")} onChangeText={(v) => set("whatsappPhone", v)} keyboardType="phone-pad" />
        </>
      ),
    },
    {
      title: "KYC", patch: () => ({ kycStatus: val("kycStatus", "pending"), panAadhaarLinkStatus: val("panAadhaarLinkStatus") || undefined, nameAsPerPan: val("nameAsPerPan") || undefined }),
      body: (
        <>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>KYC status</Text>
          <Segmented<string> options={KYC} value={val("kycStatus", "pending")} onChange={(v) => set("kycStatus", v)} />
          <View style={{ height: spacing.md }} />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>PAN–Aadhaar link</Text>
          <Segmented<string> options={PANLINK} value={val("panAadhaarLinkStatus", "pending")} onChange={(v) => set("panAadhaarLinkStatus", v)} />
          <View style={{ height: spacing.md }} />
          <TextField label="Name as per PAN" value={val("nameAsPerPan")} onChangeText={(v) => set("nameAsPerPan", v)} />
        </>
      ),
    },
    {
      title: "Risk", patch: () => ({ riskProfile: val("riskProfile") || undefined }),
      body: (
        <>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Risk profile</Text>
          <Segmented<string> options={RISK} value={val("riskProfile", "moderate")} onChange={(v) => set("riskProfile", v)} />
        </>
      ),
    },
    {
      title: "Nominee", patch: () => ({ nomineeName: val("nomineeName") || undefined, nomineeRelation: val("nomineeRelation") || undefined }),
      body: (
        <>
          <TextField label="Nominee name" value={val("nomineeName")} onChangeText={(v) => set("nomineeName", v)} />
          <TextField label="Relation" value={val("nomineeRelation")} onChangeText={(v) => set("nomineeRelation", v)} placeholder="Spouse / Son / …" />
        </>
      ),
    },
    {
      title: "Bank", patch: () => ({ bankName: val("bankName") || undefined, bankAccountNumberMasked: val("bankAccountNumberMasked") || undefined, bankIfsc: val("bankIfsc") || undefined }),
      body: (
        <>
          <TextField label="Bank name" value={val("bankName")} onChangeText={(v) => set("bankName", v)} />
          <TextField label="Account number" value={val("bankAccountNumberMasked")} onChangeText={(v) => set("bankAccountNumberMasked", v)} />
          <TextField label="IFSC" value={val("bankIfsc")} onChangeText={(v) => set("bankIfsc", v.toUpperCase())} autoCapitalize="characters" />
        </>
      ),
    },
  ];

  const last = step === STEPS.length - 1;
  const cur = STEPS[step];
  const close = () => { setStep(0); setF({}); onClose(); };
  const next = () => {
    save.mutate(cur.patch(), {
      onSuccess: () => { if (last) close(); else setStep((s) => s + 1); },
    });
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={`Onboarding · ${cur.title}`}>
      <View style={styles.progress}>
        {STEPS.map((_, i) => <View key={i} style={[styles.seg, { backgroundColor: i <= step ? palette.brand : palette.surfaceSunken }]} />)}
      </View>
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>Step {step + 1} of {STEPS.length}</Text>
      {cur.body}
      <View style={styles.nav}>
        <Button label="Back" variant="secondary" disabled={step === 0} onPress={() => setStep((s) => Math.max(0, s - 1))} style={{ flex: 1 }} />
        <Button label={last ? "Finish" : "Save & next"} loading={save.isPending} onPress={next} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: "row", gap: 4, marginBottom: spacing.xs },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  nav: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
});
