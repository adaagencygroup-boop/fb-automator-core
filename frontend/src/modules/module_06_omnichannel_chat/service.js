import api from "@/services/api";

export async function getConversations() {
  return api.get("/api/chat/conversations").catch(() => ({ conversations: [] }));
}
