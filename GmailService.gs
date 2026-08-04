/**
 * GmailService.gs
 *
 * Retrieves recent Gmail messages and filters for likely
 * job-application updates.
 *
 * Company matching priority:
 *   1. Company in subject
 *   2. Company in sender
 *   3. Company in cleaned body near recruiting language
 *
 * Body links and common footer content are excluded from company matching.
 * Known job-alert senders are rejected before scoring.
 */


/* ============================================================
 * CANDIDATE EMAIL RETRIEVAL
 * ============================================================
 */

function getCandidateJobEmails_(applications) {
  const activeCompanies =
    getActiveApplicationCompanyRecords_(
      applications
    );

  console.log(
    `Loaded ${activeCompanies.length} unique active company name(s).`
  );

  const query = [
    `newer_than:${CONFIG.GMAIL.LOOKBACK_DAYS}d`,
    "-in:spam",
    "-in:trash",
    "-category:social",
    "-category:forums"
  ].join(" ");

  console.log(`Recent-email query: ${query}`);

  /*
   * During testing, retrieve more messages than the final candidate cap.
   * Local filtering determines which messages are sent to Gemini.
   */
  const searchLimit = Math.max(
    CONFIG.GMAIL.MAX_EMAILS_PER_RUN
      * CONFIG.GMAIL.SEARCH_MULTIPLIER,

    CONFIG.GMAIL.MINIMUM_SEARCH_LIMIT
  );

  const threads = GmailApp.search(
    query,
    0,
    searchLimit
  );

  const cutoffTime =
    Date.now()
    - CONFIG.GMAIL.LOOKBACK_DAYS
      * 24
      * 60
      * 60
      * 1000;

  const candidates = [];

  for (const thread of threads) {
    const recentMessages = thread
      .getMessages()
      .filter(function (message) {
        return (
          !message.isDraft()
          && message.getDate().getTime()
            >= cutoffTime
        );
      });

    if (recentMessages.length === 0) {
      continue;
    }

    const latestMessage =
      recentMessages[recentMessages.length - 1];

    const email = {
      id: latestMessage.getId(),
      threadId: thread.getId(),
      receivedAt: latestMessage.getDate(),
      sender: latestMessage.getFrom(),
      subject: latestMessage.getSubject(),
      body: cleanEmailBody_(
        latestMessage.getPlainBody()
      ),
      thread
    };

    const evaluation = evaluateCandidateEmail_(
      email,
      activeCompanies
    );

    if (!evaluation.isCandidate) {
      console.log({
        excludedSubject: email.subject,
        companyMatch: evaluation.company,
        companyLocation:
          evaluation.companyLocation,
        companyScore:
          evaluation.companyScore,
        recruitingScore:
          evaluation.recruitingScore,
        marketingPenalty:
          evaluation.marketingPenalty,
        reason: evaluation.reason
      });

      continue;
    }

    email.candidateCompany =
      evaluation.company;

    email.companyMatchLocation =
      evaluation.companyLocation;

    email.companyMatchScore =
      evaluation.companyScore;

    email.recruitingScore =
      evaluation.recruitingScore;

    email.marketingPenalty =
      evaluation.marketingPenalty;

    email.retrievalScore =
      evaluation.totalScore;

    email.retrievalReason =
      evaluation.reason;

    console.log({
      candidateSubject: email.subject,
      candidateCompany:
        email.candidateCompany,
      companyLocation:
        email.companyMatchLocation,
      companyScore:
        email.companyMatchScore,
      recruitingScore:
        email.recruitingScore,
      marketingPenalty:
        email.marketingPenalty,
      totalScore:
        email.retrievalScore
    });

    candidates.push(email);
  }

  candidates.sort(function (first, second) {
    if (
      second.retrievalScore
      !== first.retrievalScore
    ) {
      return (
        second.retrievalScore
        - first.retrievalScore
      );
    }

    return (
      second.receivedAt.getTime()
      - first.receivedAt.getTime()
    );
  });

  return candidates.slice(
    0,
    CONFIG.GMAIL.MAX_EMAILS_PER_RUN
  );
}


/* ============================================================
 * CANDIDATE EVALUATION
 * ============================================================
 */

function evaluateCandidateEmail_(
  email,
  activeCompanies
) {
  /*
   * Hard-block senders known to distribute job advertisements,
   * recommendations, and job alerts.
   */
  if (
    isKnownJobAdvertisementSender_(
      email.sender
    )
  ) {
    return {
      isCandidate: false,
      company: null,
      companyLocation: null,
      companyScore: 0,
      recruitingScore: 0,
      marketingPenalty: 10,
      totalScore: -10,
      reason:
        "Sender is a known job-alert or job-recommendation service."
    };
  }

  const companyMatch = findBestCompanyMatch_(
    email,
    activeCompanies
  );

  if (!companyMatch.matched) {
    return {
      isCandidate: false,
      company: null,
      companyLocation: null,
      companyScore: 0,
      recruitingScore: 0,
      marketingPenalty: 0,
      totalScore: 0,
      reason:
        companyMatch.reason
        || "No active company from the spreadsheet was found."
    };
  }

  const recruitingResult =
    calculateRecruitingSignalScore_(email);

  const marketingPenalty =
    calculateMarketingPenalty_(email);

  const totalScore =
    companyMatch.score
    + recruitingResult.score
    - marketingPenalty;

  /*
   * Assessment / ATS vendors that name an active employer in the
   * subject or sender are treated as candidates even when body
   * recruiting phrases are weak or oddly worded.
   */
  const vendorWithEmployerInHeader =
    isKnownApplicantTrackingSender_(email.sender)
    && (
      companyMatch.location === "subject"
      || companyMatch.location === "sender"
    );

  if (vendorWithEmployerInHeader) {
    return {
      isCandidate: true,
      company: companyMatch.company,
      companyLocation:
        companyMatch.location,
      companyScore: companyMatch.score,
      recruitingScore:
        Math.max(
          recruitingResult.score,
          CONFIG.GMAIL.MINIMUM_RECRUITING_SCORE
        ),
      marketingPenalty,
      totalScore: Math.max(
        totalScore,
        CONFIG.GMAIL.MINIMUM_CANDIDATE_SCORE
      ),
      reason: [
        `Matched active company "${companyMatch.company}" in the ${companyMatch.location}.`,
        "Sender is an assessment or ATS vendor with the employer in the subject or sender.",
        recruitingResult.reasons.join(" ")
      ].filter(Boolean).join(" ")
    };
  }

  /*
   * The email must have recruiting evidence independent
   * of the company match.
   */
  const minimumRecruitingScore =
    CONFIG.GMAIL.MINIMUM_RECRUITING_SCORE;

  const minimumTotalScore =
    CONFIG.GMAIL.MINIMUM_CANDIDATE_SCORE;

  if (
    recruitingResult.score
    < minimumRecruitingScore
  ) {
    return {
      isCandidate: false,
      company: companyMatch.company,
      companyLocation:
        companyMatch.location,
      companyScore: companyMatch.score,
      recruitingScore:
        recruitingResult.score,
      marketingPenalty,
      totalScore,
      reason:
        "Company matched, but there was not enough recruiting-process evidence."
    };
  }

  if (totalScore < minimumTotalScore) {
    return {
      isCandidate: false,
      company: companyMatch.company,
      companyLocation:
        companyMatch.location,
      companyScore: companyMatch.score,
      recruitingScore:
        recruitingResult.score,
      marketingPenalty,
      totalScore,
      reason:
        "Marketing or unrelated-email signals outweighed the recruiting evidence."
    };
  }

  return {
    isCandidate: true,
    company: companyMatch.company,
    companyLocation:
      companyMatch.location,
    companyScore: companyMatch.score,
    recruitingScore:
      recruitingResult.score,
    marketingPenalty,
    totalScore,
    reason: [
      `Matched active company "${companyMatch.company}" in the ${companyMatch.location}.`,
      recruitingResult.reasons.join(" "),
      marketingPenalty > 0
        ? `Marketing penalty: ${marketingPenalty}.`
        : ""
    ].filter(Boolean).join(" ")
  };
}


/* ============================================================
 * ACTIVE COMPANY LIST
 * ============================================================
 */

function getActiveApplicationCompanyRecords_(
  applications
) {
  const companiesByNormalizedName =
    new Map();

  applications.forEach(function (
    application
  ) {
    if (
      !application.company
      || isTerminalApplicationStatus_(
        application.status
      )
    ) {
      return;
    }

    const cleanedCompany =
      cleanSpreadsheetCompanyName_(
        application.company
      );

    if (!cleanedCompany) {
      return;
    }

    const normalized =
      normalizeCompanyForSearch_(
        cleanedCompany
      );

    if (!normalized) {
      return;
    }

    if (
      !companiesByNormalizedName.has(
        normalized
      )
    ) {
      companiesByNormalizedName.set(
        normalized,
        {
          original: cleanedCompany,
          normalized,
          compact: compactNormalizedText_(
            normalized
          ),
          tokens: normalized
            .split(" ")
            .filter(Boolean)
        }
      );
    }
  });

  return Array.from(
    companiesByNormalizedName.values()
  );
}


function cleanSpreadsheetCompanyName_(
  company
) {
  return String(company || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeCompanyForSearch_(
  company
) {
  return String(company || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(incorporated|inc|llc|ltd|limited|corporation|corp|company|co)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Removes spaces from an already-normalized company string so
 * "jp morgan", "jpmorgan chase", and "jpmorganchase" can align.
 */
function compactNormalizedText_(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}


/**
 * True when text contains the company as a spaced phrase or as a
 * space-insensitive compact form built from consecutive tokens.
 */
function textContainsCompany_(
  normalizedText,
  companyRecord
) {
  if (
    !normalizedText
    || !companyRecord
    || !companyRecord.normalized
  ) {
    return false;
  }

  if (
    containsNormalizedPhrase_(
      normalizedText,
      companyRecord.normalized
    )
  ) {
    return true;
  }

  return textContainsCompactCompany_(
    normalizedText,
    companyRecord.compact
      || compactNormalizedText_(
        companyRecord.normalized
      )
  );
}


function textContainsCompactCompany_(
  normalizedText,
  compactCompany
) {
  const minimumLength = Number(
    CONFIG.MATCHING.MINIMUM_COMPACT_COMPANY_LENGTH
  );

  if (
    !normalizedText
    || !compactCompany
    || compactCompany.length < minimumLength
  ) {
    return false;
  }

  const tokens = String(normalizedText)
    .toLowerCase()
    .split(/\s+/)
    .map(function (token) {
      return token.replace(/[^a-z0-9]/g, "");
    })
    .filter(Boolean);

  for (let start = 0; start < tokens.length; start++) {
    let built = "";

    for (
      let end = start;
      end < tokens.length;
      end++
    ) {
      built += tokens[end];

      if (
        companyCompactFormsAlign_(
          compactCompany,
          built
        )
      ) {
        return true;
      }

      if (built.length > compactCompany.length + 8) {
        break;
      }
    }
  }

  return false;
}


/**
 * Aligns compact company forms such as "jpmorgan" with
 * "jpmorganchase" when both sides are long enough.
 */
function companyCompactFormsAlign_(
  firstCompact,
  secondCompact
) {
  if (!firstCompact || !secondCompact) {
    return false;
  }

  if (firstCompact === secondCompact) {
    return true;
  }

  const minimumLength = Number(
    CONFIG.MATCHING.MINIMUM_COMPACT_COMPANY_LENGTH
  );

  if (
    firstCompact.length >= minimumLength
    && secondCompact.startsWith(firstCompact)
  ) {
    return true;
  }

  if (
    secondCompact.length >= minimumLength
    && firstCompact.startsWith(secondCompact)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * COMPANY MATCHING
 * ============================================================
 */

/**
 * Company matching uses strict source priority:
 *
 * 1. Subject
 * 2. Sender
 * 3. Cleaned body near recruiting language
 *
 * A body match can never override a subject or sender match.
 * Matching accepts spaced phrases and compact forms
 * (e.g. "JP Morgan" vs "JPMorganChase").
 */
function findBestCompanyMatch_(
  email,
  activeCompanies
) {
  const sender =
    normalizeEmailSearchText_(
      email.sender
    );

  const subject =
    normalizeEmailSearchText_(
      email.subject
    );

  const cleanedBody =
    removeEmailFooterAndLinks_(
      email.body
    );

  const body =
    normalizeEmailSearchText_(
      cleanedBody
    );

  const subjectMatches = [];
  const senderMatches = [];
  const bodyMatches = [];

  activeCompanies.forEach(function (
    companyRecord
  ) {
    const normalizedCompany =
      companyRecord.normalized;

    /*
     * Highest priority: explicit company name
     * in the subject.
     */
    if (
      textContainsCompany_(
        subject,
        companyRecord
      )
    ) {
      subjectMatches.push({
        matched: true,
        company:
          companyRecord.original,
        score: 5,
        location: "subject"
      });
    }

    /*
     * Second priority: company name in the
     * sender display name or email domain.
     */
    if (
      textContainsCompany_(
        sender,
        companyRecord
      )
    ) {
      senderMatches.push({
        matched: true,
        company:
          companyRecord.original,
        score: 4,
        location: "sender"
      });
    }

    /*
     * Lowest priority: cleaned body mention
     * near recruiting language.
     *
     * Platform names and generic names are
     * never accepted from the body.
     */
    if (
      !isApplicationPlatformName_(
        normalizedCompany
      )
      && !isGenericCompanyName_(
        normalizedCompany,
        companyRecord.tokens
      )
      && textContainsCompany_(
        body,
        companyRecord
      )
      && isCompanyNearRecruitingLanguage_(
        body,
        normalizedCompany,
        companyRecord.compact
      )
    ) {
      bodyMatches.push({
        matched: true,
        company:
          companyRecord.original,
        score: 2,
        location: "body"
      });
    }
  });

  /*
   * Subject matches always win.
   */
  const uniqueSubjectMatches =
    deduplicateCompanyMatches_(
      subjectMatches
    );

  if (uniqueSubjectMatches.length === 1) {
    return uniqueSubjectMatches[0];
  }

  if (uniqueSubjectMatches.length > 1) {
    return {
      matched: false,
      company: null,
      score: 0,
      location: null,
      reason:
        "Multiple active companies appeared in the subject."
    };
  }

  /*
   * Sender matches are considered only when
   * no subject company was found.
   */
  const uniqueSenderMatches =
    deduplicateCompanyMatches_(
      senderMatches
    );

  if (uniqueSenderMatches.length === 1) {
    return uniqueSenderMatches[0];
  }

  if (uniqueSenderMatches.length > 1) {
    return {
      matched: false,
      company: null,
      score: 0,
      location: null,
      reason:
        "Multiple active companies appeared in the sender."
    };
  }

  /*
   * Body-only matches are allowed only when
   * exactly one active company qualifies.
   */
  const uniqueBodyMatches =
    deduplicateCompanyMatches_(
      bodyMatches
    );

  if (uniqueBodyMatches.length === 1) {
    return uniqueBodyMatches[0];
  }

  if (uniqueBodyMatches.length > 1) {
    return {
      matched: false,
      company: null,
      score: 0,
      location: null,
      reason:
        "Multiple active companies appeared only in the email body."
    };
  }

  return {
    matched: false,
    company: null,
    score: 0,
    location: null,
    reason:
      "No active company was found in the subject, sender, or relevant body text."
  };
}


function deduplicateCompanyMatches_(
  matches
) {
  const matchesByCompany = new Map();

  matches.forEach(function (match) {
    const normalized =
      normalizeCompanyForSearch_(
        match.company
      );

    if (
      !matchesByCompany.has(normalized)
    ) {
      matchesByCompany.set(
        normalized,
        match
      );
    }
  });

  return Array.from(
    matchesByCompany.values()
  );
}


/**
 * Platforms may appear because the application
 * was submitted through them, not because they
 * are the employer.
 */
function isApplicationPlatformName_(
  companyName
) {
  const normalized =
    normalizeCompanyForSearch_(
      companyName
    );

  const platformNames = new Set([
    "linkedin",
    "indeed",
    "glassdoor",
    "handshake",
    "greenhouse",
    "workday",
    "ashby",
    "lever",
    "smartrecruiters",
    "icims",
    "jobvite",
    "rippling"
  ]);

  return platformNames.has(normalized);
}


/**
 * Common or short company names are unsafe as
 * body-only matches because they can occur in
 * unrelated sentences, links, or branding.
 */
function isGenericCompanyName_(
  normalizedCompany,
  tokens
) {
  const genericNames = new Set([
    "also",
    "agenda",
    "bill",
    "circle",
    "figure",
    "gen",
    "gemini",
    "halo",
    "horizon",
    "ice",
    "loop",
    "meta",
    "notion",
    "pure",
    "roam",
    "super",
    "wanted"
  ]);

  if (
    genericNames.has(normalizedCompany)
  ) {
    return true;
  }

  if (
    tokens.length === 1
    && normalizedCompany.length < 5
  ) {
    return true;
  }

  return false;
}


function normalizeEmailSearchText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9@.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function containsNormalizedPhrase_(
  text,
  phrase
) {
  if (!text || !phrase) {
    return false;
  }

  const escapedPhrase =
    phrase.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const pattern = new RegExp(
    `(^|\\s)${escapedPhrase}(?=\\s|$|\\.|@)`,
    "i"
  );

  return pattern.test(text);
}


/**
 * A body-only employer match is accepted only when
 * the company appears near recruiting terminology.
 */
function isCompanyNearRecruitingLanguage_(
  body,
  normalizedCompany,
  compactCompany
) {
  const recruitingSignals = [
    "application",
    "applying",
    "applicant",
    "position",
    "role",
    "assessment",
    "interview",
    "candidate",
    "hiring",
    "recruiting",
    "talent acquisition",
    "offer"
  ];

  const lowerBody = String(body || "").toLowerCase();

  let companyIndex = normalizedCompany
    ? lowerBody.indexOf(normalizedCompany)
    : -1;

  while (companyIndex !== -1) {
    const windowStart = Math.max(
      0,
      companyIndex - 180
    );

    const windowEnd = Math.min(
      lowerBody.length,
      companyIndex
        + normalizedCompany.length
        + 180
    );

    const nearbyText = lowerBody.substring(
      windowStart,
      windowEnd
    );

    if (
      recruitingSignals.some(function (signal) {
        return nearbyText.includes(signal);
      })
    ) {
      return true;
    }

    companyIndex = lowerBody.indexOf(
      normalizedCompany,
      companyIndex + normalizedCompany.length
    );
  }

  /*
   * Compact-only mentions (e.g. sheet "JP Morgan", body
   * "JPMorganChase") do not have a spaced phrase index.
   * Require recruiting language somewhere in the cleaned body.
   */
  const compact =
    compactCompany
    || compactNormalizedText_(normalizedCompany);

  if (
    !textContainsCompactCompany_(
      lowerBody,
      compact
    )
  ) {
    return false;
  }

  return recruitingSignals.some(function (signal) {
    return lowerBody.includes(signal);
  });
}


/* ============================================================
 * BODY CLEANING FOR COMPANY MATCHING
 * ============================================================
 */

/**
 * Removes URLs and common footer content before
 * searching the body for employer names.
 *
 * The full cleaned email body is still sent to Gemini.
 */
function removeEmailFooterAndLinks_(body) {
  let cleaned = String(body || "");

  /*
   * Remove full URLs so social links cannot create
   * matches such as TikTok, LinkedIn, or Instagram.
   */
  cleaned = cleaned.replace(
    /https?:\/\/[^\s<>"')]+/gi,
    " "
  );

  cleaned = cleaned.replace(
    /\bwww\.[^\s<>"')]+/gi,
    " "
  );

  cleaned = cleaned.replace(
    /\bmailto:[^\s<>"')]+/gi,
    " "
  );

  /*
   * Remove common social-media link labels.
   */
  cleaned = cleaned.replace(
    /\b(linkedin|tiktok|instagram|facebook|youtube|twitter|x\.com)\b\s*[:|-]?\s*/gi,
    " "
  );

  const footerMarkers = [
    "\nfollow us",
    "\nconnect with us",
    "\nstay connected",
    "\nfind us on",
    "\nsocial media",
    "\nprivacy policy",
    "\nprivacy notice",
    "\nview in browser",
    "\nview this email",
    "\nmanage preferences",
    "\nemail preferences",
    "\nunsubscribe",
    "\nthis email was sent",
    "\nyou are receiving this",
    "\nall rights reserved",
    "\n©",
    "\ncopyright"
  ];

  const lowerBody =
    cleaned.toLowerCase();

  let earliestFooterIndex = -1;

  footerMarkers.forEach(function (
    marker
  ) {
    const markerIndex =
      lowerBody.indexOf(marker);

    if (
      markerIndex !== -1
      && (
        earliestFooterIndex === -1
        || markerIndex
          < earliestFooterIndex
      )
    ) {
      earliestFooterIndex =
        markerIndex;
    }
  });

  if (earliestFooterIndex !== -1) {
    cleaned = cleaned.substring(
      0,
      earliestFooterIndex
    );
  }

  return cleaned
    .replace(/\s+/g, " ")
    .trim();
}


/* ============================================================
 * JOB-ALERT HARD EXCLUSIONS
 * ============================================================
 */

function isKnownJobAdvertisementSender_(
  sender
) {
  const normalizedSender =
    String(sender || "").toLowerCase();

  const blockedSenders = [
    "jobs-noreply@linkedin.com",
    "jobalerts-noreply@linkedin.com",
    "newsletters-noreply@linkedin.com",
    "jobs-listings@linkedin.com",
    "jobseeker-noreply@linkedin.com",
    "no-reply@indeed.com",
    "donotreply@match.indeed.com",
    "jobalerts@indeed.com",
    "alerts@glassdoor.com",
    "jobs@handshake.com",
    "notifications@handshake.com"
  ];

  return blockedSenders.some(function (
    blockedSender
  ) {
    return normalizedSender.includes(
      blockedSender
    );
  });
}


/* ============================================================
 * RECRUITING SIGNAL SCORING
 * ============================================================
 */

function calculateRecruitingSignalScore_(
  email
) {
  const sender =
    String(email.sender || "")
      .toLowerCase();

  const subject =
    String(email.subject || "")
      .toLowerCase();

  const body =
    String(email.body || "")
      .toLowerCase();

  let score = 0;
  const reasons = [];

  if (
    isKnownApplicantTrackingSender_(
      sender
    )
  ) {
    score += 3;

    reasons.push(
      "Known recruiting or applicant-tracking sender."
    );
  }

  const subjectSignals = [
    "application",
    "applying",
    "applicant",
    "assessment",
    "interview",
    "candidate",
    "recruiting",
    "recruiter",
    "hiring team",
    "talent acquisition",
    "offer letter",
    "employment offer",
    "application status",
    "status update",
    "coding challenge",
    "coding test",
    "technical assessment",
    "next steps"
  ];

  const subjectMatches =
    countMatchingSignals_(
      subject,
      subjectSignals
    );

  if (subjectMatches > 0) {
    score += Math.min(
      subjectMatches * 2,
      4
    );

    reasons.push(
      `Recruiting language appeared in the subject (${subjectMatches} signal(s)).`
    );
  }

  const senderSignals = [
    "recruit",
    "talent",
    "career",
    "hiring",
    "candidate",
    "assessment",
    "interview",
    "applicant",
    "ats."
  ];

  const senderMatches =
    countMatchingSignals_(
      sender,
      senderSignals
    );

  if (senderMatches > 0) {
    score += Math.min(
      senderMatches,
      2
    );

    reasons.push(
      "Recruiting language appeared in the sender."
    );
  }

  const bodySignals = [
    "thank you for applying",
    "thanks for applying",
    "thank you for your application",
    "thank you for your interest",
    "received your application",
    "application has been received",
    "application process",
    "your candidacy",
    "your candidate profile",
    "hiring team",
    "talent acquisition",
    "recruiting team",
    "complete the assessment",
    "complete your assessment",
    "online assessment",
    "coding assessment",
    "technical assessment",
    "assessment portal",
    "schedule an interview",
    "schedule your interview",
    "interview availability",
    "move forward",
    "moving forward",
    "not to move forward",
    "not moving forward",
    "other candidates",
    "candidate pool",
    "offer of employment",
    "pleased to offer",
    "application status"
  ];

  const bodyMatches =
    countMatchingSignals_(
      body,
      bodySignals
    );

  if (bodyMatches > 0) {
    score += Math.min(
      bodyMatches,
      3
    );

    reasons.push(
      `Recruiting language appeared in the body (${bodyMatches} signal(s)).`
    );
  }

  return {
    score,
    reasons
  };
}


function isKnownApplicantTrackingSender_(
  sender
) {
  const normalizedSender =
    String(sender || "").toLowerCase();

  const domainMatch =
    normalizedSender.match(
      /@([a-z0-9.-]+\.[a-z]{2,})/
    );

  const domain = domainMatch
    ? domainMatch[1]
    : normalizedSender;

  const vendorTokens =
    CONFIG.GMAIL.VENDOR_DOMAIN_TOKENS
    || [];

  return vendorTokens.some(function (token) {
    return domain.indexOf(token) !== -1;
  });
}


function countMatchingSignals_(
  text,
  signals
) {
  return signals.reduce(
    function (count, signal) {
      return text.includes(signal)
        ? count + 1
        : count;
    },
    0
  );
}


/* ============================================================
 * MARKETING PENALTIES
 * ============================================================
 */

function calculateMarketingPenalty_(
  email
) {
  const sender =
    String(email.sender || "")
      .toLowerCase();

  const subject =
    String(email.subject || "")
      .toLowerCase();

  const body =
    String(email.body || "")
      .toLowerCase();

  let penalty = 0;

  const marketingSenderSignals = [
    "newsletter",
    "marketing",
    "promotions",
    "promo@",
    "deals@",
    "rewards@",
    "shop@",
    "shopping",
    "membership",
    "gearmail"
  ];

  const senderMatches =
    countMatchingSignals_(
      sender,
      marketingSenderSignals
    );

  penalty += senderMatches * 3;

  const marketingSubjectSignals = [
    "sale",
    "discount",
    "deals",
    "clearance",
    "% off",
    "shop now",
    "weekly ad",
    "rewards",
    "bonus offer",
    "restaurants near you",
    "shopping guide",
    "recommended jobs",
    "jobs for you",
    "job alert",
    "apply now",
    "invited to apply",
    "is hiring for",
    "actively hiring",
    "roles you may be interested in",
    "opportunities for you"
  ];

  const subjectMatches =
    countMatchingSignals_(
      subject,
      marketingSubjectSignals
    );

  penalty += subjectMatches * 3;

  const bodyMarketingSignals = [
    "unsubscribe",
    "manage your email preferences",
    "shop now",
    "limited time offer",
    "recommended for you",
    "based on your interests"
  ];

  const bodyMatches =
    countMatchingSignals_(
      body,
      bodyMarketingSignals
    );

  penalty += Math.min(
    bodyMatches,
    2
  );

  return penalty;
}


/* ============================================================
 * GENERAL EMAIL CLEANING
 * ============================================================
 */

function cleanEmailBody_(body) {
  if (!body) {
    return "";
  }

  let cleanedBody = String(body);

  const quotedHistoryMarkers = [
    "\n-----Original Message-----",
    "\nBegin forwarded message:",
    "\n________________________________"
  ];

  let earliestMarkerIndex = -1;

  quotedHistoryMarkers.forEach(function (
    marker
  ) {
    const markerIndex =
      cleanedBody.indexOf(marker);

    if (
      markerIndex !== -1
      && (
        earliestMarkerIndex === -1
        || markerIndex
          < earliestMarkerIndex
      )
    ) {
      earliestMarkerIndex =
        markerIndex;
    }
  });

  if (earliestMarkerIndex !== -1) {
    cleanedBody =
      cleanedBody.substring(
        0,
        earliestMarkerIndex
      );
  }

  return cleanedBody
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .substring(
      0,
      CONFIG.AI.MAX_EMAIL_BODY_CHARACTERS
    );
}
