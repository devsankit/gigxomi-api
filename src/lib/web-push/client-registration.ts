"use client";

import { getToken, onMessage, type MessagePayload, type Messaging } from "firebase/messaging";

import { getFirebaseMessaging, getFirebaseWebVapidKey } from "@/lib/web-push/firebase-web";

export type WebPushRegistrationStatus =
  | "registered"
  | "unsupported"
  | "permission-default"
  | "permission-denied"
  | "missing-config"
  | "token-unavailable"
  | "failed";

export type WebPushForegroundHandler = (
  payload: MessagePayload,
  serviceWorkerRegistration: ServiceWorkerRegistration,
) => void | Promise<void>;

export type WebPushRegistrationResult = {
  ok: boolean;
  status: WebPushRegistrationStatus;
  permission?: NotificationPermission;
  token?: string;
  error?: string;
  unsubscribe?: () => void;
};

type RegisteredWebPush = {
  messaging: Messaging;
  serviceWorkerRegistration: ServiceWorkerRegistration;
  token: string;
};

const foregroundHandlers = new Set<WebPushForegroundHandler>();

let cachedRegistration: RegisteredWebPush | null = null;
let registrationPromise: Promise<WebPushRegistrationResult> | null = null;
let foregroundUnsubscribe: (() => void) | null = null;
let shouldShowForegroundNotifications = false;

async function saveWebPushToken(token: string) {
  const response = await fetch("/api/mobile/push-token", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
      platform: "web",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Push token save failed (${response.status}): ${body}`);
  }
}

function getPayloadDeepLink(payload: MessagePayload) {
  const dataLink = typeof payload.data?.deepLinkUrl === "string" ? payload.data.deepLinkUrl.trim() : "";
  if (dataLink) {
    return dataLink;
  }

  const link = typeof payload.fcmOptions?.link === "string" ? payload.fcmOptions.link.trim() : "";
  return link || "/";
}

function getPayloadTag(payload: MessagePayload) {
  const explicitTag = typeof payload.data?.tag === "string" ? payload.data.tag.trim() : "";
  if (explicitTag) {
    return explicitTag;
  }

  const conversationId = typeof payload.data?.conversationId === "string" ? payload.data.conversationId.trim() : "";
  if (conversationId) {
    return `gigxomi-chat-${conversationId}`;
  }

  const type = typeof payload.data?.type === "string" ? payload.data.type.trim().toLowerCase() : "update";
  return `gigxomi-${type}`;
}

async function showForegroundNotification(payload: MessagePayload, serviceWorkerRegistration: ServiceWorkerRegistration) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const title = payload.notification?.title?.trim() || "Gigxomi update";
  const body = payload.notification?.body?.trim() || "You have a new notification.";
  const data = {
    ...(payload.data ?? {}),
    deepLinkUrl: getPayloadDeepLink(payload),
  };
  const notificationOptions: NotificationOptions & { badge?: string; renotify?: boolean } = {
    body,
    icon: "/gigxomi-logo.png",
    badge: "/gigxomi-logo.png",
    data,
    tag: getPayloadTag(payload),
    renotify: true,
    requireInteraction: true,
  };

  try {
    await serviceWorkerRegistration.showNotification(title, notificationOptions);
  } catch {
    try {
      new Notification(title, {
        body,
        icon: "/gigxomi-logo.png",
        data,
        tag: getPayloadTag(payload),
      });
    } catch {
      // Browser foreground notifications are best-effort.
    }
  }
}

async function registerWebPushToken(requestPermission: boolean): Promise<WebPushRegistrationResult> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, status: "unsupported" };
  }

  let permission = Notification.permission;
  if (permission === "default" && requestPermission) {
    permission = await Notification.requestPermission();
  }

  if (permission === "default") {
    return { ok: false, status: "permission-default", permission };
  }

  if (permission !== "granted") {
    return { ok: false, status: "permission-denied", permission };
  }

  if (cachedRegistration) {
    return {
      ok: true,
      status: "registered",
      permission,
      token: cachedRegistration.token,
    };
  }

  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = (async () => {
    try {
      const vapidKey = await getFirebaseWebVapidKey();
      if (!vapidKey) {
        return { ok: false, status: "missing-config", permission } satisfies WebPushRegistrationResult;
      }

      const messaging = await getFirebaseMessaging();
      if (!messaging) {
        return { ok: false, status: "unsupported", permission } satisfies WebPushRegistrationResult;
      }

      const serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration,
      });

      if (!token) {
        return { ok: false, status: "token-unavailable", permission } satisfies WebPushRegistrationResult;
      }

      await saveWebPushToken(token);
      cachedRegistration = {
        messaging,
        serviceWorkerRegistration,
        token,
      };

      return {
        ok: true,
        status: "registered",
        permission,
        token,
      } satisfies WebPushRegistrationResult;
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        permission,
        error: error instanceof Error ? error.message : "Web push registration failed.",
      } satisfies WebPushRegistrationResult;
    } finally {
      registrationPromise = null;
    }
  })();

  return registrationPromise;
}

function ensureForegroundListener(registration: RegisteredWebPush) {
  if (foregroundUnsubscribe) {
    return;
  }

  foregroundUnsubscribe = onMessage(registration.messaging, (payload) => {
    if (shouldShowForegroundNotifications) {
      void showForegroundNotification(payload, registration.serviceWorkerRegistration);
    }

    foregroundHandlers.forEach((handler) => {
      void Promise.resolve(handler(payload, registration.serviceWorkerRegistration)).catch(() => undefined);
    });
  });
}

export async function startWebPushNotifications(options: {
  requestPermission?: boolean;
  showForegroundNotification?: boolean;
  onForegroundMessage?: WebPushForegroundHandler;
} = {}): Promise<WebPushRegistrationResult> {
  const foregroundHandler = options.onForegroundMessage;

  if (options.showForegroundNotification !== false) {
    shouldShowForegroundNotifications = true;
  }

  if (foregroundHandler) {
    foregroundHandlers.add(foregroundHandler);
  }

  const result = await registerWebPushToken(Boolean(options.requestPermission));
  if (!result.ok || !cachedRegistration) {
    if (foregroundHandler) {
      foregroundHandlers.delete(foregroundHandler);
    }
    return result;
  }

  ensureForegroundListener(cachedRegistration);

  return {
    ...result,
    unsubscribe: foregroundHandler
      ? () => {
          foregroundHandlers.delete(foregroundHandler);
        }
      : undefined,
  };
}
