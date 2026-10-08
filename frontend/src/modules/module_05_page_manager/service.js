import api from "@/services/api";

export async function getPages() {
  return api.get("/api/pages");
}

export async function fetchPageTokens(userToken) {
  return api.post("/api/pages/fetch-tokens", { user_token: userToken });
}
