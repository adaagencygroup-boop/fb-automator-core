import axios from "axios";
import { API_BASE } from "../config/constants";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // 60s phù hợp với các tác vụ AI và Crawl media
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const errorMsg =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      "Không thể kết nối tới Local Engine (Port 28129)";
    console.error("[API Error]", errorMsg);
    return Promise.reject(new Error(errorMsg));
  }
);

export default api;
