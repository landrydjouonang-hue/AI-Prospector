// gmail.js - sends email directly through the user's own Gmail account via
// chrome.identity (OAuth) + the Gmail API. Runs in the background service
// worker. No password or app-specific token ever touches this extension -
// chrome.identity handles the OAuth consent screen and token natively.

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Gets a Google OAuth access token for the gmail.send scope declared in
 * manifest.json's oauth2 block. interactive=true pops the consent screen
 * the first time (or after the user has never granted access); after that,
 * Chrome caches and silently refreshes the token.
 */
function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "Could not get a Google auth token."));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function toBase64Url(base64) {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds a base64url-encoded RFC 2822 message for the Gmail API's `raw` field.
 */
function buildRawMessage({ to, subject, body }) {
  const subjectEncoded = `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
  const bodyEncoded = utf8ToBase64(body);

  const message = [
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    bodyEncoded
  ].join("\r\n");

  return toBase64Url(utf8ToBase64(message));
}

/**
 * Sends an email through the signed-in Google account. Retries once with a
 * fresh token if the cached one has expired/been revoked.
 */
export async function sendGmail({ to, subject, body }) {
  if (!to) throw new Error("No recipient email address.");

  let token = await getAuthToken(true);
  let raw;
  try {
    raw = buildRawMessage({ to, subject, body });
  } catch (e) {
    throw new Error(`Could not build the email: ${e.message}`);
  }

  let res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ raw })
  });

  if (res.status === 401) {
    // Token expired or was revoked - drop it and get a fresh one, then retry once.
    await removeCachedToken(token);
    token = await getAuthToken(true);
    res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ raw })
    });
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Gmail API error (${res.status}): ${detail}`);
  }

  return await res.json();
}

/**
 * Fully signs the user out of the extension's cached Google token so the
 * next send re-prompts consent (useful if they want to switch accounts).
 */
export async function disconnectGmail() {
  try {
    const token = await getAuthToken(false);
    await removeCachedToken(token);
    // Also revoke the token with Google so it no longer shows as an
    // authorized app, not just remove it from Chrome's local cache.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
  } catch {
    // No cached token to remove - nothing to do.
  }
}
