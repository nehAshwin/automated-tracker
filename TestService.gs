/* ============================================================
 * HELPERS AND TESTS
 * ============================================================
 */

/**
 * Local filter preview.
 * Does not call Gemini.
 */
function previewCandidateJobEmails() {
  const applications =
    getApplicationRecords_();

  const candidateEmails =
    getCandidateJobEmails_(
      applications
    );

  console.log(
    `Found ${candidateEmails.length} candidate email(s).`
  );

  candidateEmails.forEach(
    function (email) {
      console.log({
        receivedAt:
          email.receivedAt,
        sender:
          email.sender,
        subject:
          email.subject,
        candidateCompany:
          email.candidateCompany,
        companyMatchLocation:
          email.companyMatchLocation,
        companyMatchScore:
          email.companyMatchScore,
        recruitingScore:
          email.recruitingScore,
        marketingPenalty:
          email.marketingPenalty,
        retrievalScore:
          email.retrievalScore,
        retrievalReason:
          email.retrievalReason
      });
    }
  );
}


function testGeminiConnection() {
  const testEmail = {
    id: "TEST_MESSAGE",
    threadId: "TEST_THREAD",
    receivedAt: new Date(),
    sender:
      "Example Company Recruiting <recruiting@example.com>",
    subject:
      "Online assessment invitation",
    body:
      "Thank you for applying to the Software Engineering Intern "
      + "role at Example Company for Summer 2027. Please complete "
      + "the coding assessment by August 8, 2026.",
    candidateCompany:
      "Example Company",
    companyMatchLocation:
      "subject"
  };

  console.log(
    JSON.stringify(
      analyzeJobApplicationEmail_(
        testEmail
      ),
      null,
      2
    )
  );
}
