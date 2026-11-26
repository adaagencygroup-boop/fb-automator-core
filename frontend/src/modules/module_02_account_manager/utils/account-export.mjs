import { DEFAULT_MAPPING } from "./import-mapping.mjs";

function sanitizeCell(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function formatUidsForCopy(accounts = []) {
  return accounts
    .map((account) => sanitizeCell(account?.uid))
    .filter(Boolean)
    .join("\n");
}

export function formatAccountRowForCopy(account = {}) {
  return DEFAULT_MAPPING.map((field) => {
    const raw = field === "two_fa" ? (account?.two_fa ?? account?.twofa_secret) : account?.[field];
    return sanitizeCell(raw);
  }).join("|");
}

export function formatAccountsForCopy(accounts = []) {
  return accounts.map(formatAccountRowForCopy).join("\n");
}
