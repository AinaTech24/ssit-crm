/**
 * Call-intent store — powers semi-automatic call logging. When the user taps a
 * "Call" button anywhere, we "arm" a pending intent (who + phone + when) and open
 * the dialer. A top-level CallLogPrompt watches AppState; when the app returns to
 * the foreground after a real call, it prompts to log the call with the subject
 * pre-filled. (Fully-automatic OS call-log reading needs a custom dev build +
 * READ_CALL_LOG; this is the Expo-Go-friendly equivalent.)
 */

import { create } from "zustand";

export interface CallIntent {
  subjectType: "investor" | "lead";
  subjectId: string;
  name: string;
  phone: string;
  armedAt: number; // epoch ms when the call was initiated
}

interface CallIntentState {
  pending: CallIntent | null;
  arm: (i: Omit<CallIntent, "armedAt">) => void;
  clear: () => void;
}

export const useCallIntent = create<CallIntentState>((set) => ({
  pending: null,
  arm: (i) => set({ pending: { ...i, armedAt: Date.now() } }),
  clear: () => set({ pending: null }),
}));
