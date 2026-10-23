export const MODEL_GROUPS = [
  { provider: "OpenAI", models: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
  ] },
  { provider: "Google AI Studio", models: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (quyền truy cập cũ)" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (quyền truy cập cũ)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (quyền truy cập cũ)" },
  ] },
  { provider: "DeepSeek", models: [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  ] },
];

export const modelLabel = (id) => MODEL_GROUPS.flatMap((group) => group.models)
  .find((model) => model.id === id)?.label || id;
