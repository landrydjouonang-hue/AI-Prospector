// storage.js - all persistence goes through chrome.storage.local.
// Shape:
//   settings: { openRouterKey: string, model: string, defaultRegion: string,
//               customServiceProfile: string, defaultOffering: string,
//               offerings: [{ id, name, description }],
//               excludedCompanies: [{ name, website, addedAt }],
//               searchPresets: [{ id, label, mode, query, region }] }
//   leads: [ { id, mode, name, website, location, signal, sourceUrl,
//              needs, gaps, fit, pitchAngle, confidence, contacts,
//              status, notes, outreach, outreachObjective, outreachOffering,
//              linkedinMessage, createdAt, updatedAt } ]

import { DEFAULT_OPENROUTER_MODEL } from "./api.js";

const DEFAULT_SETTINGS = {
  openRouterKey: "",
  model: DEFAULT_OPENROUTER_MODEL,
  defaultRegion: "",
  customServiceProfile: "",
  defaultOffering: "",
  offerings: [],
  excludedCompanies: [],
  searchPresets: []
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

// ---------- Offerings (multiple saved products/services to pitch) ----------
export async function saveOffering(offering) {
  const settings = await getSettings();
  const offerings = settings.offerings || [];
  const now = Date.now();
  const idx = offerings.findIndex((o) => o.id === offering.id);
  if (idx >= 0) {
    offerings[idx] = { ...offerings[idx], ...offering };
  } else {
    offerings.push({ ...offering, id: offering.id || `${now}-${Math.random().toString(36).slice(2, 6)}` });
  }
  return saveSettings({ offerings });
}

export async function deleteOffering(id) {
  const settings = await getSettings();
  const offerings = (settings.offerings || []).filter((o) => o.id !== id);
  return saveSettings({ offerings });
}

// ---------- Exclude list (companies to never resurface) ----------
export function normalizeCompanyKey(name = "", website = "") {
  const n = (name || "").trim().toLowerCase();
  const w = (website || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return w || n;
}

export async function addExcludedCompany(name, website) {
  const settings = await getSettings();
  const key = normalizeCompanyKey(name, website);
  const excludedCompanies = settings.excludedCompanies || [];
  if (!excludedCompanies.some((e) => normalizeCompanyKey(e.name, e.website) === key)) {
    excludedCompanies.push({ name, website, addedAt: Date.now() });
  }
  return saveSettings({ excludedCompanies });
}

export async function removeExcludedCompany(name, website) {
  const settings = await getSettings();
  const key = normalizeCompanyKey(name, website);
  const excludedCompanies = (settings.excludedCompanies || []).filter(
    (e) => normalizeCompanyKey(e.name, e.website) !== key
  );
  return saveSettings({ excludedCompanies });
}

// ---------- Saved search presets ----------
export async function saveSearchPreset(preset) {
  const settings = await getSettings();
  const searchPresets = settings.searchPresets || [];
  const now = Date.now();
  searchPresets.unshift({ ...preset, id: `${now}-${Math.random().toString(36).slice(2, 6)}` });
  return saveSettings({ searchPresets });
}

export async function deleteSearchPreset(id) {
  const settings = await getSettings();
  const searchPresets = (settings.searchPresets || []).filter((p) => p.id !== id);
  return saveSettings({ searchPresets });
}

// ---------- Leads (CRM) ----------
export async function getLeads() {
  const { leads } = await chrome.storage.local.get("leads");
  return leads || [];
}

/**
 * Saves a lead, deduping against existing leads by normalized name/website.
 * Returns { leads, wasDuplicate, id } so callers can inform the user.
 */
export async function saveLead(lead) {
  const leads = await getLeads();
  const now = Date.now();

  let existingIdx = -1;
  if (lead.id) {
    existingIdx = leads.findIndex((l) => l.id === lead.id);
  }
  if (existingIdx < 0) {
    const key = normalizeCompanyKey(lead.name, lead.website);
    existingIdx = leads.findIndex((l) => normalizeCompanyKey(l.name, l.website) === key);
  }

  let wasDuplicate = false;
  let id;

  if (existingIdx >= 0) {
    wasDuplicate = !lead.id || leads[existingIdx].id !== lead.id;
    id = leads[existingIdx].id;
    leads[existingIdx] = { ...leads[existingIdx], ...lead, id, updatedAt: now };
  } else {
    id = lead.id || `${now}-${Math.random().toString(36).slice(2, 8)}`;
    leads.unshift({
      ...lead,
      id,
      status: lead.status || "new",
      notes: lead.notes || "",
      createdAt: now,
      updatedAt: now
    });
  }

  await chrome.storage.local.set({ leads });
  return { leads, wasDuplicate, id };
}

export async function updateLeadStatus(id, status) {
  const leads = await getLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx >= 0) {
    leads[idx].status = status;
    leads[idx].updatedAt = Date.now();
    await chrome.storage.local.set({ leads });
  }
  return leads;
}

export async function updateLeadNotes(id, notes) {
  const leads = await getLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx >= 0) {
    leads[idx].notes = notes;
    leads[idx].updatedAt = Date.now();
    await chrome.storage.local.set({ leads });
  }
  return leads;
}

export async function deleteLead(id) {
  const leads = await getLeads();
  const filtered = leads.filter((l) => l.id !== id);
  await chrome.storage.local.set({ leads: filtered });
  return filtered;
}
