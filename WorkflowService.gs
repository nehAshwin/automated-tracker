/**
 * Main daily job-application workflow.
 */
function processDailyJobApplicationEmails() {
  ensureAutomationLogHeaders_();

  const applications = getApplicationRecords_();
  const candidateEmails = getCandidateJobEmails_(applications);

  console.log({
    action: "Daily workflow started",
    applicationCount: applications.length,
    candidateEmailCount: candidateEmails.length,
    dryRun: CONFIG.DRY_RUN
  });

  const runSummary = {
    candidates: candidateEmails.length,
    jobUpdates: 0,
    matched: 0,
    sheetUpdatesApplied: 0,
    labelsApplied: 0,
    failures: 0
  };

  for (const email of candidateEmails) {
    const result = processSingleJobEmail_(
      email,
      applications
    );

    if (result.analysis.isJobApplicationUpdate) {
      runSummary.jobUpdates++;
    }

    if (result.matchResult.matched) {
      runSummary.matched++;
    }

    if (result.updateResult.applied) {
      runSummary.sheetUpdatesApplied++;
    }

    if (result.labelResult.applied) {
      runSummary.labelsApplied++;
    }

    if (result.error) {
      runSummary.failures++;
    }
  }

  console.log({
    action: "Daily workflow completed",
    ...runSummary,
    dryRun: CONFIG.DRY_RUN
  });

  return runSummary;
}


/**
 * Processes one candidate email from beginning to end.
 */
function processSingleJobEmail_(
  email,
  applications
) {
  let analysis = createEmptyEmailAnalysis_();

  let matchResult = createNoMatchResult_(
    "Matching was not performed."
  );

  let updateResult = createSkippedUpdateResult_(
    "No spreadsheet update was attempted."
  );

  let labelResult = createSkippedLabelResult_(
    "No Gmail label was attempted."
  );

  try {
    analysis = analyzeJobApplicationEmail_(email);

    if (analysis.isJobApplicationUpdate) {
      matchResult = findBestApplicationMatch_(
        analysis,
        applications,
        email.receivedAt
      );

      updateResult = updateApplicationFromEmail_(
        analysis,
        matchResult
      );

      labelResult = processInternshipLabel_(
        email.thread,
        analysis
      );
    }

    const processingResult = buildProcessingResult_(
      updateResult,
      labelResult
    );

    safelyAppendAutomationLog_({
      email,
      analysis,
      matchResult,
      updateResult,
      labelResult,
      processingResult,
      error: ""
    });

    logProcessedEmail_({
      email,
      analysis,
      matchResult,
      updateResult,
      labelResult
    });

    return {
      email,
      analysis,
      matchResult,
      updateResult,
      labelResult,
      error: null
    };
  } catch (error) {
    safelyAppendAutomationLog_({
      email,
      analysis,
      matchResult,
      updateResult,
      labelResult,
      processingResult: "Processing failed",
      error: error.message
    });

    console.error({
      action: "Email processing failed",
      subject: email.subject,
      sender: email.sender,
      error: error.message
    });

    return {
      email,
      analysis,
      matchResult,
      updateResult,
      labelResult,
      error: error.message
    };
  }
}


function buildProcessingResult_(
  updateResult,
  labelResult
) {
  return [
    formatApplicationUpdateResult_(updateResult),
    labelResult.reason
  ].filter(Boolean).join(" | ");
}


function logProcessedEmail_(result) {
  console.log({
    action: CONFIG.DRY_RUN
      ? "Job email dry-run completed"
      : "Job email processed",

    receivedAt: result.email.receivedAt,
    sender: result.email.sender,
    subject: result.email.subject,

    updateType: result.analysis.updateType,
    extractedCompany: result.analysis.company,
    extractedRole: result.analysis.role,
    extractedTerm: result.analysis.term,
    oaDeadline: result.analysis.oaDeadline,

    matched: result.matchResult.matched,
    matchedRow: result.matchResult.rowNumber,
    matchedCompany: result.matchResult.company,
    matchedRole: result.matchResult.role,
    matchConfidence: result.matchResult.confidence,

    proposedChanges:
      result.updateResult.proposedChanges,

    appliedChanges:
      result.updateResult.appliedChanges,

    gmailLabel:
      result.labelResult.labelName,

    gmailLabelApplied:
      result.labelResult.applied,

    dryRun: CONFIG.DRY_RUN
  });
}

function safelyAppendAutomationLog_(
  logEntry
) {
  try {
    appendAutomationLog_(logEntry);
  } catch (loggingError) {
    console.error({
      action: "Automation log write failed",
      subject:
        logEntry.email
          ? logEntry.email.subject
          : null,
      originalError:
        logEntry.error || "",
      loggingError:
        loggingError.message
    });
  }
}
