"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/config/constants";

const SRC = "/media/david-vu.mp4";
const SEEN_KEY = "fb-intro-video-boot";

function markClosed(bootId) {
  window.__fbIntroVideoOpen = false;
  try {
    if (bootId) localStorage.setItem(SEEN_KEY, bootId);
  } catch {
    /* trình duyệt chặn lưu thì lần tải sau có thể hiện lại */
  }
  window.dispatchEvent(new Event("fb-intro-video-closed"));
}

/** Video chào tự phát một lần mỗi lần chạy start.py. Xem hết thì tự đóng. */
export default function IntroVideo() {
  const videoRef = useRef(null);
  const bootRef = useRef("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.__fbIntroVideoOpen = true;

    const decide = async () => {
      let bootId = "";
      try {
        const response = await fetch(`${API_BASE}/api/health`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          bootId = String(data?.boot_id || "");
        }
      } catch {
        bootId = "";
      }
      if (cancelled) return;
      bootRef.current = bootId;
      let seen = "";
      try {
        seen = localStorage.getItem(SEEN_KEY) || "";
      } catch {
        seen = "";
      }
      if (bootId && seen === bootId) {
        markClosed(bootId);
        return;
      }
      setOpen(true);
    };

    void decide();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = () => {
    document.body.style.overflow = "";
    markClosed(bootRef.current);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = videoRef.current;
    let cancelled = false;

    const start = async () => {
      if (cancelled || !el) return;
      try {
        el.muted = true;
        await el.play();
        el.muted = false;
        if (el.paused) await el.play();
      } catch {
        try {
          await el.play();
        } catch {
          /* giữ nguyên, effect sẽ thử lại */
        }
      }
    };

    void start();
    const retry = window.setTimeout(() => void start(), 300);
    const again = window.setTimeout(() => void start(), 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      window.clearTimeout(again);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Video giới thiệu"
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl">
        <video
          ref={videoRef}
          src={SRC}
          className="pointer-events-none max-h-[80vh] w-full bg-black"
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          controlsList="nodownload nofullscreen noplaybackrate"
          onEnded={finish}
          onPause={() => {
            const el = videoRef.current;
            if (!el || el.ended) return;
            void el.play();
          }}
          onError={finish}
        />
      </div>
    </div>
  );
}
