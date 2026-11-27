/**
 * Lưu tệp xuống máy (Module 11):
 * - Ưu tiên `window.showSaveFilePicker`: chờ người dùng chọn nơi lưu và bấm Lưu xong mới trả `status: "saved"`,
 *   bấm Huỷ trả `status: "cancelled"` (tránh báo "Xuất thành công" giả khi hộp thoại lưu vừa mở).
 * - Trình duyệt không hỗ trợ picker (Firefox, Safari…) hoặc picker không mở được → fallback `<a download>`
 *   và trả `status: "downloaded"` để UI báo dạng thông tin thay vì khẳng định đã lưu.
 * Hàm thuần (nhận inject `win/doc/urlApi` khi test bằng `node --test`).
 */

function isAbortError(err) {
  return err?.name === "AbortError";
}

/** Tải qua link <a download> — trình duyệt tự xử lý, trang KHÔNG biết người dùng có bấm Lưu hay không. */
export function triggerBrowserDownload(
  blob,
  fileName,
  {
    doc = typeof document !== "undefined" ? document : null,
    urlApi = typeof URL !== "undefined" ? URL : null,
  } = {},
) {
  if (!doc || !urlApi) throw new Error("Môi trường hiện tại không hỗ trợ tải tệp.");
  const url = urlApi.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  doc.body?.appendChild?.(link);
  link.click();
  doc.body?.removeChild?.(link);
  urlApi.revokeObjectURL(url);
}

/**
 * Lưu Blob xuống máy. Trả về `{ status, fileName }`:
 * - `"saved"`      : người dùng đã chọn nơi lưu, bấm Lưu và ghi xong.
 * - `"cancelled"`  : người dùng bấm Huỷ ở hộp thoại lưu.
 * - `"downloaded"` : đã giao file cho trình duyệt tải bằng `<a download>` (không rõ user có bấm Lưu không).
 */
export async function saveBlobFile(
  blob,
  {
    suggestedName = "export.csv",
    types = [],
    win = typeof window !== "undefined" ? window : null,
    doc = typeof document !== "undefined" ? document : null,
    urlApi = typeof URL !== "undefined" ? URL : null,
  } = {},
) {
  if (win && typeof win.showSaveFilePicker === "function") {
    try {
      const pickerOpts = types?.length ? { suggestedName, types } : { suggestedName };
      const handle = await win.showSaveFilePicker(pickerOpts);
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (writeErr) {
        await writable.abort?.().catch(() => {});
        throw writeErr;
      }
      return { status: "saved", fileName: handle.name || suggestedName };
    } catch (err) {
      if (isAbortError(err)) return { status: "cancelled", fileName: suggestedName };
      // Picker lỗi không phải do người dùng Huỷ (vd mất user activation sau API chậm) → fallback tải thường
    }
  }

  triggerBrowserDownload(blob, suggestedName, { doc, urlApi });
  return { status: "downloaded", fileName: suggestedName };
}

/**
 * Mở hộp thoại "Lưu thành" NGAY lúc người dùng bấm (trước mọi await chậm như tải dữ liệu / import thư viện):
 * trình duyệt chỉ cho mở picker trong vài giây sau cú click — chờ API xong mới mở thì picker lỗi và
 * tệp bị tải thẳng vào Tải xuống. Trả { handle, fileName } | { cancelled: true, fileName }
 * (handle null = không có picker → khi ghi sẽ tải bằng <a download>).
 */
export async function pickSaveTarget({ suggestedName = "export", types = [], win = typeof window !== "undefined" ? window : null } = {}) {
  if (win && typeof win.showSaveFilePicker === "function") {
    try {
      const handle = await win.showSaveFilePicker(types?.length ? { suggestedName, types } : { suggestedName });
      return { handle, fileName: handle.name || suggestedName };
    } catch (err) {
      if (isAbortError(err)) return { cancelled: true, fileName: suggestedName };
    }
  }
  return { handle: null, fileName: suggestedName };
}

/** Ghi Blob vào nơi đã chọn bằng pickSaveTarget → { status: "saved" | "downloaded", fileName } */
export async function writeSaveTarget(
  target,
  blob,
  { doc = typeof document !== "undefined" ? document : null, urlApi = typeof URL !== "undefined" ? URL : null } = {},
) {
  if (target?.handle) {
    const writable = await target.handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (writeErr) {
      await writable.abort?.().catch(() => {});
      throw writeErr;
    }
    return { status: "saved", fileName: target.fileName };
  }
  triggerBrowserDownload(blob, target?.fileName || "export", { doc, urlApi });
  return { status: "downloaded", fileName: target?.fileName || "export" };
}

/** Lưu nội dung CSV (tự thêm BOM UTF-8 để Excel mở không lỗi tiếng Việt). */
export async function saveCsvContent(csvText, fileName, envOpts = {}) {
  const text = String(csvText ?? "");
  const withBom = text.startsWith("\uFEFF") ? text : `\uFEFF${text}`;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8;" });
  return saveBlobFile(blob, {
    suggestedName: fileName,
    types: [{ description: "Tệp Excel / CSV", accept: { "text/csv": [".csv"] } }],
    ...envOpts,
  });
}

/**
 * Chọn danh sách `page_key` để "Lưu danh sách" ở màn Quét thông tin page:
 * BẮT BUỘC người dùng phải tích chọn ít nhất 1 page trong bảng kết quả — KHÔNG tự lấy toàn bộ khi chưa tích.
 */
export function pickSelectedPagesForSave(allPages = [], selectedKeys = []) {
  if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) {
    return { ok: false, keys: [], reason: "empty_selection" };
  }
  const pickedSet = new Set(selectedKeys.filter(Boolean));
  if (pickedSet.size === 0) {
    return { ok: false, keys: [], reason: "empty_selection" };
  }
  const keys = [];
  const seen = new Set();
  for (const page of allPages || []) {
    const key = page?.page_key;
    if (key && pickedSet.has(key) && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  if (!keys.length) {
    return { ok: false, keys: [], reason: "no_matching_pages" };
  }
  return { ok: true, keys, reason: null };
}
