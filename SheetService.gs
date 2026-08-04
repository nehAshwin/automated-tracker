/**
 * SheetService.gs
 *
 * Reads applications and safely proposes the matching spreadsheet row.
 * This file does NOT update the Applications sheet.
 */

function getApplicationsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(
    CONFIG.SHEETS.APPLICATIONS
  );

  if (!sheet) {
    throw new Error(
      `Sheet "${CONFIG.SHEETS.APPLICATIONS}" was not found.`
    );
  }

  return sheet;
}


function getSheetHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    throw new Error(
      `Sheet "${sheet.getName()}" contains no columns.`
    );
  }

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0];

  const headerMap = {};

  headers.forEach(function (header, index) {
    const cleanedHeader = String(header).trim();

    if (cleanedHeader) {
      headerMap[cleanedHeader] = index + 1;
    }
  });

  return headerMap;
}


function requireApplicationHeaders_(headerMap) {
  const requiredHeaders = [
    CONFIG.COLUMNS.TIMESTAMP,
    CONFIG.COLUMNS.COMPANY,
    CONFIG.COLUMNS.ROLE,
    CONFIG.COLUMNS.TERM,
    CONFIG.COLUMNS.STATUS
  ];

  const invalidConfigValues = requiredHeaders.filter(function (header) {
    return typeof header !== "string" || !header.trim();
  });

  if (invalidConfigValues.length > 0) {
    throw new Error(
      "CONFIG.COLUMNS must define TIMESTAMP, COMPANY, ROLE, TERM, and STATUS."
    );
  }

  const missingHeaders = requiredHeaders.filter(function (header) {
    return !Object.prototype.hasOwnProperty.call(
      headerMap,
      header
    );
  });

  if (missingHeaders.length > 0) {
    throw new Error(
      "Applications sheet is missing: "
      + missingHeaders.join(", ")
      + ". Detected headers: "
      + Object.keys(headerMap).join(", ")
    );
  }
}


function getApplicationRecords_() {
  const sheet = getApplicationsSheet_();
  const headerMap = getSheetHeaderMap_(sheet);

  requireApplicationHeaders_(headerMap);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    return [];
  }

  const rows = sheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .getValues();

  return rows
    .map(function (row, index) {
      const rawTimestamp =
        row[headerMap[CONFIG.COLUMNS.TIMESTAMP] - 1];

      const parsedTimestamp =
        rawTimestamp instanceof Date
          ? rawTimestamp
          : new Date(rawTimestamp);

      return {
        rowNumber: index + 2,
        timestamp: Number.isNaN(parsedTimestamp.getTime())
          ? null
          : parsedTimestamp,
        company: String(
          row[headerMap[CONFIG.COLUMNS.COMPANY] - 1] || ""
        ).trim(),
        role: String(
          row[headerMap[CONFIG.COLUMNS.ROLE] - 1] || ""
        ).trim(),
        term: String(
          row[headerMap[CONFIG.COLUMNS.TERM] - 1] || ""
        ).trim(),
        status: String(
          row[headerMap[CONFIG.COLUMNS.STATUS] - 1] || ""
        ).trim()
      };
    })
    .filter(function (application) {
      return application.company || application.role;
    });
}


function normalizeApplicationText_(value) {
  let text = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.com\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");

  const acronymReplacements = [
    [/\bqa\b/g, "quality assurance"],
    [/\bqe\b/g, "quality engineer"],
    [/\bswe\b/g, "software engineer"],
    [/\bsde\b/g, "software development engineer"],
    [/\bml\b/g, "machine learning"],
    [/\bai\b/g, "artificial intelligence"],
    [/\bdevops\b/g, "development operations"]
  ];

  acronymReplacements.forEach(function (replacement) {
    text = text.replace(replacement[0], replacement[1]);
  });

  const phraseReplacements = [
    [/\bsoftware engineering\b/g, "software engineer"],
    [/\bsoftware development engineering\b/g,
      "software development engineer"],
    [/\bquality assurance engineering\b/g,
      "quality assurance engineer"],
    [/\bquality engineering\b/g, "quality engineer"],
    [/\bmachine learning engineering\b/g,
      "machine learning engineer"],
    [/\binternships?\b/g, "intern"],
    [/\bco op\b/g, "coop"]
  ];

  phraseReplacements.forEach(function (replacement) {
    text = text.replace(replacement[0], replacement[1]);
  });

  text = text.replace(
    /\b(incorporated|inc|llc|ltd|limited|corporation|corp|company|co)\b/g,
    " "
  );

  return text.replace(/\s+/g, " ").trim();
}


function tokenizeApplicationText_(value) {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "of",
    "for",
    "at",
    "in",
    "to",
    "role",
    "position",
    "program"
  ]);

  return normalizeApplicationText_(value)
    .split(" ")
    .filter(function (token) {
      return token && !stopWords.has(token);
    });
}


function calculateTokenSimilarity_(firstValue, secondValue) {
  const firstTokens = new Set(
    tokenizeApplicationText_(firstValue)
  );

  const secondTokens = new Set(
    tokenizeApplicationText_(secondValue)
  );

  if (firstTokens.size === 0 || secondTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  firstTokens.forEach(function (token) {
    if (secondTokens.has(token)) {
      overlap++;
    }
  });

  return overlap / Math.max(
    firstTokens.size,
    secondTokens.size
  );
}


function calculateExactNormalizedMatch_(firstValue, secondValue) {
  const first = normalizeApplicationText_(firstValue);
  const second = normalizeApplicationText_(secondValue);

  if (!first || !second) {
    return 0;
  }

  return first === second ? 1 : 0;
}


/**
 * Space-insensitive company similarity for variants like
 * "JP Morgan" vs "JPMorganChase".
 */
function calculateCompactCompanyMatch_(firstValue, secondValue) {
  const first = compactNormalizedText_(
    normalizeApplicationText_(firstValue)
  );

  const second = compactNormalizedText_(
    normalizeApplicationText_(secondValue)
  );

  const minimumLength = Number(
    CONFIG.MATCHING.MINIMUM_COMPACT_COMPANY_LENGTH
  );

  if (
    !first
    || !second
    || first.length < minimumLength
    || second.length < minimumLength
  ) {
    return 0;
  }

  if (first === second) {
    return 1;
  }

  if (
    companyCompactFormsAlign_(first, second)
  ) {
    return 0.92;
  }

  return 0;
}


function scoreCompanyMatch_(firstValue, secondValue) {
  return Math.max(
    calculateTokenSimilarity_(firstValue, secondValue),
    calculateExactNormalizedMatch_(firstValue, secondValue),
    calculateCompactCompanyMatch_(firstValue, secondValue)
  );
}


function normalizeStatus_(status) {
  return String(status || "").trim().toLowerCase();
}


function isTerminalApplicationStatus_(status) {
  const normalizedStatus = normalizeStatus_(status);

  return [
    normalizeStatus_(CONFIG.STATUSES.REJECTED),
    normalizeStatus_(CONFIG.STATUSES.ACCEPTED)
  ].includes(normalizedStatus);
}


function calculateApplicationRecencyScore_(
  applicationTimestamp,
  emailReceivedAt
) {
  if (
    !(applicationTimestamp instanceof Date)
    || Number.isNaN(applicationTimestamp.getTime())
    || !(emailReceivedAt instanceof Date)
    || Number.isNaN(emailReceivedAt.getTime())
  ) {
    return 0;
  }

  const ageInDays = (
    emailReceivedAt.getTime()
    - applicationTimestamp.getTime()
  ) / (24 * 60 * 60 * 1000);

  if (ageInDays < 0) return 0;
  if (ageInDays <= 14) return 1;
  if (ageInDays <= 45) return 0.85;
  if (ageInDays <= 90) return 0.65;
  if (ageInDays <= 180) return 0.35;
  return 0.1;
}


function scoreApplicationMatch_(
  analysis,
  application,
  emailReceivedAt
) {
  const companyScore = scoreCompanyMatch_(
    analysis.company,
    application.company
  );

  const roleScore = calculateTokenSimilarity_(
    analysis.role,
    application.role
  );

  const termScore = calculateTokenSimilarity_(
    analysis.term,
    application.term
  );

  const recencyScore = calculateApplicationRecencyScore_(
    application.timestamp,
    emailReceivedAt
  );

  let weightedTotal = 0;
  let totalWeight = 0;

  if (analysis.company) {
    weightedTotal += companyScore * 0.50;
    totalWeight += 0.50;
  }

  if (analysis.role) {
    weightedTotal += roleScore * 0.30;
    totalWeight += 0.30;
  }

  if (analysis.term) {
    weightedTotal += termScore * 0.10;
    totalWeight += 0.10;
  }

  if (application.timestamp && emailReceivedAt) {
    weightedTotal += recencyScore * 0.10;
    totalWeight += 0.10;
  }

  const finalScore = totalWeight > 0
    ? weightedTotal / totalWeight
    : 0;

  return {
    rowNumber: application.rowNumber,
    timestamp: application.timestamp,
    company: application.company,
    role: application.role,
    term: application.term,
    status: application.status,
    companyScore: Number(companyScore.toFixed(4)),
    roleScore: Number(roleScore.toFixed(4)),
    termScore: Number(termScore.toFixed(4)),
    recencyScore: Number(recencyScore.toFixed(4)),
    matchConfidence: Number(finalScore.toFixed(4))
  };
}


function findBestApplicationMatch_(
  analysis,
  applications,
  emailReceivedAt
) {
  if (!analysis.isJobApplicationUpdate) {
    return createNoMatchResult_(
      "Email was not classified as a job-application update."
    );
  }

  if (!analysis.company && !analysis.role) {
    return createNoMatchResult_(
      "Gemini did not extract a company or role."
    );
  }

  const activeApplications = applications.filter(function (application) {
    return !isTerminalApplicationStatus_(application.status);
  });

  if (activeApplications.length === 0) {
    return createNoMatchResult_(
      "No active application rows are available."
    );
  }

  let eligibleApplications = activeApplications;

  if (analysis.company) {
    eligibleApplications = activeApplications.filter(function (application) {
      const companyScore = scoreCompanyMatch_(
        analysis.company,
        application.company
      );

      return companyScore >= CONFIG.MATCHING.MINIMUM_COMPANY_SCORE;
    });
  }

  if (eligibleApplications.length === 0) {
    return createNoMatchResult_(
      "No active application had a sufficiently strong company match."
    );
  }

  if (analysis.company && !analysis.role && !analysis.term) {
    if (eligibleApplications.length === 1) {
      const onlyApplication = eligibleApplications[0];

      return {
        matched: true,
        rowNumber: onlyApplication.rowNumber,
        company: onlyApplication.company,
        role: onlyApplication.role,
        term: onlyApplication.term,
        status: onlyApplication.status,
        confidence: 0.93,
        reason:
          "Company-only email matched the only active application at that company.",
        candidates: [
          {
            rowNumber: onlyApplication.rowNumber,
            company: onlyApplication.company,
            role: onlyApplication.role,
            term: onlyApplication.term,
            status: onlyApplication.status,
            matchConfidence: 0.93
          }
        ]
      };
    }

    return {
      matched: false,
      rowNumber: null,
      company: null,
      role: null,
      term: null,
      status: null,
      confidence: 0,
      reason:
        `Company-only email is ambiguous because `
        + `${eligibleApplications.length} active applications exist.`,
      candidates: eligibleApplications
        .slice(0, 5)
        .map(function (application) {
          return {
            rowNumber: application.rowNumber,
            company: application.company,
            role: application.role,
            term: application.term,
            status: application.status,
            matchConfidence: 0
          };
        })
    };
  }

  const scoredCandidates = eligibleApplications
    .map(function (application) {
      return scoreApplicationMatch_(
        analysis,
        application,
        emailReceivedAt
      );
    })
    .filter(function (candidate) {
      return candidate.matchConfidence >= 0.20;
    })
    .sort(function (first, second) {
      if (second.matchConfidence !== first.matchConfidence) {
        return second.matchConfidence - first.matchConfidence;
      }

      const firstTimestamp = first.timestamp
        ? first.timestamp.getTime()
        : 0;

      const secondTimestamp = second.timestamp
        ? second.timestamp.getTime()
        : 0;

      return secondTimestamp - firstTimestamp;
    });

  if (scoredCandidates.length === 0) {
    return createNoMatchResult_(
      "No plausible active application row was found."
    );
  }

  const bestCandidate = scoredCandidates[0];
  const secondBestCandidate = scoredCandidates[1];

  const minimumConfidence = Number(
    CONFIG.MATCHING.MINIMUM_CONFIDENCE
  );

  const confidenceFloor = Number(
    CONFIG.MATCHING.CONFIDENCE_FLOOR
  );

  const confidenceMargin = Number(
    CONFIG.MATCHING.CONFIDENCE_MARGIN
  );

  const meetsAbsoluteConfidence =
    bestCandidate.matchConfidence
    >= minimumConfidence;

  const runnerUpConfidence = secondBestCandidate
    ? secondBestCandidate.matchConfidence
    : 0;

  const leadMargin =
    bestCandidate.matchConfidence
    - runnerUpConfidence;

  const meetsMarginConfidence =
    bestCandidate.matchConfidence >= confidenceFloor
    && leadMargin >= confidenceMargin;

  const meetsMinimumConfidence =
    meetsAbsoluteConfidence
    || meetsMarginConfidence;

  let reason;

  if (meetsAbsoluteConfidence) {
    reason =
      "Best active candidate passed the required confidence threshold.";
  } else if (meetsMarginConfidence) {
    reason =
      `Best candidate scored ${bestCandidate.matchConfidence} `
      + `with margin ${leadMargin.toFixed(4)} over the runner-up `
      + `(floor ${confidenceFloor}, margin ${confidenceMargin}).`;
  } else {
    reason =
      `Best candidate scored ${bestCandidate.matchConfidence}, `
      + `below required ${minimumConfidence}`
      + (
        secondBestCandidate
          ? ` and margin ${leadMargin.toFixed(4)} below required ${confidenceMargin}.`
          : "."
      );
  }

  return {
    matched: meetsMinimumConfidence,
    rowNumber: bestCandidate.rowNumber,
    company: bestCandidate.company,
    role: bestCandidate.role,
    term: bestCandidate.term,
    status: bestCandidate.status,
    confidence: bestCandidate.matchConfidence,
    reason,
    candidates: scoredCandidates.slice(0, 5)
  };
}


function createNoMatchResult_(reason) {
  return {
    matched: false,
    rowNumber: null,
    company: null,
    role: null,
    term: null,
    status: null,
    confidence: 0,
    reason,
    candidates: []
  };
}


function testReadApplications() {
  const applications = getApplicationRecords_();

  console.log(`Loaded ${applications.length} application(s).`);
  console.log(
    JSON.stringify(applications.slice(0, 10), null, 2)
  );
}


function testApplicationMatching() {
  const sampleAnalysis = {
    isJobApplicationUpdate: true,
    company: "Example Company",
    role: "QA Intern",
    term: "Summer 2027"
  };

  const result = findBestApplicationMatch_(
    sampleAnalysis,
    getApplicationRecords_(),
    new Date()
  );

  console.log(JSON.stringify(result, null, 2));
}

