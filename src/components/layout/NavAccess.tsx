"use client";

/**
 * Which gated sidebar items THIS person cannot open, available to client
 * components that draw links of their own — the Tasks / Service Requests /
 * Complaints switcher, the My Day tabs, the SIP and Insurance tab bars.
 *
 * Those used to list every view whatever the person had been granted, so
 * clicking one the admin had not ticked landed on the "no access" screen: the
 * page looked broken. Now a view the person cannot open is simply not offered.
 *
 * The server stays the authority (the layout still blocks the route); this only
 * stops the UI offering doors that are locked.
 */

import { createContext, useContext, type ReactNode } from "react";
import { gatedNavKeyForPath } from "@/config/nav-access";

const BlockedContext = createContext<ReadonlySet<string>>(new Set());

export function NavAccessProvider({ blocked, children }: { blocked: string[]; children: ReactNode }) {
  return <BlockedContext.Provider value={new Set(blocked)}>{children}</BlockedContext.Provider>;
}

/** Can this person open `href`? Un-gated routes (core pages) always can. */
export function useNavAllowed(): (href: string) => boolean {
  const blocked = useContext(BlockedContext);
  return (href: string) => {
    const key = gatedNavKeyForPath(href);
    return key === null || !blocked.has(key);
  };
}
