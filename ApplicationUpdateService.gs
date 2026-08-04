/**
 * ApplicationUpdateService.gs
 *
 * Safely converts Gemini classifications into spreadsheet updates.
 *
 * Supported sheet changes:
 * - Status
 * - OA Deadline
 *
 * CONFIG.DRY_RUN controls whether changes are actually written.
 *
 * DRY_RUN: true
 *   - Calculates and logs proposed changes.
 *   - Does not modify Applications.
 *
 * DRY_RUN: false
 *   - Applies validated changes to Applications.
 */


/* ============================================================
 * MAIN UPDATE FUNCTION
 * ============================================================
 */

/**
 * Creates and optionally applies an update for one matched email.
 */
function updateApplicationFromEmail_(
  analysis,
  matchResult
) {
  if (!analysis.isJobApplicationUpdate) {
    return createSkippedUpdateResult_(
      "Email was not classified as a job-application update."
    );
  }

  if (!matchResult || !matchResult.matched) {
    return createSkippedUpdateResult_(
      "No safely matched spreadsheet row was available."
    );
  }

  const proposedUpdate =
    buildApplicationUpdateProposal_(
      analysis,
      matchResult
    );

  if (!proposedUpdate.hasChanges) {
    return {
      attempted: true,
      applied: false,
      dryRun: CONFIG.DRY_RUN,
      rowNumber: matchResult.rowNumber,
      proposedChanges: [],
      appliedChanges: [],
      reason: proposedUpdate.reason
    };
  }

  if (CONFIG.DRY_RUN) {
    return {
      attempted: true,
      applied: false,
      dryRun: true,
      rowNumber: matchResult.rowNumber,
      proposedChanges:
        proposedUpdate.changes,
      appliedChanges: [],
      reason:
        "Dry run enabled. Changes were calculated but not written."
    };
  }

  const appliedChanges =
    applyApplicationUpdate_(
      matchResult.rowNumber,
      proposedUpdate.changes
    );

  return {
    attempted: true,
    applied: appliedChanges.length > 0,
    dryRun: false,
    rowNumber: matchResult.rowNumber,
    proposedChanges:
      proposedUpdate.changes,
    appliedChanges,
    reason:
      appliedChanges.length > 0
        ? "Validated spreadsheet changes were applied."
        : "No spreadsheet values required modification."
  };
}


/* ============================================================
 * BUILD UPDATE PROPOSAL
 * ============================================================
 */

function buildApplicationUpdateProposal_(
  analysis,
  matchResult
) {
  const changes = [];

  const desiredStatus =
    getStatusForUpdateType_(
      analysis.updateType
    );

  if (
    CONFIG.ALLOWED_UPDATES.STATUS
    && desiredStatus
  ) {
    const statusDecision =
      determineStatusChange_(
        matchResult.status,
        desiredStatus,
        analysis.updateType
      );

    if (statusDecision.shouldUpdate) {
      changes.push({
        field: "status",
        columnHeader:
          CONFIG.COLUMNS.STATUS,
        oldValue:
          matchResult.status || "",
        newValue:
          desiredStatus,
        reason:
          statusDecision.reason
      });
    }
  }

  if (
    CONFIG.ALLOWED_UPDATES.OA_DEADLINE
    && analysis.updateType
      === "oa_received"
    && analysis.oaDeadline
  ) {
    const deadline =
      new Date(analysis.oaDeadline);

    if (
      !Number.isNaN(deadline.getTime())
    ) {
      changes.push({
        field: "oaDeadline",
        columnHeader:
          CONFIG.COLUMNS.OA_DEADLINE,
        oldValue: null,
        newValue: deadline,
        reason:
          "Gemini extracted a valid OA deadline."
      });
    }
  }

  return {
    hasChanges: changes.length > 0,
    changes,
    reason:
      changes.length > 0
        ? "One or more safe changes were proposed."
        : "The email did not require a permitted spreadsheet change."
  };
}


/* ============================================================
 * UPDATE TYPE → STATUS
 * ============================================================
 */

function getStatusForUpdateType_(
  updateType
) {
  const statusByUpdateType = {
    application_received:
      CONFIG.STATUSES.APPLIED,

    oa_received:
      CONFIG.STATUSES.RECEIVED_OA,

    oa_completed:
      CONFIG.STATUSES.OA_COMPLETED,

    interview_scheduled:
      CONFIG.STATUSES.INTERVIEW_SCHEDULED,

    interview_completed:
      CONFIG.STATUSES.INTERVIEW_COMPLETED,

    rejected:
      CONFIG.STATUSES.REJECTED,

    accepted:
      CONFIG.STATUSES.ACCEPTED,

    referral_requested:
      CONFIG.STATUSES.REFERRAL_REQUESTED
  };

  return statusByUpdateType[updateType]
    || null;
}


/* ============================================================
 * STATUS SAFETY
 * ============================================================
 */

/**
 * Prevents old or duplicate emails from moving an application
 * backward in the process.
 */
function determineStatusChange_(
  currentStatus,
  desiredStatus,
  updateType
) {
  const current =
    normalizeStatusForUpdate_(
      currentStatus
    );

  const desired =
    normalizeStatusForUpdate_(
      desiredStatus
    );

  if (!desired) {
    return {
      shouldUpdate: false,
      reason:
        "No destination status was available."
    };
  }

  if (current === desired) {
    return {
      shouldUpdate: false,
      reason:
        "Application already has the requested status."
    };
  }

  /*
   * A new acceptance or rejection is allowed to close
   * an active application.
   */
  if (
    updateType === "accepted"
    || updateType === "rejected"
  ) {
    if (
      isTerminalUpdateStatus_(current)
    ) {
      return {
        shouldUpdate: false,
        reason:
          "Application already has a terminal status."
      };
    }

    return {
      shouldUpdate: true,
      reason:
        "Terminal application outcome received."
    };
  }

  /*
   * Never overwrite a terminal status with an earlier stage.
   */
  if (isTerminalUpdateStatus_(current)) {
    return {
      shouldUpdate: false,
      reason:
        "A non-terminal update cannot overwrite a terminal status."
    };
  }

  /*
   * Referral requested is a special pre-application state.
   */
  if (
    updateType === "referral_requested"
  ) {
    const referralAllowedCurrentStatuses = [
      "",
      normalizeStatusForUpdate_(
        CONFIG.STATUSES.REFERRAL_REQUESTED
      )
    ];

    return {
      shouldUpdate:
        referralAllowedCurrentStatuses.includes(
          current
        ),
      reason:
        referralAllowedCurrentStatuses.includes(
          current
        )
          ? "Referral status may be recorded."
          : "Referral status would move the application backward."
    };
  }

  const currentRank =
    getStatusProgressRank_(current);

  const desiredRank =
    getStatusProgressRank_(desired);

  if (desiredRank === null) {
    return {
      shouldUpdate: false,
      reason:
        `Destination status "${desiredStatus}" is not recognized.`
    };
  }

  /*
   * Unknown or blank current statuses may be updated.
   */
  if (currentRank === null) {
    return {
      shouldUpdate: true,
      reason:
        "Current status was blank or unrecognized."
    };
  }

  if (desiredRank > currentRank) {
    return {
      shouldUpdate: true,
      reason:
        "New status advances the application process."
    };
  }

  return {
    shouldUpdate: false,
    reason:
      "New status would duplicate or move the application backward."
  };
}


function getStatusProgressRank_(status) {
  const normalized =
    normalizeStatusForUpdate_(status);

  const ranks = {};

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.REFERRAL_REQUESTED
    )
  ] = 0;

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.APPLIED
    )
  ] = 1;

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.RECEIVED_OA
    )
  ] = 2;

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.OA_COMPLETED
    )
  ] = 3;

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.INTERVIEW_SCHEDULED
    )
  ] = 4;

  ranks[
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.INTERVIEW_COMPLETED
    )
  ] = 5;

  return Object.prototype
    .hasOwnProperty.call(
      ranks,
      normalized
    )
    ? ranks[normalized]
    : null;
}


function isTerminalUpdateStatus_(status) {
  const normalized =
    normalizeStatusForUpdate_(status);

  return [
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.REJECTED
    ),
    normalizeStatusForUpdate_(
      CONFIG.STATUSES.ACCEPTED
    )
  ].includes(normalized);
}


function normalizeStatusForUpdate_(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}


/* ============================================================
 * APPLY CHANGES
 * ============================================================
 */

function applyApplicationUpdate_(
  rowNumber,
  proposedChanges
) {
  if (
    !Number.isInteger(rowNumber)
    || rowNumber < 2
  ) {
    throw new Error(
      `Invalid application row number: ${rowNumber}`
    );
  }

  const sheet =
    getApplicationsSheet_();

  const headerMap =
    getSheetHeaderMap_(sheet);

  requireApplicationHeaders_(
    headerMap
  );

  const appliedChanges = [];

  proposedChanges.forEach(
    function (change) {
      const columnNumber =
        headerMap[
          change.columnHeader
        ];

      if (!columnNumber) {
        throw new Error(
          `Column "${change.columnHeader}" was not found in Applications.`
        );
      }

      const cell =
        sheet.getRange(
          rowNumber,
          columnNumber
        );

      const currentValue =
        cell.getValue();

      if (
        areApplicationValuesEqual_(
          currentValue,
          change.newValue
        )
      ) {
        return;
      }

      cell.setValue(
        change.newValue
      );

      appliedChanges.push({
        field: change.field,
        columnHeader:
          change.columnHeader,
        oldValue:
          currentValue,
        newValue:
          change.newValue,
        reason:
          change.reason
      });
    }
  );

  SpreadsheetApp.flush();

  return appliedChanges;
}


/* ============================================================
 * VALUE COMPARISON
 * ============================================================
 */

function areApplicationValuesEqual_(
  firstValue,
  secondValue
) {
  if (
    firstValue instanceof Date
    && secondValue instanceof Date
  ) {
    return (
      firstValue.getTime()
      === secondValue.getTime()
    );
  }

  return (
    String(firstValue || "")
      .trim()
      .toLowerCase()
    ===
    String(secondValue || "")
      .trim()
      .toLowerCase()
  );
}


/* ============================================================
 * FORMAT UPDATE RESULTS FOR LOG
 * ============================================================
 */

function formatApplicationUpdateResult_(
  updateResult
) {
  if (!updateResult) {
    return "No update result was generated.";
  }

  if (!updateResult.attempted) {
    return (
      `No spreadsheet update attempted: `
      + updateResult.reason
    );
  }

  const proposedText =
    formatApplicationChanges_(
      updateResult.proposedChanges
    );

  if (updateResult.dryRun) {
    return [
      "DRY RUN",
      `Row ${updateResult.rowNumber}`,
      proposedText
        ? `Proposed: ${proposedText}`
        : "No changes proposed",
      updateResult.reason
    ].join(" | ");
  }

  const appliedText =
    formatApplicationChanges_(
      updateResult.appliedChanges
    );

  return [
    `Row ${updateResult.rowNumber}`,
    appliedText
      ? `Applied: ${appliedText}`
      : "No values changed",
    updateResult.reason
  ].join(" | ");
}


function formatApplicationChanges_(
  changes
) {
  if (
    !Array.isArray(changes)
    || changes.length === 0
  ) {
    return "";
  }

  return changes
    .map(function (change) {
      const oldValue =
        formatApplicationValue_(
          change.oldValue
        );

      const newValue =
        formatApplicationValue_(
          change.newValue
        );

      return (
        `${change.columnHeader}: `
        + `"${oldValue}" → "${newValue}"`
      );
    })
    .join("; ");
}


function formatApplicationValue_(
  value
) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      CONFIG.AI.DEFAULT_TIME_ZONE,
      "yyyy-MM-dd HH:mm:ss"
    );
  }

  if (
    value === null
    || value === undefined
  ) {
    return "";
  }

  return String(value);
}


function createSkippedUpdateResult_(
  reason
) {
  return {
    attempted: false,
    applied: false,
    dryRun: CONFIG.DRY_RUN,
    rowNumber: null,
    proposedChanges: [],
    appliedChanges: [],
    reason
  };
}


/* ============================================================
 * MANUAL TESTS
 * ============================================================
 */

/**
 * Tests proposal logic without modifying the spreadsheet.
 */
function testApplicationUpdateProposal() {
  const sampleAnalysis = {
    isJobApplicationUpdate: true,
    updateType: "oa_received",
    company: "Example Company",
    role: "Software Engineer Intern",
    term: "Summer 2027",
    oaDeadline:
      "2026-08-10T23:59:00-07:00"
  };

  const sampleMatch = {
    matched: true,
    rowNumber: 2,
    company: "Example Company",
    role: "Software Engineer Intern",
    term: "Summer 2027",
    status:
      CONFIG.STATUSES.APPLIED,
    confidence: 0.98
  };

  const proposal =
    buildApplicationUpdateProposal_(
      sampleAnalysis,
      sampleMatch
    );

  console.log(
    JSON.stringify(
      proposal,
      null,
      2
    )
  );
}
