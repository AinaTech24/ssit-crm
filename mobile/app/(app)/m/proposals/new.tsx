/**
 * Create a proposal — mirrors the web builder. Pick a recipient (client or lead),
 * frame it (title / risk / validity), add product line items across all five
 * kinds (MF with live scheme search, insurance, PMS, AIF, other), watch the
 * running total, and save as a draft. Sending happens on the detail screen.
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { TextField } from "../../../../src/components/ui/TextField";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { useSearch } from "../../../../src/features/search/api";
import {
  useCreateProposal, useSchemeSearch, lineTitle, lineAmount, num, LINE_KIND_LABEL,
  type ProposalLine, type LineKind, type RecipientType, type RiskRating,
} from "../../../../src/features/proposals/api";
import { toast } from "../../../../src/lib/toast";
import { inr, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

type Recipient = { type: RecipientType; id: string; name: string; email?: string | null; phone?: string | null };

const RISKS: RiskRating[] = ["conservative", "moderate", "aggressive"];
const KINDS: LineKind[] = ["mf", "insurance", "pms", "aif", "other"];

export default function NewProposal() {
  const router = useRouter();
  const create = useCreateProposal();

  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [title, setTitle] = React.useState("Investment Proposal");
  const [risk, setRisk] = React.useState<RiskRating>("moderate");
  const [validDays, setValidDays] = React.useState("30");
  const [coverLetter, setCoverLetter] = React.useState("");
  const [products, setProducts] = React.useState<ProposalLine[]>([]);
  const [lineOpen, setLineOpen] = React.useState(false);

  const total = products.reduce((s, l) => s + lineAmount(l), 0);
  const kinds = new Set(products.map((p) => p.kind));
  const proposalType = kinds.size > 1 ? "mixed" : kinds.has("mf") ? "mutual_fund" : kinds.has("insurance") ? "insurance" : kinds.has("pms") ? "pms" : kinds.has("aif") ? "aif" : "mutual_fund";

  const save = () => {
    if (!recipient) return toast.error("Pick a client or lead first");
    if (title.trim().length < 2) return toast.error("Give the proposal a title");
    if (products.length === 0) return toast.error("Add at least one product");
    const validUntil = new Date(Date.now() + (parseInt(validDays, 10) || 30) * 86400000).toISOString();
    create.mutate(
      {
        recipientType: recipient.type,
        ...(recipient.type === "investor" ? { investorId: recipient.id } : { leadId: recipient.id }),
        recipientName: recipient.name, recipientEmail: recipient.email ?? undefined, recipientPhone: recipient.phone ?? undefined,
        type: proposalType, title: title.trim(), riskRating: risk, coverLetter: coverLetter.trim() || undefined,
        products, validUntil,
      },
      {
        onSuccess: (r) => { toast.success("Proposal created"); router.replace(`/m/proposals/${r.id}` as any); },
        onError: (e: any) => toast.error(e?.body?.error || "Couldn't create proposal"),
      }
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="New proposal" />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: 140 }}>
        {/* Recipient */}
        <SectionLabel text="RECIPIENT" />
        {recipient ? (
          <Pressable onPress={() => setPickerOpen(true)}>
            <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={styles.avatar}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any }}>{recipient.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>{recipient.name}</Text>
                <Text variant="caption" tone="muted">{recipient.type === "investor" ? "Client" : "Lead"}{recipient.phone ? ` · ${recipient.phone}` : ""}</Text>
              </View>
              <Feather name="edit-2" size={14} color={palette.faint} />
            </Card>
          </Pressable>
        ) : (
          <Pressable style={styles.addBtn} onPress={() => setPickerOpen(true)}>
            <Feather name="user-plus" size={16} color={palette.brand} />
            <Text style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Choose client or lead</Text>
          </Pressable>
        )}

        {/* Framing */}
        <SectionLabel text="DETAILS" />
        <Card flat>
          <TextField label="Title" value={title} onChangeText={setTitle} required />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Overall risk</Text>
          <Segmented options={RISKS.map((r) => ({ key: r, label: titleCase(r) }))} value={risk} onChange={(v) => setRisk(v as RiskRating)} />
          <View style={{ height: spacing.lg }} />
          <TextField label="Valid for (days)" value={validDays} onChangeText={setValidDays} keyboardType="numeric" />
          <TextField label="Cover letter (optional)" value={coverLetter} onChangeText={setCoverLetter} multiline />
        </Card>

        {/* Products */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm }}>
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>PRODUCTS ({products.length})</Text>
          {total > 0 ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: palette.ink }}>{inr(total)}</Text> : null}
        </View>
        {products.map((l, i) => (
          <Card key={i} flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm }}>
            <View style={styles.pTag}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any, fontSize: 10 }}>{LINE_KIND_LABEL[l.kind].toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1}>{lineTitle(l)}</Text>
              {lineAmount(l) > 0 ? <Text variant="caption" tone="muted">{inr(lineAmount(l))}</Text> : null}
            </View>
            <Pressable onPress={() => setProducts((p) => p.filter((_, ix) => ix !== i))} hitSlop={8}><Feather name="x" size={18} color={palette.faint} /></Pressable>
          </Card>
        ))}
        <Pressable style={styles.addBtn} onPress={() => setLineOpen(true)}>
          <Feather name="plus" size={16} color={palette.brand} />
          <Text style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Add product</Text>
        </Pressable>
      </Screen>

      {/* Sticky save */}
      <View style={styles.footer}>
        <Pressable style={[styles.save, (!recipient || products.length === 0) && { opacity: 0.5 }]} onPress={save} disabled={create.isPending}>
          <Text style={styles.saveTxt}>{create.isPending ? "Creating…" : "Create proposal"}</Text>
        </Pressable>
      </View>

      <RecipientPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(r) => { setRecipient(r); setPickerOpen(false); }} />
      <LineEditor visible={lineOpen} onClose={() => setLineOpen(false)} onAdd={(l) => { setProducts((p) => [...p, l]); setLineOpen(false); }} />
    </View>
  );
}

// ── Recipient picker (clients + leads via global search) ──
function RecipientPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (r: Recipient) => void }) {
  const [q, setQ] = React.useState("");
  const search = useSearch(q);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose recipient">
      <SearchBar value={q} onChangeText={setQ} placeholder="Search clients & leads…" />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {(search.data?.investors ?? []).map((i) => (
          <Pressable key={`i-${i.id}`} style={styles.pickRow} onPress={() => onPick({ type: "investor", id: i.id, name: i.name, email: i.email, phone: i.phone })}>
            <View style={[styles.avatar, { backgroundColor: palette.violet }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{i.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{i.name}</Text><Text variant="caption" tone="muted">Client{i.phone ? ` · ${i.phone}` : ""}</Text></View>
          </Pressable>
        ))}
        {(search.data?.leads ?? []).map((l) => (
          <Pressable key={`l-${l.id}`} style={styles.pickRow} onPress={() => onPick({ type: "lead", id: l.id, name: l.name, email: l.email, phone: l.phone })}>
            <View style={[styles.avatar, { backgroundColor: palette.brand }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{l.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{l.name}</Text><Text variant="caption" tone="muted">Lead{l.phone ? ` · ${l.phone}` : ""}</Text></View>
          </Pressable>
        ))}
        {q.trim().length >= 2 && !search.isLoading && (search.data?.investors.length ?? 0) + (search.data?.leads.length ?? 0) === 0 ? (
          <Text variant="body" tone="muted" style={{ textAlign: "center", padding: spacing.lg }}>No matches.</Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

// ── Line-item editor (all 5 kinds) ──
type FieldCfg = { key: string; label: string; money?: boolean };
const KIND_FIELDS: Record<LineKind, { nameKey: string; nameLabel: string; fields: FieldCfg[] }> = {
  mf: { nameKey: "schemeName", nameLabel: "Scheme name", fields: [{ key: "amcName", label: "AMC" }, { key: "monthlyAmount", label: "Monthly SIP", money: true }, { key: "lumpsum", label: "Lumpsum", money: true }, { key: "sipTermYears", label: "SIP years" }, { key: "expectedReturn", label: "Expected return %" }] },
  insurance: { nameKey: "policyName", nameLabel: "Policy name", fields: [{ key: "insurer", label: "Insurer" }, { key: "sumAssured", label: "Sum assured", money: true }, { key: "annualPremium", label: "Annual premium", money: true }, { key: "termYears", label: "Term (years)" }] },
  pms: { nameKey: "strategyName", nameLabel: "Strategy name", fields: [{ key: "manager", label: "Manager" }, { key: "proposedAmount", label: "Proposed amount", money: true }, { key: "expectedReturn", label: "Expected return %" }, { key: "termYears", label: "Term (years)" }] },
  aif: { nameKey: "fundName", nameLabel: "Fund name", fields: [{ key: "manager", label: "Manager" }, { key: "proposedAmount", label: "Proposed amount", money: true }, { key: "lockInYears", label: "Lock-in (years)" }, { key: "targetIrr", label: "Target IRR %" }] },
  other: { nameKey: "productName", nameLabel: "Product name", fields: [{ key: "company", label: "Company" }, { key: "amount", label: "Amount", money: true }, { key: "expectedReturn", label: "Expected return %" }, { key: "termYears", label: "Term (years)" }] },
};
const NUMERIC = new Set(["monthlyAmount", "lumpsum", "sipTermYears", "expectedReturn", "sumAssured", "annualPremium", "termYears", "proposedAmount", "lockInYears", "targetIrr", "amount"]);

function LineEditor({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (l: ProposalLine) => void }) {
  const [kind, setKind] = React.useState<LineKind>("mf");
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [schemeQ, setSchemeQ] = React.useState("");
  const schemes = useSchemeSearch(schemeQ);
  const cfg = KIND_FIELDS[kind];

  React.useEffect(() => { if (visible) { setVals({}); setSchemeQ(""); } }, [visible, kind]);

  const add = () => {
    const name = (vals[cfg.nameKey] ?? "").trim();
    if (!name) return toast.error(`${cfg.nameLabel} is required`);
    const line: any = { kind, [cfg.nameKey]: name };
    cfg.fields.forEach((f) => {
      const raw = (vals[f.key] ?? "").trim();
      if (!raw) return;
      line[f.key] = NUMERIC.has(f.key) ? num(raw.replace(/,/g, "")) : raw;
    });
    onAdd(line as ProposalLine);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add product">
      <Segmented options={KINDS.map((k) => ({ key: k, label: LINE_KIND_LABEL[k] }))} value={kind} onChange={(v) => setKind(v as LineKind)} />
      <ScrollView style={{ maxHeight: 420, marginTop: spacing.lg }} keyboardShouldPersistTaps="handled">
        {/* MF: live scheme search that fills scheme name + AMC */}
        {kind === "mf" ? (
          <View style={{ marginBottom: spacing.md }}>
            <SearchBar value={schemeQ} onChangeText={setSchemeQ} placeholder="Search a scheme…" />
            {(schemes.data ?? []).slice(0, 6).map((s) => (
              <Pressable key={s.schemeCode} style={styles.pickRow} onPress={() => { setVals((v) => ({ ...v, schemeName: s.schemeName, amcName: s.amc ?? "" })); setSchemeQ(""); }}>
                <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{s.schemeName}</Text><Text variant="caption" tone="muted">{[s.amc, s.category].filter(Boolean).join(" · ")}</Text></View>
                <Feather name="plus-circle" size={16} color={palette.brand} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextField label={cfg.nameLabel} value={vals[cfg.nameKey] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [cfg.nameKey]: t }))} required />
        {cfg.fields.map((f) => (
          <TextField key={f.key} label={f.label} value={vals[f.key] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))} keyboardType={NUMERIC.has(f.key) ? "numeric" : "default"} />
        ))}
      </ScrollView>
      <Pressable style={[styles.save, { marginTop: spacing.sm }]} onPress={add}>
        <Text style={styles.saveTxt}>Add to proposal</Text>
      </Pressable>
    </BottomSheet>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.brand, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: spacing.md },
  pTag: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  save: { backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  saveTxt: { color: palette.white, fontWeight: fontWeight.semibold as any, fontSize: 15 },
});
