/**
 * Global search — the "find this person fast" screen. Reachable from the search
 * icon in every tab header.
 *
 * Empty query shows recently-viewed (the people you're most likely to want).
 * Results group by Clients / Leads / Folios / SIPs; folios and SIPs open their
 * owning client. Every row offers call + WhatsApp inline, because searching for
 * a client on a phone is almost always a prelude to ringing them.
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../src/components/ui/Screen";
import { Card } from "../../src/components/ui/Card";
import { Text } from "../../src/components/ui/Text";
import { SearchBar } from "../../src/components/ui/SearchBar";
import { StatusPill } from "../../src/components/ui/StatusPill";
import { useSearch, countResults, MIN_QUERY, type SearchInvestor, type SearchLead, type SearchFolio, type SearchSip } from "../../src/features/search/api";
import { useRecentlyViewed } from "../../src/state/recentlyViewed";
import { startCall } from "../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../src/features/activities/whatsapp";
import { inr, initials, titleCase } from "../../src/lib/format";
import { spacing, palette, radius, fontWeight, TOUCH_MIN } from "../../src/theme/tokens";

/** Opens WhatsApp and records the touch on the client's timeline. */
const openWa = (phone: string | null | undefined, subject?: { type: "investor" | "lead"; id: string; name?: string | null }) =>
  openWhatsApp({ phone, subjectType: subject?.type, subjectId: subject?.id, name: subject?.name });
const money = (v: string | number | null | undefined) => { const n = Number(v ?? 0); return isFinite(n) && n > 0 ? inr(n) : null; };

export default function GlobalSearch() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = React.useState("");
  const [q, setQ] = React.useState("");
  const recent = useRecentlyViewed((s) => s.items);

  // Debounce: a phone keyboard fires fast, and each keystroke is 6 SQL queries.
  React.useEffect(() => {
    const t = setTimeout(() => setQ(raw), 250);
    return () => clearTimeout(t);
  }, [raw]);

  const search = useSearch(q);
  const r = search.data;
  const term = q.trim();
  const searching = term.length >= MIN_QUERY;
  const total = countResults(r);
  const openInvestor = (id: string) => router.push(`/m/investors/${id}` as any);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      {/* Header: back + live search field */}
      <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={palette.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SearchBar value={raw} onChangeText={setRaw} placeholder="Name, phone, PAN, folio…" autoFocus />
        </View>
      </View>

      <Screen scroll padded contentStyle={{ paddingTop: spacing.md, paddingBottom: spacing["3xl"] }}>
        {!searching ? (
          recent.length > 0 ? (
            <>
              <SectionLabel text="RECENTLY VIEWED" />
              <Card flat style={{ padding: 0, overflow: "hidden" }}>
                {recent.map((it, i) => (
                  <Pressable
                    key={`${it.type}-${it.id}`}
                    style={[styles.row, i < recent.length - 1 && styles.divider]}
                    onPress={() => router.push(`/m/${it.type === "investor" ? "investors" : "leads"}/${it.id}` as any)}
                  >
                    <Avatar name={it.name} tone={it.type === "investor" ? palette.violet : palette.brand} />
                    <Text variant="body" style={{ flex: 1, color: palette.ink }} numberOfLines={1}>{it.name}</Text>
                    <Text variant="caption" tone="faint">{it.type === "investor" ? "Client" : "Lead"}</Text>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : (
            <Hint icon="search" text="Search clients, leads, folios and SIPs by name, phone, PAN or folio number." />
          )
        ) : search.isLoading ? (
          <View style={{ paddingTop: spacing["2xl"], alignItems: "center" }}><ActivityIndicator color={palette.brand} /></View>
        ) : total === 0 ? (
          <Hint icon="search" text={`No matches for "${term}".`} />
        ) : (
          <>
            {(r?.investors.length ?? 0) > 0 ? (
              <Group title={`Clients (${r!.investors.length})`}>
                {r!.investors.map((it, i) => (
                  <InvestorRow key={it.id} it={it} last={i === r!.investors.length - 1} onOpen={() => openInvestor(it.id)} />
                ))}
              </Group>
            ) : null}

            {(r?.leads.length ?? 0) > 0 ? (
              <Group title={`Leads (${r!.leads.length})`}>
                {r!.leads.map((it, i) => (
                  <LeadRow key={it.id} it={it} last={i === r!.leads.length - 1} onOpen={() => router.push(`/m/leads/${it.id}` as any)} />
                ))}
              </Group>
            ) : null}

            {(r?.folios.length ?? 0) > 0 ? (
              <Group title={`Folios (${r!.folios.length})`}>
                {r!.folios.map((it, i) => <FolioRow key={it.id} it={it} last={i === r!.folios.length - 1} onOpen={() => it.investor_id && openInvestor(it.investor_id)} />)}
              </Group>
            ) : null}

            {(r?.sips.length ?? 0) > 0 ? (
              <Group title={`SIPs (${r!.sips.length})`}>
                {r!.sips.map((it, i) => <SipRow key={it.id} it={it} last={i === r!.sips.length - 1} onOpen={() => it.investor_id && openInvestor(it.investor_id)} />)}
              </Group>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}

// ── Rows ──
function InvestorRow({ it, last, onOpen }: { it: SearchInvestor; last: boolean; onOpen: () => void }) {
  const sub = [it.pan, it.phone].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Avatar name={it.name} tone={palette.violet} />
      <Pressable style={{ flex: 1 }} onPress={onOpen}>
        <Text variant="body" numberOfLines={1}>{it.name}</Text>
        {sub ? <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text> : null}
      </Pressable>
      {it.segment_tag ? <StatusPill label={titleCase(it.segment_tag)} tone="neutral" size="sm" dot={false} /> : null}
      <Actions phone={it.phone} onCall={() => startCall({ subjectType: "investor", subjectId: it.id, name: it.name, phone: it.phone ?? "" })} onOpen={onOpen} subject={{ type: "investor", id: it.id, name: it.name }} />
    </View>
  );
}

function LeadRow({ it, last, onOpen }: { it: SearchLead; last: boolean; onOpen: () => void }) {
  const sub = [it.stage ? titleCase(it.stage) : null, it.phone].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Avatar name={it.name} tone={palette.brand} />
      <Pressable style={{ flex: 1 }} onPress={onOpen}>
        <Text variant="body" numberOfLines={1}>{it.name}</Text>
        {sub ? <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text> : null}
      </Pressable>
      <Actions phone={it.phone} onCall={() => startCall({ subjectType: "lead", subjectId: it.id, name: it.name, phone: it.phone ?? "" })} onOpen={onOpen} subject={{ type: "lead", id: it.id, name: it.name }} />
    </View>
  );
}

function FolioRow({ it, last, onOpen }: { it: SearchFolio; last: boolean; onOpen: () => void }) {
  const aum = money(it.aum);
  return (
    <Pressable style={[styles.row, !last && styles.divider]} onPress={onOpen}>
      <View style={[styles.iconCircle, { backgroundColor: palette.brandLight }]}><Feather name="folder" size={15} color={palette.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{it.folio_number}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{[it.investor_name, it.amc_name].filter(Boolean).join(" · ") || "—"}</Text>
      </View>
      {aum ? <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any }}>{aum}</Text> : null}
      <Feather name="chevron-right" size={16} color={palette.faint} />
    </Pressable>
  );
}

function SipRow({ it, last, onOpen }: { it: SearchSip; last: boolean; onOpen: () => void }) {
  const amt = money(it.amount);
  return (
    <Pressable style={[styles.row, !last && styles.divider]} onPress={onOpen}>
      <View style={[styles.iconCircle, { backgroundColor: palette.successBg }]}><Feather name="repeat" size={15} color={palette.success} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{it.scheme_name ?? "SIP"}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{[it.investor_name, it.status ? titleCase(it.status) : null].filter(Boolean).join(" · ") || "—"}</Text>
      </View>
      {amt ? <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any }}>{amt}</Text> : null}
      <Feather name="chevron-right" size={16} color={palette.faint} />
    </Pressable>
  );
}

// ── Bits ──
function Actions({ phone, onCall, onOpen, subject }: { phone?: string | null; onCall: () => void; onOpen: () => void; subject?: { type: "investor" | "lead"; id: string; name?: string | null } }) {
  if (!phone) return <Pressable onPress={onOpen} hitSlop={6}><Feather name="chevron-right" size={16} color={palette.faint} /></Pressable>;
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <Pressable onPress={onCall} hitSlop={6} style={styles.iconBtn}><Feather name="phone" size={15} color={palette.brand} /></Pressable>
      <Pressable onPress={() => openWa(phone, subject)} hitSlop={6} style={styles.iconBtn}><Feather name="message-circle" size={15} color={palette.success} /></Pressable>
    </View>
  );
}
function Avatar({ name, tone }: { name: string; tone: string }) {
  return <View style={[styles.avatar, { backgroundColor: tone }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{initials(name)}</Text></View>;
}
function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginBottom: spacing.sm }}>{text}</Text>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SectionLabel text={title.toUpperCase()} />
      <Card flat style={{ padding: 0, overflow: "hidden", marginBottom: spacing.lg }}>{children}</Card>
    </>
  );
}
function Hint({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ alignItems: "center", paddingTop: spacing["2xl"], gap: spacing.md }}>
      <View style={[styles.iconCircle, { width: 48, height: 48, backgroundColor: palette.surfaceSunken }]}><Feather name={icon as any} size={20} color={palette.faint} /></View>
      <Text variant="body" tone="muted" style={{ textAlign: "center" }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: palette.surface },
  backBtn: { width: TOUCH_MIN, height: TOUCH_MIN, justifyContent: "center", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  avatar: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconCircle: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
});
