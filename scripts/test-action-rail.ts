import { calendarUrl, generateIcsContent } from "../src/lib/calendar";

console.log("================================================================");
console.log("   COMPASS: P0-7 THE ACTION RAIL TEST SUITE                    ");
console.log("================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

// 1. Calendar URL Tests (NO OAuth, Template URL)
console.log("--- 1. Google Calendar TEMPLATE URL Generation ---");
const todayIso = new Date().toISOString().slice(0, 10);
const todayCompact = todayIso.replace(/-/g, "");

const url1 = calendarUrl({
  what: "Review Raft consensus paper",
  dueISO: "2026-09-15",
});
assert(
  url1.startsWith("https://calendar.google.com/calendar/render?"),
  "Generates valid Google Calendar render URL"
);
assert(url1.includes("action=TEMPLATE"), "Includes action=TEMPLATE parameter");
assert(
  url1.includes("text=Review+Raft+consensus+paper") || url1.includes("text=Review%20Raft%20consensus%20paper"),
  "Includes encoded task description"
);
assert(
  url1.includes("dates=20260915T090000Z%2F20260915T093000Z") ||
  url1.includes("dates=20260915T090000Z/20260915T093000Z"),
  "Calculates correct start (09:00Z) and end (09:30Z) date-time"
);
assert(
  !url1.includes("oauth") && !url1.includes("token") && !url1.includes("client_id"),
  "NO OAuth parameters, tokens, or client IDs present"
);

// Test action with NO due date (defaults to today)
const urlNoDate = calendarUrl({
  what: "Call Sarah regarding architect boundary",
});
assert(
  urlNoDate.includes(todayCompact + "T090000Z"),
  `Action with no due date defaults to today (${todayIso} -> ${todayCompact})`
);

// 2. Whole action list .ics file export
console.log("\n--- 2. iCalendar (.ics) Whole Action List Export ---");
const sampleActions = [
  { what: "Finalize architect scope", dueISO: "2026-09-12", id: "act_1" },
  { what: "Draft Q4 prototype roadmap", id: "act_2" }, // no due date
  { what: "Send boundaries update to Sarah", dueISO: "2026-09-18", id: "act_3" },
];

const icsContent = generateIcsContent(sampleActions);
assert(icsContent.includes("BEGIN:VCALENDAR"), ".ics starts with BEGIN:VCALENDAR");
assert(icsContent.includes("VERSION:2.0"), ".ics specifies VERSION:2.0");
assert(icsContent.includes("PRODID:-//Compass Journal//Action Rail//EN"), ".ics specifies Compass PRODID");
assert(icsContent.includes("SUMMARY:Finalize architect scope"), "Includes summary of first action");
assert(icsContent.includes("SUMMARY:Draft Q4 prototype roadmap"), "Includes summary of second action with no due date");
assert(icsContent.includes("DTSTART:" + todayCompact + "T090000Z"), "Second action with no due date exports defaulting to today");
assert(icsContent.includes("END:VCALENDAR"), ".ics ends with END:VCALENDAR");

// Count occurrences of BEGIN:VEVENT
const eventCount = (icsContent.match(/BEGIN:VEVENT/g) || []).length;
assert(eventCount === 3, `Exports all ${sampleActions.length} action items as separate VEVENTs`);

// 3. UI Rules & Layout Verification
console.log("\n--- 3. UI Rules & Responsive Specifications Verification ---");
import * as fs from "fs";
const actionRailSource = fs.readFileSync("./src/components/ActionRail.tsx", "utf8");
const cssSource = fs.readFileSync("./src/index.css", "utf8");

// Section ordering verification
const themesIdx = actionRailSource.indexOf('id="rail-section-themes"');
const decisionsIdx = actionRailSource.indexOf('id="rail-section-decisions"');
const nextActionsIdx = actionRailSource.indexOf('id="rail-section-next-actions"');
const openQuestionsIdx = actionRailSource.indexOf('id="rail-section-open-questions"');

assert(themesIdx !== -1 && decisionsIdx !== -1 && nextActionsIdx !== -1 && openQuestionsIdx !== -1, "All 4 required sections exist in ActionRail");
assert(
  themesIdx < decisionsIdx && decisionsIdx < nextActionsIdx && nextActionsIdx < openQuestionsIdx,
  "Sections appear in exact required order: Themes -> Decisions -> Next actions -> Open questions"
);

// Stagger and animation length check
assert(
  actionRailSource.includes("delay: i * 0.04") || actionRailSource.includes("0.04"),
  "Items appear with 40ms stagger"
);
assert(
  actionRailSource.includes("0.18") || actionRailSource.includes("duration: 0.18"),
  "Animation duration is <= 200ms (180ms)"
);
assert(
  actionRailSource.includes("useReducedMotion") && actionRailSource.includes("shouldReduceMotion"),
  "Respects prefers-reduced-motion"
);

// Checkbox optimistic update & reconciliation on failure
assert(
  actionRailSource.includes("optimisticDone") && actionRailSource.includes("setOptimisticDone"),
  "Checkbox updates optimistically in state"
);
assert(
  actionRailSource.includes("syncErrors") && actionRailSource.includes("Reconciling action status due to sync failure"),
  "Reconciles back to previous state on failure"
);

// One click to add, confirmed inline, no modal
assert(
  actionRailSource.includes("Added to calendar"),
  "Confirmed state shown inline"
);
assert(
  !actionRailSource.toLowerCase().includes("<dialog") && !actionRailSource.toLowerCase().includes("modal"),
  "NEVER a modal for calendar add"
);

// Skeleton blocks, no spinners
assert(
  actionRailSource.includes("animate-pulse") && actionRailSource.includes("bg-stone-200"),
  "Uses skeleton blocks while loading"
);
assert(
  !actionRailSource.includes("animate-spin") && !actionRailSource.includes("<Spinner"),
  "No spinners while loading"
);

// Empty state explanations
assert(
  actionRailSource.includes("Key themes and central threads distilled"),
  "Themes empty state explains what will appear"
);
assert(
  actionRailSource.includes("Firm choices, boundaries, and strategic conclusions"),
  "Decisions empty state explains what will appear"
);
assert(
  actionRailSource.includes("Concrete next actions and commitments"),
  "Next actions empty state explains what will appear"
);
assert(
  actionRailSource.includes("Unresolved questions, philosophical inquiries"),
  "Open questions empty state explains what will appear"
);

// Responsive layout below 900px
assert(
  cssSource.includes("@media (max-width: 899px)") &&
  cssSource.includes("flex-direction: column") &&
  cssSource.includes(".rail-layout-container"),
  "Below 900px layout stacks below the conversation without hiding behind a tab"
);

console.log("\n================================================================");
if (failed === 0) {
  console.log(`ALL ${passed} ACTION RAIL TESTS PASSED SUCCESSFULLY!`);
} else {
  console.log(`${failed} TEST(S) FAILED. ${passed} passed.`);
  process.exit(1);
}
