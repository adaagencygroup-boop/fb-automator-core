/* ==========================================================================
   FB Automator Pro — Trang hướng dẫn sử dụng
   JavaScript thuần (ES6), không framework, không build step.

   01. Khởi động và dò khả năng
   02. Vẽ icon Lucide
   03. Header dính
   04. Mục lục trên di động
   05. Cuộn mượt theo neo
   06. Tự làm nổi mục đang đọc
   ========================================================================== */

(function () {
  "use strict";

  /* ==========================================================================
     01. KHỞI ĐỘNG
     ====================================================================== */
  document.documentElement.classList.remove("no-js");

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ==========================================================================
     02. ICON
     ====================================================================== */
  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  /* ==========================================================================
     03. HEADER DÍNH
     ====================================================================== */
  const header = $("#header");

  if (header) {
    const onScroll = () => {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ==========================================================================
     04. MỤC LỤC TRÊN DI ĐỘNG
     Trên desktop mục lục là cột dính, luôn hiện; nút này chỉ có tác dụng ở
     màn hình hẹp.
     ====================================================================== */
  const tocToggle = $("#toc-toggle");
  const toc = $("#docs-toc");

  if (tocToggle && toc) {
    const setOpen = (open) => {
      toc.classList.toggle("is-open", open);
      tocToggle.setAttribute("aria-expanded", open ? "true" : "false");
      tocToggle.setAttribute("aria-label", open ? "Đóng mục lục" : "Mở mục lục");
    };

    tocToggle.addEventListener("click", () => {
      setOpen(!toc.classList.contains("is-open"));
    });

    // Chọn một mục thì đóng lại cho đỡ che nội dung.
    toc.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toc.classList.contains("is-open")) {
        setOpen(false);
        tocToggle.focus();
      }
    });
  }

  /* ==========================================================================
     05. CUỘN MƯỢT, BÙ CHIỀU CAO HEADER DÍNH
     ====================================================================== */
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;

    const target = document.getElementById(hash.slice(1));
    if (!target) return;

    event.preventDefault();

    const offset = header ? header.getBoundingClientRect().height + 4 : 0;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(top, 0),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });

    if (history.replaceState) history.replaceState(null, "", hash);
  });

  /* ==========================================================================
     06. TỰ LÀM NỔI MỤC ĐANG ĐỌC
     ====================================================================== */
  const tocLinks = $$(".docs__toc-list a");
  const sections = tocLinks
    .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = `#${entry.target.id}`;
          tocLinks.forEach((link) =>
            link.classList.toggle("is-active", link.getAttribute("href") === id)
          );
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    sections.forEach((section) => spy.observe(section));
  }

  /* ==========================================================================
     CHẠY KHI TRANG SẴN SÀNG
     ====================================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderIcons);
  } else {
    renderIcons();
  }

  // Script CDN dùng defer có thể về sau DOMContentLoaded — vẽ lại icon.
  window.addEventListener("load", renderIcons);
})();
