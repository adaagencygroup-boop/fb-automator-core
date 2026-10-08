import api from "./api";

export const pageService = {
  // Lấy danh sách fanpage
  getPages: () => api.get("/api/pages"),

  // Đồng bộ Fanpage qua User Access Token
  fetchPageTokens: (userToken) =>
    api.post("/api/pages/fetch-tokens", { user_token: userToken.trim() }),

  // Đăng bài AI tự động lên Fanpage
  postAIContent: (payload) =>
    api.post("/api/pages/post-ai", payload),

  // Cào video TikTok hàng loạt
  scrapeTikTok: (url, count = 5) =>
    api.post("/api/media/scrape-tiktok", { url, count }),

  // Cào video YouTube Shorts
  scrapeYouTube: (url, count = 5) =>
    api.post("/api/media/scrape-youtube", { url, count }),
};

export default pageService;
