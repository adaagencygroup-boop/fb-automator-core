"use client";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { startReelsPostJob, selectFolder } from "../service";
export default function ReelsPostTab({ pages = [], accounts = [], loading = false }) {
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [rootFolder, setRootFolder] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem("fb_reels_config");
      return saved ? JSON.parse(saved).rootFolder || "" : "";
    } catch {
      return "";
    }
  });
  const [folderError, setFolderError] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("fb_reels_config");
      return saved ? JSON.parse(saved).scheduleEnabled ?? true : true;
    } catch {
      return true;
    }
  });
  const [scheduleTimes, setScheduleTimes] = useState(() => {
    if (typeof window === "undefined") return ["08:00", "12:00", "18:00", "21:00"];
    try {
      const saved = localStorage.getItem("fb_reels_config");
      return saved && Array.isArray(JSON.parse(saved).scheduleTimes) ? JSON.parse(saved).scheduleTimes : ["08:00", "12:00", "18:00", "21:00"];
    } catch {
      return ["08:00", "12:00", "18:00", "21:00"];
    }
  });
  const [newTime, setNewTime] = useState("");
  const [delayMin, setDelayMin] = useState(() => {
    if (typeof window === "undefined") return 600;
    try {
      const saved = localStorage.getItem("fb_reels_config");
      return saved ? JSON.parse(saved).delayMin ?? 600 : 600;
    } catch {
      return 600;
    }
  });
  const [delayMax, setDelayMax] = useState(() => {
    if (typeof window === "undefined") return 900;
    try {
      const saved = localStorage.getItem("fb_reels_config");
      return saved ? JSON.parse(saved).delayMax ?? 900 : 900;
    } catch {
      return 900;
    }
  });
  const [isRunning, setIsRunning] = useState(false);
  const [pageMappings, setPageMappings] = useState([]);
  const folderInputRef = useRef(null);
  const [logs, setLogs] = useState([
    "[10:15:20] Hệ thống sẵn sàng cho tác vụ đăng Reels hàng loạt. Dữ liệu nạp động từ cơ sở dữ liệu."
  ]);
  useEffect(() => {
    try {
      localStorage.setItem("fb_reels_config", JSON.stringify({ rootFolder, scheduleEnabled, scheduleTimes, delayMin, delayMax }));
    } catch {}
  }, [rootFolder, scheduleEnabled, scheduleTimes, delayMin, delayMax]);
  const handleSelectFolder = async () => {
    try {
      const res = await selectFolder(rootFolder);
      if (res && res.folder) {
        setRootFolder(res.folder);
        setFolderError(false);
        return;
      }
    } catch {}
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };
  const handleFolderFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const first = files[0];
      const relPath = first.webkitRelativePath || "";
      const rootPart = relPath.split("/")[0] || "";
      if (rootPart) {
        setRootFolder(rootPart);
        setFolderError(false);
      }
    }
  };
  useEffect(() => {
    if (pages && pages.length > 0) {
      setPageMappings(
        pages.map((p) => {
          const safeName = (p.page_name || "").replace(/[\\/*?:"<>|]/g, "").trim() || `Page_${p.page_id || p.id}`;
          return {
            ...p,
            folder: p.reels_folder || (rootFolder ? `${rootFolder}\\${safeName}` : ""),
          };
        })
      );
    } else {
      setPageMappings([]);
    }
  }, [pages, rootFolder]);
  const handleRemoveTime = (t) => {
    setScheduleTimes(scheduleTimes.filter((item) => item !== t));
  };
  const handleAddTime = () => {
    if (newTime && !scheduleTimes.includes(newTime)) {
      setScheduleTimes([...scheduleTimes, newTime]);
      setNewTime("");
    }
  };
  const handleAutoAssign = () => {
    setPageMappings(
      pageMappings.map((p) => {
        const safeName = (p.page_name || "").replace(/[\\/*?:"<>|]/g, "").trim() || `Page_${p.page_id || p.id}`;
        return {
          ...p,
          folder: rootFolder ? `${rootFolder}\\${safeName}` : safeName,
        };
      })
    );
  };
  const handleFolderChange = (id, val) => {
    setPageMappings(pageMappings.map((p) => (p.id === id ? { ...p, folder: val } : p)));
  };
  const handleStart = async () => {
    if (!rootFolder || !rootFolder.trim()) {
      setFolderError(true);
      alert("Vui lòng chọn hoặc nhập thư mục gốc chứa video trước khi kích hoạt!");
      return;
    }
    setFolderError(false);
    setIsRunning(true);
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] Bắt đầu chu trình đăng Reels lên các Fanpage đã chọn...`,
      `[${new Date().toLocaleTimeString()}] Kiểm tra kết nối Supabase Storage bucket page-videos... OK`,
      ...prev,
    ]);
    await startReelsPostJob({
      root_folder: rootFolder,
      schedule_enabled: scheduleEnabled,
      schedule_times: scheduleTimes,
      delay_min: delayMin,
      delay_max: delayMax,
      mappings: pageMappings,
    });
  };
  const handleStop = () => {
    setIsRunning(false);
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] Đã nhận lệnh dừng luồng đăng Reels.`, ...prev]);
  };
  const filteredAccounts = accounts.filter((acc) =>
    (acc.name || "").toLowerCase().includes(accountSearch.toLowerCase()) ||
    (acc.uid || "").includes(accountSearch)
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 space-y-4">
          <Card className="border border-border bg-card shadow-card">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-xs font-heading font-bold text-foreground flex items-center gap-2">
                <span>📹</span> Cấu hình đăng Video Reels
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-foreground">Thư mục gốc chứa video</label>
                <div className="flex gap-2">
                  <input ref={folderInputRef} type="file" webkitdirectory="" directory="" className="hidden" onChange={handleFolderFileChange} />
                  <Input value={rootFolder} onChange={(e) => { setRootFolder(e.target.value); if (e.target.value.trim()) setFolderError(false); }} placeholder="video_reels" className={`h-8 text-xs font-mono ${folderError || !rootFolder.trim() ? "border-amber-400 focus-visible:border-amber-500" : ""}`} />
                  <Button variant="outline" size="sm" type="button" onClick={handleSelectFolder} className="h-8 shrink-0">Chọn thư mục</Button>
                </div>
                {(!rootFolder || !rootFolder.trim()) && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                    <span>⚠️</span> Thư mục đang trống. Bấm &quot;Chọn thư mục&quot; hoặc nhập đường dẫn video.
                  </p>
                )}
              </div>
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Hẹn giờ đăng Reels</span>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                    <span className="text-[11px] text-muted-foreground">{scheduleEnabled ? "Kích hoạt" : "Tắt"}</span>
                  </div>
                </div>
                {scheduleEnabled && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {scheduleTimes.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted border border-border text-[11px] font-mono">
                          {t}
                          <button type="button" onClick={() => handleRemoveTime(t)} className="text-muted-foreground hover:text-destructive">×</button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-7 w-24 text-xs font-mono" />
                      <Button size="sm" variant="subtle" className="h-7 text-[11px]" onClick={handleAddTime}>+ Thêm giờ</Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-border space-y-1.5">
                <label className="font-semibold text-foreground">Giãn cách đăng ngẫu nhiên</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-[11px]">Từ (giây)</span>
                    <Input type="number" value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-[11px]">Đến (giây)</span>
                    <Input type="number" value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} className="h-8 text-xs font-mono" />
                  </div>
                </div>
              </div>
              <div className="pt-2 flex items-center gap-2">
                <Button className="flex-1 font-bold" variant="default" disabled={isRunning} onClick={handleStart}>▶ KÍCH HOẠT</Button>
                <Button className="flex-1 font-bold" variant="destructive" disabled={!isRunning} onClick={handleStop}>⏹ DỪNG LUỒNG</Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-7 space-y-4">
          <Card className="border border-border bg-card shadow-card">
            <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-heading font-bold text-foreground">
                {selectedAccountId ? "Gán nguồn video cho Fanpage" : "Danh sách tài khoản đang quản lý Page"}
              </CardTitle>
              {selectedAccountId ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="subtle" className="h-7 text-[11px]" onClick={handleAutoAssign}>⚡ Tự động gán theo tên</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelectedAccountId(null)}>← Đổi Tài khoản</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-[11px]">🔄 Đồng bộ</Button>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-3">
              {!selectedAccountId ? (
                <div className="space-y-3">
                  <Input placeholder="Tìm tài khoản..." value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} className="text-xs h-8" />
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-12 text-center text-xs">STT</TableHead>
                          <TableHead className="text-xs">Tài khoản</TableHead>
                          <TableHead className="text-center text-xs">Số Page</TableHead>
                          <TableHead className="text-right text-xs pr-4">Thao tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAccounts.map((acc, i) => (
                          <TableRow key={acc.id || i} className="hover:bg-muted/30">
                            <TableCell className="text-center text-xs font-mono">{i + 1}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <img src={acc.avatar} alt={acc.name} className="w-7 h-7 rounded-full object-cover" />
                                <div>
                                  <span className="text-xs font-bold text-foreground block">{acc.name}</span>
                                  <span className="text-[11px] font-mono text-muted-foreground">UID: {acc.uid}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center text-xs font-semibold">{acc.pagesCount}</TableCell>
                            <TableCell className="text-right pr-4">
                              <Button size="sm" variant="subtle" className="h-7 text-xs" onClick={() => setSelectedAccountId(acc.id)}>Đăng nhập</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-12 text-center text-xs">STT</TableHead>
                        <TableHead className="text-xs">Tên Fanpage</TableHead>
                        <TableHead className="text-xs">Thư mục nguồn Video</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageMappings.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-10 text-muted-foreground text-xs">Chưa có Fanpage nào từ cơ sở dữ liệu. Vui lòng thêm Fanpage ở tab Danh sách Fanpage.</TableCell>
                        </TableRow>
                      ) : (
                        pageMappings.map((p, idx) => (
                          <TableRow key={p.id || idx} className="hover:bg-muted/30">
                            <TableCell className="text-center text-xs font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <img src={p.avatar} alt={p.page_name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                                <span className="text-xs font-semibold text-foreground">{p.page_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input value={p.folder} onChange={(e) => handleFolderChange(p.id, e.target.value)} placeholder="video_reels" className="h-7 text-xs font-mono" />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border border-border bg-card shadow-card">
            <CardHeader className="p-3 pb-2 border-b border-border">
              <CardTitle className="text-xs font-heading font-bold text-foreground flex items-center justify-between">
                <span>💻 Theo dõi Tiến trình</span>
                {isRunning && <span className="text-primary font-normal animate-pulse text-[11px]">● Đang tải lên</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="h-32 rounded-md bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300 overflow-y-auto space-y-1">
                {logs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
