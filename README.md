# AI Prospector — HSE & Agency Lead Finder

A Chrome extension (Manifest V3) that uses OpenRouter's web search to find
companies matching two prospecting niches, runs a full needs/gap analysis
on any company you pick, looks up the decision-maker(s) to contact, drafts
outreach tailored to whether you're selling a service or seeking to be
hired, and tracks everything in a lightweight built-in CRM. Opens as a
**side panel** that stays open as you browse.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`prospector-extension`).
4. Click the extension icon in the toolbar — it opens as a side panel that
   stays docked to the browser window. Unlike a popup, it does **not**
   close when you click a link, switch tabs, or click elsewhere on the
   page — only when you close the panel yourself.

## Set up your OpenRouter key

1. Get a key at https://openrouter.ai/keys (starts with `sk-or-v1-`).
2. Go to the **Settings** tab, paste the key.
3. Set the model slug you want to use (default:
   `anthropic/claude-sonnet-4.5`). Any slug from
   https://openrouter.ai/models works — e.g. `openai/gpt-4o-mini` for a
   cheaper option, or `perplexity/sonar` which has strong native search.
4. Optionally set a default region, a service profile for **Custom** mode,
   and a **default offering** — what you'd sell by default (e.g. "a safety
   training management platform I built for HSE training centres"). This
   pre-fills the "what are you selling" field when generating outreach.
5. Click **Save settings**. The key is stored only in this browser via
   `chrome.storage.local` — it's never sent anywhere except directly to
   OpenRouter.

## How it works

Discovery, analysis, and contact lookup all run through OpenRouter's
web-search plugin (`plugins: [{ id: "web" }]`), which attaches live search
results to the conversation before the model responds — this works
regardless of which model you pick in Settings.

**Search tab** — pick a mode:
- **HSE Training** — finds safety/HSE training providers, certification
  bodies, or employers related to a specific training you name (e.g. "Work
  at Height"), flagging compliance gaps or expansion signals.
- **Agency Hiring** — finds web design/development/marketing agencies that
  are hiring, outsourcing, or show signs of needing developer help.
- **Custom** — free-text criteria, matched against the service profile you
  set in Settings.

Type your focus (and optionally a region), then **Find companies**.

**Results tab** — for any company:
- **Analyze** — full breakdown (needs, gaps, fit, and a tailored pitch angle).
- **Find contacts** — searches for the decision-maker(s) most relevant to
  the opportunity (HSE/Training Manager, Ops Director, HR/Recruitment
  lead, or Founder), with name, role, LinkedIn, and email/phone *only*
  when publicly published — nothing is guessed or invented.
- **Save to CRM** to keep the company, its analysis, and any contacts found.

**CRM tab** — saved leads with status tracking (new / contacted / won /
lost), a **Find/Refresh contacts** button if you didn't run it earlier,
and a **Generate outreach** control with two settings:
- **Goal: Sell a service** — pitches the offering you type in that field
  (defaults to your Settings default offering) against the company's
  specific gap.
- **Goal: Get hired/contracted** — positions you as the person/consultant
  to engage, framed around your relevant expertise rather than a product.

## Notes

- Analyze, Find companies, and Find contacts each use OpenRouter credits
  (the web-search plugin costs a bit more than a plain completion).
- Contact lookup is deliberately conservative: it only reports names,
  emails, and phone numbers it found real public evidence for, and returns
  an empty list rather than guessing when nothing solid turns up.
- Search quality varies by model — models with strong native browsing
  (e.g. `perplexity/sonar`, `openai/gpt-4o-search-preview`) tend to return
  more reliable results than models relying purely on the plugin.
- The side panel is a per-window UI; closing all Chrome windows closes it
  too, but CRM data persists in `chrome.storage.local` regardless.

## What's new: bulk actions, contacts-per-lead, CSV, presets & more

**Search tab**
- **Saved presets** — click "Save as preset" to store the current mode/query/region as a one-click chip above the search form.

**Results tab**
- **Bulk actions** — "Analyze all" and "Find contacts (all)" run the corresponding AI call across every un-processed result in the list, one at a time.
- **Hide low confidence** — toggle to collapse the list to medium/high-confidence matches once analysis has run.
- **Not interested** — removes a company from the current results and adds it to your exclude list, so future searches won't resurface it (enforced by asking the model to skip it, not just a local filter).

**CRM tab**
- **Notes field** — free text per lead for anything the AI can't infer (e.g. "spoke to them at OTC 2025").
- **Multiple contacts** — if more than one decision-maker is found, a dropdown lets you pick who outreach should be addressed to.
- **Generate LinkedIn msg** — a second, shorter draft suited to a LinkedIn connection note/DM, alongside the email draft.
- **Open in Mail** — appears once an email draft exists and the addressed contact has a public email, prefilling a `mailto:` link.
- **Export CSV** — downloads all CRM leads (including notes, contacts, and outreach drafts) as a spreadsheet-ready file.
- **Duplicate detection** — saving a company already in your CRM (matched by name/website) updates the existing entry instead of creating a second one.

**Settings tab**
- **Saved offerings** — keep 2–3 offerings on hand (e.g. HSE training delivery, your training-centre software, recruitment consulting) and pick one per-lead from a dropdown instead of retyping the "what are you selling" field each time.
- **Excluded companies** — view and remove entries from your exclude list.

**Header**
- A small call counter shows how many OpenRouter calls this session has used, since discovery/analysis/contacts/outreach/LinkedIn each cost credits.

## Gmail sending (one-time setup)

The CRM's **"Send via Gmail"** button sends outreach directly from your own
Google account using OAuth — no password or app password is ever stored.
Because Gmail's OAuth requires an app identity you control, you need to
create a small (free) Google Cloud OAuth client once before this works.

1. **Load the extension first** (see above) so Chrome assigns it an ID.
   Go to `chrome://extensions`, find "AI Prospector", and copy its **ID**
   (a long string under the extension name).
2. Go to https://console.cloud.google.com/ and create a new project (or
   use an existing one).
3. Enable the **Gmail API**: APIs & Services → Library → search "Gmail
   API" → Enable.
4. Configure the **OAuth consent screen** (APIs & Services → OAuth
   consent screen): choose "External," fill in an app name and your
   email, and add yourself as a test user. It can stay in "Testing" mode
   indefinitely for personal use.
5. Create credentials: APIs & Services → Credentials → Create Credentials
   → OAuth client ID → Application type **Chrome Extension** → paste the
   extension ID from step 1 → Create. Copy the generated **Client ID**
   (ends in `.apps.googleusercontent.com`).
6. Open `manifest.json` in this folder and replace
   `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com` with the
   client ID from step 5.
7. Go back to `chrome://extensions` and click the **reload** icon on the
   extension to pick up the manifest change.
8. On your next "Send via Gmail" click, Chrome will show a Google
   sign-in/consent popup (once) asking to allow the app to send email on
   your behalf. After that, sending is silent.

**Notes**
- The scope requested is `gmail.send` only — this extension can send
  email as you, but cannot read your inbox or anything else in your
  Google account.
- If you ever move this extension folder to a different path, Chrome
  will assign it a new ID, which breaks the OAuth client (Chrome
  Extension–type clients are tied to the exact ID). You'd need to create
  a new OAuth client with the new ID, or repackage/publish the extension
  properly for a stable ID.
- **Disconnect Google account** in Settings clears the cached token and
  revokes it with Google, so the next send starts a fresh sign-in — handy
  if you want to switch which Google account sends outreach.
