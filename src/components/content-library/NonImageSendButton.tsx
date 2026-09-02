"use client";

import { useState } from "react";
import { Send, Users } from "lucide-react";
import { SendToClientDrawer } from "./SendToClientDrawer";
import { BulkSendDrawer } from "./BulkSendDrawer";

export function NonImageSendButton({
  assetId,
  assetTitle,
  assetType,
  assetFileUrl,
}: {
  assetId: string;
  assetTitle: string;
  assetType: string;
  assetFileUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-secondary hover:bg-secondary/80 border text-secondary-foreground px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
      >
        <Send className="size-4" /> Send to Client
      </button>
      <button
        type="button"
        onClick={() => setBulkOpen(true)}
        className="rounded-md bg-secondary hover:bg-secondary/80 border text-secondary-foreground px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
      >
        <Users className="size-4" /> Send to many
      </button>
      <SendToClientDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        assetId={assetId}
        assetTitle={assetTitle}
        assetType={assetType}
        assetFileUrl={assetFileUrl}
      />
      <BulkSendDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        assetId={assetId}
        assetType={assetType}
      />
    </>
  );
}
