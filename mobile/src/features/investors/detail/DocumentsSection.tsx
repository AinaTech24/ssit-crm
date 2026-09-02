/**
 * Documents section — lists a client's documents and lets the RM upload new ones
 * (photo or file), open them (presigned URL), and delete them. Parity with the
 * web InvestorDocumentsSection.
 */

import React, { useState } from "react";
import { View, Pressable, Linking, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { BottomSheet } from "../../../components/ui/BottomSheet";
import { Section, Empty } from "./primitives";
import { confirmDelete } from "../../../lib/confirm";
import { fmtDate, titleCase } from "../../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useDocuments, useUploadDocument, useDeleteDocument, getDocumentUrl } from "./subfeatures";

const iconFor = (mime?: string | null) => (!mime ? "file" : mime.includes("pdf") ? "file-text" : mime.startsWith("image/") ? "image" : "file");
const kb = (b?: string | null) => (b ? `${Math.max(1, Math.round(Number(b) / 1024))} KB` : "");

export function DocumentsSection({ id, clientName }: { id: string; clientName?: string }) {
  const { data } = useDocuments(id);
  const upload = useUploadDocument(id);
  const del = useDeleteDocument(id);
  const [pick, setPick] = useState(false);
  const docs = data?.documents ?? [];

  const doUpload = async (asset: { uri: string; name: string; mime: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    upload.mutate({ ...asset, category: "other", clientName });
  };

  const pickPhoto = async () => {
    setPick(false);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.85 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      doUpload({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mime: a.mimeType ?? "image/jpeg" });
    }
  };
  const pickFile = async () => {
    setPick(false);
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets?.[0]) {
      const a = r.assets[0];
      doUpload({ uri: a.uri, name: a.name, mime: a.mimeType ?? "application/octet-stream" });
    }
  };
  const openDoc = async (docId: string) => {
    try { const url = await getDocumentUrl(id, docId, true); Linking.openURL(url); } catch {}
  };
  const removeDoc = (docId: string, name: string) => {
    confirmDelete({ title: `Delete “${name}”?`, message: "This removes the document from the client record.", confirmLabel: "Delete" }, () => del.mutate(docId));
  };

  return (
    <Section title="Documents" icon="paperclip" right={<Pressable onPress={() => setPick(true)} hitSlop={8}><Feather name="upload" size={16} color={palette.brand} /></Pressable>}>
      {upload.isPending ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.xs }}>Uploading…</Text> : null}
      {docs.length === 0 ? <Empty text="No documents. Tap upload to add KYC / statements / forms." /> : docs.map((doc) => (
        <Pressable key={doc.id} style={styles.row} onPress={() => openDoc(doc.id)} onLongPress={() => removeDoc(doc.id, doc.name)}>
          <Feather name={iconFor(doc.mimeType) as any} size={16} color={palette.brand} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{doc.name}</Text>
            <Text variant="caption" tone="faint">{[titleCase(doc.category), kb(doc.sizeBytes), fmtDate(doc.createdAt)].filter(Boolean).join(" · ")}</Text>
          </View>
          <Feather name="external-link" size={14} color={palette.faint} />
        </Pressable>
      ))}

      <BottomSheet visible={pick} onClose={() => setPick(false)} title="Upload document">
        <Button label="Photo from library" variant="secondary" full icon={<Feather name="image" size={15} color={palette.ink} />} onPress={pickPhoto} style={{ marginBottom: spacing.sm }} />
        <Button label="File (PDF / doc / sheet)" variant="secondary" full icon={<Feather name="file" size={15} color={palette.ink} />} onPress={pickFile} />
      </BottomSheet>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
});
