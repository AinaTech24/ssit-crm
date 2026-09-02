/**
 * Generic module create form. Reads the :module param, looks up its FormSpec in
 * the forms registry, and renders a FormScreen — the same create form as the web
 * CRM. Modules without a spec yet show a titled placeholder.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { getForm } from "../../../../src/features/forms";
import { MENU } from "../../../../src/navigation/menu";
import { palette } from "../../../../src/theme/tokens";

export default function GenericModuleNew() {
  const { module } = useLocalSearchParams<{ module: string }>();

  const spec = getForm(module);

  if (!spec) {
    const item = MENU.flatMap((g) => g.items).find((it) => it.key === module);
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title={item?.label ? `New ${item.label}` : "New"} />
        <EmptyState
          icon="edit-3"
          title="Form coming up"
          message="This module's create form is next on the build list."
        />
      </View>
    );
  }

  return <FormScreen spec={spec} />;
}
