/* ============================================================
 * AUTOMATION LOG
 * ============================================================
 */

const AUTOMATION_LOG_HEADERS = [
  "Timestamp",
  "Email ID",
  "Thread ID",
  "Received At",
  "Sender",
  "Subject",

  "Is Job Update",
  "Update Type",
  "Extracted Company",
  "Extracted Role",
  "Extracted Term",
  "OA Deadline",
  "Extraction Confidence",
  "Evidence",
  "Notes",

  "Matched",
  "Matched Row",
  "Matched Company",
  "Matched Role",
  "Matched Term",
  "Current Status",
  "Match Confidence",
  "Match Reason",
  "Top Candidates",

  "Proposed Changes",
  "Applied Changes",

  "Gmail Label",
  "Gmail Label Applied",

  "Processing Result",
  "Error"
];

function ensureAutomationLogHeaders_() {
  const sheet = getAutomationLogSheet_();

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        AUTOMATION_LOG_HEADERS.length
      )
      .setValues([
        AUTOMATION_LOG_HEADERS
      ]);

    sheet.setFrozenRows(1);
    return;
  }

  const existingHeaders = sheet
    .getRange(
      1,
      1,
      1,
      Math.max(
        sheet.getLastColumn(),
        1
      )
    )
    .getDisplayValues()[0]
    .map(function (header) {
      return String(header).trim();
    });

  const missingHeaders =
    AUTOMATION_LOG_HEADERS.filter(
      function (header) {
        return !existingHeaders.includes(
          header
        );
      }
    );

  if (missingHeaders.length > 0) {
    sheet
      .getRange(
        1,
        sheet.getLastColumn() + 1,
        1,
        missingHeaders.length
      )
      .setValues([
        missingHeaders
      ]);
  }

  sheet.setFrozenRows(1);
}

function getAutomationLogSheet_() {
  const spreadsheet =
    SpreadsheetApp
      .getActiveSpreadsheet();

  const sheet =
    spreadsheet.getSheetByName(
      CONFIG.SHEETS.AUTOMATION_LOG
    );

  if (!sheet) {
    throw new Error(
      `Sheet "${CONFIG.SHEETS.AUTOMATION_LOG}" was not found.`
    );
  }

  return sheet;
}

function appendAutomationLog_(
  logEntry
) {
  ensureAutomationLogHeaders_();

  const sheet =
    getAutomationLogSheet_();

  const headerMap =
    getSheetHeaderMap_(sheet);

  const lastColumn =
    sheet.getLastColumn();

  const email = logEntry.email;
  const analysis =
    logEntry.analysis;

  const updateResult =
    logEntry.updateResult || {};

  const labelResult =
    logEntry.labelResult || {};

  const match =
    logEntry.matchResult || {};

  const topCandidates =
    Array.isArray(match.candidates)
      ? match.candidates
          .map(function (candidate) {
            return (
              `Row ${candidate.rowNumber}: `
              + `${candidate.company} | `
              + `${candidate.role} | `
              + `${candidate.term} | `
              + `score=${candidate.matchConfidence}`
            );
          })
          .join("\n")
      : "";

  const valuesByHeader = {
    "Timestamp": new Date(),
    "Email ID": email.id,
    "Thread ID": email.threadId,
    "Received At": email.receivedAt,
    "Sender": email.sender,
    "Subject": email.subject,
    "Is Job Update":
      analysis.isJobApplicationUpdate,
    "Update Type":
      analysis.updateType,
    "Extracted Company":
      analysis.company || "",
    "Extracted Role":
      analysis.role || "",
    "Extracted Term":
      analysis.term || "",
    "OA Deadline":
      analysis.oaDeadline
        ? new Date(
            analysis.oaDeadline
          )
        : "",
    "Extraction Confidence":
      analysis.confidence,
    "Evidence":
      analysis.evidence || "",
    "Notes":
      analysis.notes || "",
    "Matched":
      Boolean(match.matched),
    "Matched Row":
      match.rowNumber || "",
    "Matched Company":
      match.company || "",
    "Matched Role":
      match.role || "",
    "Matched Term":
      match.term || "",
    "Current Status":
      match.status || "",
    "Match Confidence":
      match.confidence ?? "",
    "Match Reason":
      match.reason || "",
    "Top Candidates":
      topCandidates,
    "Processing Result":
      logEntry.processingResult || "",
    "Proposed Changes":
      formatApplicationChanges_(
        updateResult.proposedChanges
      ),
    "Applied Changes":
      formatApplicationChanges_(
        updateResult.appliedChanges
      ),
    "Gmail Label":
      labelResult.labelName || "",
    "Gmail Label Applied":
      Boolean(labelResult.applied),
    "Error":
      logEntry.error || ""
  };

  const row =
    new Array(lastColumn).fill("");

  Object.keys(
    valuesByHeader
  ).forEach(function (header) {
    const columnNumber =
      headerMap[header];

    if (columnNumber) {
      row[columnNumber - 1] =
        valuesByHeader[header];
    }
  });

  sheet.appendRow(row);
}
