import Link from "next/link";
import { Field, SelectField } from "./components";
import { Button } from "@/components/ui/button";
import { modelLabel } from "./aiModels";

export default function SavedApiSelector({ source, disabled = false, onChange }) {
  return <div className="space-y-2">
    <Field label="API đã cấu hình" required>
      <SelectField value={source.selected?.id || ""} disabled={disabled || source.loading} onChange={(event) => { source.select(event.target.value); onChange?.(); }}>
        <option value="" disabled>{source.loading ? "Đang tải API..." : "Chọn API từ User Profile"}</option>
        {source.apis.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{modelLabel(item.model)} ({item.hint}){!item.configured ? " — Khóa không khả dụng" : ""}</option>)}
      </SelectField>
    </Field>
    {!source.loading && !source.apis.length && <p className="text-xs text-amber-600">Chưa có API. Hãy thêm cấu hình trong Hồ sơ cá nhân.</p>}
    {source.selectedId && !source.selected && !source.loading && source.apis.length > 0 && <p role="alert" className="text-xs text-amber-600">API đã chọn không còn khả dụng. Vui lòng chọn lại.</p>}
    {source.error && <p role="alert" className="text-xs text-red-600">{source.error}</p>}
    <div className="flex items-center gap-3"><Link href="/profile" className="text-xs text-blue-600 hover:underline">Quản lý API trong Hồ sơ cá nhân</Link><Button type="button" variant="outline" size="sm" onClick={source.refresh} disabled={disabled || source.loading}>Tải lại</Button></div>
  </div>;
}
