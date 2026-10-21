import React, { useState, useEffect } from "react";
import { Eye, EyeOff, Sparkles, Check, AlertCircle, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { Tooltip } from "@/components/ui/tooltip";
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
 * 5. Thao tác nhanh: Tải model Google, Kiểm tra API, Lưu cấu hình / Chỉnh sửa
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
  isLocked,
  setIsLocked,
}) {
  const activeProvider = model === "gemini" || model.startsWith("gemini-") ? "gemini" : "openai";
  const savedKey = providerStatus?.[activeProvider];
  const hasApiKey = Boolean(apiKey.trim() || savedKey?.configured);

  const [internalLocked, setInternalLocked] = useState(false);
  const locked = isLocked !== undefined ? isLocked : internalLocked;
  const setLocked = (val) => {
    if (setIsLocked) setIsLocked(val);
    setInternalLocked(val);
  };

  const [errorDialog, setErrorDialog] = useState(null);

  // Tự động mở Modal Dialog khi có lỗi
  useEffect(() => {
    if (settingsFeedback?.type === "error" && settingsFeedback?.message) {
      setErrorDialog({
        title: settingsFeedback.title || "Lỗi cấu hình AI",
        message: settingsFeedback.message,
      });
    }
  }, [settingsFeedback]);

  const handleCloseError = () => {
    setErrorDialog(null);
    if (setSettingsFeedback) setSettingsFeedback(null);
  };

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
      toast.success(result.message || "Kết nối API thành công!", "KIỂM TRA THÀNH CÔNG");
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
      toast.success(`Đã tải ${result.count} model khả dụng từ Google AI Studio.`, "TẢI MODEL THÀNH CÔNG");
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
      const ok = await onSaveSettings();
      if (ok) {
        setLocked(true);
      }
      return ok;
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
      toast.success("Đã lưu cấu hình trên máy này thành công.", "LƯU THÀNH CÔNG");
      setLocked(true);

      setTimeout(() => {
        const step3Element = document.getElementById("step-3-group-source");
        if (step3Element) {
          step3Element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 120);

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
      aside={
        locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
            <Check className="size-3 text-emerald-600" />
            Đã lưu cấu hình
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-200/60">
            <Edit3 className="size-3 text-amber-600" />
            Đang chỉnh sửa
          </span>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Model AI" required>
          <Tooltip content="Chọn mô hình AI tạo nội dung: OpenAI GPT-4o, GPT-4o mini hoặc Google Gemini." align="left">
            <SelectField
              value={model}
              onChange={handleModelChange}
              disabled={settingsLoading || locked}
              title="Chọn mô hình AI tạo nội dung"
            >
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
          </Tooltip>
          <span className="block text-[10px] font-normal text-slate-400">
            Model đang dùng: {model}. Có thể tải danh sách thực tế theo quyền của API Key.
          </span>
        </Field>

        <Field label="API Key" required>
          <Tooltip content="Nhập API Key của nhà cung cấp đã chọn. Khóa được mã hóa và lưu trữ an toàn trên máy này." align="right">
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={settingsLoading || locked}
                title="Khóa API bí mật của nhà cung cấp AI"
                placeholder={
                  savedKey?.configured
                    ? `Đã lưu ${savedKey.hint}`
                    : activeProvider === "openai"
                      ? "sk-••••••••••••••••"
                      : "AIza••••••••••••••••"
                }
                className="pr-10 font-mono disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                autoComplete="off"
              />
              <button
                type="button"
                disabled={settingsLoading || locked}
                onClick={() => setShowApiKey((current) => !current)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                aria-label={showApiKey ? "Ẩn API Key" : "Hiện API Key"}
                title={showApiKey ? "Ẩn API Key" : "Hiện API Key"}
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Tooltip>
          <span className="block text-[10px] font-normal text-slate-400">
            {savedKey?.configured
              ? `Đang dùng khóa đã mã hóa trên máy (${savedKey.hint}). Nhập khóa mới để thay thế.`
              : "Nhập API Key hợp lệ của nhà cung cấp AI đã chọn."}
          </span>
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Luồng">
          <Tooltip content="Số luồng chạy đồng thời (1 - 10). Tương ứng số tài khoản đăng bài song song cùng lúc." align="left">
            <Input
              type="number"
              min="1"
              max="10"
              value={threads}
              onChange={(event) => setThreads(event.target.value)}
              disabled={settingsLoading || locked}
              title="Số luồng tài khoản chạy đồng thời (1 - 10)"
              className="disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
            />
          </Tooltip>
        </Field>
        <Field label="Nghỉ (phút)">
          <Tooltip content="Thời gian nghỉ giữa các phiên đăng (0 - 1440 phút), giúp giãn cách an toàn tránh bị hạn chế tài khoản." align="center">
            <Input
              type="number"
              min="0"
              max="1440"
              value={restMinutes}
              onChange={(event) => setRestMinutes(event.target.value)}
              disabled={settingsLoading || locked}
              title="Thời gian nghỉ giữa các phiên đăng bài tính bằng phút"
              className="disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
            />
          </Tooltip>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div
          className={`text-[11px] ${settingsFeedback?.type === "success"
            ? "text-emerald-600 font-medium"
            : "text-slate-400"
            }`}
        >
          {settingsLoading
            ? "Đang đọc cấu hình local..."
            : settingsFeedback?.type === "success"
              ? settingsFeedback.message
              : locked
                ? "Cấu hình đã được lưu an toàn trên máy này. Bấm Chỉnh sửa nếu muốn thay đổi."
                : hasApiKey
                  ? "API Key đã được cấu hình trên máy"
                  : "Chưa có API Key cho model này"}
        </div>
        <div className="flex gap-2">
          {locked ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLocked(false)}
              className="cursor-pointer text-xs flex items-center gap-1.5 border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium shadow-2xs"
            >
              <Edit3 className="size-3.5 text-slate-600" />
              Chỉnh sửa
            </Button>
          ) : (
            <>
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
                className="cursor-pointer text-xs bg-slate-900 text-white hover:bg-slate-800"
              >
                {settingsAction === "saving" ? "Đang lưu..." : "Lưu cấu hình"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Modal Dialog Popup báo lỗi */}
      <Dialog open={Boolean(errorDialog)} onOpenChange={(open) => !open && handleCloseError()}>
        <DialogContent className="max-w-md rounded-2xl border-slate-200 bg-white p-6 shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="flex items-center gap-2.5 text-base font-bold text-red-600">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertCircle className="size-5" />
              </span>
              <span>{errorDialog?.title || "Thông báo lỗi"}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-xl border border-red-100 bg-red-50/70 p-4 text-xs leading-relaxed text-slate-700">
            {errorDialog?.message}
          </div>

          <DialogFooter className="mt-5 flex justify-end">
            <Button
              type="button"
              variant="default"
              onClick={handleCloseError}
              className="bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Đã hiểu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
