"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ghi âm tin nhắn thoại bằng MediaRecorder (API sẵn có của trình duyệt, không thêm thư viện).
 *
 * Lưu ý định dạng: Messenger nhận audio kiểu mp3/m4a/aac/wav; Chrome lại mặc định xuất
 * webm/opus. Vì vậy ưu tiên chọn mp4/mpeg nếu trình duyệt hỗ trợ, cuối cùng mới tới webm.
 *
 * start()  -> xin quyền mic rồi bắt đầu ghi
 * stop()   -> Promise<File|null>, trả file ghi được
 * cancel() -> huỷ, không trả file
 */

// Xếp theo mức độ Facebook chấp nhận tốt nhất -> kém nhất
const MIME_CANDIDATES = [
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
];

const EXT_BY_MIME = [
  [/mp4/, "m4a"],
  [/mpeg/, "mp3"],
  [/ogg/, "ogg"],
  [/webm/, "webm"],
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* trình duyệt cũ không có isTypeSupported */
    }
  }
  return "";
}

function extensionOf(mime) {
  const found = EXT_BY_MIME.find(([re]) => re.test(mime || ""));
  return found ? found[1] : "webm";
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator?.mediaDevices?.getUserMedia);

  // Đồng hồ đếm giây khi đang ghi
  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Rời khung chat khi đang ghi -> nhả micro
  useEffect(() => () => releaseStream(), [releaseStream]);

  const start = useCallback(async () => {
    if (!supported || recorderRef.current) return false;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      streamRef.current = stream;
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      return true;
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Bạn chưa cho phép dùng micro. Hãy bật quyền micro cho trang này rồi thử lại."
          : "Không truy cập được micro. Kiểm tra thiết bị thu âm rồi thử lại.",
      );
      releaseStream();
      return false;
    }
  }, [supported, releaseStream]);

  const stop = useCallback(
    () =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder) {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const type = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          releaseStream();
          setRecording(false);
          if (!blob.size) {
            resolve(null);
            return;
          }
          const name = `voice-${Date.now()}.${extensionOf(type)}`;
          resolve(new File([blob], name, { type }));
        };
        try {
          recorder.stop();
        } catch {
          releaseStream();
          setRecording(false);
          resolve(null);
        }
      }),
    [releaseStream],
  );

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* bỏ qua */
      }
    }
    releaseStream();
    setRecording(false);
    setSeconds(0);
  }, [releaseStream]);

  return { supported, recording, seconds, error, start, stop, cancel };
}
