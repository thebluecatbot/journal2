/**
 * Calendar utilities for the post-entry digest panel
 * Generates Google Calendar TEMPLATE URLs and iCalendar (.ics) exports.
 * NO OAuth, no tokens, no consent screen required.
 */

export interface CalendarActionParam {
  what: string;
  dueISO?: string;
  id?: string;
}

/**
 * Generates a Google Calendar TEMPLATE URL for one-click adding without OAuth.
 */
export function calendarUrl({ what, dueISO }: CalendarActionParam): string {
  const d = (dueISO || new Date().toISOString().slice(0, 10));
  const start = d.replace(/-/g, "") + "T090000Z";
  const end   = d.replace(/-/g, "") + "T093000Z";
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: what,
    dates: `${start}/${end}`,
    details: "Created from your Compass journal entry"
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/**
 * Builds an RFC 5545 compliant iCalendar (.ics) string for a list of action items.
 * Actions with no due date default to today.
 */
export function generateIcsContent(actions: CalendarActionParam[]): string {
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const events = actions.map((act, idx) => {
    const d = act.dueISO && /^\d{4}-\d{2}-\d{2}$/.test(act.dueISO)
      ? act.dueISO
      : now.toISOString().slice(0, 10);
    const start = d.replace(/-/g, "") + "T090000Z";
    const end = d.replace(/-/g, "") + "T093000Z";
    const uid = `${act.id || `action-${idx}-${Date.now()}`}@compass.journal`;
    const cleanSummary = (act.what || "Journal Next Action")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/[\r\n]+/g, " ");

    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${cleanSummary}`,
      "DESCRIPTION:Created from your Compass journal entry",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    ].join("\r\n");
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Compass Journal//Action Rail//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Triggers a browser download of an .ics calendar file containing the specified actions.
 */
export function downloadIcsFile(actions: CalendarActionParam[], filename = "compass-actions.ics"): void {
  const ics = generateIcsContent(actions);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
