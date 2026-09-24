import "server-only";

export type FirebaseWebRuntimeConfig = {
  apiKey: string;
  appId: string;
  authDomain: string;
  messagingSenderId: string;
  projectId: string;
  storageBucket: string;
  vapidKey: string;
};

function readEnv(key: string) {
  return globalThis.process?.env?.[key]?.trim() ?? "";
}

export function readFirebaseWebRuntimeConfig(): FirebaseWebRuntimeConfig {
  return {
    apiKey: readEnv("NEXT_PUBLIC_FIREBASE_API_KEY") || readEnv("FIREBASE_WEB_API_KEY"),
    appId: readEnv("NEXT_PUBLIC_FIREBASE_APP_ID") || readEnv("FIREBASE_WEB_APP_ID"),
    authDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") || readEnv("FIREBASE_WEB_AUTH_DOMAIN"),
    messagingSenderId: readEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID") || readEnv("FIREBASE_WEB_MESSAGING_SENDER_ID"),
    projectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID") || readEnv("FIREBASE_WEB_PROJECT_ID"),
    storageBucket: readEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET") || readEnv("FIREBASE_WEB_STORAGE_BUCKET"),
    vapidKey: readEnv("NEXT_PUBLIC_FIREBASE_WEB_PUSH_VAPID_KEY") || readEnv("FIREBASE_WEB_PUSH_VAPID_KEY"),
  };
}

