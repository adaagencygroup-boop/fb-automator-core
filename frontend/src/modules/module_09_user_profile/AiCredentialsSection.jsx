"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAiCredential, updateAiCredential, deleteAiCredential, getAiCredentials, getGeminiModels, testGroupAiConnection } from "../module_07_group_spam/service";
import { MODEL_GROUPS, modelLabel } from "../module_07_group_spam/shared/aiModels";

const emptyForm = { id: "", model: "gpt-4o", api_key: "" };

export default function AiCredentialsSection() {
  const [apis, setApis] = useState([]);
  const [form, setForm] = useState(null);
  const [googleModels, setGoogleModels] = useState(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function load() {
    setLoading(true);
    try { setApis(await getAiCredentials()); setNotice(null); }
    catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setLoading(false); }
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  function edit(item) {
    setForm(item ? { id: item.id, model: item.model, api_key: "" } : { ...emptyForm });
    setVisible(false); setNotice(null); setDeleting(null);
  }
  async function action(kind) {
    setBusy(kind); setNotice(null);
    try {
      if (kind === "delete") {
        await deleteAiCredential(deleting.id);
        setApis((items) => items.filter((item) => item.id !== deleting.id));
        if (form?.id === deleting.id) setForm(null);
        setDeleting(null);
        setNotice({ text: "Đã xóa API." });
        return;
      }
      const payload = { model: form.model, api_key: form.api_key.trim() || null, credential_id: form.api_key.trim() ? null : (form.id || null) };
      if (kind === "test") {
        if (!payload.api_key && !payload.credential_id) throw new Error("Hãy nhập API Key trước khi kiểm tra.");
        const result = await testGroupAiConnection(payload);
        setNotice({ text: result.message });
      } else if (kind === "models") {
        if (!payload.api_key && !payload.credential_id) throw new Error("Hãy nhập API Key trước khi tải model.");
        const result = await getGeminiModels(payload);
        setGoogleModels(result.models);
        setNotice({ text: `Đã tải ${result.count} model Google.` });
      } else {
        const data = { name: form.model, model: form.model, api_key: payload.api_key };
        const saved = form.id ? await updateAiCredential(form.id, data) : await addAiCredential(data);
        setApis((items) => [...items.filter((item) => item.id !== saved.id), saved]);
        setForm(null); setVisible(false);
        setNotice({ text: "Đã lưu API. Bạn có thể chọn API này tại Đăng bài hoặc Bình luận." });
      }
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(""); }
  }

  return <section className="rounded-xl border border-[#e2e8f5] bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3"><h3 className="text-sm font-semibold">4. Cấu hình API AI</h3><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={load} disabled={loading || !!busy}>Tải lại</Button><Button type="button" size="sm" onClick={() => edit(null)} disabled={loading || !!busy}><Plus size={14} className="mr-1" />Thêm API</Button></div></div>
    <p className="mb-4 text-xs text-slate-500">Thêm nhiều API, kể cả cùng nhà cung cấp, để dùng cho đăng bài và bình luận. Khóa được mã hóa trên máy này.</p>
    {notice && <p role={notice.error ? "alert" : "status"} className={`mb-3 rounded-lg p-3 text-xs ${notice.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{notice.text}</p>}
    {loading ? <p className="text-sm text-slate-500">Đang tải API...</p> : <div className="space-y-2">{apis.length === 0 && <p className="text-sm text-slate-500">Chưa có API. Nhấn Thêm API để cấu hình.</p>}{apis.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><p className="text-sm font-semibold">{modelLabel(item.model)}</p><p className="text-xs text-slate-500">{item.hint} · {item.configured ? "Đã cấu hình" : "Khóa không khả dụng"}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => edit(item)}><Pencil size={13} className="mr-1" />Sửa</Button><Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => setDeleting(item)}><Trash2 size={13} className="mr-1" />Xóa</Button></div></div>)}</div>}
    {deleting && <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm"><p>Xóa API {modelLabel(deleting.model)} ({deleting.hint})? Các tác vụ dùng API này sẽ cần chọn lại.</p><div className="mt-2 flex gap-2"><Button type="button" variant="destructive" size="sm" disabled={!!busy} onClick={() => action("delete")}>Xác nhận xóa</Button><Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => setDeleting(null)}>Hủy</Button></div></div>}
    {form && <form onSubmit={(event) => { event.preventDefault(); action("save"); }} className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-slate-50 p-4">
      <h4 className="text-sm font-semibold">{form.id ? "Chỉnh sửa API" : "Thêm API mới"}</h4>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">Model AI (bắt buộc)
          <select className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={form.model} disabled={!!busy} onChange={(event) => { setForm({ ...form, model: event.target.value }); setNotice(null); }}>
            {MODEL_GROUPS.map((group) => <optgroup key={group.provider} label={group.provider}>
              {(group.provider === "Google AI Studio" && googleModels ? googleModels : group.models).map((model) => <option key={model.id} value={model.id}>{model.label || model.name}</option>)}
              {group.provider === "Google AI Studio" && form.model.startsWith("gemini-") && !(googleModels || group.models).some((model) => model.id === form.model) && <option value={form.model}>{modelLabel(form.model)}</option>}
            </optgroup>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">API Key (bắt buộc)
          <div className="relative mt-1.5"><Input required={!form.id} maxLength={512} type={visible ? "text" : "password"} autoComplete="off" value={form.api_key} disabled={!!busy} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder={form.id ? "Để trống để giữ khóa đã lưu" : "Nhập API Key"} className="h-11 pr-10 font-mono" /><button type="button" aria-label={visible ? "Ẩn API Key" : "Hiện API Key"} onClick={() => setVisible(!visible)} className="absolute right-3 top-3.5 text-slate-400">{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
        </label>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!!busy} onClick={() => action("test")}>Kiểm tra API</Button>{form.model.startsWith("gemini-") && <Button type="button" variant="outline" disabled={!!busy} onClick={() => action("models")}>Tải model Google</Button>}<Button disabled={!!busy}>{busy ? "Đang xử lý..." : "Lưu API"}</Button><Button type="button" variant="outline" disabled={!!busy} onClick={() => { setForm(null); setVisible(false); }}>Hủy</Button></div>
    </form>}
  </section>;
}
