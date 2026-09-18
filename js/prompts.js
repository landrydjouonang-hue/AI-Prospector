// prompts.js - builds the system/user prompts for each search mode.
// Two AI calls per lead lifecycle:
//   1. discovery  - cheap, broad, returns a JSON list of candidate companies
//   2. analysis   - deep dive on ONE chosen company, returns the full breakdown

const DISCOVERY_JSON_CONTRACT = `Return ONLY a valid JSON array, nothing else - no markdown fences, no preamble, no explanation.
Each element must be an object with exactly these fields:
{
  "name": "Company name",
  "website": "https://... (best known URL, or empty string if unknown)",
  "location": "City/Region/Country if known, else empty string",
  "signal": "One sentence: the specific, concrete reason this company matched the search (e.g. what training they offer/lack, what role they're hiring for, what gap was found)",
  "sourceUrl": "The URL of the page where this signal was found, if available"
}
Return at most 12 companies. Only include real companies you found evidence for via web search - never invent placeholder companies.`;

export function buildDiscoveryPrompt(mode, query, region, excludedCompanies = []) {
  const regionClause = region ? ` Focus on the region: ${region}.` : "";
  const excludeClause =
    excludedCompanies && excludedCompanies.length
      ? `\nDo NOT include these companies - they've already been contacted or ruled out: ${excludedCompanies
          .map((e) => e.name || e.website)
          .filter(Boolean)
          .join(", ")}.`
      : "";

  let system, task;

  if (mode === "hse") {
    system = `You are a lead-discovery research assistant working for an HSE (Health, Safety & Environment) training consultant and software provider. Your job is to use live web search to find real companies in the safety/HSE training space - training providers, certification bodies, industrial employers - that represent a genuine business opportunity for HSE training services or safety-training-management software.`;
    task = `Search the web and find companies related to this HSE training niche: "${query}".${regionClause}${excludeClause}
Look specifically for signals such as:
- Companies advertising or offering the specific training/certification mentioned (possible competitors or partners)
- Companies that appear to need this training but don't currently offer/hold it (compliance gap - a strong lead)
- Training providers expanding their course catalog, hiring instructors, or opening new accreditations
- Industrial/offshore employers publicly requiring this certification for staff (potential client for training delivery)
${DISCOVERY_JSON_CONTRACT}`;
  } else if (mode === "agency") {
    system = `You are a lead-discovery research assistant working for a freelance/contract web developer and software engineer. Your job is to use live web search to find real web design, web development, or marketing agencies that are actively hiring, outsourcing, or in need of web/software development help.`;
    task = `Search the web and find agencies matching this criteria: "${query}".${regionClause}${excludeClause}
Look specifically for signals such as:
- Active job postings for web developers, freelance developers, or software engineers
- Agencies whose site or portfolio shows outdated/broken tech that a developer could help modernize
- Agencies explicitly stating they partner with freelance developers or need overflow dev capacity
- Recent agency growth (new clients announced, expanding services) suggesting they may need more dev capacity
${DISCOVERY_JSON_CONTRACT}`;
  } else {
    // custom / free-text mode
    system = `You are a lead-discovery research assistant. Your job is to use live web search to find real companies matching the user's custom prospecting criteria, and to note a concrete, evidence-based signal for why each one is a good match.`;
    task = `Search the web and find companies matching this custom criteria: "${query}".${regionClause}${excludeClause}
${DISCOVERY_JSON_CONTRACT}`;
  }

  return { system, user: task };
}

const ANALYSIS_JSON_CONTRACT = `Return ONLY a valid JSON object, nothing else - no markdown fences, no preamble.
{
  "needs": ["short bullet describing an identified need", "..."],
  "gaps": ["short bullet describing a gap between what they have and what they need", "..."],
  "fit": "1-3 sentences on how the consultant's services specifically address this company's gaps",
  "pitchAngle": "A single tailored opening angle/hook for an outreach message to this company, referencing the specific signal found",
  "confidence": "high | medium | low - how strong the evidence for this lead is"
}`;

export function buildAnalysisPrompt(mode, company, serviceProfile, defaultOffering = "") {
  const regionLine = company.location ? `Location: ${company.location}\n` : "";
  const sourceLine = company.sourceUrl ? `Source of signal: ${company.sourceUrl}\n` : "";

  const offeringLine = defaultOffering ? ` and this software/product: ${defaultOffering}` : "";

  const context =
    mode === "hse"
      ? `The consultant offers: HSE/safety training delivery (OPITO, IRATA, BOSIET, HUET, GHS/SGH, electrical habilitation NF C 18-510, etc.)${offeringLine}.`
      : mode === "agency"
      ? `The consultant offers: freelance/contract web development and software engineering services.`
      : `The consultant's services: ${serviceProfile || "general professional services (not specified)"}`;

  const system = `You are a B2B sales research analyst. Given one company and a short profile of the consultant's services, use web search to gather a bit more detail on the company if useful, then produce a concise, evidence-grounded needs/gap analysis to prepare an outreach pitch. Be concrete and specific - avoid generic filler like "could benefit from digital transformation".`;

  const user = `Company: ${company.name}
Website: ${company.website || "unknown"}
${regionLine}${sourceLine}Signal found during discovery: ${company.signal}

Consultant context: ${context}

Analyze this company against the consultant's services and produce the breakdown.
${ANALYSIS_JSON_CONTRACT}`;

  return { system, user };
}

const CONTACTS_JSON_CONTRACT = `Return ONLY a valid JSON object, nothing else - no markdown fences, no preamble.
{
  "contacts": [
    {
      "name": "Full name, or empty string if only a role/title was found",
      "role": "Job title, e.g. 'HSE Manager', 'Training Director', 'Head of Operations'",
      "linkedin": "LinkedIn profile URL if found, else empty string",
      "email": "Email address ONLY if publicly published (e.g. on the company site or a press release) - never guess or construct one",
      "phone": "Phone number ONLY if publicly published, else empty string",
      "source": "URL of the page where this contact was found"
    }
  ]
}
Prioritize people who would actually make the buying/hiring decision for this kind of engagement: HSE/Training Managers, Operations Directors, HR/Recruitment leads, or Founders/Owners for smaller companies. Return at most 5 contacts. Only include people you found real evidence for via web search - never invent names, emails, or roles. If nothing is found, return an empty array.`;

export function buildContactsPrompt(mode, company) {
  const system = `You are a B2B research assistant that finds publicly available information about the decision-makers at a specific company, for legitimate outreach purposes. You only report information that is genuinely public (company "About/Team" pages, LinkedIn, press releases, conference speaker bios, etc.) and never fabricate or guess contact details.`;

  const user = `Company: ${company.name}
Website: ${company.website || "unknown"}
${company.location ? `Location: ${company.location}\n` : ""}Context: this company was flagged in a ${mode === "hse" ? "HSE/safety training" : mode === "agency" ? "web/agency hiring" : "prospecting"} search. Signal: ${company.signal || ""}

Search the web and find the decision-maker(s) at this company most relevant to that context.
${CONTACTS_JSON_CONTRACT}`;

  return { system, user };
}

/**
 * objective: "sell" (pitching a specific product/service to this company) or
 *            "hire" (positioning the consultant to be hired/contracted by this company)
 * offering: free-text description of what's being sold, used only when objective === "sell"
 * contact: the specific contact object to address (from lead.contacts), or null
 */
export function buildOutreachPrompt(mode, lead, serviceProfile, objective = "sell", offering = "", contact = null) {
  const fallbackContext =
    mode === "hse"
      ? `HSE/safety training delivery services.`
      : mode === "agency"
      ? `freelance/contract web development and software engineering.`
      : serviceProfile || "professional services";

  const chosenContact = contact || (lead.contacts && lead.contacts.length ? lead.contacts[0] : null);
  const contactLine = chosenContact
    ? `Address it to: ${chosenContact.name || chosenContact.role} (${chosenContact.role || "role unknown"}).\n`
    : "";

  let system, goalLine;

  if (objective === "hire") {
    goalLine = `The consultant wants to be HIRED or CONTRACTED by this company - positioned as a candidate/service provider they should engage, not as someone selling them a product. Frame the email around the consultant's specific relevant expertise and how it addresses the company's identified gap, and propose a short call to discuss availability/engagement.`;
    system = `You write short, specific, non-generic outreach emails for a consultant seeking to be hired or contracted by a company. No fluff, no "I hope this email finds you well", no generic flattery. Reference the specific signal/gap found. 120-180 words. End with a low-friction call to action.`;
  } else {
    const offeringLine = offering ? `The specific product/service to sell: ${offering}.` : `What the consultant offers: ${fallbackContext}`;
    goalLine = `The consultant wants to SELL a specific product/service to this company. ${offeringLine} Frame the email around how that specific offering addresses the company's identified gap - this is a sales pitch, not a job application.`;
    system = `You write short, specific, non-generic cold sales outreach emails for a B2B consultant. No fluff, no "I hope this email finds you well", no generic flattery. Reference the specific signal/gap found. 120-180 words. End with a low-friction call to action (a short call or demo, not a hard sell).`;
  }

  const user = `Company: ${lead.name}
${contactLine}Signal: ${lead.signal}
Identified needs: ${(lead.needs || []).join("; ")}
Identified gaps: ${(lead.gaps || []).join("; ")}
Pitch angle to use: ${lead.pitchAngle || ""}

${goalLine}

Write the outreach email. Return ONLY the email body text, no subject line label, no JSON, no markdown.`;

  return { system, user };
}

/**
 * Shorter-form message suited to a LinkedIn connection note / DM
 * (LinkedIn's own tone norms: brief, casual-professional, no email formality).
 */
export function buildLinkedInPrompt(mode, lead, objective = "sell", offering = "", contact = null) {
  const fallbackContext =
    mode === "hse"
      ? `HSE/safety training delivery services.`
      : mode === "agency"
      ? `freelance/contract web development and software engineering.`
      : "professional services";

  const chosenContact = contact || (lead.contacts && lead.contacts.length ? lead.contacts[0] : null);
  const nameLine = chosenContact?.name ? `Their name: ${chosenContact.name} (${chosenContact.role || "role unknown"}).\n` : "";

  const goalLine =
    objective === "hire"
      ? `Goal: get hired/contracted by this company - positioned as a candidate/consultant, referencing relevant expertise.`
      : `Goal: sell ${offering || fallbackContext} to this company, referencing the specific gap found.`;

  const system = `You write short LinkedIn connection request notes and short DMs for B2B outreach. LinkedIn norms: casual-professional, no "Dear" or email formality, no subject line. Maximum 400 characters (LinkedIn connection notes are capped at 300 characters, so aim for under that when possible). Reference the specific signal found. End with a soft, low-friction question rather than a hard ask.`;

  const user = `Company: ${lead.name}
${nameLine}Signal: ${lead.signal}
Pitch angle: ${lead.pitchAngle || ""}
${goalLine}

Write the LinkedIn message. Return ONLY the message text, nothing else.`;

  return { system, user };
}
