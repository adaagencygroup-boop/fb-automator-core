import api from "@/services/api";

export async function getFarmTasks() {
  return api.get("/api/farm/tasks").catch(() => ({ tasks: [] }));
}
