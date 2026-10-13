"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Eye, X } from "lucide-react";
import { getAccountDetail } from "../service";

const fields = [
  { label: "UID", value: (account) => account.uid, color: "text-slate-900 font-mono font-bold" },
  { label: "PASS FB", value: (account) => account.password, color: "text-emerald-600 font-mono" },
  { label: "2FA KEY", value: (account) => account.two_fa || account.twofa_secret, color: "text-amber-600 font-mono" },
  { label: "COOKIE", value: (account) => account.cookie, color: "text-slate-600 font-mono text-[11px]" },
  { label: "TOKEN FB", value: (account) => account.token, color: "text-sky-600 font-mono text-[11px]" },
  { label: "EMAIL", value: (account) => account.email, color: "text-slate-800 font-medium" },
  { label: "PASS MAIL", value: (account) => account.pass_mail || account.passmail, color: "text-emerald-600 font-mono" },
  { label: "MAIL KHÔI PHỤC", value: (account) => account.mail_recovery || account.mailkhoiphuc, color: "text-sky-600 font-medium" },
  { label: "TOKEN HOTMAIL", value: (account) => account.token_hotmail || account.tokenhotmail, color: "text-slate-600 font-mono text-[11px]" },
  { label: "CLIENT ID", value: (account) => account.client_id, color: "text-slate-700 font-mono" },
  { label: "PROXY", value: (account) => account.proxy, color: "text-emerald-700 font-mono" },
];

export default function AccountDetailPanel({ uid, initialAccount, onClose }) {
  const [account, setAccount] = useState(initialAccount || null);
  const [error, setError] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    let active = true;
    getAccountDetail(uid)
      .then((detail) => {
        if (active) setAccount(detail);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không thể tải chi tiết tài khoản.");
      });
    return () => {
      active = false;
    };
  }, [uid]);

  useEffect(() => {
    if (copiedField === null) return;
    const timeout = window.setTimeout(() => setCopiedField(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedField]);

  const copyValue = async (index, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(index);
      setError(null);
    } catch {
      setError("Không thể sao chép. Hãy kiểm tra quyền truy cập clipboard.");
    }
  };

  const copyAllFields = async () => {
    if (!account) return;
    const allFieldsValue = [
      account.uid || "",
      account.password || "",
      account.two_fa || account.twofa_secret || "",
      account.cookie || "",
      account.token || "",
      account.email || "",
      account.pass_mail || account.passmail || "",
      account.mail_recovery || account.mailkhoiphuc || "",
      account.token_hotmail || account.tokenhotmail || "",
      account.client_id || "",
      account.proxy || "",
    ].join("|");

    try {
      await navigator.clipboard.writeText(allFieldsValue);
      setCopiedAll(true);
      setError(null);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      setError("Không thể sao chép. Hãy kiểm tra quyền truy cập clipboard.");
    }
  };

  return (
    <div className="border-t border-border bg-slate-50/70 p-4" aria-label={`Chi tiết tài khoản ${uid}`}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs font-bold text-sky-700">
          <div className="flex items-center gap-1.5">
            <Eye className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-semibold text-slate-800">
              CHI TIẾT 11 TRƯỜNG DỮ LIỆU: <span className="font-mono text-primary font-bold">{uid}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={copyAllFields}
            disabled={!account}
            title="Sao chép toàn bộ 11 trường: UID|Pass|2FA|Cookie|Token|Email|PassMail|MailKhôiPhục|TokenHotmail|ClientId|Proxy"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer shadow-sm ${
              copiedAll
                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                : "bg-white border-border text-slate-700 hover:bg-primary-subtle hover:text-primary hover:border-blue-300"
            }`}
          >
            {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-primary" />}
            <span>{copiedAll ? "Đã sao chép 11 trường!" : "Sao chép tất cả (11 trường)"}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors"
          title="Đóng bảng chi tiết"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 p-2.5 text-xs font-medium text-red-600 border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {fields.map(({ label, value, color }, index) => {
          const rawValue = account ? value(account) : undefined;
          const displayValue = rawValue || "--";
          const isCopied = copiedField === index;

          return (
            <div
              key={label}
              className="flex flex-col justify-between rounded-lg border border-border bg-white p-2.5 shadow-subtle hover:border-slate-300 transition-colors"
            >
              <div className="flex items-center justify-between gap-1 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {label}
                </span>
                {rawValue && (
                  <button
                    type="button"
                    onClick={() => copyValue(index, rawValue)}
                    className="p-1 rounded text-slate-400 hover:text-primary hover:bg-slate-100 transition-colors"
                    title={`Sao chép ${label}`}
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
              <div
                className={`text-xs truncate break-all select-all ${color}`}
                title={rawValue || ""}
              >
                {displayValue}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
