/**
 * FormScreen — renders a FormSpec as a native create/edit form: grouped
 * sections, per-field validation, a sticky action bar, and the exact same POST
 * payload the web CRM sends. One generic screen drives every module's form.
 *
 * Supports two shapes:
 *   - single-page (spec.sections) — everything on one scroll
 *   - wizard (spec.steps) — a stepper with Back/Next; submit on the last step
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import { LoadingState, ErrorState } from "../states";
import { FieldRenderer } from "./FieldRenderer";
import { api, ApiError } from "../../api/client";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import type { FormSpec, FormValues, SectionSpec } from "../../features/forms/types";

export function FormScreen({ spec }: { spec: FormSpec }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const rawParams = useLocalSearchParams();
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams)) p[k] = Array.isArray(v) ? v[0] : String(v ?? "");
    return p;
  }, [rawParams]);

  // Normalize to a list of steps. Single-page specs become one implicit step.
  const steps = useMemo(
    () => spec.steps ?? [{ title: spec.title, sections: spec.sections ?? [] }],
    [spec]
  );
  const isWizard = !!spec.steps;

  // Edit mode: ?editId=<id> + spec.editInitial. Fetch the record and prefill.
  const editId = (params.editId || "").trim() || null;
  const isEdit = !!editId && !!spec.editInitial;
  const editQ = useQuery({
    queryKey: ["form-record", spec.endpoint, editId],
    enabled: isEdit,
    queryFn: () => api.get<any>(`${spec.endpoint}/${editId}`),
  });

  const [form, setForm] = useState<FormValues>(() =>
    typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial }
  );
  const [hydrated, setHydrated] = useState(!isEdit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  // RM double-booking (409 rm_conflict) → surface the clash + "Schedule anyway".
  const [conflicts, setConflicts] = useState<any[] | null>(null);

  // Once the edit record loads, hydrate the form from it (once).
  useEffect(() => {
    if (!isEdit || hydrated || !editQ.data || !spec.editInitial) return;
    const rec = spec.editRecordEnvelope ? editQ.data[spec.editRecordEnvelope] : editQ.data;
    if (!rec) return;
    const base = typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial };
    let next = { ...base, ...spec.editInitial(rec, params) };
    if (spec.derive) {
      const d = spec.derive(next);
      if (d) next = { ...next, ...d };
    }
    setForm(next);
    setHydrated(true);
  }, [isEdit, hydrated, editQ.data]);

  const setField = (key: string, value: any) => {
    setForm((s) => {
      let next = { ...s, [key]: value };
      if (spec.derive) {
        const d = spec.derive(next);
        if (d) next = { ...next, ...d };
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  };

  // Field keys that are actually visible in the given sections (respects visibleIf).
  const visibleKeysIn = (sections: SectionSpec[]): string[] =>
    sections.flatMap((s) => s.fields.filter((f) => !f.visibleIf || f.visibleIf(form)).map((f) => f.key));

  const goNext = () => {
    setBanner(null);
    const errs = spec.validate?.(form) ?? null;
    if (errs) {
      // Only block on errors for fields on THIS step.
      const stepKeys = new Set(visibleKeysIn(steps[step].sections));
      const stepErrs = Object.fromEntries(Object.entries(errs).filter(([k]) => stepKeys.has(k)));
      const msgs = Object.values(stepErrs);
      if (msgs.length) {
        setErrors(stepErrs);
        setBanner(msgs[0] || "Please fix the highlighted fields.");
        return;
      }
    }
    setErrors({});
    Haptics.selectionAsync().catch(() => {});
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const goBack = () => {
    setBanner(null);
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const submit = async (opts?: { force?: boolean }) => {
    setBanner(null);
    if (!opts?.force) {
      const errs = spec.validate?.(form) ?? null;
      if (errs && Object.keys(errs).length) {
        setErrors(errs);
        // Jump the user to the first step that has an error.
        if (isWizard) {
          const badStep = steps.findIndex((st) =>
            visibleKeysIn(st.sections).some((k) => errs[k])
          );
          if (badStep >= 0 && badStep !== step) setStep(badStep);
        }
        setBanner(Object.values(errs)[0] || "Please fix the highlighted fields.");
        return;
      }
    }
    setErrors({});
    setConflicts(null);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const body = spec.buildBody(form, params);
      const finalBody = opts?.force ? { ...body, force: true } : body;
      const json = isEdit
        ? await api.patch<any>(`${spec.endpoint}/${editId}`, finalBody)
        : await api.post<any>(spec.endpoint, finalBody);
      for (const key of spec.invalidate ?? []) qc.invalidateQueries({ queryKey: [key] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (isEdit) {
        // Refresh the detail screen we're returning to.
        qc.invalidateQueries();
        router.back();
        return;
      }
      if (spec.afterCreate) {
        await spec.afterCreate(json, form, { router, params, post: api.post });
        return;
      }
      const target = spec.redirect?.(json, form, params) ?? null;
      if (target) router.replace(target as any);
      else router.back();
    } catch (e) {
      // RM double-booking — offer "Schedule anyway" (re-submits with force:true).
      if (e instanceof ApiError && e.status === 409 && e.body?.error === "rm_conflict") {
        setConflicts(Array.isArray(e.body.conflicts) ? e.body.conflicts : []);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      const msg = e instanceof ApiError ? e.message : "Could not save. Please try again.";
      setBanner(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const headerTitle = isEdit ? spec.editTitle ?? "Edit" : spec.title;
  const submitText = isEdit ? "Save changes" : spec.submitLabel;

  // In edit mode, wait for the record before rendering the form (avoids a flash
  // of empty fields then a jump when values arrive).
  if (isEdit && !hydrated) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={headerTitle} onBack={() => router.back()} />
        {editQ.isError ? <ErrorState onRetry={editQ.refetch} /> : <LoadingState label="Loading…" />}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={headerTitle} onBack={() => router.back()} />

      {isWizard ? (
        <View style={styles.stepper}>
          <Text variant="caption" tone="muted">
            Step {step + 1} of {steps.length}
          </Text>
          <Text variant="subtitle" style={{ marginTop: 2 }}>
            {current.title}
          </Text>
          {current.description ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {current.description}
            </Text>
          ) : null}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {current.sections
            .filter((section) => (!section.visibleIf || section.visibleIf(form)) && section.fields.some((f) => !f.visibleIf || f.visibleIf(form)))
            .map((section, si) => (
            <View key={si} style={styles.section}>
              {section.title ? <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text> : null}
              {section.fields
                .filter((f) => !f.visibleIf || f.visibleIf(form))
                .map((f) => (
                  <FieldRenderer
                    key={f.key}
                    field={f}
                    value={form[f.key]}
                    error={errors[f.key]}
                    onChange={(v) => setField(f.key, v)}
                    form={form}
                  />
                ))}
            </View>
          ))}

          {banner ? (
            <Text variant="body" tone="danger" center style={{ marginTop: spacing.sm, color: palette.danger }}>
              {banner}
            </Text>
          ) : null}
        </ScrollView>

        <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          {isWizard && step > 0 ? (
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button label="Back" variant="secondary" onPress={goBack} full />
              </View>
              <View style={{ flex: 2 }}>
                {isLast ? (
                  <Button label={submitText} onPress={submit} loading={busy} full />
                ) : (
                  <Button label="Next" onPress={goNext} full />
                )}
              </View>
            </View>
          ) : isWizard && !isLast ? (
            <Button label="Next" onPress={goNext} full />
          ) : (
            <Button label={submitText} onPress={submit} loading={busy} full />
          )}
        </View>
      </KeyboardAvoidingView>

      {/* RM double-booking clash → confirm "Schedule anyway". */}
      <BottomSheet visible={!!conflicts} onClose={() => setConflicts(null)} title="RM already booked">
        <Text variant="body" tone="muted" style={{ marginBottom: spacing.md }}>
          This RM has {conflicts?.length === 1 ? "an overlapping meeting" : `${conflicts?.length ?? 0} overlapping meetings`} at that time:
        </Text>
        {(conflicts ?? []).map((c: any, i: number) => (
          <View key={c.id ?? i} style={styles.conflictRow}>
            <Text variant="body" numberOfLines={1}>{c.subject || (c.meeting_type ? String(c.meeting_type).replace(/_/g, " ") : "Meeting")}{c.name ? ` · ${c.name}` : ""}</Text>
            {c.meeting_date ? (
              <Text variant="caption" tone="muted">
                {new Date(c.meeting_date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {c.duration_minutes ? ` · ${c.duration_minutes} min` : ""}
              </Text>
            ) : null}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
          <Button label="Go back" variant="secondary" onPress={() => setConflicts(null)} style={{ flex: 1 }} />
          <Button label="Schedule anyway" loading={busy} onPress={() => submit({ force: true })} style={{ flex: 1 }} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  stepper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceSunken,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.brand },
  section: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as any,
    letterSpacing: 0.6,
    color: palette.muted,
    marginBottom: spacing.md,
  },
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  conflictRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
    gap: 2,
  },
});
