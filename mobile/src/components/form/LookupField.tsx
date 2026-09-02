/**
 * LookupField — a SelectField whose options are fetched from an endpoint
 * (e.g. /api/employees?role=rm → { rows }). The native equivalent of the web
 * RmSelector and other "assign to / pick a record" dropdowns.
 */

import React from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { palette, spacing } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { SelectField } from "../ui/SelectField";
import type { FieldSpec, Option } from "../../features/forms/types";

export function LookupField({
  field,
  value,
  onChange,
  form,
}: {
  field: FieldSpec;
  value: string | null;
  onChange: (v: string) => void;
  form?: Record<string, any>;
}) {
  const endpoint = field.lookupEndpoint!;
  const envelope = field.lookupEnvelope ?? "rows";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lookup", endpoint],
    queryFn: () => api.get<any>(endpoint),
    staleTime: 60_000,
  });

  let rows: any[] = (data && (data[envelope] ?? data)) || [];
  if (field.lookupFilter) rows = rows.filter((r) => field.lookupFilter!(r, form ?? {}));
  const options: Option[] = rows.map((r) => ({
    value: field.lookupValue ? field.lookupValue(r) : String(r.id),
    label: field.lookupLabel ? field.lookupLabel(r) : r.name ?? r.title ?? String(r.id),
  }));
  const withClear: Option[] = [
    { value: "", label: field.placeholder ?? "— None —" },
    ...options,
  ];

  if (isLoading) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {field.label}
        </Text>
        <Text tone="muted" variant="body">
          Loading…
        </Text>
      </View>
    );
  }
  if (isError) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {field.label}
        </Text>
        <Text tone="danger" variant="caption" style={{ color: palette.danger }}>
          Couldn't load options
        </Text>
      </View>
    );
  }

  return (
    <SelectField
      label={field.label}
      value={value ?? ""}
      options={withClear}
      onChange={onChange}
      placeholder={field.placeholder}
      required={field.required}
    />
  );
}
