import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard, Field } from "../../shared/components";
import SavedApiSelector from "../../shared/SavedApiSelector";

export default function GroupSettingsSection({ apiSource, threads, setThreads, restMinutes, setRestMinutes, settingsLoading, settingsAction, settingsFeedback, onSaveSettings, isLocked, setIsLocked, stepNumber = "3" }) {
  const busy = settingsLoading || Boolean(settingsAction);
  return <SectionCard number={stepNumber} title="Cấu hình API & thông số chung" description="Chọn API đã cấu hình trong Hồ sơ cá nhân để tạo nội dung." aside={<span className="text-xs text-slate-500">{isLocked ? "Đã lưu cấu hình" : "Đang chỉnh sửa"}</span>}>
    <SavedApiSelector source={apiSource} disabled={busy || isLocked} onChange={() => setIsLocked(false)} />
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Luồng"><Input type="number" min="1" max="10" value={threads} onChange={(event) => setThreads(event.target.value)} disabled={busy || isLocked} /></Field><Field label="Nghỉ (phút)"><Input type="number" min="0" max="1440" value={restMinutes} onChange={(event) => setRestMinutes(event.target.value)} disabled={busy || isLocked} /></Field></div>
    {settingsFeedback && <p role={settingsFeedback.type === "error" ? "alert" : "status"} className="mt-3 text-xs">{settingsFeedback.message}</p>}
    <div className="mt-4 flex justify-end">{isLocked ? <Button type="button" variant="outline" onClick={() => setIsLocked(false)}>Chỉnh sửa</Button> : <Button type="button" disabled={busy || apiSource.loading || !apiSource.selected} onClick={() => onSaveSettings()}>{settingsAction === "saving" ? "Đang lưu..." : "Lưu cấu hình"}</Button>}</div>
  </SectionCard>;
}
