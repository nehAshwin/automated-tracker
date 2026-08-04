# Automated Job Application Tracker

A Google Apps Script project that keeps a job-application spreadsheet in sync with recruiting emails in Gmail. Each day it finds likely application updates, classifies them with Gemini, matches them to the right row in your sheet, and updates status (and OA deadlines) without you copying details by hand.

## What problem this solves

Internship and new-grad recruiting generates a constant stream of confirmation, assessment, interview, rejection, and offer emails. Manually updating a tracker is easy to miss and hard to keep accurate.

This project:

- Scans recent Gmail for messages that look like updates for companies you already applied to
- Classifies each candidate email with Gemini (OA invite, rejection, interview, etc.)
- Matches the email to an active row in an **Applications** sheet
- Updates **Status** and **OA Deadline** when the change is safe
- Labels the Gmail thread (`Internships`, or `Internships/✨rejections✨` for rejections)
- Logs every decision to an **Automation Log** sheet for review

## How it works

Daily run (or a manual run of `processDailyJobApplicationEmails`):

1. Load applications not marked Accepted or Rejected from the `Applications` sheet.
2. Find candidate emails in Gmail from the last lookback window (default: 1 day). Local filters require:
  - An active company name in subject, sender, or (carefully) body
  - Recruiting-language signals
  - Not a known job-alert / marketing sender
3. Classify with Gemini — structured JSON for update type, company, role, term, OA deadline, confidence, and evidence.
4. Match to a sheet row using company / role / term similarity plus recency. Low-confidence or ambiguous matches are skipped.
5. Update the sheet only when status would move forward or close out via accept/reject.
6. Label the Gmail thread and append a row to `Automation Log`.

### Project files


| File                          | Role                                      |
| ----------------------------- | ----------------------------------------- |
| `Config.gs`                   | Sheets, columns, thresholds, trigger time |
| `WorkflowService.gs`          | Main daily workflow                       |
| `GmailService.gs`             | Candidate email retrieval and filtering   |
| `GeminiService.gs`            | Gemini classification                     |
| `SheetService.gs`             | Read applications and match rows          |
| `ApplicationUpdateService.gs` | Propose / apply sheet updates             |
| `GmailLabelService.gs`        | Apply internship / rejection labels       |
| `AutomationLogService.gs`     | Write the Automation Log                  |
| `TriggerService.gs`           | Create / delete the daily trigger         |
| `TestService.gs`              | Preview candidates and test Gemini        |


## Setup: use these files yourself

### 1. Prepare the Google Sheet

Create (or open) a spreadsheet with two tabs:

**Applications** — header row must include at least:

- `Timestamp`
- `Company`
- `Role`
- `Term`
- `Status`

Add one row per application you want tracked. Keep `Company` / `Role` / `Term` / `Status` filled in.

**Automation Log** — can start empty. On first run the script writes the header row.

### 2. Attach a Google Apps Script project

1. In the spreadsheet: **Extensions → Apps Script**.
2. Delete any default `Code.gs` content if you do not need it.
3. Create one script file per `.gs` file in this repo (same names are fine) and paste the contents.
4. Save the project.

The script must stay **bound to this spreadsheet** (`SpreadsheetApp.getActiveSpreadsheet()` is used throughout).

### 3. Add your Gemini API key

1. In Apps Script: **Project Settings** (gear) → **Script Properties**.
2. Add a property:
  - Name: `GEMINI_API_KEY`
  - Value: your [Google AI Studio](https://aistudio.google.com/apikey) API key

Do not commit the key into source files.

### 4. Authorize and smoke-test

In the Apps Script editor:

1. Run `previewCandidateJobEmails` — confirms sheet + Gmail access and shows which emails would be candidates (no Gemini, no writes).
2. Run `testGeminiConnection` — confirms the API key and model work.
3. Optionally set `CONFIG.DRY_RUN = true` in `Config.gs`, then run `processDailyJobApplicationEmails`. Review **Automation Log** and Executions before enabling writes.
4. Set `CONFIG.DRY_RUN = false` when you are ready for live sheet/label updates.

First runs will prompt for Google permissions (Sheets, Gmail, external URL fetch for Gemini). Approve them for the Google account that owns the sheet and inbox.

### 5. Launch the daily trigger

1. In the Apps Script editor, select `createDailyJobTrackerTrigger`.
2. Click **Run**.

That deletes any existing trigger for `processDailyJobApplicationEmails` and creates a new one that runs **every day at 9:00 AM** in `America/Los_Angeles` (see `CONFIG.TRIGGER`).

To remove it later, run `deleteDailyJobTrackerTrigger`.

You can also run `processDailyJobApplicationEmails` manually anytime.

## Configuration notes

Edit `Config.gs` to adjust behavior without changing the rest of the code:

- `DRY_RUN` — propose changes and log them without writing the sheet or applying labels
- `GMAIL.LOOKBACK_DAYS` / `MAX_EMAILS_PER_RUN` — how far back and how many candidates per run
- `MATCHING.MINIMUM_CONFIDENCE` — how strict sheet matching is
- `AI.MODEL` — Gemini model name
- `TRIGGER.HOUR` / `TIME_ZONE` — when the daily job runs
- `ALLOWED_UPDATES` — which fields may be written (`STATUS`, `OA_DEADLINE`, etc.)
- `GMAIL.LABELS` — Gmail label names for internships and rejections

## Operational tips

- Keep active applications (not Accepted/Rejected) accurate in the sheet; company names drive email filtering.
- Use **Automation Log** to audit matches, skipped updates, and failures.
- After changing the trigger hour or timezone in `Config.gs`, run `createDailyJobTrackerTrigger` again so the schedule is recreated.

