export function normalizeInstagramGraphApiVersion(value?: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "v25.0";
  }
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

type SendInstagramTextMessageInput = {
  accessToken: string;
  recipientId: string;
  body: string;
  graphApiVersion?: string;
  instagramBusinessAccountId?: string;
};

type SendInstagramTextMessageResult =
  | { ok: true; mode: "instagram-sent"; messageId: string }
  | { ok: false; mode: "instagram-failed"; error: string };

export async function sendInstagramTextMessage(
  input: SendInstagramTextMessageInput,
): Promise<SendInstagramTextMessageResult> {
  const accessToken = input.accessToken.trim();
  const recipientId = input.recipientId.trim();
  const body = input.body.trim();
  const graphApiVersion = normalizeInstagramGraphApiVersion(input.graphApiVersion);
  const instagramBusinessAccountId = String(input.instagramBusinessAccountId ?? "").trim();

  if (!accessToken) {
    return { ok: false, mode: "instagram-failed", error: "Instagram access token is missing." };
  }
  if (!recipientId) {
    return { ok: false, mode: "instagram-failed", error: "Instagram recipient id is missing." };
  }
  if (!body) {
    return { ok: false, mode: "instagram-failed", error: "Instagram message body is empty." };
  }
  if (!instagramBusinessAccountId) {
    return { ok: false, mode: "instagram-failed", error: "Instagram business account id is missing." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  // Instagram User tokens (IGAA...) must use graph.instagram.com.
  // Facebook Page Access tokens (EAA...) use graph.facebook.com.
  const isInstagramUserToken = accessToken.startsWith("IG");
  const primaryEndpoint = isInstagramUserToken
    ? `https://graph.instagram.com/${graphApiVersion}/me/messages`
    : `https://graph.facebook.com/${graphApiVersion}/${instagramBusinessAccountId}/messages`;

  const fallbackEndpoint = isInstagramUserToken
    ? `https://graph.facebook.com/${graphApiVersion}/${instagramBusinessAccountId}/messages`
    : `https://graph.instagram.com/${graphApiVersion}/me/messages`;

  async function postToEndpoint(endpoint: string) {
    const isInstagramDomain = endpoint.includes("graph.instagram.com");
    const bodyPayload = isInstagramDomain
      ? {
          recipient: { id: recipientId },
          message: { text: body },
        }
      : {
          messaging_product: "instagram",
          recipient: { id: recipientId },
          message: { text: body },
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; type?: string; code?: number };
      message_id?: string;
    };

    return { response, payload };
  }

  try {
    let { response, payload } = await postToEndpoint(primaryEndpoint);

    // If primary failed due to token/endpoint mismatch, try the fallback endpoint
    if (!response.ok && (payload.error?.code === 190 || payload.error?.type === "OAuthException")) {
      try {
        const fallbackResult = await postToEndpoint(fallbackEndpoint);
        if (fallbackResult.response.ok) {
          response = fallbackResult.response;
          payload = fallbackResult.payload;
        }
      } catch {
        // keep original response
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        mode: "instagram-failed",
        error: String(payload.error?.message ?? "Instagram Graph API rejected the message send."),
      };
    }

    return {
      ok: true,
      mode: "instagram-sent",
      messageId: String(payload.message_id ?? ""),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "instagram-failed",
      error: error instanceof Error ? error.message : "Unable to reach the Instagram Graph API.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type InstagramUserProfileResult =
  | { ok: true; name?: string; username?: string; profilePicUrl?: string }
  | { ok: false; error: string };

export async function fetchInstagramUserProfile(input: {
  accessToken: string;
  scopedUserId: string;
  graphApiVersion?: string;
}): Promise<InstagramUserProfileResult> {
  const accessToken = input.accessToken.trim();
  const scopedUserId = input.scopedUserId.trim();
  const graphApiVersion = normalizeInstagramGraphApiVersion(input.graphApiVersion);

  if (!accessToken || !scopedUserId) {
    return { ok: false, error: "Missing accessToken or scopedUserId" };
  }

  const isInstagramUserToken = accessToken.startsWith("IG");
  const endpoints = isInstagramUserToken
    ? [
        `https://graph.instagram.com/${graphApiVersion}/${scopedUserId}?fields=name,username,profile_pic`,
        `https://graph.facebook.com/${graphApiVersion}/${scopedUserId}?fields=name,username,profile_pic`,
      ]
    : [
        `https://graph.facebook.com/${graphApiVersion}/${scopedUserId}?fields=name,username,profile_pic`,
        `https://graph.instagram.com/${graphApiVersion}/${scopedUserId}?fields=name,username,profile_pic`,
      ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        const data = (await response.json()) as {
          name?: string;
          username?: string;
          profile_pic?: string;
        };
        const username = typeof data.username === "string" && data.username.trim() ? data.username.trim() : undefined;
        const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
        const profilePicUrl = typeof data.profile_pic === "string" && data.profile_pic.trim() ? data.profile_pic.trim() : undefined;
        if (username || name) {
          return { ok: true, name, username, profilePicUrl };
        }
      }
    } catch {
      // try next endpoint
    }
  }

  return { ok: false, error: "Could not resolve Instagram profile from Meta API." };
}

