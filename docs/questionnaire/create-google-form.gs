/**
 * Builds the ConsentLedger usability questionnaire as a Google Form, with a
 * linked Google Sheet for the responses.
 *
 * How to use:
 *   1. Open https://script.google.com and click "New project".
 *   2. Delete the sample code, paste this whole file, and click Save.
 *   3. Fill in the five lines under SETTINGS below.
 *   4. Choose the function "createForm" at the top and click Run.
 *      Google asks for permission the first time: Review permissions →
 *      choose your account → Advanced → Go to project → Allow.
 *   5. Open "Execution log": it shows the link to share, the edit link and
 *      the responses sheet. The form also appears in your Google Drive.
 *
 * Running it again makes a second, separate form, so run it once.
 * Anything can be edited afterwards in the Google Forms editor.
 */

// ---------------------------- SETTINGS ----------------------------------
const RESEARCHER = '[Your full name], [Department], [Institution]';
const RESEARCHER_CONTACT = '[your email]';
const SUPERVISOR = '[Supervisor name], [supervisor email]';
// The hosted app's address and the walkthrough password (from
// ~/consentledger-demo-password.txt on the server). Leave as they are if the
// app is not online yet, and edit the "Try the system" section later.
const APP_URL = '[app link, e.g. https://consentledger.duckdns.org]';
const DEMO_PASSWORD = '[walkthrough password]';
// -------------------------------------------------------------------------

const LIKERT = ['1 Strongly disagree', '2 Disagree', '3 Neutral', '4 Agree', '5 Strongly agree'];

function createForm() {
  const title = 'ConsentLedger usability questionnaire';
  const form = FormApp.create(title);
  form
    .setDescription(
      'Evaluating a blockchain-based prototype for patient consent and access control in health record sharing.\n\n' +
        'Researcher: ' + RESEARCHER + '\n' +
        'Supervisor: ' + SUPERVISOR + '\n\n' +
        'You are invited to try a prototype system online and tell us what you think of it. ' +
        'It takes about 25–35 minutes. Please read the information below before deciding whether to take part.'
    )
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
    .setProgressBar(true)
    .setConfirmationMessage(
      'Thank you for taking part. Your answers have been recorded anonymously.'
    );

  // ---- Page 1: information sheet and consent ----
  info(form, 'What is the study about?',
    'It tests a prototype called ConsentLedger, which lets patients decide which organisations may see their ' +
    'health records and records every access decision on a shared ledger. We want to know whether people who ' +
    'work with health records would find it useful and easy to use.');
  info(form, 'What will I be asked to do?',
    '• Open the prototype in your web browser, on a phone or computer.\n' +
    '• Carry out seven short tasks listed in this form, such as granting consent, requesting a record and ' +
    'checking the audit log.\n' +
    '• Say how each task went, then answer about 20 questions about your experience.\n' +
    'Your voice, face and screen are not recorded.');
  info(form, 'Is any real patient data involved?',
    'No. Every patient, record and organisation in the prototype is invented for this study.');
  info(form, 'Do I have to take part?',
    'No. Taking part is voluntary and has no effect on your work or studies. You can stop at any point before ' +
    'submitting by closing this page; nothing is saved until you press Submit. Because responses are anonymous, ' +
    'they cannot be removed once submitted.');
  info(form, 'Will my answers be kept confidential?',
    'Yes. The form does not ask for your name or email address. Results are reported only as totals and ' +
    'averages for the whole group, and no individual or workplace will be identifiable. Responses are kept in ' +
    'the researcher\'s password-protected Google account, used only for this study, in line with the Nigeria ' +
    'Data Protection Act 2023, and deleted when the degree is awarded.');
  info(form, 'Questions or concerns?',
    'Contact the researcher: ' + RESEARCHER_CONTACT + '. For concerns about how the study is conducted, ' +
    'contact the supervisor: ' + SUPERVISOR + '.');

  const statements = [
    'I have read and understood the information above, and know how to contact the researcher with questions.',
    'I understand that taking part is voluntary and that I can stop at any time before submitting, without giving a reason.',
    'I understand that my responses are anonymous, so they cannot be withdrawn once submitted.',
    'I understand that all patient data in the prototype is synthetic and that I will not see any real patient information.',
    'I understand that I will report my own task results, and that my voice, face and screen are not recorded.',
    'I agree that my anonymous answers may be reported in the researcher\'s dissertation and related academic work, in summary form only.',
  ];
  form.addCheckboxItem()
    .setTitle('Consent: tick every statement you agree with')
    .setChoiceValues(statements)
    .setValidation(FormApp.createCheckboxValidation()
      .setHelpText('All six statements must be ticked to take part.')
      .requireSelectExactly(statements.length)
      .build())
    .setRequired(true);
  const agree = form.addMultipleChoiceItem().setTitle('Do you agree to take part in this study?').setRequired(true);
  agree.setChoices([
    agree.createChoice('Yes, I agree to take part', FormApp.PageNavigationType.CONTINUE),
    agree.createChoice('No, I do not wish to take part', FormApp.PageNavigationType.SUBMIT),
  ]);

  // ---- Page 2: eligibility ----
  form.addPageBreakItem().setTitle('Who can take part');
  const eligible = form.addMultipleChoiceItem()
    .setTitle('Do you work with patient records or health information, or are you a medical, nursing or other ' +
      'health student who has handled patient records during clinical placements?')
    .setRequired(true);
  eligible.setChoices([
    eligible.createChoice('Yes', FormApp.PageNavigationType.CONTINUE),
    eligible.createChoice('No', FormApp.PageNavigationType.SUBMIT),
  ]);
  const before = form.addMultipleChoiceItem()
    .setTitle('Have you filled in this questionnaire before, or helped to build this system?')
    .setRequired(true);
  before.setChoices([
    before.createChoice('No', FormApp.PageNavigationType.CONTINUE),
    before.createChoice('Yes', FormApp.PageNavigationType.SUBMIT),
  ]);

  // ---- Page 3: the walkthrough ----
  form.addPageBreakItem()
    .setTitle('Try the system')
    .setHelpText(
      'Open the prototype in a new browser tab: ' + APP_URL + '\n' +
      'Password for every account below: ' + DEMO_PASSWORD + '\n\n' +
      'You will play three roles in turn: a patient, a laboratory and a regulator. Switch account with the ' +
      'menu at the top right (Sign out). There are no right or wrong answers; we are testing the system, not you. ' +
      'Keep this form open and come back to it when you have finished.'
    );
  info(form, 'Before you start',
    'Sign in as tunde.adeyemi. If the Patient page shows that Diagnostics Laboratory B already has active ' +
    'consent (left over from someone else), revoke it first, then begin task 1.');
  info(form, 'The seven tasks',
    '1. Sign in as the patient. You are Tunde Adeyemi. Sign in with the username tunde.adeyemi.\n' +
    '2. Grant consent. Allow Diagnostics Laboratory B to see your full record until the end of next month.\n' +
    '3. Request a record as the laboratory. Sign out and sign in as lab.b. Request access to Tunde Adeyemi\'s ' +
    'lab result, ehr-ref-55A.\n' +
    '4. Verify and open the record. Verify your request. If access is granted, open the record. How can you ' +
    'tell it has not been altered?\n' +
    '5. Revoke consent as the patient. Sign in as tunde.adeyemi again and stop Laboratory B from seeing your records.\n' +
    '6. Try again as the laboratory. Sign in as lab.b, try to open the same record again, then make a new ' +
    'request for it and verify it. What happens?\n' +
    '7. Check the audit log as the regulator. Sign in as regulator.e. Find the decisions from the last few ' +
    'minutes and check that the audit log has not been tampered with.');
  form.addGridItem()
    .setTitle('How did each task go?')
    .setRows([
      '1. Sign in as the patient',
      '2. Grant consent',
      '3. Request a record',
      '4. Verify and open the record',
      '5. Revoke consent',
      '6. Try again after revoking',
      '7. Check the audit log',
    ])
    .setColumns(['Did it easily', 'Did it, but had to search or retry', 'Could not do it'])
    .setRequired(true);

  // ---- Page 4: Part A ----
  form.addPageBreakItem().setTitle('Part A: About you');
  choice(form, 'Your role', [
    'Health records officer',
    'Health information management staff',
    'Doctor',
    'Nurse or midwife',
    'Other clinician',
    'Laboratory or pharmacy staff',
    'IT or systems staff',
    'Medical, nursing or other health student (clinical years)',
  ], true);
  choice(form, 'Years working with health records or health information (students: years of clinical placements)',
    ['Less than 2', '2–5', '6–10', 'More than 10']);
  choice(form, 'Type of organisation', [
    'Public hospital or clinic',
    'Private hospital or clinic',
    'Laboratory or pharmacy',
    'Government or regulator',
    'University or training institution',
  ], true);
  choice(form, 'How often you use electronic records systems at work', ['Daily', 'Weekly', 'Rarely', 'Never']);
  choice(form, 'Before today, how familiar were you with blockchain?',
    ['Not at all', 'Heard of it', 'Understand the basics', 'Have used or worked with it']);

  // ---- Page 5: Parts B–D ----
  form.addPageBreakItem()
    .setTitle('Parts B–D: Your views of the system')
    .setHelpText('For each statement, choose the answer that best matches your view.');
  likert(form, 'Part B: Perceived usefulness', [
    'PU1. Using this system would let me check a patient\'s consent more quickly than current methods.',
    'PU2. Using this system would improve how well I handle requests for patient records.',
    'PU3. Using this system would let me deal with more record requests in the same time.',
    'PU4. Using this system would make it easier to show who accessed a record, and why.',
    'PU5. Using this system would make sharing records with other organisations easier.',
    'PU6. Overall, I would find this system useful in my work.',
  ]);
  likert(form, 'Part C: Perceived ease of use', [
    'PEOU1. Learning to use this system was easy for me.',
    'PEOU2. I found it easy to get the system to do what I wanted it to do.',
    'PEOU3. My interaction with the system was clear and understandable.',
    'PEOU4. I could tell what the system had done after each action, such as a grant, a request or a revocation.',
    'PEOU5. It would be easy for me to become skilful at using this system.',
    'PEOU6. Overall, I found this system easy to use.',
  ]);
  likert(form, 'Part D: Intention to use', [
    'BI1. If this system were available at my workplace, I would intend to use it.',
    'BI2. If this system were available at my workplace, I expect I would use it regularly.',
  ]);

  // ---- Page 6: Part E ----
  form.addPageBreakItem().setTitle('Part E: Your comments').setHelpText('Optional, but very helpful.');
  form.addParagraphTextItem().setTitle('What did you find most useful about the system?');
  form.addParagraphTextItem().setTitle('What, if anything, was confusing or difficult to use?');
  form.addParagraphTextItem().setTitle('What would make this system more useful in your work?');

  // ---- Responses sheet and links ----
  const sheet = SpreadsheetApp.create(title + ' (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  form.setAcceptingResponses(true);
  try {
    form.setPublished(true); // newer Google Forms publishing model
  } catch (e) {
    // Older accounts publish automatically.
  }
  let shareUrl = form.getPublishedUrl();
  try {
    shareUrl = form.shortenFormUrl(shareUrl);
  } catch (e) {}

  Logger.log('Share this link with participants: ' + shareUrl);
  Logger.log('Edit the form: ' + form.getEditUrl());
  Logger.log('Responses sheet: ' + sheet.getUrl());
}

function info(form, title, text) {
  form.addSectionHeaderItem().setTitle(title).setHelpText(text);
}

function choice(form, title, options, withOther) {
  const item = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(options).setRequired(true);
  if (withOther) item.showOtherOption(true);
  return item;
}

function likert(form, title, rows) {
  form.addGridItem().setTitle(title).setRows(rows).setColumns(LIKERT).setRequired(true);
}
