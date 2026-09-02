/**
 * Generic module list. Reads the :module param, looks it up in the registry, and
 * renders ModuleList against its endpoint. Modules not yet in the registry show a
 * titled "coming up" placeholder (still capability-gated by the drawer).
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ModuleList } from "../../../../src/components/ModuleList";
import { GenericCard } from "../../../../src/components/domain/GenericCard";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { useModuleList } from "../../../../src/features/list";
import { REGISTRY, defaultFilter } from "../../../../src/features/registry";
import { MENU } from "../../../../src/navigation/menu";
import { palette } from "../../../../src/theme/tokens";
import { CalendarScreen } from "../../../../src/features/calendar/Calendar";
import { Billing } from "../../../../src/features/billing/Billing";
import { FirmProfile } from "../../../../src/features/firm/FirmProfile";
import { ProfileSettings } from "../../../../src/features/settings/ProfileSettings";
import { SecuritySettings } from "../../../../src/features/settings/SecuritySettings";
import { AppearanceSettings } from "../../../../src/features/settings/AppearanceSettings";
import { PreferencesSettings } from "../../../../src/features/settings/PreferencesSettings";
import { OrganisationSettings } from "../../../../src/features/settings/OrganisationSettings";
import { CustomFieldsSettings } from "../../../../src/features/settings/CustomFieldsSettings";
import { OnboardingFieldsSettings } from "../../../../src/features/settings/OnboardingFieldsSettings";
import { MastersHub, MasterTypeScreen } from "../../../../src/features/settings/MasterSettings";
import { DesksSettings } from "../../../../src/features/settings/DesksSettings";
import { IntegrationsSettings } from "../../../../src/features/settings/IntegrationsSettings";
import { EmailSettings } from "../../../../src/features/settings/EmailSettings";
import { WhatsAppSettings } from "../../../../src/features/settings/WhatsAppSettings";
import { TargetsSettings } from "../../../../src/features/settings/TargetsSettings";
import { AssignmentRulesSettings } from "../../../../src/features/settings/AssignmentRulesSettings";
import { NotificationTemplatesSettings } from "../../../../src/features/settings/NotificationTemplatesSettings";
import { RiskQuestionnaireSettings } from "../../../../src/features/settings/RiskQuestionnaireSettings";
import { BlueprintsHub, BlueprintEditor } from "../../../../src/features/settings/BlueprintSettings";
import { SettingsPlaceholder } from "../../../../src/features/settings/SettingsPlaceholder";

export default function GenericModuleList() {
  const { module } = useLocalSearchParams<{ module: string }>();

  // Bespoke screens (not registry list/detail): the Calendar module + the two
  // infra screens reached from Settings / the header profile menu.
  if (module === "calendar") return <CalendarScreen />;
  if (module === "billing") return <Billing />;
  if (module === "firm-profile") return <FirmProfile />;

  // Settings sub-pages (routed as /m/settings-<x> so they reuse this stack's
  // proper index anchor → clean one-press back to the Settings tab).
  if (module === "settings-profile") return <ProfileSettings />;
  if (module === "settings-security") return <SecuritySettings />;
  if (module === "settings-appearance") return <AppearanceSettings />;
  if (module === "settings-preferences") return <PreferencesSettings />;
  if (module === "settings-organisation") return <OrganisationSettings />;
  if (module === "settings-custom-fields") return <CustomFieldsSettings />;
  if (module === "settings-onboarding-fields") return <OnboardingFieldsSettings />;
  if (module === "settings-masters") return <MastersHub />;
  if (module?.startsWith("masters-")) return <MasterTypeScreen type={module.slice("masters-".length)} />;
  if (module === "settings-desks") return <DesksSettings />;
  if (module === "settings-integrations") return <IntegrationsSettings />;
  if (module === "settings-email") return <EmailSettings />;
  if (module === "settings-whatsapp") return <WhatsAppSettings />;
  if (module === "settings-targets") return <TargetsSettings />;
  if (module === "settings-assignment-rules") return <AssignmentRulesSettings />;
  if (module === "settings-notification-templates") return <NotificationTemplatesSettings />;
  if (module === "settings-risk-profile") return <RiskQuestionnaireSettings />;
  if (module === "settings-blueprints") return <BlueprintsHub />;
  if (module?.startsWith("blueprint-")) return <BlueprintEditor id={module.slice("blueprint-".length)} />;
  if (module?.startsWith("settings-")) return <SettingsPlaceholder sectionKey={module.slice("settings-".length)} />;

  const cfg = REGISTRY[module];

  if (!cfg) {
    const item = MENU.flatMap((g) => g.items).find((it) => it.key === module);
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title={item?.label ?? "Module"} />
        <EmptyState
          icon={(item?.icon as any) ?? "grid"}
          title={`${item?.label ?? "This module"} — coming up`}
          message="Its data already lives in your CRM; the native screen is next on the build list."
        />
      </View>
    );
  }

  return (
    <ModuleList<any>
      title={cfg.title}
      unit={cfg.unit}
      chips={cfg.chips}
      useData={() => useModuleList(module, cfg.endpoint, cfg.envelope)}
      filterFn={(item, q, f) => defaultFilter(cfg, item, q, f)}
      renderCard={(item, open) => {
        const c = cfg.card(item);
        return (
          <GenericCard
            icon={c.icon as any}
            iconTone={c.iconTone}
            title={c.title}
            subtitle={c.subtitle}
            badge={c.badge}
            badge2={c.badge2}
            rightLabel={c.rightLabel}
            rightValue={c.rightValue}
            onPress={open}
          />
        );
      }}
      hrefFor={(item) => `/m/${module}/${item.id}`}
      searchPlaceholder={cfg.searchPlaceholder}
      emptyIcon={cfg.emptyIcon as any}
      emptyTitle={cfg.emptyTitle ?? "Nothing here"}
      emptyMessage={cfg.emptyMessage}
    />
  );
}
