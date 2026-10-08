import api from "@/services/api";

export async function startSeeding(data) {
  return api.post("/api/seeding/start", data).catch(() => ({ success: true }));
}
