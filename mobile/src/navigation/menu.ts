/**
 * The drawer ("sidebar") information architecture, as data.
 *
 * The app is deliberately focused on a small set of modules. Bottom tabs are
 * Home (dashboard) · Tasks · Settings; every other kept module lives here,
 * grouped and capability-gated (mirrors the server's `can()` matrix).
 */

import { type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

type FeatherName = ComponentProps<typeof Feather>["name"];

export interface MenuItem {
  key: string;
  label: string;
  icon: FeatherName;
  route: string;
  /** Visible if the user has ANY of these caps. Empty = always visible. */
  anyCap?: string[];
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: "Overview",
    items: [
      { key: "daily", label: "Daily Plan", icon: "sun", route: "/m/daily" },
      { key: "attendance", label: "Attendance", icon: "clock", route: "/m/attendance" },
      { key: "review", label: "Monthly Review", icon: "clipboard", route: "/m/review" },
      { key: "business", label: "Business", icon: "bar-chart-2", route: "/m/business", anyCap: ["dashboard.view.owner", "reports.business", "reports.manage"] },
    ],
  },
  {
    title: "Clients",
    items: [
      { key: "investors", label: "Clients", icon: "users", route: "/m/investors", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "goals", label: "Goal Planning", icon: "target", route: "/m/goals", anyCap: ["goal.manage"] },
    ],
  },
  {
    title: "Sales Tools",
    items: [
      { key: "calculators", label: "Calculators", icon: "sliders", route: "/m/calculators" },
      { key: "proposals", label: "Proposals", icon: "file-text", route: "/m/proposals", anyCap: ["proposal.view"] },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { key: "leads", label: "Leads", icon: "trending-up", route: "/m/leads", anyCap: ["lead.view.all", "lead.view.assigned"] },
      { key: "activities", label: "Calls", icon: "phone-call", route: "/m/activities" },
    ],
  },
  {
    title: "Servicing",
    items: [
      { key: "sips", label: "SIP Tracker", icon: "repeat", route: "/m/sips" },
      { key: "service-requests", label: "Service Requests", icon: "life-buoy", route: "/m/service-requests" },
    ],
  },
  {
    title: "Schedule",
    items: [
      { key: "calendar", label: "Calendar", icon: "calendar", route: "/m/calendar" },
      { key: "review-meetings", label: "Meetings", icon: "video", route: "/m/review-meetings", anyCap: ["review_meeting.manage.all", "review_meeting.manage.assigned"] },
    ],
  },
];
