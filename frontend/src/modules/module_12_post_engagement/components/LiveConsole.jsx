"use client";

import { useEffect, useRef } from "react";
import { Copy } from "lucide-react";
import { toast } from "@/lib/toast";

// Cửa sổ "Terminal Session #LOG-ENGAGE-…" (Figma): log theo luồng [Thread-01], màu theo mức độ:
// thành công xanh lá, cảnh báo vàng, lỗi đỏ, hệ thống [System] xanh ngọc.

const LEVEL_COLORS = {
  SUCCESS: "text-emerald-400",
  WARN: "text-amber-300",
  WARNING: "text-amber-300",
  ERROR: "text-rose-400",
  INFO: "text-slate-300",
};

export default function LiveConsole({ logs = [], sessionId = "", running = false }) {
  const boxRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const copyLog = async () => {
    const text = logs.map((l) => `[${l.time}] [${l.thread || "System"}] ${l.message}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Đã sao chép toàn bộ nhật ký.");
    } catch {
      toast.error("Không sao chép được nhật ký.");
    }
  };

  const tag = sessionId ? sessionId.replace(/^PE[SC]-/, "").slice(-6).toUpperCase() : "";

  return (
    <section className="overflow-hidden rounded-2xl bg-[#0B1220] shadow-[0_8px_24px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5">
            <span className="size-3 rounded-full bg-[#FF5F57]" />
            <span className="size-3 rounded-full bg-[#FEBC2E]" />
            <span className="size-3 rounded-full bg-[#28C840]" />
          </span>
          <span className="font-mono text-xs text-slate-400">
            Terminal Session #LOG-ENGAGE{tag ? `-${tag}` : ""}
            {running && <span className="ml-2 inline-block size-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />}
          </span>
        </div>
        <button
          type="button"
          onClick={copyLog}
          disabled={!logs.length}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40"
        >
          <Copy className="size-3.5" /> Copy Log
        </button>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[260px] overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-6"
      >
        {logs.length === 0 ? (
          <p className="text-slate-500">Chưa có nhật ký. Bấm Kiểm tra hoặc Bắt đầu thực thi để xem tiến trình theo thời gian thực.</p>
        ) : (
          logs.map((l, i) => {
            const system = (l.thread || "System") === "System";
            const color = system ? "text-teal-300" : LEVEL_COLORS[String(l.level || "INFO").toUpperCase()] || "text-slate-300";
            return (
              <div key={`${i}-${l.time}`} className="whitespace-pre-wrap break-words">
                <span className="text-sky-400">[{l.time}]</span>{" "}
                <span className={system ? "text-teal-300" : "text-sky-300"}>[{l.thread || "System"}]</span>{" "}
                <span className={color}>{l.message}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
