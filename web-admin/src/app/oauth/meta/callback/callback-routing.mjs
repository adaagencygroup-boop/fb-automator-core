export const LOCAL_CALLBACK_URL = "http://127.0.0.1:28129/oauth/meta/callback";

export function readOAuthResult(hash) {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return {
    state: params.get("state") || "",
    accessToken: params.get("access_token") || "",
    error: params.get("error_description") || params.get("error") || "",
  };
}

export function getCallbackAction(hash) {
  const result = readOAuthResult(hash);
  if (result.state.startsWith("profile.")) return { type: "profile", result };
  if (result.state.startsWith("web-popup.")) return { type: "popup", result };
  return { type: "invalid", result };
}

export function makeLocalCallbackUrl(result) {
  const params = new URLSearchParams();
  params.set("state", result.state);
  if (result.accessToken) params.set("access_token", result.accessToken);
  if (result.error) params.set("error", result.error);
  return `${LOCAL_CALLBACK_URL}#${params.toString()}`;
}
