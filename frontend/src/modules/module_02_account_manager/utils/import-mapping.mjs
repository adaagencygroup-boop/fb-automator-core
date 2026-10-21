export const DEFAULT_MAPPING = [
  "uid", "password", "two_fa", "cookie", "token", "email",
  "pass_mail", "mail_recovery", "token_hotmail", "client_id", "proxy",
];

export function isValidProxy(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  let host, port;
  if (raw.includes("://")) {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      host = url.hostname;
      // URL removes default ports; read the explicit port from the authority.
      const authority = raw.split("://")[1].split(/[/?#]/)[0].split("@").pop();
      port = authority.match(/:(\d+)$/)?.[1];
    } catch { return false; }
  } else {
    const address = raw.includes("@") ? raw.slice(raw.indexOf("@") + 1) : raw;
    const parts = address.split(":");
    if (raw.includes("@") ? parts.length !== 2 : ![2, 4].includes(parts.length)) return false;
    [host, port] = parts;
  }
  return !!host?.trim() && /^\d+$/.test(port || "") && Number(port) >= 1 && Number(port) <= 65535;
}

export function normalizeImportedValue(value) {
  const normalized = String(value || "").trim().replace(/\\_/g, "_");
  const markdownEmail = normalized.match(/^\[([^\]]+@[^\]]+)\]\(mailto:[^)]+\)$/i);
  return markdownEmail?.[1] || normalized;
}

export function isFacebookToken(value) {
  return /^EAA/i.test(normalizeImportedValue(value));
}

// Preview, validation and submission must respect the selected column mapping.
export function mapImportedRow(line, delimiter, columnMap) {
  const account = { uid: "" };
  line.split(delimiter).map(normalizeImportedValue).forEach((value, index) => {
    const field = columnMap[index];
    if (field && field !== "ignore") account[field] = value;
  });
  return account;
}

export function detectColumnMapping(lines, delimiter, columnCount) {
  // null can still be inferred; "ignore" must survive every later fallback.
  const mapping = Array.from({ length: columnCount }).fill(null);
  const samplesByColumn = Array.from({ length: columnCount }, (_, columnIndex) =>
    lines.slice(0, 50)
      .map((line) => normalizeImportedValue(line.split(delimiter)[columnIndex] || ""))
      .filter(Boolean),
  );
  const allMatch = (samples, pattern) => samples.length > 0 && samples.every((value) => pattern.test(value));
  const someMatch = (samples, pattern) => samples.length > 0 && samples.some((value) => pattern.test(value));

  const assignedFields = new Set();

  // 1. Proxy
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || assignedFields.has("proxy")) return;
    if (samples.every(isValidProxy)) {
      mapping[index] = "proxy";
      assignedFields.add("proxy");
    }
  });

  // 2. Cookie chuỗi
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null || assignedFields.has("cookie")) return;
    if (samples.every((value) => /(?:^|;)\s*c_user=\d+/i.test(value) && /(?:^|;)\s*xs=/i.test(value))) {
      mapping[index] = "cookie";
      assignedFields.add("cookie");
    }
  });

  // 3. Token FB
  samplesByColumn.forEach((samples, index) => {
    if (mapping[index] !== null || !samples.some(isFacebookToken)) return;
    if (samples.every(isFacebookToken) && !assignedFields.has("token")) {
      mapping[index] = "token";
      assignedFields.add("token");
    } else {
      // Mixed token types and duplicate Facebook columns need an explicit choice.
      // Protect them from Hotmail/password and positional fallbacks.
      mapping[index] = "ignore";
    }
  });

  // 4. UID
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null || assignedFields.has("uid")) return;
    if (allMatch(samples, /^\d{5,20}$/)) {
      mapping[index] = "uid";
      assignedFields.add("uid");
    }
  });

  // 5. 2FA Secret Key
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null || assignedFields.has("two_fa")) return;
    if (allMatch(samples, /^[A-Z2-7]{16,64}$/)) {
      mapping[index] = "two_fa";
      assignedFields.add("two_fa");
    }
  });

  // 6. Email
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null) return;
    if (allMatch(samples, /^[^\s@]+@[^\s@]+\.[^\s@]+$/i)) {
      if (!assignedFields.has("email")) {
        mapping[index] = "email";
        assignedFields.add("email");
      } else if (!assignedFields.has("mail_recovery")) {
        mapping[index] = "mail_recovery";
        assignedFields.add("mail_recovery");
      }
    }
  });

  // 7. Token Hotmail
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null || assignedFields.has("token_hotmail")) return;
    if (
      someMatch(samples, /^(?:M\.C\d+_|MsaArtifacts|EwB)/i) ||
      someMatch(samples, /MsaArtifacts/i) ||
      samples.some((v) => v.length > 80 && !isFacebookToken(v) && !/(?:^|;)\s*c_user=/i.test(v))
    ) {
      mapping[index] = "token_hotmail";
      assignedFields.add("token_hotmail");
    }
  });

  // 8. Client ID
  samplesByColumn.forEach((samples, index) => {
    if (!samples.length || mapping[index] !== null) return;
    if (allMatch(samples, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      if (!assignedFields.has("client_id")) {
        mapping[index] = "client_id";
        assignedFields.add("client_id");
      } else {
        mapping[index] = "ignore";
      }
    }
  });

  // 9. Heuristic Password & Pass Mail
  const uidIndex = mapping.indexOf("uid");
  if (uidIndex >= 0 && uidIndex + 1 < columnCount && mapping[uidIndex + 1] === null && !assignedFields.has("password")) {
    mapping[uidIndex + 1] = "password";
    assignedFields.add("password");
  }

  const emailIndex = mapping.indexOf("email");
  if (emailIndex >= 0 && emailIndex + 1 < columnCount && mapping[emailIndex + 1] === null && !assignedFields.has("pass_mail")) {
    mapping[emailIndex + 1] = "pass_mail";
    assignedFields.add("pass_mail");
  }

  // 10. Fallback
  mapping.forEach((field, index) => {
    if (field === null && index < DEFAULT_MAPPING.length) {
      const fallback = DEFAULT_MAPPING[index];
      if (fallback && fallback !== "proxy" && !assignedFields.has(fallback)) {
        mapping[index] = fallback;
        assignedFields.add(fallback);
      }
    }
  });

  const finalUsed = new Set();
  return mapping.map((field) => {
    if (field === null || field === "ignore") return "ignore";
    if (finalUsed.has(field)) return "ignore";
    finalUsed.add(field);
    return field;
  });
}

