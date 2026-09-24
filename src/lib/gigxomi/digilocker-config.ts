import "server-only";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function hasDigiLockerProviderConfiguration() {
  const required = [
    "DIGILOCKER_CLIENT_ID",
    "DIGILOCKER_CLIENT_SECRET",
    "DIGILOCKER_AUTHORIZE_URL",
    "DIGILOCKER_TOKEN_URL",
    "DIGILOCKER_USERINFO_URL",
    "DIGILOCKER_REDIRECT_URI",
  ];
  if (required.some((name) => !env(name))) return false;

  const requireIdToken = env("DIGILOCKER_REQUIRE_ID_TOKEN").toLowerCase() === "true";
  return !requireIdToken || Boolean(env("DIGILOCKER_ISSUER") && env("DIGILOCKER_JWKS_URL"));
}
