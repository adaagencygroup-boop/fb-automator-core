"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, User } from "lucide-react";
import api from "@/services/api";
import { toast } from "@/lib/toast";
import AuthLayout, { AuthHeading } from "@/components/auth/AuthLayout";
import SessionOverlay from "@/components/auth/SessionOverlay";
import AccountStatusScreen from "@/components/auth/AccountStatusScreen";
import {
  Checkbox,
  Field,
  FormAlert,
  LoginInput,
  RegisterInput,
  SubmitButton,
  SwitchDivider,
  FOCUS_RING,
} from "@/components/auth/AuthFields";
import { cn } from "@/lib/utils";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:3010";
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const REMEMBER_KEY = "fb-automator.remember-username";

// Màn trạng thái tài khoản (AccountStatusScreen): "pending" | "locked" | "rejected"
const STATUS_SCREENS = ["pending", "locked", "rejected"];

// Toast lỗi đăng nhập (Figma)
const AUTH_TOAST_KEY = "auth-error";
const TOASTS = {
  loginFailed: {
    key: AUTH_TOAST_KEY,
    title: "Đăng nhập thất bại",
    message: "Mật khẩu không khớp với bản quyền đã đăng ký hoặc tài khoản đã bị khóa do vi phạm chính sách bảo mật.",
  },
  hwidMismatch: {
    key: AUTH_TOAST_KEY,
    title: "Lỗi xác thực phần cứng HWID",
    message:
      "Mã máy trạm hiện tại không trùng khớp với mã HWID đã được kích hoạt trong License của tài khoản này. Mỗi License chỉ gắn với duy nhất 1 thiết bị.",
  },
  licenseExpired: {
    key: "license-expired",
    icon: "calendar",
    title: "Bản quyền license đã hết hạn",
    message:
      "Bản quyền của tài khoản này đã kết thúc chu kỳ hoạt động. Vui lòng gia hạn thêm thời gian sử dụng để tiếp tục mở khóa phiên làm việc và hệ thống proxy tự động.",
    duration: 10000,
  },
};

/** Tài khoản đăng nhập được nhưng bản quyền đã hết hạn (backend đặt status = "expired") */
const isLicenseExpired = (me) => me?.status === "expired";

const PASSWORD_RULE = /^[A-Za-z0-9]{6,}$/;
const PHONE_RULE = /^0\d{9}$/;

const readRemembered = () => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) || "";
  } catch {
    return "";
  }
};
const writeRemembered = (username) => {
  try {
    if (username) window.localStorage.setItem(REMEMBER_KEY, username);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* trình duyệt chặn localStorage */
  }
};

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("login");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Thông tin đăng nhập gần nhất (chỉ giữ trong bộ nhớ) — để nút "Làm mới trạng thái" kiểm tra lại tài khoản
  const lastCredentials = useRef(null);
  // HWID của máy (gửi kèm khi đăng nhập / đăng ký, không hiển thị) — cũng cho biết Local Engine có đang chạy không
  const [hwid, setHwid] = useState("");
  const [hwidStatus, setHwidStatus] = useState("loading"); // loading | ok | error

  const loadMe = useCallback(async () => {
    const me = await api.get("/api/v1/auth/me");
    setUser(me);
    return me;
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("fb_auth_token");
    api
      .get("/api/v1/auth/me")
      .then((me) => {
        setUser(me);
        if (isLicenseExpired(me)) toast.error(TOASTS.licenseExpired);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // Đọc HWID khi chưa đăng nhập (dùng khi gửi form + báo trạng thái hệ thống ở cột trái)
  useEffect(() => {
    if (!ready || user) return undefined;
    let cancelled = false;
    api
      .get("/api/v1/auth/hwid")
      .then((res) => {
        if (cancelled) return;
        setHwid(res?.hwid || "");
        setHwidStatus(res?.hwid ? "ok" : "error");
      })
      .catch(() => !cancelled && setHwidStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  useEffect(() => {
    if (!user) return undefined;
    const kick = (err) => {
      // Engine tạm mất kết nối: giữ phiên, lần kiểm tra sau sẽ thử lại
      if (err?.isNetworkError) return;
      const message = String(err?.message || "");
      setUser(null);
      if (message.includes("SESSION_REVOKED") || message.includes("ACCOUNT_BANNED") || message.includes("ACCOUNT_LOCKED")) {
        setScreen("locked");
      } else {
        setScreen("login");
      }
      setError("");
    };
    const refetch = () => {
      api
        .post("/api/v1/auth/refresh")
        .then(() => loadMe())
        .catch(kick);
    };
    const refreshTimer = setInterval(refetch, REFRESH_EVERY_MS);
    const watchTimer = setInterval(() => {
      loadMe().catch(kick);
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(watchTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loadMe]);

  /** HWID mới nhất (đọc lại từ Engine nếu chưa có) */
  async function currentHwid() {
    if (hwid) return hwid;
    const res = await api.get("/api/v1/auth/hwid");
    setHwid(res.hwid || "");
    setHwidStatus(res.hwid ? "ok" : "error");
    return res.hwid;
  }

  function goTo(next) {
    toast.dismissKey("status-refresh");
    setScreen(next);
    setError("");
    setNotice("");
  }

  /** Đăng nhập (admin trước, rồi license người dùng). Lỗi được ném ra cho handleAuthError */
  async function signIn({ username, password }) {
    const machineId = await currentHwid();
    let loggedIn = false;
    try {
      await api.post(
        `/api/v1/admin/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
        null,
        { headers: { "X-Auth-Client": "browser" } }
      );
      loggedIn = true;
    } catch (adminErr) {
      const adminMsg = String(adminErr.message || "");
      if (adminMsg.includes("khóa")) throw adminErr;
    }
    if (!loggedIn) {
      await api.post("/api/v1/auth/verify-license", {
        username,
        password,
        hwid: machineId,
      });
    }
    const me = await loadMe();
    lastCredentials.current = null;
    toast.dismissKey(AUTH_TOAST_KEY);
    if (isLicenseExpired(me)) toast.error(TOASTS.licenseExpired);
    return me;
  }

  /** Lỗi đăng nhập -> màn trạng thái (chờ duyệt / bị khóa / bị từ chối) hoặc toast lỗi */
  function handleAuthError(err) {
    const message = String(err?.message || "");
    if (message.includes("ACCOUNT_PENDING") || message.includes("chờ")) return "pending";
    if (message.includes("ACCOUNT_REJECTED") || message.includes("từ chối")) return "rejected";
    if (message.includes("ACCOUNT_BANNED") || message.includes("ACCOUNT_LOCKED")) return "locked";
    if (message.includes("ERR_HWID_MISMATCH") || message.includes("HWID")) toast.error(TOASTS.hwidMismatch);
    else if (["INVALID_PASSWORD", "ACCOUNT_NOT_FOUND"].some((code) => message.includes(code)) || message.includes("khóa"))
      toast.error(TOASTS.loginFailed);
    else toast.error({ key: AUTH_TOAST_KEY, title: "Đăng nhập thất bại", message: translate(message) });
    return null;
  }

  async function onLogin(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const remember = form.get("remember") === "on";
    lastCredentials.current = { username, password };
    try {
      await signIn({ username, password });
      writeRemembered(remember ? username : "");
    } catch (err) {
      const next = handleAuthError(err);
      if (next) setScreen(next);
    } finally {
      setSubmitting(false);
    }
  }

  /** Nút "Làm mới trạng thái": đăng nhập lại bằng thông tin vừa nhập để xem tài khoản đã được duyệt/mở khóa chưa */
  async function refreshStatus() {
    const credentials = lastCredentials.current;
    if (!credentials) {
      toast.info({
        key: "status-refresh",
        title: "Cần đăng nhập lại",
        message: "Vui lòng đăng nhập lại để kiểm tra trạng thái mới nhất của tài khoản.",
      });
      goTo("login");
      return;
    }
    setRefreshing(true);
    try {
      await signIn(credentials);
    } catch (err) {
      const next = handleAuthError(err);
      if (next === screen) {
        toast.info({
          key: "status-refresh",
          title: "Chưa có thay đổi",
          message:
            next === "pending"
              ? "Tài khoản vẫn đang chờ Quản trị viên kích hoạt. Vui lòng liên hệ hỗ trợ để được duyệt nhanh hơn."
              : "Tài khoản vẫn chưa được mở lại. Vui lòng liên hệ Quản trị viên để được kiểm tra.",
        });
      } else if (next) setScreen(next);
    } finally {
      setRefreshing(false);
    }
  }

  async function onRegister(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm_password") || "");
    const contact = String(form.get("contact_info") || "").trim();

    if (!PASSWORD_RULE.test(password)) return setError("Mật khẩu tối thiểu 6 ký tự, chỉ gồm chữ hoặc số.");
    if (password !== confirm) return setError("Mật khẩu xác nhận không khớp.");
    if (!PHONE_RULE.test(contact)) return setError("Số điện thoại gồm 10 số, bắt đầu bằng 0.");
    if (form.get("agree") !== "on") return setError("Bạn cần đồng ý với Điều khoản dịch vụ trước khi tạo tài khoản.");

    setSubmitting(true);
    try {
      const machineId = await currentHwid();
      await api.post("/api/v1/auth/register", {
        username,
        password,
        contact_info: contact,
        hwid: machineId,
      });
      lastCredentials.current = { username, password };
      setScreen("pending");
    } catch (err) {
      setError(translate(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    api.post("/api/v1/auth/logout").catch(() => {});
    setUser(null);
    setScreen("login");
    setNotice("");
  }

  if (user) {
    const isAdmin = ["admin", "ADMIN"].includes(user.role);
    return children({ user, isAdmin, adminUrl: ADMIN_URL, logout });
  }

  const layoutProps = {
    engineOnline: hwidStatus === "ok" ? true : hwidStatus === "error" ? false : null,
    onExplore: () => document.getElementById("auth-username")?.focus(),
    onDocs: () => {
      setError("");
      setNotice("Tài liệu hướng dẫn đang được cập nhật.");
    },
  };

  // Đang kiểm tra phiên: lớp phủ toàn màn hình (không hiện khung Đăng nhập để tránh nháy form)
  if (!ready) return <SessionOverlay />;

  if (STATUS_SCREENS.includes(screen)) {
    return (
      <AccountStatusScreen
        variant={screen}
        engineOnline={layoutProps.engineOnline}
        onBack={() => goTo("login")}
        onRefresh={refreshStatus}
        refreshing={refreshing}
      />
    );
  }

  return (
    <AuthLayout {...layoutProps}>
      {screen === "login" ? (
        <LoginForm
          onSubmit={onLogin}
          submitting={submitting}
          error={error}
          notice={notice}
          onForgot={() => {
            setError("");
            setNotice("Liên hệ admin để được đặt lại mật khẩu.");
          }}
          onSwitch={() => goTo("register")}
        />
      ) : (
        <RegisterForm
          onSubmit={onRegister}
          submitting={submitting}
          error={error}
          notice={notice}
          onSwitch={() => goTo("login")}
        />
      )}
    </AuthLayout>
  );
}

function LoginForm({ onSubmit, submitting, error, notice, onForgot, onSwitch }) {
  const usernameRef = useRef(null);

  // Điền sẵn tên đăng nhập đã ghi nhớ (đọc sau khi mount để không lệch với HTML dựng sẵn)
  useEffect(() => {
    const saved = readRemembered();
    if (saved && usernameRef.current && !usernameRef.current.value) usernameRef.current.value = saved;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title="Đăng nhập" subtitle="Vui lòng đăng nhập để tiếp tục sử dụng phần mềm" />
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <LoginInput
          ref={usernameRef}
          id="auth-username"
          name="username"
          label="Tên đăng nhập"
          icon={User}
          placeholder="Nhập tên đăng nhập"
          autoComplete="username"
          required
        />
        <LoginInput
          id="auth-password"
          name="password"
          label="Mật khẩu"
          icon={Lock}
          password
          placeholder="Nhập mật khẩu"
          autoComplete="current-password"
          required
        />
        <div className="flex items-center justify-between">
          <Checkbox name="remember" defaultChecked>
            Ghi nhớ đăng nhập
          </Checkbox>
          <button
            type="button"
            onClick={onForgot}
            className={cn("rounded px-0.5 text-xs leading-4 text-[#2563EB] hover:text-[#1D4ED8] hover:underline", FOCUS_RING)}
          >
            Quên mật khẩu?
          </button>
        </div>
        <FormAlert error={error} notice={notice} />
        <SubmitButton loading={submitting}>Đăng nhập</SubmitButton>
        <SwitchDivider question="Chưa có tài khoản?" action="Đăng ký ngay" onClick={onSwitch} />
      </form>
    </div>
  );
}

function RegisterForm({ onSubmit, submitting, error, notice, onSwitch }) {
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        compact
        title="Đăng ký tài khoản mới"
        subtitle="Vui lòng điền thông tin bên dưới để thiết lập quyền truy cập phần mềm"
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-[15px]">
        <Field label="Tên đăng nhập" htmlFor="auth-username" required>
          <RegisterInput
            id="auth-username"
            name="username"
            icon={User}
            placeholder="Nhập tên đăng nhập"
            autoComplete="username"
            required
          />
        </Field>
        <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2 sm:gap-3.5">
          <Field label="Mật khẩu" htmlFor="auth-password" required>
            <RegisterInput
              id="auth-password"
              name="password"
              password
              placeholder="Nhập mật khẩu"
              autoComplete="new-password"
              title="Tối thiểu 6 ký tự, chỉ gồm chữ hoặc số"
              required
            />
          </Field>
          <Field label="Xác nhận mật khẩu" htmlFor="auth-confirm" required>
            <RegisterInput
              id="auth-confirm"
              name="confirm_password"
              password
              placeholder="Xác nhận lại mật khẩu"
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <Field label="Thông tin liên hệ (Số điện thoại)" htmlFor="auth-contact" required>
          <RegisterInput
            id="auth-contact"
            name="contact_info"
            placeholder="Nhập thông tin liên hệ"
            inputMode="numeric"
            autoComplete="tel"
            title="10 số, bắt đầu bằng 0"
            required
          />
        </Field>
        <Checkbox name="agree" size={16} labelClassName="text-[11px] font-semibold tracking-[0.55px] text-[#565E74]">
          Tôi đồng ý với <span className="text-[#2563EB]">Điều khoản dịch vụ</span> và bảo mật HWID
        </Checkbox>
        <FormAlert error={error} notice={notice} />
        <SubmitButton loading={submitting}>Tạo tài khoản</SubmitButton>
        <div className="pt-2">
          <SwitchDivider
            question="Đã có tài khoản?"
            action="Đăng nhập ngay"
            onClick={onSwitch}
          />
        </div>
      </form>
    </div>
  );
}

function translate(message) {
  const map = {
    ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản.",
    INVALID_PASSWORD: "Sai mật khẩu.",
    ACCOUNT_PENDING: "Tài khoản đang chờ admin duyệt.",
    ACCOUNT_BANNED: "Tài khoản đã bị khóa.",
    ACCOUNT_LOCKED: "Tài khoản đã bị khóa.",
    ACCOUNT_REJECTED: "Đơn đăng ký đã bị từ chối.",
    ERR_HWID_MISMATCH: "Máy này không khớp HWID.",
    SESSION_REVOKED: "Phiên đăng nhập đã bị thu hồi.",
  };
  return map[message] || message;
}
