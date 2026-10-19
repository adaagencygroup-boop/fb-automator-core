"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionContext";
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { toast } from "@/lib/toast";
import { cancelWebOAuth, getSyncJob, getWebConnection, startWebPopupOAuth, syncWebConnection } from "./service";
import { openOAuthPopup, terminalJob } from "./webOAuth.mjs";

export default function useWebFacebookConnection(onConnected) {
  const session = useSession();
  const owner = String(session?.user?.id || getSessionUserId() || "");
  const [connection, setConnection] = useState(null);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingConnection, setLoadingConnection] = useState(true);
  const callback = useRef(onConnected);
  const popup = useRef(null);
  const startingRef = useRef(false);
  const revision = useRef(null);
  const decision = useRef(null);
  useEffect(() => { callback.current = onConnected; }, [onConnected]);

  useEffect(() => {
    let disposed = false;
    const requestRevision = {};
    revision.current = requestRevision;
    // FanpageList keys its subtree by owner, so a session change creates fresh state.
    if (owner) getWebConnection().then((data) => {
      if (disposed || revision.current !== requestRevision) return;
      setConnection(data);
      if (data.active_job) setJob(data.active_job);
    }).catch((failure) => { if (!disposed && revision.current === requestRevision) setError(failure.message); })
      .finally(() => { if (!disposed && revision.current === requestRevision) setLoadingConnection(false); });
    return () => { disposed = true; revision.current = null; };
  }, [owner]);

  useEffect(() => {
    if (!owner) return;
    let disposed = false;
    let refreshing = false;
    async function refreshAttempt() {
      if (refreshing) return;
      refreshing = true;
      const requestRevision = revision.current;
      try {
        const data = await getWebConnection();
        if (disposed || revision.current !== requestRevision) return;
        setConnection(data);
        if (data.active_job) { setJob(data.active_job); setError(""); }
        else if (data.connected) callback.current?.();
      } catch { /* Existing job polling keeps its own error and retry policy. */ }
      finally { refreshing = false; }
    }
    let channel;
    try {
      channel = new BroadcastChannel("meta-web-oauth");
      channel.onmessage = (event) => {
        if (event.data?.type === "attempt-started" && event.data.owner === owner) refreshAttempt();
      };
    } catch { /* Focus refresh works without BroadcastChannel or window.opener. */ }
    window.addEventListener("focus", refreshAttempt);
    return () => { disposed = true; channel?.close(); window.removeEventListener("focus", refreshAttempt); };
  }, [owner]);

  const jobId = job?.job_id;
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer;
    async function poll() {
      try {
        const next = await getSyncJob(jobId);
        if (disposed) return;
        if (next.status !== "AWAITING_CONFIRMATION" || decision.current !== jobId) setJob(next);
        if (!terminalJob(next.status)) {
          timer = setTimeout(poll, 1000);
          return;
        }
        let data;
        try { data = await getWebConnection(); } catch { /* Preserve the result; refresh can be retried. */ }
        if (disposed) return;
        if (data) setConnection(data);
        setJob(null);
        if (next.status === "SUCCEEDED") {
          if (!data) setConnection({ connected: true, identity: next.result.identity, token_state: "unknown" });
          setError("");
          toast.success(next.result.message);
          callback.current?.();
          try { popup.current?.close(); } catch { /* Callback also closes itself on success. */ }
        } else {
          setError(next.error || next.message || "Kết nối Facebook chưa hoàn tất.");
        }
      } catch (failure) {
        if (!disposed) {
          setError(failure.message);
          if ([401, 403, 404].includes(failure.status)) setJob(null);
          else timer = setTimeout(poll, 3000);
        }
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId, owner]);

  async function connect(reason = "connect") {
    if (startingRef.current || job) return;
    if (!owner) { setError("Hãy đăng nhập phần mềm trước khi kết nối Facebook."); return; }
    startingRef.current = true;
    setLoadingConnection(false);
    const requestRevision = {};
    revision.current = requestRevision;
    decision.current = null;
    setStarting(true);
    setError("");
    try {
      const opened = await openOAuthPopup(window, startWebPopupOAuth, owner, reason);
      if (revision.current !== requestRevision) { try { opened.popup.close(); } catch { /* Session changed. */ } return; }
      popup.current = opened.popup;
      setJob(opened.attempt);
    } catch (failure) {
      if (revision.current !== requestRevision) return;
      setError(failure.message);
      // Recover a pending attempt if the request succeeded but its response was lost.
      try {
        const data = await getWebConnection();
        if (revision.current !== requestRevision) return;
        setConnection(data);
        if (data.active_job) setJob(data.active_job);
      } catch { /* The original error remains visible. */ }
    } finally {
      if (revision.current === requestRevision) { startingRef.current = false; setStarting(false); }
    }
  }

  async function resync() {
    if (startingRef.current || job) return;
    startingRef.current = true;
    const requestRevision = {};
    revision.current = requestRevision;
    decision.current = null;
    setStarting(true);
    setError("");
    try { const next = await syncWebConnection(); if (revision.current === requestRevision) setJob(next); }
    catch (failure) { if (revision.current === requestRevision) setError(failure.message); }
    finally { if (revision.current === requestRevision) { startingRef.current = false; setStarting(false); } }
  }

  async function cancel() {
    if (!job || actionBusy) return;
    setActionBusy(true);
    try {
      await cancelWebOAuth(job.job_id);
      try { popup.current?.close(); } catch { /* No cross-origin access is required. */ }
      decision.current = job.job_id;
      setJob((current) => current?.job_id === job.job_id ? { ...current, status: "CANCELLED" } : current);
    } catch (failure) { setError(failure.message); }
    finally { setActionBusy(false); }
  }
  return { connection, job, starting, actionBusy, error, loadingConnection, connect, resync, cancel };
}
