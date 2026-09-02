/**
 * Clients (Investors) list — web-parity: 8-KPI strip, debounced search, a full
 * filter+sort sheet (segment / category / tier / KYC / status / RM / date range +
 * 10 sort options), a virtualized infinite list of InvestorCards with row
 * actions (edit / delete), pull-to-refresh, and a create FAB.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { FAB } from "../../../../src/components/ui/FAB";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState, NetworkErrorState } from "../../../../src/components/states";
import { InvestorCard } from "../../../../src/components/domain/InvestorCard";
import { InvestorKpiStrip } from "../../../../src/features/investors/InvestorKpiStrip";
import { InvestorFilters, EMPTY_FILTERS, countActive, type UiFilters } from "../../../../src/features/investors/InvestorFilters";
import { useInvestors, flattenInvestors, useDeleteInvestor, type Investor } from "../../../../src/features/investors/api";
import { useTeam } from "../../../../src/features/team/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { ApiError } from "../../../../src/api/client";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function InvestorsList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<UiFilters>({ ...EMPTY_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rowAction, setRowAction] = useState<Investor | null>(null);
  const debounced = useDebounced(search);
  const del = useDeleteInvestor();

  const rmTeam = useTeam();
  const rmOptions = rmTeam.data?.rows ?? [];

  const apiFilters = useMemo(
    () => ({
      q: debounced,
      segment: filters.segment.join(","),
      category: filters.category.join(","),
      tier: filters.tier.join(","),
      kyc: filters.kyc.join(","),
      status: filters.status.join(","),
      rm: filters.rm.join(","),
      created_from: filters.created_from,
      created_to: filters.created_to,
      sort: filters.sort,
      dir: filters.dir,
    }),
    [debounced, filters]
  );

  const query = useInvestors(apiFilters);
  const { rows, total } = flattenInvestors(query.data);
  const activeCount = countActive(filters);

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [query]);

  const doDelete = (inv: Investor) => {
    setRowAction(null);
    confirmDelete(
      { title: `Delete ${inv.name}?`, message: "The client moves to Trash and can be restored within 30 days.", confirmLabel: "Delete" },
      () => del.mutate(inv.id)
    );
  };

  const header = (
    <View style={styles.controls}>
      <InvestorKpiStrip />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, PAN, phone…" />
      <View style={styles.toolbar}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>
            Filter & sort{activeCount ? ` · ${activeCount}` : ""}
          </Text>
        </Pressable>
        {activeCount > 0 ? (
          <Pressable onPress={() => setFilters({ ...EMPTY_FILTERS })} hitSlop={8}>
            <Text variant="caption" style={{ color: palette.danger }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const renderBody = () => {
    if (query.isLoading) {
      return (<><View style={{ paddingHorizontal: spacing.lg }}>{header}</View><SkeletonList count={6} /></>);
    }
    if (query.isError) {
      const net = query.error instanceof ApiError && query.error.kind !== "http";
      return net ? <NetworkErrorState onRetry={() => query.refetch()} /> : <ErrorState message={(query.error as any)?.message} onRetry={() => query.refetch()} />;
    }
    return (
      <FlashList
        data={rows}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <InvestorCard
            investor={item}
            onPress={() => router.push(`/m/investors/${item.id}`)}
            onLongPress={() => setRowAction(item)}
          />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
        ListEmptyComponent={
          debounced || activeCount ? (
            <SearchEmptyState query={debounced || "these filters"} />
          ) : (
            <EmptyState icon="users" title="No clients yet" message="Add your first client to get started." actionLabel="Add client" onAction={() => router.push("/m/investors/new" as any)} />
          )
        }
        ListFooterComponent={query.isFetchingNextPage ? <SkeletonList count={2} /> : null}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Clients" subtitle={query.isLoading ? undefined : `${total} client${total === 1 ? "" : "s"}`} />
      <View style={{ flex: 1 }}>{renderBody()}</View>
      <FAB onPress={() => router.push("/m/investors/new" as any)} />

      <InvestorFilters
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        value={filters}
        onApply={setFilters}
        rmOptions={rmOptions}
      />

      <BottomSheet visible={!!rowAction} onClose={() => setRowAction(null)} title={rowAction?.name ?? "Client"}>
        <Button
          label="Edit client"
          variant="secondary"
          full
          icon={<Feather name="edit-2" size={15} color={palette.ink} />}
          onPress={() => { const id = rowAction?.id; setRowAction(null); if (id) router.push(`/m/investors/new?editId=${id}` as any); }}
          style={{ marginBottom: spacing.sm }}
        />
        <Button
          label="Delete client"
          variant="danger"
          full
          loading={del.isPending}
          icon={<Feather name="trash-2" size={15} color="#fff" />}
          onPress={() => rowAction && doDelete(rowAction)}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
