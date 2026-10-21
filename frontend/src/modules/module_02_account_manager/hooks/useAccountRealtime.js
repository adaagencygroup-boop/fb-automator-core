"use client";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { getAccountOperation } from "../service";
import { TERMINAL_PHASES } from "../utils/account-realtime.mjs";

export default function useAccountRealtime({ enabled, applyAccountPatches, requestRefresh, onUnknown }) {
  const [progress, setProgress] = useState({});
  const tracked = useRef(new Map());
  const versions = useRef(new Map());
  const latest = useRef(new Map());
  const superseded = useRef(new Map());
  const completed = useRef(new Set());
  const pendingPatches = useRef(new Map());
  const flushTimer = useRef(null);
  const live = useRef(false);

  const flush = useEffectEvent(() => {
    flushTimer.current = null;
    if (!live.current) return;
    applyAccountPatches([...pendingPatches.current.values()]);
    pendingPatches.current.clear();
  });

  const accept = useEffectEvent((data) => {
    if (!live.current || !data.operation_id) return;
    const rows = data.accounts ? Object.values(data.accounts) : data.account ? [data.account] : [];
    const accepted = [];
    for (const row of rows) {
      const old = latest.current.get(row.uid);
      if (superseded.current.get(row.uid)?.has(data.operation_id)) continue;
      if (old?.serverTime && old.operation_id !== data.operation_id && old.started_at > data.started_at) continue;
      const key = `${data.operation_id}:${row.uid}`;
      if ((versions.current.get(key) ?? -1) >= data.sequence) continue;
      versions.current.set(key, data.sequence);
      latest.current.set(row.uid, { operation_id: data.operation_id, started_at: data.started_at, phase: row.phase, serverTime: true });
      accepted.push({ ...row, operation_id: data.operation_id, kind: data.kind, started_at: data.started_at });
    }
    // A POST may return after its first SSE event. Preserve the event's metadata.
    if (data.done) { completed.current.add(data.operation_id); tracked.current.delete(data.operation_id); }
    else if (!completed.current.has(data.operation_id) && !tracked.current.has(data.operation_id)) tracked.current.set(data.operation_id, { kind: data.kind });
    if (!accepted.length) return;
    setProgress(previous => {
      const next = { ...previous };
      for (const row of accepted) next[row.uid] = row;
      return next;
    });
    for (const row of accepted) {
      pendingPatches.current.set(row.uid, row);
    }
    if (flushTimer.current === null) flushTimer.current = setTimeout(flush, 100);
    requestRefresh();
  });

  const recover = useEffectEvent(async (id) => {
    const operation = tracked.current.get(id);
    if (!operation || operation.polling) return;
    operation.polling = true;
    try {
      const snapshot = await getAccountOperation(id);
      if (live.current && tracked.current.get(id) === operation) accept(snapshot);
    } catch (error) {
      if (live.current && tracked.current.get(id) === operation && (error.status ?? error.response?.status) === 404) {
        tracked.current.delete(id);
        completed.current.add(id);
        for (const [uid, row] of latest.current) if (row.operation_id === id) latest.current.set(uid, { ...row, phase: "unknown" });
        setProgress(previous => Object.fromEntries(Object.entries(previous).map(([uid, row]) => [uid,
          row.operation_id === id ? { ...row, phase: "unknown" } : row])));
        requestRefresh();
        onUnknown();
      }
    } finally { operation.polling = false; }
  });

  const begin = useCallback((kind, uids) => {
    if (uids.some(uid => {
      const row = latest.current.get(uid);
      return row && !TERMINAL_PHASES.has(row.phase) && row.phase !== "unknown";
    })) return false;
    const started_at = Date.now() / 1000;
    for (const uid of uids) {
      const oldId = latest.current.get(uid)?.operation_id;
      if (oldId) {
        if (!superseded.current.has(uid)) superseded.current.set(uid, new Set());
        superseded.current.get(uid).add(oldId);
      }
      pendingPatches.current.delete(uid);
      latest.current.set(uid, { started_at, phase: "queued", serverTime: false });
    }
    setProgress(previous => ({ ...previous, ...Object.fromEntries(uids.map(uid => [uid, { uid, kind, phase: "queued", started_at }])) }));
    return true;
  }, []);
  const fail = useCallback((uids) => {
    for (const uid of uids) latest.current.set(uid, { ...latest.current.get(uid), phase: "failed" });
    setProgress(previous => ({ ...previous, ...Object.fromEntries(uids.map(uid => [uid,
      { ...previous[uid], uid, phase: "failed" }])) }));
  }, []);
  const watch = useCallback((id, kind, uids) => {
    if (!id || !live.current) return;
    if (!completed.current.has(id) && !tracked.current.has(id)) tracked.current.set(id, { kind });
    for (const uid of uids) if (!superseded.current.get(uid)?.has(id) && !latest.current.get(uid)?.operation_id) latest.current.set(uid, { ...latest.current.get(uid), operation_id: id });
    setProgress(previous => {
      const next = { ...previous };
      for (const uid of uids) if (!superseded.current.get(uid)?.has(id) && !next[uid]?.operation_id) next[uid] = { ...next[uid], operation_id: id };
      return next;
    });
  }, []);

  useEffect(() => {
    live.current = enabled;
    if (!enabled) return;
    const pending = pendingPatches.current;
    const operations = tracked.current;
    const seen = versions.current;
    const current = latest.current;
    const finished = completed.current;
    const oldOperations = superseded.current;
    const onEvent = (event) => {
      const data = event.detail;
      if (data?.event === "account_operation_updated") accept(data);
      else if (data?.type === "connected") {
        requestRefresh();
        for (const id of tracked.current.keys()) void recover(id);
      }
    };
    window.addEventListener("local_engine_event", onEvent);
    const timer = setInterval(() => { for (const id of tracked.current.keys()) void recover(id); }, 5000);
    return () => {
      live.current = false;
      window.removeEventListener("local_engine_event", onEvent);
      clearInterval(timer);
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
      pending.clear();
      operations.clear();
      seen.clear();
      current.clear();
      finished.clear();
      oldOperations.clear();
    };
  }, [enabled, requestRefresh]);

  const loggingIn = Object.values(progress).some(row => row.kind === "login" && !TERMINAL_PHASES.has(row.phase) && row.phase !== "unknown");
  return { progress, begin, fail, watch, loggingIn };
}
