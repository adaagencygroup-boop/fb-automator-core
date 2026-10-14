import React, { useState } from "react";
import { Eye, EyeOff, Sparkles, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard, Field, SelectField } from "../../shared/components";
import { testGroupAiConnection, getGeminiModels, saveGroupSettings } from "../../service";

/**
 * ============================================================================
 * MODULE 07 - BƯỚC 2: CẤU HÌNH API & THÔNG SỐ CHUNG (GroupSettingsSection)
 * Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:
 * 1. Chọn Model AI (OpenAI GPT-4o, GPT-4o mini, Google AI Studio Gemini)
 * 2. Cấu hình & mã hóa API Key cục bộ trên máy
 * 3. Luồng chạy (threads: 1-10)
 * 4. Thời gian nghỉ giữa phiên (rest_minutes: 0-1440)
 * 5. Giới hạn số bài đăng tối đa (max_posts: 1-1000)
 * 6. Thao tác nhanh: Tải model Google, Kiểm tra API, Lưu cấu hình
 * ============================================================================
 */
export default function GroupSettingsSection({
  model = "gpt-4o",
  setModel,
  apiKey = "",
  setApiKey,
  showApiKey = false,
  setShowApiKey,
  threads = "2",
  setThreads,
  restMinutes = "10",
  setRestMinutes,
  maxPosts = "10",
  setMaxPosts,
  geminiModels = [],
  setGeminiModels,
  providerStatus = {},
  setProviderStatus,
  settingsLoading = false,
  settingsAction = "",
  setSettingsAction,
  settingsFeedback = null,
  setSettingsFeedback,
  onSaveSettings,
  onTestApi,
  onLoadGeminiModels,
  onModelChange,
}) {
  const activeProvider = model === "gemini" || model.startsWith("gemini-") ? "gemini" : "openai";
  const savedKey = providerStatus?.[activeProvider];
  const hasApiKey = Boolean(apiKey.trim() || savedKey?.configured);

  const handleModelChange = (event) => {
    if (onModelChange) {
      onModelChange(event);
      return;
    }
    setModel(event.target.value);
    setApiKey("");
    if (setShowApiKey) setShowApiKey(false);
    if (setSettingsFeedback) setSettingsFeedback(null);
  };

  const handleTestApi = async () => {
    if (onTestApi) {
      return onTestApi();
    }
    if (setSettingsAction) setSettingsAction("testing");
    if (setSettingsFeedback) setSettingsFeedback(null);
    try {
      if (!hasApiKey) throw new Error("Hãy nhập API Key trước khi kiểm tra");
      const result = await testGroupAiConnection({ model, api_key: apiKey.trim() || null });
      if (setSettingsFeedback) {
        setSettingsFeedback({ type: "success", message: result.message || "Kết nối API thành công" });
      }
    } catch (error) {
      if (setSettingsFeedback) {
        setSettingsFeedback({ type: "error", message: error.message || "API Key không hợp lệ" });
      }
    } finally {
      if (setSettingsAction) setSettingsAction("");
    }
  };

  const handleLoadGeminiModels = async () => {
    if (onLoadGeminiModels) {
      return onLoadGeminiModels();
    }
    if (setSettingsAction) setSettingsAction("loading-models");
    if (setSettingsFeedback) setSettingsFeedback(null);
    try {
      if (!apiKey.trim() && !providerStatus?.gemini?.configured) {
        throw new Error("Hãy nhập Google AI Studio API Key trước khi tải model");
      }
      const result = await getGeminiModels({ api_key: apiKey.trim() || null });
      if (setGeminiModels) setGeminiModels(result.models);
      if (!result.models.some((item) => item.id === model) && setModel) {
        setModel(result.models[0].id);
      }
      if (setSettingsFeedback) {
        setSettingsFeedback({
          type: "success",
          message: `Đã tải ${result.count} model khả dụng từ Google AI Studio`,
        });
      }
    } catch (error) {
      if (setSettingsFeedback) {
        setSettingsFeedback({
          type: "error",
          message: error.message || "Không tải được danh sách model Google",
        });
      }
    } finally {
      if (setSettingsAction) setSettingsAction("");
    }
  };

  const handleSaveSettings = async () => {
    if (onSaveSettings) {
      return onSaveSettings();
    }
    if (setSettingsAction) setSettingsAction("saving");
    if (setSettingsFeedback) setSettingsFeedback(null);
    try {
      const payload = {
        model,
        api_key: apiKey.trim() || null,
        threads: Number(threads),
        rest_minutes: Number(restMinutes),
        max_posts: Number(maxPosts),
      };
      const result = await saveGroupSettings(payload);
      if (setProviderStatus) setProviderStatus(result.providers || {});
      setApiKey("");
      if (setShowApiKey) setShowApiKey(false);
      if (setSettingsFeedback) {
        setSettingsFeedback({ type: "success", message: "Đã lưu cấu hình trên máy này" });
      }
      return true;
    } catch (error) {
      if (setSettingsFeedback) {
        setSettingsFeedback({ type: "error", message: error.message || "Không thể lưu cấu hình" });
      }
      return false;
    } finally {
      if (setSettingsAction) setSettingsAction("");
    }
  };

  return (
    <SectionCard
      number="2"
      title="Cấu hình API & thông số chung"
      description="Cài đặt nhà cung cấp AI, mã hóa khóa API an toàn và thiết lập số luồng, độ trễ đăng bài"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Model AI" required>
          <SelectField value={model} onChange={handleModelChange} disabled={settingsLoading}>
            <optgroup label="OpenAI">
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o mini</option>
            </optgroup>
            <optgroup label="Google AI Studio">
              {geminiModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </SelectField>
          <span className="block text-[10px] font-normal text-slate-400">
            Model đang dùng: {model}. Có thể tải danh sách thực tế theo quyền của API Key.
          </span>
        </Field>

        <Field label="API Key" required>
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                savedKey?.configured
                  ? `Đã lưu ${savedKey.hint}`
                  : activeProvider === "openai"
                    ? "sk-••••••••••••••••"
                    : "AIza••••••••••••••••"
              }
              className="pr-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((current) => !current)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              aria-label={showApiKey ? "Ẩn API Key" : "Hiện API Key"}
              title={showApiKey ? "Ẩn API Key" : "Hiện API Key"}
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <span className="block text-[10px] font-normal text-slate-400">
            {savedKey?.configured
              ? `Đang dùng khóa đã mã hóa trên máy (${savedKey.hint}). Nhập khóa mới để thay thế.`
              : "Nhập API Key hợp lệ của nhà cung cấp AI đã chọn."}
          </span>
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Luồng">
          <Input
            type="number"
            min="1"
            max="10"
            value={threads}
            onChange={(event) => setThreads(event.target.value)}
          />
        </Field>
        <Field label="Nghỉ (phút)">
          <Input
            type="number"
            min="0"
            max="1440"
            value={restMinutes}
            onChange={(event) => setRestMinutes(event.target.value)}
          />
        </Field>
        <Field label="Max bài">
          <Input
            type="number"
            min="1"
            max="1000"
            value={maxPosts}
            onChange={(event) => setMaxPosts(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div
          className={`text-[11px] ${settingsFeedback?.type === "error" ? "text-red-600" : "text-emerald-600"
            }`}
        >
          {settingsLoading
            ? "Đang đọc cấu hình local..."
            : settingsFeedback?.message ||
            (hasApiKey
              ? "API Key đã được cấu hình trên máy"
              : "Chưa có API Key cho model này")}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(settingsAction) || settingsLoading}
            onClick={handleLoadGeminiModels}
            className="cursor-pointer text-xs"
          >
            {settingsAction === "loading-models" ? "Đang tải model..." : "Tải model Google"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(settingsAction) || settingsLoading}
            onClick={handleTestApi}
            className="cursor-pointer text-xs"
          >
            {settingsAction === "testing" ? "Đang kiểm tra..." : "Kiểm tra API"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={Boolean(settingsAction) || settingsLoading || !hasApiKey}
            onClick={handleSaveSettings}
            className="cursor-pointer text-xs"
          >
            {settingsAction === "saving" ? "Đang lưu..." : "Lưu cấu hình"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
