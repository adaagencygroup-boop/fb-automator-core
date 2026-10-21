"use client";

import { useEffect, useRef } from "react";

const SRC = "/music/king-cong.mp4";

/** Phát nhạc chào mỗi lần vào app — luôn autoplay, không khóa theo phiên. */
export default function IntroMusic() {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    let started = false;
    let cancelled = false;

    const start = async () => {
      if (cancelled || started || window.__fbIntroVideoOpen) return;
      try {
        el.volume = 0.85;
        el.currentTime = 0;
        // Chrome thường chặn autoplay có tiếng: unmute sau khi play muted.
        el.muted = true;
        await el.play();
        el.muted = false;
        started = true;
      } catch {
        try {
          el.muted = false;
          await el.play();
          started = true;
        } catch {
          /* chờ gesture người dùng */
        }
      }
    };

    const onInteract = () => {
      if (window.__fbIntroVideoOpen) return;
      if (started && !el.paused) return;
      started = false;
      void start();
    };

    const onVideoClosed = () => {
      started = false;
      void start();
    };

    void start();
    // Retry ngắn nếu media chưa sẵn sàng lần đầu.
    const t1 = window.setTimeout(() => void start(), 300);
    const t2 = window.setTimeout(() => void start(), 1200);

    window.addEventListener("fb-intro-video-closed", onVideoClosed);
    window.addEventListener("pointerdown", onInteract, true);
    window.addEventListener("keydown", onInteract, true);
    window.addEventListener("touchstart", onInteract, true);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("fb-intro-video-closed", onVideoClosed);
      window.removeEventListener("pointerdown", onInteract, true);
      window.removeEventListener("keydown", onInteract, true);
      window.removeEventListener("touchstart", onInteract, true);
      try {
        el.pause();
      } catch {
        /* bỏ qua */
      }
    };
  }, []);

  return <audio ref={audioRef} src={SRC} preload="auto" autoPlay playsInline />;
}
