"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import { toast } from "@/lib/toast";
import { CONTENT_MULTI, IMAGE_NONE } from "../composeText";

export const EMPTY_COMPOSE = {
  content_text: "",
  content_mode: CONTENT_MULTI,
  image_mode: IMAGE_NONE,
  image_paths: [],
  min_images: 1,
  max_images: 1,
};

const SAVE_DELAY_MS = 800;
const JOB_POLL_MS = 2000;

function pickCompose(data) {
  if (!data) return { ...EMPTY_COMPOSE };
  return {
    content_text: data.content_text || "",
    content_mode: data.content_mode || CONTENT_MULTI,
    image_mode: data.image_mode || IMAGE_NONE,
    image_paths: Array.isArray(data.image_paths) ? data.image_paths : [],
    min_images: Number(data.min_images) || 1,
    max_images: Number(data.max_images) || 1,
  };
}

/**
 * Nháp ô soạn bài chung của Status: tự lưu vào DB (không cần nút Lưu, không hỏi khi rời trang),
 * AI tạo bài chạy ngầm trên backend và thêm từng bài vào cuối nháp.
 *
 * autosave = false (đang sửa chiến dịch): chỉ giữ nội dung trong state, không ghi nháp.
 */
export function useComposeDraft({ postType = "status", autosave = true } = {}) {
  const [compose, setCompose] = useState(EMPTY_COMPOSE);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [job, setJob] = useState(null);

  const composeRef = useRef(compose);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const savingRef = useRef(null);
  const jobTimerRef = useRef(null);
  const lastProcessedRef = useRef(-1);
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  const generating = job?.status === "RUNNING";

  const applyServerDraft = useCallback((data) => {
    const next = pickCompose(data);
    composeRef.current = next;
    dirtyRef.current = false;
    setCompose(next);
  }, []);

  const reload = useCallback(async () => {
    const res = await api.get(`/api/post/compose/draft?post_type=${postType}`);
    const payload = res?.data !== undefined && res?.success !== undefined ? res : res?.data ?? res;
    applyServerDraft(payload?.data);
    setLoaded(true);
    return payload;
  }, [postType, applyServerDraft]);

  const save = useCallback(async () => {
    if (!autosaveRef.current || !dirtyRef.current) return;
    if (savingRef.current) await savingRef.current;
    const body = { post_type: postType, ...composeRef.current };
    dirtyRef.current = false;
    setSaveState("saving");
    const p = api
      .put("/api/post/compose/draft", body)
      .then(() => setSaveState("saved"))
      .catch((err) => {
        if (err?.status === 409) {
          // AI đang thêm bài: nháp bị khoá, bản trên máy chủ là bản đúng
          setSaveState("idle");
          return;
        }
        dirtyRef.current = true;
        setSaveState("error");
      })
      .finally(() => {
        savingRef.current = null;
      });
    savingRef.current = p;
    await p;
  }, [postType]);

  /** Ghi ngay bản đang soạn (gọi trước khi Đăng ngay / Tạo chiến dịch). */
  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await save();
    if (savingRef.current) await savingRef.current;
  }, [save]);

  const update = useCallback(
    (patch) => {
      const next = { ...composeRef.current, ...(typeof patch === "function" ? patch(composeRef.current) : patch) };
      composeRef.current = next;
      setCompose(next);
      if (!autosaveRef.current) return;
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        save();
      }, SAVE_DELAY_MS);
    },
    [save],
  );

  /** Thay toàn bộ nội dung (vd: nạp nội dung chiến dịch để sửa) — không ghi nháp. */
  const replace = useCallback((data) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    applyServerDraft(data);
  }, [applyServerDraft]);

  const stopJobPolling = () => {
    if (jobTimerRef.current) clearInterval(jobTimerRef.current);
    jobTimerRef.current = null;
  };

  const pollJob = useCallback(
    (jobId) => {
      stopJobPolling();
      lastProcessedRef.current = -1;
      const tick = async () => {
        try {
          const res = await api.get(`/api/post/compose/generate/${jobId}`);
          const next = res?.job || res?.data?.job;
          if (!next) return;
          setJob(next);
          if (next.processed !== lastProcessedRef.current) {
            lastProcessedRef.current = next.processed;
            if (autosaveRef.current) await reload();
          }
          if (next.status !== "RUNNING") {
            stopJobPolling();
            if (autosaveRef.current) await reload();
            const notify = next.status === "DONE" ? toast.success : next.status === "CANCELLED" ? toast.info : toast.error;
            const detail = next.status === "FAILED" && next.errors?.length ? ` ${next.errors[0]}` : "";
            notify(`${next.message}${detail}`, "AI TẠO BÀI");
          }
        } catch (err) {
          if (err?.status === 404) {
            stopJobPolling();
            setJob(null);
          }
        }
      };
      tick();
      jobTimerRef.current = setInterval(tick, JOB_POLL_MS);
    },
    [reload],
  );

  const startGenerate = useCallback(
    async ({ prompt, count, withImages, apiKeySource, pixabayKey, model }) => {
      await flush();
      const res = await api.post("/api/post/compose/generate", {
        post_type: postType,
        prompt,
        count,
        with_images: !!withImages,
        api_key_source: apiKeySource || null,
        pixabay_key: pixabayKey || null,
        model: model || null,
      });
      const started = res?.job || res?.data?.job;
      if (started) {
        setJob(started);
        pollJob(started.id);
      }
      return started;
    },
    [flush, pollJob, postType],
  );

  const cancelGenerate = useCallback(async () => {
    if (!job?.id) return;
    try {
      const res = await api.post(`/api/post/compose/generate/${job.id}/cancel`);
      const next = res?.job || res?.data?.job;
      if (next) setJob(next);
    } catch (err) {
      toast.error(err?.message || "Không huỷ được.", "AI TẠO BÀI");
    }
  }, [job]);

  const clearAll = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (!autosaveRef.current) {
      replace({ ...composeRef.current, content_text: "", image_paths: [] });
      return;
    }
    const res = await api.delete(`/api/post/compose/draft?post_type=${postType}`);
    applyServerDraft(res?.data);
  }, [applyServerDraft, postType, replace]);

  // Nạp nháp lần đầu + nối lại lượt AI đang chạy (sau khi tải lại trang)
  useEffect(() => {
    if (!autosave) return undefined;
    let cancelled = false;
    reload()
      .then((payload) => {
        if (cancelled) return;
        const running = payload?.generate_job;
        if (running?.status === "RUNNING") {
          setJob(running);
          pollJob(running.id);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave]);

  // Rời trang: ghi nốt bản đang soạn, dừng poll
  useEffect(
    () => () => {
      stopJobPolling();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        save();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    compose,
    loaded,
    saveState,
    job,
    generating,
    update,
    replace,
    flush,
    reload,
    clearAll,
    startGenerate,
    cancelGenerate,
  };
}
