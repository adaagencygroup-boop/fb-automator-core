"use client";

import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getAccountDetail, saveSingleAccount } from "../service";
import { AlertTriangle, Check, UserRoundPlus, X } from "lucide-react";

export default function SingleAccountModal({
  isOpen,
  editUid = null,
  onClose,
  onSuccess,
  existingAccounts = [],
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [twoFa, setTwoFa] = useState("");
  const [cookie, setCookie] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [passMail, setPassMail] = useState("");
  const [mailRecovery, setMailRecovery] = useState("");
  const [tokenHotmail, setTokenHotmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [proxy, setProxy] = useState("");
  const [loadedUid, setLoadedUid] = useState(null);
  const fetching = Boolean(isOpen && editUid && loadedUid !== editUid);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState(null);

  const resetForm = useCallback(() => {
    setUid("");
    setPassword("");
    setTwoFa("");
    setCookie("");
    setToken("");
    setEmail("");
    setPassMail("");
    setMailRecovery("");
    setTokenHotmail("");
    setClientId("");
    setProxy("");
    setError("");
    setErrorField(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (!isOpen || !editUid) return;

    let ignore = false;
    getAccountDetail(editUid)
      .then((data) => {
        if (!ignore) {
          setUid(data.uid || editUid);
          setPassword(data.password || "");
          setTwoFa(data.two_fa || data.twofa_secret || "");
          setCookie(data.cookie || "");
          setToken(data.token || "");
          setEmail(data.email || "");
          setPassMail(data.pass_mail || "");
          setMailRecovery(data.mail_recovery || "");
          setTokenHotmail(data.token_hotmail || "");
          setClientId(data.client_id || "");
          setProxy(data.proxy || "");
        }
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError.message || "Lỗi tải thông tin tài khoản");
        }
      })
      .finally(() => { if (!ignore) setLoadedUid(editUid); });

    return () => {
      setLoadedUid(null);
      ignore = true;
    };
  }, [isOpen, editUid]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !loading) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, handleClose]);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedUid = uid.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUid) {
      setError("Vui lòng nhập UID tài khoản Facebook!");
      setErrorField("uid");
      return;
    }

    const uidRegex = /^[1-9][0-9]{3,19}$/;
    if (!uidRegex.test(trimmedUid)) {
      setError("UID không hợp lệ: Chỉ chứa 4-20 chữ số và không bắt đầu bằng số 0.");
      setErrorField("uid");
      return;
    }

    if (existingAccounts.some((acc) => acc.uid === trimmedUid && acc.uid !== editUid)) {
      setError("Tài khoản có UID này đã tồn tại trong danh sách!");
      setErrorField("uid");
      return;
    }

    if (!trimmedPassword) {
      setError("Vui lòng nhập Mật khẩu tài khoản!");
      setErrorField("password");
      return;
    }

    if (trimmedPassword.length < 4 || trimmedPassword.length > 250) {
      setError("Mật khẩu không hợp lệ: Độ dài từ 4 đến 250 ký tự.");
      setErrorField("password");
      return;
    }

    setLoading(true);
    setError("");
    setErrorField(null);

    try {
      await saveSingleAccount({
        uid: trimmedUid,
        ...(editUid ? { original_uid: editUid } : {}),
        password: trimmedPassword,
        two_fa: twoFa.trim(),
        cookie: cookie.trim(),
        token: token.trim(),
        email: email.trim(),
        pass_mail: passMail.trim(),
        mail_recovery: mailRecovery.trim(),
        token_hotmail: tokenHotmail.trim(),
        client_id: clientId.trim(),
        proxy: proxy.trim(),
      });
      if (onSuccess) await onSuccess({ originalUid: editUid, uid: trimmedUid });
      handleClose();
    } catch (submitError) {
      setError(submitError.message || "Lỗi khi lưu thông tin tài khoản");
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { number: 1, key: "uid", label: "UID (Facebook ID) *", placeholder: "Nhập UID (Facebook ID)", value: uid, setValue: setUid, required: true },
    { number: 2, key: "password", label: "Mật khẩu (Pass) *", placeholder: "Nhập Mật khẩu (Pass)", value: password, setValue: setPassword, required: true },
    { number: 3, key: "two_fa", label: "Mã bảo mật (2FA Key)", placeholder: "Nhập Mã 2FA Secret", value: twoFa, setValue: setTwoFa },
    { number: 4, key: "cookie", label: "Cookie chuỗi", placeholder: "Nhập Cookie chuỗi", value: cookie, setValue: setCookie },
    { number: 5, key: "token", label: "Access Token (EAAB...)", placeholder: "Nhập Access Token EAAB...", value: token, setValue: setToken },
    { number: 6, key: "email", label: "Email đăng nhập", placeholder: "Nhập Email đăng nhập", value: email, setValue: setEmail, type: "email" },
    { number: 7, key: "pass_mail", label: "Mật khẩu Email", placeholder: "Nhập Mật khẩu Email", value: passMail, setValue: setPassMail },
    { number: 8, key: "mail_recovery", label: "Mail khôi phục", placeholder: "Nhập Mail khôi phục", value: mailRecovery, setValue: setMailRecovery },
    { number: 9, key: "token_hotmail", label: "Token Hotmail", placeholder: "Nhập Token Hotmail", value: tokenHotmail, setValue: setTokenHotmail },
    { number: 10, key: "client_id", label: "Client ID", placeholder: "Nhập Client ID", value: clientId, setValue: setClientId },
    { number: 11, key: "proxy", label: "Proxy (IP:Port:User:Pass)", placeholder: "Nhập Proxy (IP:Port:User:Pass)", value: proxy, setValue: setProxy },
  ];

  const renderField = (field) => {
    const isFieldInvalid = errorField === field.key;
    return (
      <label
        key={field.number}
        className={`flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-lg border bg-white px-3 py-1.5 transition-colors shadow-subtle ${
          isFieldInvalid
            ? "border-red-400 ring-1 ring-red-300"
            : "border-border hover:border-slate-300 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2 sm:w-44 sm:shrink-0">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              isFieldInvalid
                ? "bg-red-100 text-red-600"
                : "bg-primary-subtle text-primary border border-blue-100"
            }`}
          >
            {field.number}
          </span>
          <span className="truncate text-xs font-semibold text-slate-700" title={field.label}>
            {field.label}
          </span>
        </span>
        <input
          type={field.type || "text"}
          required={field.required}
          disabled={loading || fetching}
          value={field.value}
          onChange={(event) => {
            field.setValue(event.target.value);
            if (errorField === field.key) {
              setError("");
              setErrorField(null);
            }
          }}
          placeholder={field.placeholder}
          className="h-8 min-w-0 flex-1 rounded bg-transparent px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-50"
        />
      </label>
    );
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm select-none w-screen h-screen overflow-y-auto animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) handleClose();
      }}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[960px] overflow-y-auto rounded-2xl border border-border bg-white p-6 shadow-2xl text-slate-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          disabled={loading || fetching}
          className="absolute right-5 top-5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
          title="Đóng"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex items-center gap-3 pr-10">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary border border-blue-100 shadow-sm">
            <UserRoundPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 leading-snug">
              {editUid ? "Chỉnh sửa tài khoản Facebook" : "Thêm một tài khoản Facebook"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-normal">
              {editUid
                ? `Cập nhật thông tin chi tiết cho tài khoản UID ${editUid}`
                : "Điền thông tin chi tiết 11 trường để lưu trữ tài khoản vào hệ thống"}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
            <div className="min-w-0 flex-1">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid gap-3 lg:grid-cols-2 lg:gap-3.5">
            <div className="space-y-2">{fields.slice(0, 6).map(renderField)}</div>
            <div className="space-y-2">{fields.slice(6).map(renderField)}</div>
          </div>

          <div className="mt-6 flex justify-end gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading || fetching}
              className="h-9 px-4 rounded-md border border-border bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50 shadow-subtle"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || fetching}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary hover:bg-primary-hover px-5 text-xs font-semibold text-white shadow-sm transition cursor-pointer disabled:opacity-50 active:scale-95"
            >
              <Check className="h-4 w-4" />
              <span>{loading ? "Đang lưu..." : editUid ? "Lưu thay đổi" : "Lưu tài khoản"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
