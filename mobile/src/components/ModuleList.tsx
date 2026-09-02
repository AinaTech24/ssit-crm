/**
 * ModuleList — the generic list screen shared by most modules: header + count,
 * search, optional filter chips, virtualized cards, all states, and an optional
 * create FAB. A module supplies its data hook, a client-side filter, and a card
 * renderer; everything else is handled here.
 */

import React, { useState, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ScreenHeader } from "./ui/ScreenHeader";
import { SearchBar } from "./ui/SearchBar";
import { Chip } from "./ui/Chip";
import { FAB } from "./ui/FAB";
import { SkeletonList } from "./ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "./states";
import { palette, spacing } from "../theme/tokens";

type FeatherName = React.ComponentProps<typeof import("@expo/vector-icons").Feather>["name"];

export interface ModuleListProps<T extends { id: string }> {
  title: string;
  useData: () => { data?: T[]; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void; isRefetching: boolean };
  filterFn: (item: T, search: string, filter: string) => boolean;
  chips?: { key: string; label: string }[];
  renderCard: (item: T, open: () => void) => React.ReactNode;
  hrefFor: (item: T) => string;
  searchPlaceholder?: string;
  emptyIcon?: FeatherName;
  emptyTitle: string;
  emptyMessage?: string;
  createHref?: string;
  unit?: [string, string]; // [singular, plural] for the count subtitle
}

export function ModuleList<T extends { id: string }>({
  title,
  useData,
  filterFn,
  chips,
  renderCard,
  hrefFor,
  searchPlaceholder = "Search…",
  emptyIcon = "inbox",
  emptyTitle,
  emptyMessage,
  createHref,
  unit = ["item", "items"],
}: ModuleListProps<T>) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(chips?.[0]?.key ?? "");
  const { data, isLoading, isError, error, refetch, isRefetching } = useData();
  const items = useMemo(() => (data ?? []).filter((it) => filterFn(it, search, filter)), [data, search, filter]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder={searchPlaceholder} />
      {chips?.length ? (
        <View style={styles.chips}>
          {chips.map((c) => (
            <Chip key={c.key} label={c.label} selected={filter === c.key} onPress={() => setFilter(c.key)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={title} subtitle={isLoading ? undefined : `${items.length} ${items.length === 1 ? unit[0] : unit[1]}`} />
      {isLoading ? (
        <>
          {header}
          <SkeletonList count={7} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={refetch} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => <>{renderCard(item, () => router.push(hrefFor(item) as any))}</>}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: createHref ? 96 : 40 }}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={search ? <SearchEmptyState query={search} /> : <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />}
        />
      )}
      {createHref ? <FAB onPress={() => router.push(createHref as any)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
