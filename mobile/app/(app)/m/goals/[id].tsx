/**
 * Goal detail + calculator — web parity with GoalDetailCalculator. Live "three
 * ways to reach this goal" (flat SIP / step-up / lumpsum), gap + additional-SIP
 * banners, a return-sensitivity strip, a year-by-year projection, an editable
 * assumptions sheet (→ PATCH, server recomputes), a linked-investments picker,
 * recompute, WhatsApp share, and archive. Computed with the ported calc engine.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, Linking, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { DateField } from "../../../../src/components/form/DateField";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { confirmDelete } from "../../../../src/lib/confirm";
import {
  useGoalFull, usePatchGoal, useDeleteGoal, useRecomputeGoal,
  goalStatusBadge, categoryLabel, GLIDE_PATHS, type GoalFull, type Goal, type GoalFolio, type GoalSip,
} from "../../../../src/features/goals/api";
import { computeGoal, projectYearly, sensitivitySipRates, monthsBetween, inflatedTarget } from "../../../../src/features/goals/calc";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { inr, fmtDate, toNumber } from "../../../../src/lib/format";
import { palette, spacing, radius, fontWeight } from "../../../../src/theme/tokens";

const num = (v: any, d = 0) => { const n = toNumber(v); return Number.isFinite(n) && n !== 0 ? n : (v == null || v === "" ? d : n); };

export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useGoalFull(id);
  const recompute = useRecomputeGoal(id);
  const del = useDeleteGoal();
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Goal" onBack={() => router.back()} /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Goal" onBack={() => router.back()} /><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></View>;

  const g = data.goal;
  const inv = data.investor;
  const st = goalStatusBadge(g.status);
  const targetAmt = num(g.targetAmount);
  const currentVal = num(g.currentValue);
  const existingSip = num(g.existingMonthlySip ?? g.monthlyContribution);
  const ret = num(g.expectedReturn, 12) || 12;
  const infl = num(g.inflationPct, 6) || 6;
  const stepUp = num(g.stepUpPct, 0);
  const monthsLeft = monthsBetween(new Date(), new Date(g.targetDate));

  const calc = useMemo(() => computeGoal({
    futureTarget: targetAmt, currentValue: currentVal, existingMonthlySip: existingSip,
    monthsLeft, expectedReturnPct: ret, inflationPct: infl, stepUpPct: stepUp,
  }), [targetAmt, currentVal, existingSip, monthsLeft, ret, infl, stepUp]);
  const sens = useMemo(() => sensitivitySipRates(targetAmt, currentVal, calc.months), [targetAmt, currentVal, calc.months]);
  const years = useMemo(() => projectYearly({ currentValue: currentVal, initialMonthlySip: calc.requiredStepUpInitialSip || calc.requiredMonthlySipTotal, annualReturnPct: ret, stepUpPct: stepUp, months: calc.months }), [currentVal, calc, ret, stepUp]);

  const pct = Math.min(100, Math.round(num(g.progressPct)));
  const expPct = Math.min(100, Math.round(num(g.expectedProgressPct)));

  const doShare = () => {
    const phone = inv?.whatsappPhone || inv?.phone || "";
    const msg = `${g.name} — target ${inr(targetAmt)} by ${new Date(g.targetDate).getFullYear()}. Suggested SIP ${inr(calc.requiredMonthlySipTotal)}/mo.`;
    // With a client we record the share; without one it's a plain share sheet.
    if (phone) openWhatsApp({ phone, text: msg, subjectType: "investor", subjectId: inv?.id ?? null, name: inv?.name, purpose: `Goal — ${g.name}` });
    else Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`).catch(() => {});
  };
  const doRecompute = () => { setBanner(null); recompute.mutate(undefined, { onSuccess: () => setBanner("Recomputed from linked investments."), onError: (e: any) => setBanner(e?.message ?? "Recompute failed.") }); };
  const doDelete = () => confirmDelete({ title: `Archive ${g.name}?`, message: "The goal is archived (status → abandoned).", confirmLabel: "Archive" }, () => del.mutate(g.id, { onSuccess: () => router.back() }));

  return (
    <View style={styles.screen}>
      <ScreenHeader title={g.name} subtitle={categoryLabel(g.category)} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(240)}>
          {/* Header / progress */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={styles.icon}><Feather name="target" size={22} color={palette.violet} /></View>
              <View style={{ flex: 1 }}>
                <Text variant="title" numberOfLines={1}>{inr(targetAmt)}</Text>
                <Pressable onPress={() => inv && router.push(`/m/investors/${inv.id}` as any)}>
                  <Text variant="caption" tone="muted" numberOfLines={1}>{inv?.name ?? "—"}{inv?.pan ? ` · ${inv.pan}` : ""} · by {new Date(g.targetDate).getFullYear()}</Text>
                </Pressable>
              </View>
              <StatusPill label={st.label} tone={st.tone} />
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} />{expPct > 0 ? <View style={[styles.marker, { left: `${expPct}%` }]} /> : null}</View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <Text variant="caption" tone="muted">{inr(currentVal)} funded · {pct}%</Text>
              <Text variant="caption" tone="faint">expected {expPct}%</Text>
            </View>
          </Card>

          {banner ? <Banner text={banner} /> : null}

          {/* Three ways */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Three ways to reach this goal</Text>
            <Way label="Flat monthly SIP" value={`${inr(calc.requiredMonthlySipTotal)}/mo`} />
            {stepUp > 0 ? <Way label={`Step-up SIP start (+${stepUp}%/yr)`} value={`${inr(calc.requiredStepUpInitialSip)}/mo`} /> : null}
            <Way label="Lumpsum today" value={inr(calc.requiredLumpsumToday)} last />
            {calc.additionalMonthlySipNeeded > 0 ? (
              <Banner tone="warning" text={`Increase SIP by ${inr(calc.additionalMonthlySipNeeded)}/mo to stay on track (current ${inr(existingSip)}/mo).`} />
            ) : null}
            {calc.gapAmount > 0 ? (
              <Banner tone="danger" text={`Projected shortfall of ${inr(calc.gapAmount)} at the current plan.`} />
            ) : (
              <Banner tone="success" text="On track to meet this goal at the current plan." />
            )}
            <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
              Assumes {ret}% return · {infl}% inflation{stepUp > 0 ? ` · ${stepUp}% step-up` : ""} · glide {GLIDE_PATHS.find((x) => x.value === g.glidePath)?.label ?? "None"} · annuity-due (month-start).
            </Text>
            <Button label="Edit assumptions" variant="secondary" icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => setEditOpen(true)} style={{ marginTop: spacing.md }} />
          </Card>

          {/* Sensitivity */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>If returns are different</Text>
            <View style={styles.thead}>
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>Return</Text>
              <Text variant="caption" tone="faint" style={styles.tnum}>Req. SIP</Text>
              <Text variant="caption" tone="faint" style={styles.tnum}>Lumpsum</Text>
            </View>
            {sens.map((s) => (
              <View key={s.ratePct} style={styles.trow}>
                <Text variant="body" style={{ flex: 1, fontWeight: (s.ratePct === Math.round(ret) ? fontWeight.bold : fontWeight.regular) as any }}>{s.ratePct}%</Text>
                <Text variant="body" style={styles.tnum}>{inr(s.sip)}</Text>
                <Text variant="body" style={styles.tnum}>{inr(s.lumpsum)}</Text>
              </View>
            ))}
          </Card>

          {/* Year-by-year */}
          {years.length > 0 ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Year-by-year (at required SIP)</Text>
              <View style={styles.thead}>
                <Text variant="caption" tone="faint" style={{ width: 44 }}>Yr</Text>
                <Text variant="caption" tone="faint" style={styles.tnum}>SIP/mo</Text>
                <Text variant="caption" tone="faint" style={styles.tnum}>Corpus</Text>
              </View>
              {years.map((y) => (
                <View key={y.year} style={styles.trow}>
                  <Text variant="body" style={{ width: 44 }}>{y.year}</Text>
                  <Text variant="body" style={styles.tnum}>{inr(y.monthlySip)}</Text>
                  <Text variant="body" style={styles.tnum}>{inr(y.endOfYearCorpus)}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Linked investments */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text variant="subtitle">Linked investments</Text>
              <Pressable onPress={() => setLinkOpen(true)} hitSlop={8}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Manage</Text></Pressable>
            </View>
            <Text variant="caption" tone="muted">
              {(g.linkedFolios?.length ?? 0)} folio{(g.linkedFolios?.length ?? 0) === 1 ? "" : "s"} · {(g.linkedSips?.length ?? 0)} SIP{(g.linkedSips?.length ?? 0) === 1 ? "" : "s"} linked. Recompute pulls current value + SIP from them.
            </Text>
            <Button label="Recompute from linked" variant="secondary" loading={recompute.isPending} onPress={doRecompute} icon={<Feather name="refresh-cw" size={15} color={palette.ink} />} style={{ marginTop: spacing.md }} />
          </Card>

          {g.remarks ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">REMARKS</Text>
              <Text variant="body" style={{ marginTop: 4 }}>{g.remarks}</Text>
            </Card>
          ) : null}

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}><Button label="Share" variant="secondary" onPress={doShare} icon={<Feather name="message-circle" size={15} color={palette.ink} />} full /></View>
            <View style={{ flex: 1 }}><Button label="Archive" variant="danger" loading={del.isPending} onPress={doDelete} icon={<Feather name="archive" size={15} color="#fff" />} full /></View>
          </View>
        </Animated.View>
      </ScrollView>

      <EditGoalSheet visible={editOpen} onClose={() => setEditOpen(false)} id={id} goal={g} />
      <LinkInvestmentsSheet visible={linkOpen} onClose={() => setLinkOpen(false)} id={id} data={data} />
    </View>
  );
}

function Way({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.wayRow, !last && styles.divider]}>
      <Text variant="body" tone="muted" style={{ flex: 1 }}>{label}</Text>
      <Text variant="body" style={{ fontWeight: fontWeight.bold as any }}>{value}</Text>
    </View>
  );
}
function Banner({ text, tone }: { text: string; tone?: "success" | "warning" | "danger" }) {
  const bg = tone === "danger" ? palette.dangerBg : tone === "warning" ? palette.warningBg : tone === "success" ? palette.successBg : palette.infoBg;
  const fg = tone === "danger" ? palette.danger : tone === "warning" ? palette.warning : tone === "success" ? palette.success : palette.info;
  return <View style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}><Text variant="caption" style={{ color: fg }}>{text}</Text></View>;
}

// ── Edit assumptions ──
function EditGoalSheet({ visible, onClose, id, goal }: { visible: boolean; onClose: () => void; id: string; goal: Goal }) {
  const patch = usePatchGoal(id);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("future");
  const [amount, setAmount] = useState(""); // present (today) or future
  const [year, setYear] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [existingSip, setExistingSip] = useState("");
  const [ret, setRet] = useState("12");
  const [infl, setInfl] = useState("6");
  const [stepUp, setStepUp] = useState("0");
  const [glide, setGlide] = useState("none");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const m = goal.targetMode ?? "future";
    setName(goal.name ?? "");
    setMode(m);
    setAmount(String(m === "today" && goal.presentTargetAmount != null ? toNumber(goal.presentTargetAmount) : toNumber(goal.targetAmount)));
    setYear(String(new Date(goal.targetDate).getFullYear()));
    setCurrentValue(String(toNumber(goal.currentValue)));
    setExistingSip(String(toNumber(goal.existingMonthlySip ?? goal.monthlyContribution)));
    setRet(String(toNumber(goal.expectedReturn) || 12));
    setInfl(String(toNumber(goal.inflationPct) || 6));
    setStepUp(String(toNumber(goal.stepUpPct) || 0));
    setGlide(goal.glidePath ?? "none");
    setRemarks(goal.remarks ?? "");
    setErr(null);
  }, [visible]);

  const save = async () => {
    setErr(null);
    const yr = parseInt(year, 10);
    const amt = parseFloat(amount) || 0;
    if (!name.trim() || !amt || !yr) { setErr("Name, amount and year are required."); return; }
    const targetDate = `${yr}-12-31`;
    const yearsLeft = Math.max(0, monthsBetween(new Date(), new Date(targetDate))) / 12;
    const future = mode === "today" ? inflatedTarget(amt, parseFloat(infl) || 6, yearsLeft) : amt;
    const body: Record<string, any> = {
      name: name.trim(),
      targetAmount: Math.round(future),
      targetMode: mode,
      presentTargetAmount: mode === "today" ? amt : undefined,
      targetDate,
      inflationPct: parseFloat(infl) || 6,
      stepUpPct: parseFloat(stepUp) || 0,
      glidePath: glide,
      currentValue: parseFloat(currentValue) || 0,
      existingMonthlySip: parseFloat(existingSip) || 0,
      expectedReturnPct: parseFloat(ret) || 12,
      remarks: remarks || undefined,
    };
    try { await patch.mutateAsync(body); onClose(); } catch (e: any) { setErr(e?.message ?? "Could not save."); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit assumptions">
      <ScrollView style={{ maxHeight: 470 }} showsVerticalScrollIndicator={false}>
        <TextField label="Goal name" value={name} onChangeText={setName} />
        <SelectField label="Target value is…" value={mode} options={[{ value: "today", label: "Today's value (inflate to target date)" }, { value: "future", label: "Target-date value" }]} onChange={setMode} />
        <TextField label={mode === "today" ? "Target amount (today ₹)" : "Target amount (₹)"} value={amount} onChangeText={setAmount} keyboardType="numeric" />
        <TextField label="Target year" value={year} onChangeText={setYear} keyboardType="numeric" />
        <TextField label="Current investment (₹)" value={currentValue} onChangeText={setCurrentValue} keyboardType="numeric" />
        <TextField label="Existing monthly SIP (₹)" value={existingSip} onChangeText={setExistingSip} keyboardType="numeric" />
        <TextField label="Return % p.a." value={ret} onChangeText={setRet} keyboardType="numeric" />
        <TextField label="Inflation % p.a." value={infl} onChangeText={setInfl} keyboardType="numeric" />
        <TextField label="SIP step-up % / yr" value={stepUp} onChangeText={setStepUp} keyboardType="numeric" />
        <SelectField label="Glide path" value={glide} options={GLIDE_PATHS} onChange={setGlide} />
        <TextField label="Remarks" value={remarks} onChangeText={setRemarks} multiline />
        {err ? <Text variant="caption" tone="danger" style={{ marginBottom: spacing.sm }}>{err}</Text> : null}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label="Save" loading={patch.isPending} onPress={save} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

// ── Linked investments picker ──
function LinkInvestmentsSheet({ visible, onClose, id, data }: { visible: boolean; onClose: () => void; id: string; data: GoalFull }) {
  const patch = usePatchGoal(id);
  const [folios, setFolios] = useState<string[]>([]);
  const [sipIds, setSipIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (visible) { setFolios(data.goal.linkedFolios ?? []); setSipIds(data.goal.linkedSips ?? []); setErr(null); } }, [visible]);

  const toggleFolio = (fid: string) => setFolios((p) => p.includes(fid) ? p.filter((x) => x !== fid) : [...p, fid]);
  const toggleSip = (sid: string) => setSipIds((p) => p.includes(sid) ? p.filter((x) => x !== sid) : [...p, sid]);

  const save = async () => {
    setErr(null);
    const body = {
      linkedFolios: folios,
      linkedSips: sipIds,
      folioAllocations: folios.map((folioId) => ({ folioId, allocationPct: 100 })),
      sipAllocations: sipIds.map((sipId) => ({ sipId, allocationPct: 100 })),
    };
    try { await patch.mutateAsync(body); onClose(); } catch (e: any) { setErr(e?.message ?? "Could not save."); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Link investments">
      <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>FOLIOS</Text>
        {data.folios.length === 0 ? <Text variant="caption" tone="muted">No folios for this client.</Text> : data.folios.map((f: GoalFolio) => (
          <PickRow key={f.id} selected={folios.includes(f.id)} title={f.amcName || "Folio"} sub={`${f.folioNumber ?? ""} · ${inr(f.aum)}`} onToggle={() => toggleFolio(f.id)} />
        ))}
        <Text variant="label" tone="muted" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>ACTIVE SIPS</Text>
        {data.sips.length === 0 ? <Text variant="caption" tone="muted">No active SIPs for this client.</Text> : data.sips.map((s: GoalSip) => (
          <PickRow key={s.id} selected={sipIds.includes(s.id)} title={s.schemeName || s.amcName || "SIP"} sub={`${inr(s.amount)}/mo · ${s.frequency ?? "monthly"}`} onToggle={() => toggleSip(s.id)} />
        ))}
        {err ? <Text variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>{err}</Text> : null}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label="Save links" loading={patch.isPending} onPress={save} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}
function PickRow({ selected, title, sub, onToggle }: { selected: boolean; title: string; sub: string; onToggle: () => void }) {
  return (
    <Pressable style={styles.pickRow} onPress={onToggle}>
      <Feather name={selected ? "check-square" : "square"} size={18} color={selected ? palette.brand : palette.faint} />
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{title}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  icon: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: palette.violetBg, alignItems: "center", justifyContent: "center" },
  track: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden", marginTop: spacing.lg, position: "relative" },
  fill: { height: 8, borderRadius: 4, backgroundColor: palette.success },
  marker: { position: "absolute", top: -2, width: 2, height: 12, backgroundColor: palette.ink },
  wayRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  thead: { flexDirection: "row", paddingBottom: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  trow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  tnum: { width: 92, textAlign: "right" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
});
