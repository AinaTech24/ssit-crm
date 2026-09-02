/**
 * Connectivity — a best-effort "are we online?" flag, driven by the API client:
 * a request that fails with a network/timeout error flips it offline; any
 * successful request flips it back online. No NetInfo dependency needed.
 */

import { create } from "zustand";

interface ConnectivityState {
  online: boolean;
  setOnline: (v: boolean) => void;
}

export const useConnectivity = create<ConnectivityState>((set, get) => ({
  online: true,
  setOnline: (v) => { if (get().online !== v) set({ online: v }); },
}));
