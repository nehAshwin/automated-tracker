/**
 * Global configuration for the job-application automation.
 */
const CONFIG = {
  SHEETS: {
    APPLICATIONS: "Applications",
    AUTOMATION_LOG: "Automation Log"
  },

  COLUMNS: {
    TIMESTAMP: "Timestamp",
    COMPANY: "Company",
    ROLE: "Role",
    TERM: "Term",
    STATUS: "Status",
    OA_DEADLINE: "OA Deadline",
    SCHEDULED_OA: "Scheduled OA",
    NOTES: "Notes"
  },

  STATUSES: {
    APPLIED: "Applied",
    RECEIVED_OA: "Received OA",
    OA_COMPLETED: "OA Completed",
    INTERVIEW_SCHEDULED: "Interview Scheduled",
    INTERVIEW_COMPLETED: "Interview Completed",
    REJECTED: "Rejected",
    ACCEPTED: "Accepted",
    REFERRAL_REQUESTED: "Referral Requested"
  },

  DRY_RUN: false,

  MATCHING: {
    MINIMUM_CONFIDENCE: 0.80,
    MINIMUM_COMPANY_SCORE: 0.75,
    /*
     * Accept a best row below MINIMUM_CONFIDENCE when it clearly
     * beats the runner-up and still clears CONFIDENCE_FLOOR.
     */
    CONFIDENCE_MARGIN: 0.15,
    CONFIDENCE_FLOOR: 0.55,
    /*
     * Minimum compact-company length before space-insensitive
     * matching is allowed (avoids short false positives).
     */
    MINIMUM_COMPACT_COMPANY_LENGTH: 6
  },

  GMAIL: {
    LOOKBACK_DAYS: 1,
    MAX_EMAILS_PER_RUN: 30,
    SEARCH_MULTIPLIER: 5,
    MINIMUM_SEARCH_LIMIT: 100,

    MINIMUM_RECRUITING_SCORE: 2,
    MINIMUM_CANDIDATE_SCORE: 5,

    /*
     * Sender domains containing these tokens count as ATS / OA
     * vendors (e.g. hackerrankforwork.com, cloud.oracle.com).
     */
    VENDOR_DOMAIN_TOKENS: [
      "greenhouse",
      "lever",
      "ashby",
      "workday",
      "smartrecruiters",
      "icims",
      "jobvite",
      "successfactors",
      "oracle",
      "brassring",
      "hackerrank",
      "codesignal",
      "karat",
      "hirevue",
      "modernhire",
      "rippling"
    ],

    LABELS: {
      INTERNSHIPS: "Internships",
      REJECTIONS: "Internships/✨rejections✨"
    }
  },

  AI: {
    PROVIDER: "gemini",
    MODEL: "gemini-3.5-flash-lite",
    TEMPERATURE: 0.1,
    MAX_EMAIL_BODY_CHARACTERS: 10000,
    DEFAULT_TIME_ZONE: "America/Los_Angeles"
  },

  TRIGGER: {
    HANDLER_FUNCTION: "processDailyJobApplicationEmails",
    HOUR: 9,
    TIME_ZONE: "America/Los_Angeles"
  },

  ALLOWED_UPDATES: {
    STATUS: true,
    OA_DEADLINE: true,
    SCHEDULED_OA: false,
    NOTES: false
  }
};
