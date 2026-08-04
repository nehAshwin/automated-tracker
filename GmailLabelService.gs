/**
 * Handles Gmail labels for confirmed application updates.
 */
function processInternshipLabel_(
  thread,
  analysis
) {
  if (
    !analysis
    || !analysis.isJobApplicationUpdate
  ) {
    return createSkippedLabelResult_(
      "Email was not classified as a job-application update."
    );
  }

  const labelName =
    getInternshipLabelName_(
      analysis.updateType
    );

  if (CONFIG.DRY_RUN) {
    return {
      attempted: true,
      applied: false,
      dryRun: true,
      labelName,
      reason:
        `Dry run enabled. Gmail label "${labelName}" was proposed but not applied.`
    };
  }

  return applyInternshipLabel_(
    thread,
    analysis
  );
}


function getInternshipLabelName_(
  updateType
) {
  return updateType === "rejected"
    ? CONFIG.GMAIL.LABELS.REJECTIONS
    : CONFIG.GMAIL.LABELS.INTERNSHIPS;
}


function applyInternshipLabel_(
  thread,
  analysis
) {
  if (!thread) {
    throw new Error(
      "Cannot apply internship label because the Gmail thread is missing."
    );
  }

  const internshipLabel =
    getOrCreateGmailLabel_(
      CONFIG.GMAIL.LABELS.INTERNSHIPS
    );

  const rejectionLabel =
    getOrCreateGmailLabel_(
      CONFIG.GMAIL.LABELS.REJECTIONS
    );

  const labelName =
    getInternshipLabelName_(
      analysis.updateType
    );

  thread.addLabel(internshipLabel);

  if (analysis.updateType === "rejected") {
    thread.addLabel(rejectionLabel);
  } else {
    thread.removeLabel(rejectionLabel);
  }

  return {
    attempted: true,
    applied: true,
    dryRun: false,
    labelName,
    reason:
      `Applied Gmail label "${labelName}".`
  };
}


function getOrCreateGmailLabel_(
  labelName
) {
  return (
    GmailApp.getUserLabelByName(labelName)
    || GmailApp.createLabel(labelName)
  );
}


function createSkippedLabelResult_(
  reason
) {
  return {
    attempted: false,
    applied: false,
    dryRun: CONFIG.DRY_RUN,
    labelName: null,
    reason
  };
}
