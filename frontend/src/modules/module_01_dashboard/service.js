import api from "@/services/api";

export async function getDashboardStats() {
  return api.get("/api/dashboard/stats");
}
