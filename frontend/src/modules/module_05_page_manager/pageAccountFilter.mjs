export const ALL_ACCOUNTS = "all";

export function pageAccountKey(page) {
  const webId = String(page.web_connection_id ?? "").trim();
  if (webId) return `web:${webId}`;
  const uid = String(page.manager_uid ?? "").trim();
  return uid ? `account:${uid}` : "unassigned";
}

export function pageAccountOptions(pages) {
  const accounts = new Map();
  for (const page of pages) {
    const value = pageAccountKey(page);
    const existing = accounts.get(value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const isWeb = value.startsWith("web:");
    const identifier = value === "unassigned" ? "" : value.slice(value.indexOf(":") + 1);
    accounts.set(value, {
      value,
      name: value === "unassigned" ? "Chưa gán tài khoản" : String(page.manager_name || `Tài khoản ${identifier}`),
      detail: identifier ? `${isWeb ? "OAuth trình duyệt · ID" : "UID"}: ${identifier}` : "",
      count: 1,
    });
  }
  return [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name, "vi") || a.value.localeCompare(b.value));
}

export function matchesPageAccount(page, selected) {
  return selected === ALL_ACCOUNTS || pageAccountKey(page) === selected;
}
