import { callModel, extractJson } from "./api.js";
import {
  buildDiscoveryPrompt,
  buildAnalysisPrompt,
  buildOutreachPrompt,
  buildContactsPrompt,
  buildLinkedInPrompt
} from "./prompts.js";
import { getSettings } from "./storage.js";
import { sendGmail, disconnectGmail } from "./gmail.js";

// Open the side panel (instead of a transient popup) when the toolbar icon
// is clicked. The side panel stays open across tab switches and outside
// clicks until the user closes it themselves.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  /* setPanelBehavior can reject on unsupported Chrome versions - fails silently */
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message || String(err) });
  });
  return true; // keep the message channel open for the async response
});

async function handleMessage(message) {
  const { type } = message;
  const settings = await getSettings();

  const NO_KEY_NEEDED = ["ping", "gmail_send", "gmail_disconnect"];
  if (!settings.openRouterKey && !NO_KEY_NEEDED.includes(type)) {
    return { ok: false, error: "No OpenRouter API key set. Add one in the Settings tab." };
  }

  switch (type) {
    case "ping":
      return { ok: true };

    case "discover": {
      const { mode, query, region } = message;
      const { system, user } = buildDiscoveryPrompt(
        mode,
        query,
        region || settings.defaultRegion,
        settings.excludedCompanies
      );
      const { text } = await callModel(settings.openRouterKey, settings.model, system, user, {
        useWebSearch: true,
        maxTokens: 3000
      });
      const companies = extractJson(text);
      return { ok: true, companies: Array.isArray(companies) ? companies : [] };
    }

    case "analyze": {
      const { mode, company } = message;
      const { system, user } = buildAnalysisPrompt(mode, company, settings.customServiceProfile, settings.defaultOffering);
      const { text } = await callModel(settings.openRouterKey, settings.model, system, user, {
        useWebSearch: true,
        maxTokens: 1500
      });
      const breakdown = extractJson(text);
      return { ok: true, breakdown };
    }

    case "contacts": {
      const { mode, company } = message;
      const { system, user } = buildContactsPrompt(mode, company);
      const { text } = await callModel(settings.openRouterKey, settings.model, system, user, {
        useWebSearch: true,
        maxTokens: 1200
      });
      const parsed = extractJson(text);
      return { ok: true, contacts: Array.isArray(parsed?.contacts) ? parsed.contacts : [] };
    }

    case "outreach": {
      const { mode, lead, objective, offering, contact } = message;
      const { system, user } = buildOutreachPrompt(
        mode,
        lead,
        settings.customServiceProfile,
        objective || "sell",
        offering || settings.defaultOffering || "",
        contact || null
      );
      const { text } = await callModel(settings.openRouterKey, settings.model, system, user, {
        useWebSearch: false,
        maxTokens: 500
      });
      return { ok: true, outreach: text };
    }

    case "linkedin": {
      const { mode, lead, objective, offering, contact } = message;
      const { system, user } = buildLinkedInPrompt(
        mode,
        lead,
        objective || "sell",
        offering || settings.defaultOffering || "",
        contact || null
      );
      const { text } = await callModel(settings.openRouterKey, settings.model, system, user, {
        useWebSearch: false,
        maxTokens: 250
      });
      return { ok: true, linkedin: text };
    }

    case "gmail_send": {
      const { to, subject, body } = message;
      try {
        await sendGmail({ to, subject, body });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }

    case "gmail_disconnect": {
      await disconnectGmail();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${type}` };
  }
}
