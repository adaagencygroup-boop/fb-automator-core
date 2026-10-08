import api from "@/services/api";

export async function getAccounts() {
  return api.get("/api/accounts");
}

export async function importAccounts(rawData) {
  return api.post("/api/accounts/import", { raw_data: rawData });
}
