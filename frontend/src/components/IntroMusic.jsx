"use client";

import { useEffect, useRef } from "react";

const SRC = "/music/king-cong.mp4";
export const INTRO_MUSIC_FLAG = "fb_intro_music_played";

/** Phát nhạc chào mỗi lần vào app (một lần / phiên tab). */
export default function IntroMusic() {
  const audioRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(INTRO_MUSIC_FLAG) === "1") return;

    const el = audioRef.current;
    if (!el) return;

    let finished = false;
    const markPlayed = () => {
      if (finished) return;
      finished = true;
      sessionStorage.setItem(INTRO_MUSIC_FLAG, "1");
    };

    const tryPlay = () => {
      el.volume = 0.75;
      return el.play().then(markPlayed).catch(() => {});
    };

    tryPlay();
    // Trình duyệt có thể chặn autoplay khi khôi phục phiên — phát lại ở lần bấm/phím đầu.
    window.addEventListener("pointerdown", tryPlay);
    window.addEventListener("keydown", tryPlay);
    return () => {
      window.removeEventListener("pointerdown", tryPlay);
      window.removeEventListener("keydown", tryPlay);
      try {
        el.pause();
      } catch {
        /* bỏ qua */
      }
    };
  }, []);

  return <audio ref={audioRef} src={SRC} preload="auto" playsInline />;
}
