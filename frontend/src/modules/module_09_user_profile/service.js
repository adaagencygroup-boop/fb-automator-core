import api from "@/services/api";

export async function getSettings() {
  return api.get("/api/settings");
}

export async function getProxies() {
  return api.get("/api/proxies");
}

export async function getKeys() {
  return api.get("/api/keys");
}
