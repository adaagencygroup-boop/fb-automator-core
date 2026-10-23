export function withImportCategory(accounts, enabled, categoryId, categories) {
  if (enabled && (!Number.isInteger(categoryId) || !categories.some(category => category.id === categoryId))) {
    throw new Error("Vui lòng chọn danh mục hợp lệ hoặc tạo danh mục mới trước khi import.");
  }
  return accounts.map(account => {
    const result = { ...account };
    if (enabled) result.category_id = categoryId;
    else delete result.category_id;
    return result;
  });
}

export function importOutcome(response, skippedCount = 0) {
  const added = response.added_count ?? response.imported ?? 0;
  const updated = response.updated_count ?? 0;
  const skipped = skippedCount + (response.skipped_count || 0);
  const errors = Array.isArray(response.errors) ? response.errors : [];
  const failedUids = [...new Set(errors.map(error => error.uid).filter(Boolean))];
  const counts = `Thêm mới: ${added}, cập nhật: ${updated}, bỏ qua: ${skipped}, lỗi: ${errors.length}.`;
  const details = errors.slice(0, 3).map(error => `${error.uid}: ${error.error || "Không thể lưu tài khoản"}`).join("; ");
  return {
    added, updated, errors, failedUids,
    complete: errors.length === 0,
    level: errors.length ? (added + updated > 0 ? "warning" : "error") : "success",
    message: details ? `${counts} ${details}${errors.length > 3 ? "; …" : ""}` : counts,
  };
}
