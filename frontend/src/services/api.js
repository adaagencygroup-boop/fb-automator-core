import axios from "axios";
import { API_BASE } from "../config/constants";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor
api.interceptors.request.use(
  (config) => {
    // Có thể gắn token/auth header nếu cần sau này
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.detail || error.message || "Network Error";
    console.error("[API Error]", message);
    return Promise.reject(new Error(message));
  }
);

export default api;
