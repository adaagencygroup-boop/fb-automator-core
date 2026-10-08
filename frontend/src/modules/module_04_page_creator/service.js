import api from "@/services/api";

export async function createBulkPages(data) {
  return api.post("/api/pages/create", data).catch(() => ({ success: true, count: 0 }));
}
