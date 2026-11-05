"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const UnsavedChangesContext = createContext(null);

export function UnsavedChangesProvider({ children }) {
  const [guard, setGuard] = useState({ dirty: false, discard: null });
  const [pendingAction, setPendingAction] = useState(null);

  const setUnsavedChanges = useCallback((dirty, discard = null) => {
    setGuard({ dirty: Boolean(dirty), discard: dirty ? discard : null });
  }, []);

  const requestNavigation = useCallback((action) => {
    if (!guard.dirty) {
      action();
      return true;
    }
    setPendingAction(() => action);
    return false;
  }, [guard.dirty]);

  const stay = useCallback(() => setPendingAction(null), []);

  const leave = useCallback(async () => {
    const action = pendingAction;
    setPendingAction(null);
    setGuard({ dirty: false, discard: null });
    await guard.discard?.();
    action?.();
  }, [guard.discard, pendingAction]);

  useEffect(() => {
    if (!guard.dirty) return undefined;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [guard.dirty]);

  const value = useMemo(() => ({ setUnsavedChanges, requestNavigation }), [setUnsavedChanges, requestNavigation]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {pendingAction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-changes-title"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h2 id="unsaved-changes-title" className="text-base font-bold text-slate-900">Thay đổi chưa lưu</h2>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              Bạn đã nhập dữ liệu nhưng chưa lưu. Bạn muốn tiếp tục chỉnh sửa hay rời khỏi màn hình?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={stay} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Ở lại
              </button>
              <button type="button" onClick={leave} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                Rời đi
              </button>
            </div>
          </div>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error("useUnsavedChanges must be used inside UnsavedChangesProvider");
  return context;
}
