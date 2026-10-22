export function parseCategoriesResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.categories)) return response.categories;
  throw new Error("Dữ liệu danh mục không hợp lệ. Vui lòng kiểm tra Local Engine và thử lại.");
}

export function categoryQuery(value) {
  if (value === "uncategorized") return { uncategorized: true };
  return value === "all" ? {} : { category_id: Number(value) };
}

// Stop at the first failed batch; callers can retain precisely the remaining selection.
export async function moveAccountBatches(uids, categoryId, send) {
  const unique = [...new Set(uids)];
  let completed = 0;
  try {
    for (; completed < unique.length; completed += Math.min(100, unique.length - completed)) {
      await send(unique.slice(completed, completed + 100), categoryId);
    }
    return { completed, remaining: [], error: null };
  } catch (error) {
    return { completed, remaining: unique.slice(completed), error };
  }
}
