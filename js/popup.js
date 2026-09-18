import {
  getSettings,
  saveSettings,
  getLeads,
  saveLead,
  updateLeadStatus,
  updateLeadNotes,
  deleteLead,
  saveOffering,
  deleteOffering,
  addExcludedCompany,
  removeExcludedCompany,
  saveSearchPreset,
  deleteSearchPreset
} from "./storage.js";
import { DEFAULT_OPENROUTER_MODEL } from "./api.js";

let currentMode = "hse";
let lastResults = []; // in-memory discovery results for the current session
let usageCount = 0;

const MODE_HINTS = {
  hse: 'e.g. "companies offering Work at Height training"',
  agency: 'e.g. "web agencies hiring freelance developers"',
  custom: 'e.g. "your own custom prospecting criteria"'
};

const OPENROUTER_TYPES = new Set(["discover", "analyze", "contacts", "outreach", "linkedin"]);

// Wraps chrome.runtime.sendMessage to track how many OpenRouter calls this session has made.
async function callBg(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (res.ok && OPENROUTER_TYPES.has(message.type)) bumpUsage();
  return res;
}

function bumpUsage() {
  usageCount += 1;
  const el = document.getElementById("usage-counter");
  if (el) el.textContent = `${usageCount} call${usageCount === 1 ? "" : "s"}`;
}

// ---------- Tab navigation ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
  if (tab === "crm") renderCrm();
  if (tab === "settings") {
    renderOfferings();
    renderExcluded();
  }
}

// ---------- Mode selector ----------
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("query-hint").textContent = MODE_HINTS[currentMode];
  });
});

// ---------- Search presets ----------
async function renderPresets() {
  const settings = await getSettings();
  const row = document.getElementById("presets-row");
  const presets = settings.searchPresets || [];

  if (!presets.length) {
    row.innerHTML = "";
    return;
  }

  row.innerHTML = presets
    .map(
      (p) => `<span class="preset-chip" data-id="${p.id}">
        <span class="preset-apply">${escapeHtml(p.label)}</span>
        <span class="preset-delete" data-id="${p.id}">&times;</span>
      </span>`
    )
    .join("");

  presets.forEach((p) => {
    const chip = row.querySelector(`.preset-chip[data-id="${p.id}"] .preset-apply`);
    chip?.addEventListener("click", () => applyPreset(p));
    const del = row.querySelector(`.preset-delete[data-id="${p.id}"]`);
    del?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteSearchPreset(p.id);
      renderPresets();
    });
  });
}

function applyPreset(preset) {
  currentMode = preset.mode;
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === preset.mode));
  document.getElementById("query-hint").textContent = MODE_HINTS[currentMode];
  document.getElementById("query-input").value = preset.query || "";
  document.getElementById("region-input").value = preset.region || "";
}

document.getElementById("save-preset-btn").addEventListener("click", async () => {
  const query = document.getElementById("query-input").value.trim();
  const region = document.getElementById("region-input").value.trim();
  const statusEl = document.getElementById("search-status");

  if (!query) {
    statusEl.textContent = "Enter a search focus before saving a preset.";
    statusEl.className = "status-line error";
    return;
  }

  const label = query.length > 30 ? `${query.slice(0, 30)}...` : query;
  await saveSearchPreset({ label, mode: currentMode, query, region });
  renderPresets();
  statusEl.textContent = "Preset saved.";
  statusEl.className = "status-line success";
});

// ---------- Search ----------
document.getElementById("search-btn").addEventListener("click", runSearch);

async function runSearch() {
  const query = document.getElementById("query-input").value.trim();
  const region = document.getElementById("region-input").value.trim();
  const statusEl = document.getElementById("search-status");
  const btn = document.getElementById("search-btn");

  if (!query) {
    statusEl.textContent = "Enter what you're looking for first.";
    statusEl.className = "status-line error";
    return;
  }

  btn.disabled = true;
  statusEl.className = "status-line";
  statusEl.innerHTML = `<span class="spinner"></span> Searching the web for matching companies...`;

  const res = await callBg({ type: "discover", mode: currentMode, query, region });

  btn.disabled = false;

  if (!res.ok) {
    statusEl.textContent = `Error: ${res.error}`;
    statusEl.className = "status-line error";
    return;
  }

  lastResults = (res.companies || []).map((c, i) => ({
    ...c,
    _localId: `r${Date.now()}_${i}`,
    mode: currentMode
  }));

  statusEl.textContent = `Found ${lastResults.length} companies. See the Results tab.`;
  statusEl.className = "status-line success";
  renderResults();
  switchTab("results");
}

// ---------- Results ----------
document.getElementById("hide-low-confidence").addEventListener("change", renderResults);
document.getElementById("bulk-analyze-btn").addEventListener("click", runBulkAnalyze);
document.getElementById("bulk-contacts-btn").addEventListener("click", runBulkContacts);

function renderResults() {
  const listEl = document.getElementById("results-list");
  const emptyEl = document.getElementById("results-empty");
  const hideLow = document.getElementById("hide-low-confidence").checked;

  const visible = lastResults.filter((c) => !(hideLow && (c.confidence || "").toLowerCase() === "low"));

  if (!lastResults.length) {
    emptyEl.style.display = "block";
    listEl.innerHTML = "";
    return;
  }
  emptyEl.style.display = "none";

  listEl.innerHTML = visible.map((c) => companyCardHtml(c)).join("");

  visible.forEach((c) => {
    const cardEl = document.getElementById(`card-${c._localId}`);
    cardEl.querySelector(".analyze-btn")?.addEventListener("click", () => runAnalysis(c));
    cardEl.querySelector(".contacts-btn")?.addEventListener("click", () => runContactsLookup(c, cardEl));
    cardEl.querySelector(".save-btn")?.addEventListener("click", () => saveResultAsLead(c));
    cardEl.querySelector(".exclude-btn")?.addEventListener("click", () => excludeResult(c));
  });
}

async function excludeResult(company) {
  await addExcludedCompany(company.name, company.website);
  lastResults = lastResults.filter((c) => c._localId !== company._localId);
  renderResults();
}

function companyCardHtml(c) {
  const website = c.website
    ? `<a href="${escapeAttr(c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website)}</a>`
    : "no website found";
  const breakdown = c.needs ? breakdownHtml(c) : "";
  const contacts = c.contacts && c.contacts.length ? contactsHtml(c.contacts) : "";
  return `
  <div class="company-card" id="card-${c._localId}">
    <div class="company-card-header">
      <p class="company-name">${escapeHtml(c.name || "Unnamed company")}</p>
    </div>
    <p class="company-meta">${escapeHtml(c.location || "")} ${c.location ? "&middot;" : ""} ${website}</p>
    <p class="company-signal">${escapeHtml(c.signal || "")}</p>
    <div class="card-actions">
      <button class="secondary-btn analyze-btn">${c.needs ? "Re-analyze" : "Analyze"}</button>
      <button class="secondary-btn contacts-btn">${c.contacts ? "Refresh contacts" : "Find contacts"}</button>
      <button class="secondary-btn save-btn">Save to CRM</button>
      <button class="secondary-btn exclude-btn">Not interested</button>
    </div>
    <div class="breakdown-slot">${breakdown}</div>
    <div class="contacts-slot">${contacts}</div>
  </div>`;
}

async function runAnalysis(company) {
  const cardEl = document.getElementById(`card-${company._localId}`);
  const slot = cardEl.querySelector(".breakdown-slot");
  slot.innerHTML = `<div class="status-line"><span class="spinner"></span> Running full breakdown...</div>`;

  const res = await callBg({ type: "analyze", mode: company.mode, company });

  if (!res.ok) {
    slot.innerHTML = `<div class="status-line error">Error: ${escapeHtml(res.error)} <button class="secondary-btn retry-btn">Retry</button></div>`;
    slot.querySelector(".retry-btn")?.addEventListener("click", () => runAnalysis(company));
    return;
  }

  Object.assign(company, res.breakdown);
  slot.innerHTML = breakdownHtml(company);
  slot.querySelector(".save-btn-2")?.addEventListener("click", () => saveResultAsLead(company));
}

function breakdownHtml(c) {
  const conf = (c.confidence || "medium").toLowerCase();
  return `
  <div class="breakdown">
    <span class="badge ${["high", "medium", "low"].includes(conf) ? conf : "medium"}">${escapeHtml(c.confidence || "medium")} confidence</span>
    <h4>Needs</h4>
    <ul>${(c.needs || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
    <h4>Gaps</h4>
    <ul>${(c.gaps || []).map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul>
    <h4>Fit</h4>
    <p>${escapeHtml(c.fit || "")}</p>
    <div class="pitch-box">${escapeHtml(c.pitchAngle || "")}</div>
    <div class="card-actions">
      <button class="secondary-btn save-btn-2">Save to CRM</button>
    </div>
  </div>`;
}

async function runContactsLookup(company, cardEl) {
  const slot = cardEl.querySelector(".contacts-slot");
  slot.innerHTML = `<div class="status-line"><span class="spinner"></span> Looking up decision-makers...</div>`;

  const res = await callBg({ type: "contacts", mode: company.mode, company });

  if (!res.ok) {
    slot.innerHTML = `<div class="status-line error">Error: ${escapeHtml(res.error)} <button class="secondary-btn retry-btn">Retry</button></div>`;
    slot.querySelector(".retry-btn")?.addEventListener("click", () => runContactsLookup(company, cardEl));
    return;
  }

  company.contacts = res.contacts || [];
  slot.innerHTML = contactsHtml(company.contacts);
}

function contactsHtml(contacts) {
  if (!contacts || !contacts.length) {
    return `<div class="breakdown"><p class="company-meta">No public decision-maker contact found.</p></div>`;
  }
  return `
  <div class="breakdown">
    <h4>Decision-makers</h4>
    <ul class="contacts-list">
      ${contacts
        .map(
          (ct) => `<li>
            <strong>${escapeHtml(ct.name || "Unnamed")}</strong>${ct.role ? ` \u2014 ${escapeHtml(ct.role)}` : ""}<br/>
            ${ct.linkedin ? `<a href="${escapeAttr(ct.linkedin)}" target="_blank" rel="noopener">LinkedIn</a> ` : ""}
            ${ct.email ? `&middot; ${escapeHtml(ct.email)} ` : ""}
            ${ct.phone ? `&middot; ${escapeHtml(ct.phone)}` : ""}
          </li>`
        )
        .join("")}
    </ul>
  </div>`;
}

async function saveResultAsLead(company) {
  const { wasDuplicate } = await saveLead({
    mode: company.mode,
    name: company.name,
    website: company.website,
    location: company.location,
    signal: company.signal,
    sourceUrl: company.sourceUrl,
    needs: company.needs || [],
    gaps: company.gaps || [],
    fit: company.fit || "",
    pitchAngle: company.pitchAngle || "",
    confidence: company.confidence || "",
    contacts: company.contacts || []
  });
  const statusEl = document.getElementById("search-status");
  statusEl.textContent = wasDuplicate
    ? `"${company.name}" was already in your CRM \u2014 updated existing entry.`
    : `Saved "${company.name}" to CRM.`;
  statusEl.className = "status-line success";
}

async function runBulkAnalyze() {
  const statusEl = document.getElementById("search-status");
  const targets = lastResults.filter((c) => !c.needs);
  for (let i = 0; i < targets.length; i++) {
    statusEl.textContent = `Analyzing ${i + 1}/${targets.length}...`;
    statusEl.className = "status-line";
    await runAnalysis(targets[i]);
  }
  statusEl.textContent = `Analyzed ${targets.length} companies.`;
  statusEl.className = "status-line success";
}

async function runBulkContacts() {
  const statusEl = document.getElementById("search-status");
  const targets = lastResults.filter((c) => !c.contacts);
  for (let i = 0; i < targets.length; i++) {
    const cardEl = document.getElementById(`card-${targets[i]._localId}`);
    statusEl.textContent = `Finding contacts ${i + 1}/${targets.length}...`;
    statusEl.className = "status-line";
    if (cardEl) await runContactsLookup(targets[i], cardEl);
  }
  statusEl.textContent = `Looked up contacts for ${targets.length} companies.`;
  statusEl.className = "status-line success";
}

// ---------- CRM ----------
document.getElementById("export-csv-btn").addEventListener("click", exportCsv);

async function renderCrm() {
  const leads = await getLeads();
  const settings = await getSettings();
  const listEl = document.getElementById("crm-list");
  const emptyEl = document.getElementById("crm-empty");

  if (!leads.length) {
    emptyEl.style.display = "block";
    listEl.innerHTML = "";
    return;
  }
  emptyEl.style.display = "none";

  listEl.innerHTML = leads.map((l) => leadCardHtml(l, settings)).join("");

  leads.forEach((l) => {
    const cardEl = document.getElementById(`lead-${l.id}`);
    cardEl.querySelector(".status-select")?.addEventListener("change", async (e) => {
      await updateLeadStatus(l.id, e.target.value);
    });
    cardEl.querySelector(".contacts-btn")?.addEventListener("click", () => runLeadContactsLookup(l, cardEl));

    const goalSelect = cardEl.querySelector(".goal-select");
    const offeringInput = cardEl.querySelector(".offering-input");
    const offeringPreset = cardEl.querySelector(".offering-preset-select");
    goalSelect?.addEventListener("change", () => {
      const isSell = goalSelect.value === "sell";
      offeringInput.style.display = isSell ? "block" : "none";
      if (offeringPreset) offeringPreset.style.display = isSell ? "block" : "none";
    });
    offeringPreset?.addEventListener("change", () => {
      if (offeringPreset.value) offeringInput.value = offeringPreset.value;
    });

    const contactSelect = cardEl.querySelector(".contact-select");
    const getChosenContact = () => {
      if (!contactSelect) return (l.contacts && l.contacts[0]) || null;
      const idx = Number(contactSelect.value);
      return l.contacts?.[idx] || null;
    };

    cardEl.querySelector(".outreach-btn")?.addEventListener("click", () => {
      const objective = goalSelect ? goalSelect.value : "sell";
      const offering = offeringInput ? offeringInput.value.trim() : "";
      generateOutreach(l, objective, offering, getChosenContact());
    });
    cardEl.querySelector(".linkedin-btn")?.addEventListener("click", () => {
      const objective = goalSelect ? goalSelect.value : "sell";
      const offering = offeringInput ? offeringInput.value.trim() : "";
      generateLinkedin(l, objective, offering, getChosenContact());
    });
    cardEl.querySelector(".notes-textarea")?.addEventListener("change", async (e) => {
      await updateLeadNotes(l.id, e.target.value);
    });
    cardEl.querySelector(".gmail-send-btn")?.addEventListener("click", (e) => sendViaGmail(l, e.target.dataset.email, cardEl));
    cardEl.querySelector(".delete-btn")?.addEventListener("click", async () => {
      await deleteLead(l.id);
      renderCrm();
    });
  });
}

function leadCardHtml(l, settings) {
  const conf = (l.confidence || "").toLowerCase();
  const contacts = l.contacts || [];
  const offerings = settings.offerings || [];

  const contactSelectHtml =
    contacts.length > 1
      ? `<select class="status-select contact-select">
          ${contacts.map((ct, i) => `<option value="${i}">${escapeHtml(ct.name || ct.role || `Contact ${i + 1}`)}</option>`).join("")}
        </select>`
      : "";

  const offeringPresetHtml = offerings.length
    ? `<select class="status-select offering-preset-select" style="display:${l.outreachObjective === "hire" ? "none" : "block"}">
        <option value="">Choose a saved offering...</option>
        ${offerings.map((o) => `<option value="${escapeAttr(o.description || o.name)}">${escapeHtml(o.name)}</option>`).join("")}
      </select>`
    : "";

  const outreachEmail = l.outreachContactEmail || contacts[0]?.email || "";
  const mailLink = l.outreach && outreachEmail
    ? `<a class="mail-link" href="mailto:${encodeURIComponent(outreachEmail)}?subject=${encodeURIComponent(
        `Regarding ${l.name}`
      )}&body=${encodeURIComponent(l.outreach)}">Open in Mail</a>`
    : "";
  const gmailBtn =
    l.outreach && outreachEmail ? `<button class="secondary-btn gmail-send-btn" data-email="${escapeAttr(outreachEmail)}">Send via Gmail</button>` : "";

  return `
  <div class="company-card" id="lead-${l.id}">
    <div class="company-card-header">
      <p class="company-name">${escapeHtml(l.name || "Unnamed company")}</p>
      ${conf ? `<span class="badge ${conf}">${escapeHtml(l.confidence)}</span>` : ""}
    </div>
    <p class="company-meta">${escapeHtml(l.location || "")} &middot; ${escapeHtml(l.mode)}</p>
    <p class="company-signal">${escapeHtml(l.signal || "")}</p>
    ${l.pitchAngle ? `<div class="pitch-box">${escapeHtml(l.pitchAngle)}</div>` : ""}

    <div class="contacts-slot">${contacts.length ? contactsHtml(contacts) : ""}</div>

    <div class="card-actions">
      <select class="status-select">
        ${["new", "contacted", "won", "lost"].map((s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <button class="secondary-btn contacts-btn">${contacts.length ? "Refresh contacts" : "Find contacts"}</button>
      <button class="secondary-btn delete-btn">Delete</button>
    </div>

    ${contactSelectHtml}

    <div class="goal-row">
      <select class="status-select goal-select">
        <option value="sell" ${l.outreachObjective !== "hire" ? "selected" : ""}>Goal: Sell a service</option>
        <option value="hire" ${l.outreachObjective === "hire" ? "selected" : ""}>Goal: Get hired/contracted</option>
      </select>
      ${offeringPresetHtml}
      <input
        type="text"
        class="offering-input"
        placeholder="What are you selling? e.g. my own training centre management software"
        value="${escapeAttr(l.outreachOffering || settings.defaultOffering || "")}"
        style="display:${l.outreachObjective === "hire" ? "none" : "block"}"
      />
      <div class="inline-actions">
        <button class="secondary-btn outreach-btn wide-secondary">Generate email</button>
        <button class="secondary-btn linkedin-btn wide-secondary">Generate LinkedIn msg</button>
      </div>
    </div>

    <div class="outreach-slot">
      ${l.outreach ? `<div class="outreach-box">${escapeHtml(l.outreach)}</div><div class="inline-actions">${mailLink ? `<p>${mailLink}</p>` : ""}${gmailBtn}</div><div class="gmail-status status-line"></div>` : ""}
    </div>
    <div class="linkedin-slot">${l.linkedinMessage ? `<div class="outreach-box">${escapeHtml(l.linkedinMessage)}</div>` : ""}</div>

    <textarea class="notes-textarea" rows="2" placeholder="Notes (e.g. spoke to them at a conference)...">${escapeHtml(l.notes || "")}</textarea>
  </div>`;
}

async function runLeadContactsLookup(lead, cardEl) {
  const slot = cardEl.querySelector(".contacts-slot");
  slot.innerHTML = `<div class="status-line"><span class="spinner"></span> Looking up decision-makers...</div>`;

  const res = await callBg({ type: "contacts", mode: lead.mode, company: lead });

  if (!res.ok) {
    slot.innerHTML = `<div class="status-line error">Error: ${escapeHtml(res.error)} <button class="secondary-btn retry-btn">Retry</button></div>`;
    slot.querySelector(".retry-btn")?.addEventListener("click", () => runLeadContactsLookup(lead, cardEl));
    return;
  }

  lead.contacts = res.contacts || [];
  await saveLead(lead);
  renderCrm();
}

async function generateOutreach(lead, objective, offering, contact) {
  const cardEl = document.getElementById(`lead-${lead.id}`);
  const slot = cardEl.querySelector(".outreach-slot");
  slot.innerHTML = `<div class="status-line"><span class="spinner"></span> Drafting outreach message...</div>`;

  const res = await callBg({ type: "outreach", mode: lead.mode, lead, objective, offering, contact });

  if (!res.ok) {
    slot.innerHTML = `<div class="status-line error">Error: ${escapeHtml(res.error)} <button class="secondary-btn retry-btn">Retry</button></div>`;
    slot.querySelector(".retry-btn")?.addEventListener("click", () => generateOutreach(lead, objective, offering, contact));
    return;
  }

  lead.outreach = res.outreach;
  lead.outreachObjective = objective;
  lead.outreachOffering = offering;
  lead.outreachContactEmail = contact?.email || "";
  await saveLead(lead);
  renderCrm();
}

async function generateLinkedin(lead, objective, offering, contact) {
  const cardEl = document.getElementById(`lead-${lead.id}`);
  const slot = cardEl.querySelector(".linkedin-slot");
  slot.innerHTML = `<div class="status-line"><span class="spinner"></span> Drafting LinkedIn message...</div>`;

  const res = await callBg({ type: "linkedin", mode: lead.mode, lead, objective, offering, contact });

  if (!res.ok) {
    slot.innerHTML = `<div class="status-line error">Error: ${escapeHtml(res.error)} <button class="secondary-btn retry-btn">Retry</button></div>`;
    slot.querySelector(".retry-btn")?.addEventListener("click", () => generateLinkedin(lead, objective, offering, contact));
    return;
  }

  lead.linkedinMessage = res.linkedin;
  lead.outreachObjective = objective;
  lead.outreachOffering = offering;
  await saveLead(lead);
  renderCrm();
}

async function sendViaGmail(lead, email, cardEl) {
  const statusEl = cardEl.querySelector(".gmail-status");
  const btn = cardEl.querySelector(".gmail-send-btn");
  if (btn) btn.disabled = true;
  statusEl.innerHTML = `<span class="spinner"></span> Sending via Gmail (you may see a Google sign-in popup the first time)...`;
  statusEl.className = "status-line";

  const res = await chrome.runtime.sendMessage({
    type: "gmail_send",
    to: email,
    subject: `Regarding ${lead.name}`,
    body: lead.outreach
  });

  if (btn) btn.disabled = false;

  if (!res.ok) {
    statusEl.textContent = `Could not send: ${res.error}`;
    statusEl.className = "status-line error";
    return;
  }

  statusEl.textContent = `Sent to ${email}.`;
  statusEl.className = "status-line success";
  await updateLeadStatus(lead.id, "contacted");
}

function exportCsv() {
  getLeads().then((leads) => {
    if (!leads.length) return;

    const headers = [
      "Name",
      "Website",
      "Location",
      "Mode",
      "Status",
      "Confidence",
      "Signal",
      "Needs",
      "Gaps",
      "Fit",
      "Pitch angle",
      "Contacts",
      "Notes",
      "Outreach objective",
      "Outreach offering",
      "Outreach email",
      "LinkedIn message"
    ];

    const rows = leads.map((l) => [
      l.name || "",
      l.website || "",
      l.location || "",
      l.mode || "",
      l.status || "",
      l.confidence || "",
      l.signal || "",
      (l.needs || []).join("; "),
      (l.gaps || []).join("; "),
      l.fit || "",
      l.pitchAngle || "",
      (l.contacts || []).map((c) => `${c.name || ""} (${c.role || ""}) ${c.email || ""}`).join(" | "),
      l.notes || "",
      l.outreachObjective || "",
      l.outreachOffering || "",
      l.outreach || "",
      l.linkedinMessage || ""
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospector-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ---------- Settings ----------
async function loadSettingsIntoForm() {
  const s = await getSettings();
  document.getElementById("api-key-input").value = s.openRouterKey || "";
  document.getElementById("model-input").value = s.model || DEFAULT_OPENROUTER_MODEL;
  document.getElementById("default-region-input").value = s.defaultRegion || "";
  document.getElementById("custom-profile-input").value = s.customServiceProfile || "";
  document.getElementById("default-offering-input").value = s.defaultOffering || "";
}

document.getElementById("save-settings-btn").addEventListener("click", async () => {
  const openRouterKey = document.getElementById("api-key-input").value.trim();
  const model = document.getElementById("model-input").value.trim() || DEFAULT_OPENROUTER_MODEL;
  const defaultRegion = document.getElementById("default-region-input").value.trim();
  const customServiceProfile = document.getElementById("custom-profile-input").value.trim();
  const defaultOffering = document.getElementById("default-offering-input").value.trim();

  await saveSettings({ openRouterKey, model, defaultRegion, customServiceProfile, defaultOffering });

  const statusEl = document.getElementById("settings-status");
  statusEl.textContent = "Settings saved.";
  statusEl.className = "status-line success";
});

// ---------- Gmail ----------
document.getElementById("gmail-disconnect-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("gmail-disconnect-status");
  statusEl.innerHTML = `<span class="spinner"></span> Disconnecting...`;
  statusEl.className = "status-line";
  await chrome.runtime.sendMessage({ type: "gmail_disconnect" });
  statusEl.textContent = "Disconnected. The next Gmail send will prompt sign-in again.";
  statusEl.className = "status-line success";
});

// ---------- Offerings management ----------
document.getElementById("add-offering-btn").addEventListener("click", async () => {
  const name = document.getElementById("offering-name-input").value.trim();
  const description = document.getElementById("offering-desc-input").value.trim();
  if (!name) return;
  await saveOffering({ name, description });
  document.getElementById("offering-name-input").value = "";
  document.getElementById("offering-desc-input").value = "";
  renderOfferings();
});

async function renderOfferings() {
  const settings = await getSettings();
  const listEl = document.getElementById("offerings-list");
  const offerings = settings.offerings || [];

  if (!offerings.length) {
    listEl.innerHTML = `<p class="hint-text">No saved offerings yet.</p>`;
    return;
  }

  listEl.innerHTML = offerings
    .map(
      (o) => `<div class="offering-item" data-id="${o.id}">
        <span>${escapeHtml(o.name)}${o.description ? `<span class="offering-desc">${escapeHtml(o.description)}</span>` : ""}</span>
        <button class="item-delete-btn" data-id="${o.id}">Remove</button>
      </div>`
    )
    .join("");

  offerings.forEach((o) => {
    listEl.querySelector(`.item-delete-btn[data-id="${o.id}"]`)?.addEventListener("click", async () => {
      await deleteOffering(o.id);
      renderOfferings();
    });
  });
}

// ---------- Excluded companies management ----------
async function renderExcluded() {
  const settings = await getSettings();
  const listEl = document.getElementById("excluded-list");
  const excluded = settings.excludedCompanies || [];

  if (!excluded.length) {
    listEl.innerHTML = `<p class="hint-text">No excluded companies yet.</p>`;
    return;
  }

  listEl.innerHTML = excluded
    .map(
      (e, i) => `<div class="excluded-item" data-idx="${i}">
        <span>${escapeHtml(e.name || e.website)}</span>
        <button class="item-delete-btn" data-idx="${i}">Remove</button>
      </div>`
    )
    .join("");

  excluded.forEach((e, i) => {
    listEl.querySelector(`.item-delete-btn[data-idx="${i}"]`)?.addEventListener("click", async () => {
      await removeExcludedCompany(e.name, e.website);
      renderExcluded();
    });
  });
}

// ---------- Utils ----------
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(str = "") {
  return escapeHtml(str);
}

// ---------- Init ----------
loadSettingsIntoForm();
renderPresets();
