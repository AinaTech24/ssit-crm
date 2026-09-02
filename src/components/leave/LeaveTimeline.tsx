"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays, HelpCircle } from "lucide-react";
import { LEAVE_TYPE_LABELS } from "@/lib/leave/policy";

type UserRow = {
  id: string;
  name: string;
  department: string | null;
  status: string;
  email: string;
};

type LeaveRow = {
  id: string;
  employee_user_id: string;
  leave_type: string;
  duration: string;
  from_date: string;
  to_date: string;
  no_of_days: string;
  status: string;
  reason: string | null;
  employee_name: string | null;
};

const DEPARTMENT_LABELS: Record<string, string> = {
  sales: "Sales",
  operations: "Operations",
  back_office: "Back Office",
  compliance: "Compliance",
  marketing: "Marketing",
  advisory: "Advisory",
  support: "Support",
  leadership: "Leadership",
  other: "Other",
};

const ABBR: Record<string, string> = {
  casual: "CL",
  sick: "SL",
  earned: "EL",
  maternity: "ML",
  paternity: "PL",
  comp_off: "CO",
  unpaid: "LOP",
};

export function LeaveTimeline({
  users,
  leaves,
  currentYear,
  currentMonth,
}: {
  users: UserRow[];
  leaves: LeaveRow[];
  currentYear: number;
  currentMonth: number; // 1-indexed
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Compute calendar properties
  const daysInMonth = useMemo(() => new Date(currentYear, currentMonth, 0).getDate(), [currentYear, currentMonth]);
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  const monthName = useMemo(() => {
    return new Date(currentYear, currentMonth - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  }, [currentYear, currentMonth]);

  // Navigate to another month
  function navigateMonth(offset: number) {
    let nextMonth = currentMonth + offset;
    let nextYear = currentYear;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    } else if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("month", String(nextMonth));
    params.set("year", String(nextYear));
    router.push(`?${params.toString()}`);
  }

  function resetToToday() {
    const today = new Date();
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", String(today.getMonth() + 1));
    params.set("year", String(today.getFullYear()));
    router.push(`?${params.toString()}`);
  }

  // Get day of week abbreviation
  const getDayOfWeek = (day: number) => {
    const date = new Date(currentYear, currentMonth - 1, day);
    return date.toLocaleDateString("en-IN", { weekday: "short" });
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() + 1 === currentMonth &&
      today.getFullYear() === currentYear
    );
  };

  const isWeekend = (day: number) => {
    const date = new Date(currentYear, currentMonth - 1, day);
    const dayOfWeek = date.getDay(); // 0 is Sunday, 6 is Saturday
    return dayOfWeek === 0 || dayOfWeek === 6;
  };

  // Group users by department
  const groupedUsers = useMemo(() => {
    const groups: Record<string, UserRow[]> = {};
    for (const u of users) {
      const dept = u.department || "other";
      groups[dept] ??= [];
      groups[dept].push(u);
    }
    return groups;
  }, [users]);

  // Map leaves for quick check by user and date
  // Key format: `${userId}_${dateStr}` -> LeaveRow
  const leavesMap = useMemo(() => {
    const map: Record<string, { leave: LeaveRow; isStart: boolean; isEnd: boolean }[]> = {};

    for (const l of leaves) {
      const uId = l.employee_user_id;
      // Loop through all dates between from_date and to_date
      const start = new Date(l.from_date);
      const end = new Date(l.to_date);
      
      const startStr = l.from_date;
      const endStr = l.to_date;

      // Iterate through the days of the current month
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (dateStr >= startStr && dateStr <= endStr) {
          const isStart = dateStr === startStr;
          const isEnd = dateStr === endStr;
          
          map[`${uId}_${day}`] ??= [];
          map[`${uId}_${day}`].push({ leave: l, isStart, isEnd });
        }
      }
    }
    return map;
  }, [leaves, currentYear, currentMonth, daysInMonth]);

  return (
    <div className="card-surface p-6 space-y-6">
      {/* Timeline Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-5 text-brand-cyan" />
          <h2 className="text-lg font-bold tracking-tight">{monthName}</h2>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-1.5 rounded-lg border border-border hover:bg-secondary/40 transition-colors"
            title="Previous Month"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={resetToToday}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border hover:bg-secondary/40 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => navigateMonth(1)}
            className="p-1.5 rounded-lg border border-border hover:bg-secondary/40 transition-colors"
            title="Next Month"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Grid Container */}
      <div className="overflow-x-auto border border-border rounded-lg relative min-h-[400px]">
        <table className="w-full border-collapse table-fixed text-xs select-none">
          {/* Header Row */}
          <thead>
            <tr className="border-b bg-secondary/20">
              <th className="sticky left-0 bg-background z-20 w-[180px] min-w-[180px] p-3 text-left font-semibold border-r border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                Team Member
              </th>
              {daysArray.map((day) => {
                const dayName = getDayOfWeek(day);
                const weekend = isWeekend(day);
                const today = isToday(day);
                return (
                  <th
                    key={day}
                    style={{ width: "38px", minWidth: "38px" }}
                    className={`p-1.5 text-center font-medium border-r border-border last:border-r-0 ${
                      today
                        ? "bg-brand-cyan/15 text-brand-cyan font-bold"
                        : weekend
                        ? "bg-secondary/40 text-muted-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider">{dayName[0]}</div>
                    <div className={`mt-0.5 text-xs inline-block size-5 leading-5 rounded-full ${
                      today ? "bg-brand-cyan text-primary-foreground font-semibold" : ""
                    }`}>
                      {day}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Object.keys(groupedUsers).length === 0 ? (
              <tr>
                <td colSpan={daysInMonth + 1} className="p-12 text-center text-muted-foreground">
                  No active team members found.
                </td>
              </tr>
            ) : (
              Object.entries(groupedUsers).map(([deptKey, deptUsers]) => {
                const deptLabel = DEPARTMENT_LABELS[deptKey] || deptKey;
                return (
                  <optgroup key={deptKey} label={deptLabel}>
                    {/* Department Header Row */}
                    <tr className="border-b bg-secondary/15">
                      <td className="sticky left-0 bg-secondary/15 z-10 p-2 font-bold text-[10px] tracking-wider uppercase text-muted-foreground border-r border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        {deptLabel}
                      </td>
                      <td colSpan={daysInMonth} className="p-0 border-r border-border last:border-r-0">
                        <div className="h-6" />
                      </td>
                    </tr>
                    {deptUsers.map((user) => (
                      <tr key={user.id} className="border-b last:border-0 hover:bg-secondary/10">
                        {/* Employee Sidebar Card */}
                        <td className="sticky left-0 bg-background hover:bg-secondary/10 z-10 p-2.5 font-medium border-r border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] truncate">
                          <div className="font-semibold text-foreground truncate" title={user.name}>
                            {user.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate" title={user.email}>
                            {user.email}
                          </div>
                        </td>

                        {/* Calendar Grid Cells */}
                        {daysArray.map((day) => {
                          const weekend = isWeekend(day);
                          const today = isToday(day);
                          const dayLeaves = leavesMap[`${user.id}_${day}`] || [];
                          
                          // Style based on active leaves
                          let cellContent = null;
                          let cellClass = "";
                          let cellTitle = "";

                          if (dayLeaves.length > 0) {
                            // Find the first leave (normally one per employee per day)
                            const { leave, isStart, isEnd } = dayLeaves[0];
                            const isApproved = leave.status === "approved";
                            const lAbbr = ABBR[leave.leave_type] || "L";
                            
                            // Base color styles
                            const bgStyle = isApproved 
                              ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/30" 
                              : "bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 border-dashed border-y border-amber-400";
                            
                            // Border details for continuous block
                            const roundStyle = isStart && isEnd 
                              ? "rounded-md border-x border-y" 
                              : isStart 
                              ? "rounded-l-md border-l border-y" 
                              : isEnd 
                              ? "rounded-r-md border-r border-y" 
                              : "border-y";

                            const borderStyle = isApproved
                              ? "border-emerald-500"
                              : "border-amber-500";

                            cellClass = `${bgStyle} ${roundStyle} ${borderStyle} font-semibold py-0.5 px-1 flex items-center justify-center cursor-pointer transition-all duration-150`;
                            cellContent = (
                              <span className="text-[10px] tracking-tight">{lAbbr}</span>
                            );

                            const leaveLabel = LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type;
                            cellTitle = `${user.name} on ${leaveLabel} (${leave.status})\nDates: ${leave.from_date} to ${leave.to_date}\nReason: ${leave.reason || "No reason provided"}`;
                          }

                          return (
                            <td
                              key={day}
                              className={`p-1 text-center align-middle border-r border-border last:border-r-0 ${
                                today ? "bg-brand-cyan/5" : weekend ? "bg-secondary/20" : ""
                              }`}
                              title={cellTitle}
                            >
                              {cellContent ? (
                                <div className={cellClass}>
                                  {cellContent}
                                </div>
                              ) : (
                                <div className="h-6 w-full" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </optgroup>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Legend & Instructions */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-4 pt-4 border-t border-border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="size-3.5 rounded bg-emerald-500/20 border border-emerald-500" />
            <span>Approved Leave</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3.5 rounded bg-amber-500/20 border border-dashed border-amber-500" />
            <span>Requested (Pending Approval)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3.5 bg-secondary/30 border border-border" />
            <span>Weekend</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3.5 bg-brand-cyan/15 border border-brand-cyan/30" />
            <span>Today</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <HelpCircle className="size-3" />
            <span>Abbreviations:</span>
          </div>
          <span>CL = Casual, SL = Sick, EL = Earned, CO = Comp Off, LOP = Loss of Pay</span>
        </div>
      </div>
    </div>
  );
}
