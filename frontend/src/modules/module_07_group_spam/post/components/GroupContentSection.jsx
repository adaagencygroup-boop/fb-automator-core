"use client";

import React, { useRef, useState, useEffect } from "react";
import {
  Sparkles,
  RotateCcw,
  ImageIcon,
  Bold,
  Italic,
  Underline,
  List,
  Link2,
  Undo2,
  Redo2,
  ListOrdered,
  Minus,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, Field, SelectField } from "../../shared/components";

// Nút toolbar dùng chung, giữ vùng chọn trong editor khi bấm.
function EditorButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 hover:bg-white hover:text-primary"
    >
      {React.cloneElement(children, { className: "size-3.5" })}
    </button>
  );
}

// Chuyển văn bản thường thành HTML và chỉ giữ các thẻ editor hỗ trợ.
export function editorHtml(value = "") {
  const content = String(value);
  if (!/<\/?(?:p|div|h[23]|blockquote|ul|ol|li|br|hr|b|strong|i|em|u|a|img)\b/i.test(content)) {
    return content
      .split("\n")
      .map((line) => line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"))
      .join("<br>");
  }
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const allowed = new Set(["P", "DIV", "H2", "H3", "BLOCKQUOTE", "UL", "OL", "LI", "BR", "HR", "B", "STRONG", "I", "EM", "U", "A", "IMG"]);
  const clean = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }
        const originalHref = child.getAttribute("href");
        const originalSrc = child.getAttribute("src");
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        if (child.tagName === "A") {
          if (originalHref && /^https?:\/\//i.test(originalHref)) {
            child.setAttribute("href", originalHref);
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noopener noreferrer");
          }
        }
        if (child.tagName === "IMG") {
          if (originalSrc && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(originalSrc)) {
            child.setAttribute("src", originalSrc);
            child.setAttribute("alt", "Ảnh đính kèm");
          } else {
            child.remove();
            continue;
          }
        }
        clean(child);
      }
    }
  };
  clean(parsed.body);
  return parsed.body.innerHTML;
}

export default function GroupContentSection({
  prompt,
  setPrompt,
  aiCount,
  setAiCount,
  posts,
  setPosts,
  activePost,
  setActivePost,
  isGenerating,
  hasGeneratedContent,
  setHasGeneratedContent,
  onGeneratePosts,
  isLocked = false,
  setIsLocked,
  onContinue,
  editorRef: externalEditorRef,
  stepNumber = "6",
  contentType = "post",
}) {
  const isComment = contentType === "comment";
  const itemLabel = isComment ? "bình luận" : "bài viết";
  const itemTitle = isComment ? "Bình luận" : "Bài";
  const localEditorRef = useRef(null);
  const editorRef = externalEditorRef || localEditorRef;
  const inlineImageRef = useRef(null);
  const postsRef = useRef(posts);
  const isTypingRef = useRef(false);
  const linkRangeRef = useRef(null);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // Đồng bộ nội dung vào editor khi chuyển tab bài viết, khi AI tạo bài mới, hoặc khi editor mount.
  useEffect(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      return;
    }
    if (editorRef.current) {
      const targetHtml = editorHtml(posts[activePost] || "");
      if (editorRef.current.innerHTML !== targetHtml) {
        editorRef.current.innerHTML = targetHtml;
      }
    }
  }, [activePost, posts, hasGeneratedContent, editorRef]);

  const isDuplicateContent = aiCount === "duplicate" || aiCount === "1" || Number(aiCount) === 1;
  const numCount = isDuplicateContent ? 1 : Math.max(1, Math.min(10, parseInt(aiCount, 10) || 1));
  const targetLength = isDuplicateContent ? 1 : numCount;
  const displayPosts = Array.from({ length: targetLength }, (_, i) => posts[i] ?? "");
  const activePostLength = String(posts[activePost] || "").replace(/<[^>]*>/g, "").length;

  useEffect(() => {
    if (activePost >= targetLength) {
      setActivePost(Math.max(0, targetLength - 1));
    }
  }, [activePost, targetLength, setActivePost]);

  const handleCountChange = (event) => {
    const rawVal = event.target.value;
    if (rawVal === "") {
      setAiCount("");
      return;
    }
    const val = parseInt(rawVal, 10);
    if (isNaN(val)) return;
    const clamped = Math.max(1, Math.min(10, val));
    setAiCount(String(clamped));
    if (clamped === 1) {
      setActivePost(0);
    } else if (activePost >= clamped) {
      setActivePost(clamped - 1);
    }
    if (hasGeneratedContent && posts.length < clamped) {
      setPosts((current) => {
        const next = [...current];
        while (next.length < clamped) {
          next.push(current[0] || prompt.trim() || "");
        }
        return next;
      });
    }
  };

  const handleCountBlur = () => {
    const val = parseInt(aiCount, 10);
    if (isNaN(val) || val < 1) {
      setAiCount("1");
      setActivePost(0);
    } else if (val > 10) {
      setAiCount("10");
    }
  };

  const setPresetCount = (preset) => {
    const strVal = String(preset);
    setAiCount(strVal);
    if (preset === 1) {
      setActivePost(0);
    } else if (activePost >= preset) {
      setActivePost(preset - 1);
    }
    if (hasGeneratedContent && posts.length < preset) {
      setPosts((current) => {
        const next = [...current];
        while (next.length < preset) {
          next.push(current[0] || prompt.trim() || "");
        }
        return next;
      });
    }
  };

  const handleConfirmOriginalContent = () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.warning("Vui lòng nhập nội dung gốc trước khi xác nhận!", "CHƯA CÓ NỘI DUNG");
      return;
    }
    const count = isDuplicateContent ? 1 : numCount;
    let nextPosts;
    if (count === 1) {
      nextPosts = [trimmed];
      setActivePost(0);
      toast.success("Đã áp dụng nội dung gốc (Trùng lặp nội dung 1 bài cho mọi nhóm)!", "XÁC NHẬN NỘI DUNG");
    } else {
      nextPosts = Array.from({ length: count }, (_, i) => posts[i]?.trim() || trimmed);
      toast.success(`Đã áp dụng nội dung gốc cho ${count} bài viết!`, "XÁC NHẬN NỘI DUNG");
    }
    setPosts(nextPosts);
    setHasGeneratedContent(false);
  };

  const updateActivePost = (value) => {
    setPosts((current) => {
      const next = [...current];
      while (next.length <= activePost) next.push("");
      next[activePost] = value;
      return next;
    });
  };

  // Áp dụng định dạng tại vị trí con trỏ rồi lưu HTML vào bài hiện tại.
  const runEditorCommand = (command, value = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) {
      isTypingRef.current = true;
      updateActivePost(editorRef.current.innerHTML);
    }
  };

  // Lưu vùng chọn để gắn liên kết sau khi người dùng nhập URL trong modal.
  const openLinkDialog = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkRangeRef.current = range && editorRef.current?.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkText(selection?.toString() || "");
    setLinkUrl("");
    setLinkError("");
    setLinkDialogOpen(true);
  };

  const applyLink = (event) => {
    event.preventDefault();
    let parsedUrl;
    try {
      parsedUrl = new URL(linkUrl.trim());
    } catch {
      setLinkError("Nhập địa chỉ URL hợp lệ.");
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      setLinkError("Liên kết phải bắt đầu bằng http:// hoặc https://.");
      return;
    }

    const editor = editorRef.current;
    const range = linkRangeRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (range && editor.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range && !range.collapsed) {
      document.execCommand("createLink", false, parsedUrl.href);
    } else {
      const anchor = document.createElement("a");
      anchor.href = parsedUrl.href;
      anchor.textContent = linkText.trim() || parsedUrl.href;
      const insertionRange = range || document.createRange();
      if (!range) {
        insertionRange.selectNodeContents(editor);
        insertionRange.collapse(false);
      }
      insertionRange.deleteContents();
      insertionRange.insertNode(anchor);
      insertionRange.setStartAfter(anchor);
      insertionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(insertionRange);
    }
    updateActivePost(editor.innerHTML);
    setLinkDialogOpen(false);
  };

  // Đọc ảnh người dùng chọn thành data URL để chèn trực tiếp vào bài.
  const insertInlineImage = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      editorRef.current?.focus();
      document.execCommand("insertImage", false, String(reader.result));
      if (editorRef.current) updateActivePost(editorRef.current.innerHTML);
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <SectionCard
        number={stepNumber}
        title={isComment ? "Tạo nội dung bình luận" : "Tạo nội dung bài viết"}
      >
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <Field
            label={`Nội dung gốc ${itemLabel}`}
            hint={`Nhập nội dung để ${isComment ? "bình luận trực tiếp vào bài đầu tiên của nhóm" : "đăng bài trực tiếp"} hoặc làm gợi ý cho AI.`}
          >
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setHasGeneratedContent(false);
                }}
                disabled={isLocked}
                maxLength={2000}
                placeholder={`Nhập nội dung ${itemLabel} tại đây...`}
                className="min-h-32 resize-none pb-6 text-xs leading-5"
              />
              <span className="absolute bottom-2 right-3 text-[9px] text-slate-400">{prompt.length}/2000</span>
            </div>
          </Field>
          <div className="flex flex-col justify-between gap-3">
            <Field
              label={`Số lượng ${itemLabel} AI tạo ra`}
              hint={
                isDuplicateContent
                  ? `Nhập 1: dùng một ${itemLabel} cho tất cả nhóm`
                  : `${numCount} ${itemLabel}: phân bổ nội dung khác nhau cho các nhóm`
              }
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={aiCount}
                    onChange={handleCountChange}
                    onBlur={handleCountBlur}
                    disabled={isLocked}
                    placeholder="1-10"
                    className="h-9 w-20 text-center font-bold text-slate-800"
                  />
                  <div className="flex flex-1 flex-wrap items-center gap-1">
                    {[1, 3, 5, 10].map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        disabled={isLocked}
                        onClick={() => setPresetCount(preset)}
                        className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors border ${
                          numCount === preset
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {preset === 1 ? "1 (Trùng lặp)" : preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Field>

            <div className="space-y-2 pt-1">
              {/* Nút tạo nội dung AI hỗ trợ */}
              <Button
                type="button"
                variant="outline"
                onClick={onGeneratePosts}
                disabled={isLocked || isGenerating || !prompt.trim()}
                className="w-full border-purple-200 bg-purple-50/50 text-purple-700 hover:bg-purple-100 hover:text-purple-800 transition-colors"
                title={`Tính năng hỗ trợ: Sử dụng AI để sinh biến thể ${itemLabel} tự động`}
              >
                <Sparkles className="mr-2 size-3.5 text-purple-600" />
                {isGenerating ? "Đang tạo nội dung AI..." : "Tạo nội dung AI (Hỗ trợ)"}
              </Button>
            </div>
          </div>
        </div>

        {hasGeneratedContent && posts.some((p) => p && p.trim()) && (
          <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-800">
                {isDuplicateContent
                  ? "Kết quả nội dung (Trùng lặp nội dung)"
                  : `Kết quả nội dung (${displayPosts.filter((p) => p && p.trim()).length} ${itemLabel})`}
              </p>
              <p className="text-[10px] text-slate-500">
                {isDuplicateContent
                  ? `Nội dung ${itemLabel} này sẽ được dùng cho tất cả các nhóm mục tiêu`
                  : `Mỗi ${itemLabel} sẽ được luân phiên hoặc ngẫu nhiên cho các nhóm`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-slate-600 hover:text-slate-800"
                disabled={isLocked || !prompt.trim()}
                onClick={handleConfirmOriginalContent}
                title="Áp dụng lại nội dung từ ô nhập phía trên"
              >
                <RotateCcw className="mr-1.5 size-3" /> Nạp lại nội dung gốc
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-purple-600 border-purple-200 hover:bg-purple-50"
                disabled={isLocked || isGenerating || !prompt.trim()}
                onClick={onGeneratePosts}
                title={`Yêu cầu AI sinh lại các ${itemLabel}`}
              >
                <Sparkles className="mr-1.5 size-3" /> Tạo lại bằng AI
              </Button>
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {displayPosts.map((_, index) => (
              <button
                type="button"
                key={index}
                onClick={() => setActivePost(index)}
                className={`h-9 min-w-20 flex-1 text-[10px] font-semibold transition-colors ${
                  activePost === index ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:bg-white"
                }`}
              >
                {isDuplicateContent ? `${itemTitle} 1` : `${itemTitle} ${index + 1}`}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-[11px] font-semibold text-slate-600">Nội dung {itemLabel} {activePost + 1}</p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <input
              ref={inlineImageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                insertInlineImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {/* Toolbar định dạng nội dung và chèn các thành phần vào vị trí con trỏ. */}
            {!isLocked && (
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-slate-500">
                <EditorButton label="Hoàn tác" onClick={() => runEditorCommand("undo")}><Undo2 /></EditorButton>
                <EditorButton label="Làm lại" onClick={() => runEditorCommand("redo")}><Redo2 /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <select
                  aria-label="Kiểu đoạn văn"
                  defaultValue="p"
                  onChange={(event) => runEditorCommand("formatBlock", event.target.value)}
                  className="h-7 rounded border-0 bg-transparent px-1 text-[11px] text-slate-600 outline-none hover:bg-white"
                >
                  <option value="p">Đoạn văn</option>
                  <option value="h2">Tiêu đề 2</option>
                  <option value="h3">Tiêu đề 3</option>
                  <option value="blockquote">Trích dẫn</option>
                </select>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Đậm" onClick={() => runEditorCommand("bold")}><Bold /></EditorButton>
                <EditorButton label="Nghiêng" onClick={() => runEditorCommand("italic")}><Italic /></EditorButton>
                <EditorButton label="Gạch chân" onClick={() => runEditorCommand("underline")}><Underline /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Danh sách dấu đầu dòng" onClick={() => runEditorCommand("insertUnorderedList")}><List /></EditorButton>
                <EditorButton label="Danh sách đánh số" onClick={() => runEditorCommand("insertOrderedList")}><ListOrdered /></EditorButton>
                <EditorButton label="Đường phân cách" onClick={() => runEditorCommand("insertHorizontalRule")}><Minus /></EditorButton>
                <span className="mx-1 h-5 border-l border-slate-200" />
                <EditorButton label="Chèn liên kết" onClick={openLinkDialog}><Link2 /></EditorButton>
                <EditorButton label="Chèn ảnh" onClick={() => inlineImageRef.current?.click()}><ImageIcon /></EditorButton>
              </div>
            )}
            {/* Vùng soạn thảo rich text; lưu HTML để giữ định dạng riêng từng bài. */}
            <div
              ref={editorRef}
              contentEditable={!isLocked}
              suppressContentEditableWarning
              role="textbox"
              aria-label={`Nội dung ${itemLabel} ${activePost + 1}`}
              aria-multiline="true"
              aria-readonly={isLocked}
              onInput={(event) => {
                isTypingRef.current = true;
                updateActivePost(event.currentTarget.innerHTML);
              }}
              onClick={(event) => {
                const anchor = event.target.closest("a[href]");
                if (!anchor || !event.currentTarget.contains(anchor)) return;
                event.preventDefault();
                window.open(anchor.href, "_blank", "noopener,noreferrer");
              }}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");
                document.execCommand("insertText", false, text);
              }}
              className="min-h-24 max-h-80 overflow-y-auto px-3 py-3 text-xs leading-5 text-slate-800 outline-none [&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold [&_img]:my-2 [&_img]:max-h-40 [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
            />
            <div className="px-3 pb-2 text-right text-[9px] text-slate-400">
              {activePostLength}/2000
            </div>
          </div>
          </div>
        )}

      </SectionCard>

      {linkDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLinkDialogOpen(false);
          }}
        >
          <form onSubmit={applyLink} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Chèn liên kết</h2>
            <p className="mt-1 text-xs text-slate-500">Liên kết sẽ gắn vào phần văn bản đang chọn.</p>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              Địa chỉ liên kết
              <Input
                autoFocus
                type="text"
                inputMode="url"
                value={linkUrl}
                onChange={(event) => { setLinkUrl(event.target.value); setLinkError(""); }}
                placeholder="https://example.com"
                className="mt-1.5"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Nội dung hiển thị
              <Input
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder="Nhập nội dung liên kết"
                className="mt-1.5"
              />
            </label>
            {linkError && <p role="alert" className="mt-2 text-xs text-red-600">{linkError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>Hủy</Button>
              <Button type="submit">Chèn liên kết</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
