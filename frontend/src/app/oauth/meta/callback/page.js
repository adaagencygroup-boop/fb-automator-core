"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import api from "@/services/api";
import { cancelWebOAuth, completeWebPopupOAuth, confirmSyncJob, followSyncJob, getSyncJob, startWebPopupOAuth } from "@/modules/module_05_page_manager/service";
import { announcePopupAttempt, forgetPopupContext, popupAttemptContext, readPopupContext, safeReturnPath, storePopupContext, switchAuthorizationUrl, terminalJob } from "@/modules/module_05_page_manager/webOAuth.mjs";
import MetaCallbackView from "@/modules/module_05_page_manager/MetaCallbackView";

function subscribeLocation(onChange) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function profileCallback() {
  return (new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1)).get("state") || "").startsWith("profile.");
}

export default function MetaCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState("Đang xử lý kết nối Meta…");
  const [canClose, setCanClose] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [phase, setPhase] = useState("processing");
  const [errorCode, setErrorCode] = useState("");
  const [previousIdentity, setPreviousIdentity] = useState(null);
  const [connectedIdentity, setConnectedIdentity] = useState(null);
  const [count, setCount] = useState(null);
  const [owner, setOwner] = useState("");
  const [switchAttempt, setSwitchAttempt] = useState(null);
  const decision = useRef(null);
  const busy = useRef(false);
  const active = useRef(null);
  const originalContext = useRef(null);
  const isProfile = useSyncExternalStore(subscribeLocation, profileCallback, () => false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
    const state = params.get("state") || "";
    // Profile worker owns this callback: preserve its fragment and never submit tokens.
    if (state.startsWith("profile.")) {
      return;
    }
    let context;
    try { context = readPopupContext(state, window.sessionStorage); } catch { /* Storage may be disabled. */ }
    let resumed;
    try { resumed = JSON.parse(window.sessionStorage.getItem("meta-web-callback-job")); } catch { /* Optional recovery. */ }
    if (!state && resumed) context = resumed;
    originalContext.current = context;
    const token = params.get("access_token") || "";
    const preparingSwitch = !window.location.hash && params.get("switch") === "1";
    if (!preparingSwitch) window.history.replaceState(null, "", window.location.pathname);
    async function finish() {
      try {
        if (!state.startsWith("web.") && !state.startsWith("web-popup.") && !(!state && resumed?.jobId)) throw new Error("OAuth state không hợp lệ.");
        const user = await api.get("/api/v1/auth/me");
        if (context && String(user.id) !== context.owner) throw new Error("Phiên phần mềm đã đổi tài khoản. Hãy kết nối lại từ dashboard.");
        setOwner(String(user.id));
        setPreviousIdentity(context?.previousIdentity || null);
        if (preparingSwitch) {
          const url = switchAuthorizationUrl(context, state);
          if (!url) throw new Error("Không tìm thấy phiên đổi tài khoản. Hãy mở lại từ màn Page.");
          const job = await getSyncJob(context.jobId);
          if (job.status !== "AWAITING_OAUTH") throw new Error(job.error || "Phiên đổi tài khoản đã kết thúc. Hãy thử lại.");
          active.current = { jobId: context.jobId, owner: String(user.id), mode: "popup", reason: "switch" };
          setSwitchAttempt({ url, state, jobId: context.jobId });
          setPhase("switch");
          setMessage("Chọn Facebook bạn muốn kết nối trước khi tiếp tục cấp quyền.");
          return;
        }
        let result;
        if (state.startsWith("web-popup.") || (!state && resumed?.jobId)) {
          const initial = state ? await completeWebPopupOAuth({ state, access_token: token, error: params.get("error") || "" }) : { job_id: resumed.jobId };
          if (context && initial.job_id !== context.jobId) throw new Error("Tác vụ trả về không khớp cửa sổ OAuth.");
          active.current = { jobId: initial.job_id, owner: String(user.id), mode: "popup", reason: context?.reason, previousIdentity: context?.previousIdentity };
          try { window.sessionStorage.setItem("meta-web-callback-job", JSON.stringify(active.current)); } catch { /* No token is stored. */ }
          for (;;) {
            let job;
            try { job = await getSyncJob(initial.job_id); }
            catch (failure) {
              if ([401, 403, 404].includes(failure.status)) throw failure;
              setMessage("Mất kết nối tạm thời, đang thử tải lại tiến độ…");
              await new Promise((resolve) => setTimeout(resolve, 3000));
              continue;
            }
            if (job.status === "AWAITING_CONFIRMATION" && decision.current !== job.job_id) {
              setConfirmation(job);
              setPhase("confirmation");
              setMessage("Xác nhận tài khoản Facebook để hoàn tất đăng nhập và tự động đồng bộ Page.");
            } else if (job.status !== "AWAITING_CONFIRMATION") {
              setConfirmation(null);
              setPhase("syncing");
              setMessage(job.message || job.status);
            }
            if (terminalJob(job.status)) {
              if (job.status !== "SUCCEEDED") {
                setErrorCode(job.error_code || "");
                const failure = new Error(job.error || job.message);
                failure.cancelled = job.status === "CANCELLED";
                throw failure;
              }
              result = job.result;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          const initial = await api.post("/api/pages/sync-by-token", { state, access_token: token, error: params.get("error") || "" });
          result = await followSyncJob(initial, (job) => setMessage(job.message || job.status));
        }
        forgetPopupContext(state, window.sessionStorage);
        try { window.sessionStorage.removeItem("meta-web-callback-job"); } catch { /* Optional recovery. */ }
        setMessage(result.message);
        setPhase("success");
        setConnectedIdentity(result.identity || null);
        setCount(result.count ?? null);
        if (active.current || state.startsWith("web-popup.") || context?.mode === "popup") {
          setCanClose(true);
          window.close();
        } else {
          window.location.replace(safeReturnPath(context?.returnTo, window.location.origin));
        }
      } catch (error) {
        forgetPopupContext(state, window.sessionStorage);
        try { window.sessionStorage.removeItem("meta-web-callback-job"); } catch { /* Optional recovery. */ }
        setConfirmation(null);
        setPhase(error.cancelled ? "cancelled" : "error");
        setCanClose(Boolean(active.current || context?.mode === "popup" || state.startsWith("web-popup.")));
        setMessage(error.message || "Kết nối Meta thất bại.");
      }
    }
    finish();
  }, []);

  async function decide(accept) {
    if ((!confirmation && !switchAttempt) || busy.current) return;
    busy.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      if (switchAttempt) {
        await cancelWebOAuth(switchAttempt.jobId);
        try { forgetPopupContext(switchAttempt.state, window.sessionStorage); } catch { /* Optional context. */ }
        setSwitchAttempt(null);
        setPhase("cancelled");
        setMessage("Đã hủy đổi tài khoản. Kết nối và Page hiện tại được giữ nguyên.");
        setCanClose(true);
        return;
      }
      await confirmSyncJob(confirmation.job_id, accept);
      decision.current = confirmation.job_id;
      setConfirmation(null);
      setPhase(accept ? "syncing" : "cancelled");
      setMessage(accept ? "Đã chấp nhận. Đang tự động đồng bộ Page…" : "Đang hủy kết nối…");
    } catch (failure) { setActionError(failure.message || "Không gửi được xác nhận. Hãy thử lại."); }
    finally { busy.current = false; setActionBusy(false); }
  }

  async function retry() {
    if (busy.current || !owner) return;
    busy.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      const user = await api.get("/api/v1/auth/me");
      if (String(user.id) !== owner) throw new Error("Phiên phần mềm đã đổi tài khoản. Hãy kết nối lại từ màn Page.");
      const reason = errorCode === "SAME_FACEBOOK_IDENTITY" || originalContext.current?.reason === "switch" ? "switch" : "connect";
      const attempt = await startWebPopupOAuth(reason);
      const context = popupAttemptContext(attempt, owner, safeReturnPath(originalContext.current?.returnTo, window.location.origin), reason);
      let stored = false;
      try { stored = storePopupContext(attempt.state, context, window.sessionStorage); } catch { /* Optional context. */ }
      if (reason === "switch" && !stored) {
        await cancelWebOAuth(attempt.job_id);
        throw new Error("Trình duyệt đang chặn bộ nhớ phiên. Hãy cho phép rồi thử lại từ màn Page.");
      }
      announcePopupAttempt(owner);
      window.location.replace(attempt.authorization_url);
    } catch (failure) { setActionError(failure.message || "Không thể tạo phiên kết nối mới."); }
    finally { busy.current = false; setActionBusy(false); }
  }

  async function continueSwitch() {
    if (!switchAttempt || busy.current) return;
    busy.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      const job = await getSyncJob(switchAttempt.jobId);
      if (job.status !== "AWAITING_OAUTH") throw new Error(job.error || "Phiên đổi tài khoản đã kết thúc. Hãy tạo phiên mới.");
      window.location.replace(switchAttempt.url);
    } catch (failure) {
      setSwitchAttempt(null);
      setPhase("error");
      setMessage(failure.message);
      setCanClose(true);
    } finally { busy.current = false; setActionBusy(false); }
  }

  return <MetaCallbackView phase={isProfile ? "profile" : phase} message={isProfile ? "Worker đang xử lý kết nối. Giữ cửa sổ này mở." : message}
    identity={confirmation?.identity || connectedIdentity} previousIdentity={previousIdentity} errorCode={errorCode}
    actionBusy={actionBusy} actionError={actionError} canClose={canClose} count={count}
    onAccept={() => decide(true)} onDecline={() => decide(false)} onContinue={continueSwitch}
    onRetry={!isProfile && owner ? retry : null} onClose={() => window.close()} />;
}
