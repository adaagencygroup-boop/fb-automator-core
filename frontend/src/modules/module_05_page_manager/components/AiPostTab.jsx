"use client";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { startAiPostJob } from "../service";
export default function AiPostTab({ pages = [], accounts = [], loading = false }) {
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [keyFileName, setKeyFileName] = useState(() => {
    if (typeof window === "undefined") return "Keys.txt";
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).keyFileName || "Keys.txt" : "Keys.txt";
    } catch {
      return "Keys.txt";
    }
  });
  const [pixabayKey, setPixabayKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).pixabayKey || "" : "";
    } catch {
      return "";
    }
  });
  const [geminiModel, setGeminiModel] = useState(() => {
    if (typeof window === "undefined") return "gemini-3.8-flash";
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).geminiModel || "gemini-3.8-flash" : "gemini-3.8-flash";
    } catch {
      return "gemini-3.8-flash";
    }
  });
  const [fbVersion, setFbVersion] = useState(() => {
    if (typeof window === "undefined") return "v22.0";
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).fbVersion || "v22.0" : "v22.0";
    } catch {
      return "v22.0";
    }
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).scheduleEnabled ?? true : true;
    } catch {
      return true;
    }
  });
  const [scheduleTimes, setScheduleTimes] = useState(() => {
    if (typeof window === "undefined") return ["06:00", "15:30", "21:00"];
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved && Array.isArray(JSON.parse(saved).scheduleTimes) ? JSON.parse(saved).scheduleTimes : ["06:00", "15:30", "21:00"];
    } catch {
      return ["06:00", "15:30", "21:00"];
    }
  });
  const [newTime, setNewTime] = useState("");
  const [delayMin, setDelayMin] = useState(() => {
    if (typeof window === "undefined") return 600;
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).delayMin ?? 600 : 600;
    } catch {
      return 600;
    }
  });
  const [delayMax, setDelayMax] = useState(() => {
    if (typeof window === "undefined") return 900;
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).delayMax ?? 900 : 900;
    } catch {
      return 900;
    }
  });
  const [promptText, setPromptText] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem("fb_ai_post_config");
      return saved ? JSON.parse(saved).promptText || "" : "";
    } catch {
      return "";
    }
  });
  const [accountSearch, setAccountSearch] = useState("");
  const [pageConfigs, setPageConfigs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([
    "[14:28:05] Sẵn sàng hệ thống tạo bài viết tự động với AI. Dữ liệu nạp động từ cơ sở dữ liệu."
  ]);
  useEffect(() => {
    try {
      localStorage.setItem("fb_ai_post_config", JSON.stringify({ keyFileName, pixabayKey, geminiModel, fbVersion, scheduleEnabled, scheduleTimes, delayMin, delayMax, promptText }));
    } catch {}
  }, [keyFileName, pixabayKey, geminiModel, fbVersion, scheduleEnabled, scheduleTimes, delayMin, delayMax, promptText]);
  useEffect(() => {
    if (pages && pages.length > 0) {
      setPageConfigs(
        pages.map((p) => ({
          ...p,
          selected: true,
          keyword: p.ai_keyword || p.page_name || "",
        }))
      );
    } else {
      setPageConfigs([]);
    }
  }, [pages]);
  const handleRemoveTime = (t) => {
    setScheduleTimes(scheduleTimes.filter((item) => item !== t));
  };
  const handleAddTime = () => {
    if (newTime && !scheduleTimes.includes(newTime)) {
      setScheduleTimes([...scheduleTimes, newTime]);
      setNewTime("");
    }
  };
  const handleSelectAll = (val) => {
    setPageConfigs(pageConfigs.map((p) => ({ ...p, selected: val })));
  };
  const handleKeywordChange = (id, val) => {
    setPageConfigs(pageConfigs.map((p) => (p.id === id ? { ...p, keyword: val } : p)));
  };
  const handleToggleSelect = (id) => {
    setPageConfigs(pageConfigs.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  };
  const handleStart = async () => {
    if (!promptText.trim()) {
      alert("Vui lòng nhập Khung Prompt AI cấu trúc bài đăng trước khi kích hoạt!");
      return;
    }
    const selected = pageConfigs.filter((p) => p.selected);
    if (selected.length === 0) {
      alert("Vui lòng chọn ít nhất 1 Fanpage để đăng bài!");
      return;
    }
    setIsRunning(true);
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] Bắt đầu phiên đăng bài AI tự động (Model: ${geminiModel})...`,
      `[${new Date().toLocaleTimeString()}] Khởi tạo prompt từ người dùng (${promptText.length} ký tự)...`,
      ...prev,
    ]);
    const res = await startAiPostJob({
      gemini_model: geminiModel,
      fb_version: fbVersion,
      keys_file: keyFileName,
      pixabay_key: pixabayKey,
      schedule_enabled: scheduleEnabled,
      schedule_times: scheduleTimes,
      delay_min: delayMin,
      delay_max: delayMax,
      prompt: promptText.trim(),
      pages: selected,
    });
    if (res && res.success) {
      setLogs((prev) => [`[${new Date().toLocaleTimeString()}] Đã gửi tác vụ lên máy chủ engine (Job ID: ${res.job_id || "OK"})`, ...prev]);
    }
  };
  const handleStop = () => {
    setIsRunning(false);
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] Đã nhận lệnh dừng luồng đăng bài AI.`, ...prev]);
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
                <span>⚙</span> Cấu hình hệ thống API Keys
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-foreground">File chứa danh sách Gemini API Keys (Mỗi dòng 1 Key)</label>
                <div className="flex gap-2">
                  <Input value={keyFileName} onChange={(e) => setKeyFileName(e.target.value)} className="h-8 text-xs font-mono" />
                  <Button variant="outline" size="sm" className="h-8 shrink-0">Chọn File Key</Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-foreground">Pixabay API Key (tùy chọn)</label>
                <Input value={pixabayKey} onChange={(e) => setPixabayKey(e.target.value)} placeholder="Nhập Pixabay API Key..." className="h-8 text-xs font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-semibold text-foreground">Model Gemini</label>
                  <Input
                    list="gemini-models-list"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="gemini-3.8-flash"
                    className="h-8 text-xs font-mono"
                  />
                  <datalist id="gemini-models-list">
                    <option value="gemini-3.8-flash" />
                    <option value="gemini-3.8-pro" />
                    <option value="gemini-2.5-flash" />
                    <option value="gemini-2.5-pro" />
                    <option value="gemini-2.0-flash" />
                    <option value="gemini-1.5-flash" />
                    <option value="gemini-1.5-pro" />
                  </datalist>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-foreground">Phiên bản Facebook API</label>
                  <select value={fbVersion} onChange={(e) => setFbVersion(e.target.value)} className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs font-mono">
                    <option value="v22.0">v22.0</option>
                    <option value="v21.0">v21.0</option>
                    <option value="v19.0">v19.0</option>
                  </select>
                </div>
              </div>
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Hẹn giờ đăng bài</span>
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
              <div className="pt-2 border-t border-border space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-foreground">Khung Prompt AI cấu trúc bài đăng</label>
                  <span className="text-[10px] text-muted-foreground font-mono">{promptText.length}/1000</span>
                </div>
                <Textarea
                  rows={4}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder={"Ví dụ:\nHãy tạo 1 bài viết về chủ đề du lịch Việt Nam, ngắn gọn, hấp dẫn, có icon, phù hợp đăng Facebook. Nội dung cần thu hút người xem, khuyến khích tương tác."}
                  className="text-xs leading-relaxed"
                />
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
                {selectedAccountId ? "Danh sách Fanpage của tài khoản" : "Danh sách tài khoản đang quản lý Page"}
              </CardTitle>
              {selectedAccountId ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="subtle" className="h-7 text-[11px]" onClick={() => handleSelectAll(true)}>✓ Chọn Tất Cả</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleSelectAll(false)}>✕ Bỏ Chọn Tất Cả</Button>
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
                        <TableHead className="w-10 text-center text-xs"></TableHead>
                        <TableHead className="w-12 text-center text-xs">STT</TableHead>
                        <TableHead className="text-xs">Tên Fanpage</TableHead>
                        <TableHead className="text-xs">Từ khóa tìm kiếm ảnh / Chủ đề bài viết</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageConfigs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-10 text-muted-foreground text-xs">Chưa có Fanpage nào từ cơ sở dữ liệu. Vui lòng thêm Fanpage ở tab Danh sách Fanpage.</TableCell>
                        </TableRow>
                      ) : (
                        pageConfigs.map((p, idx) => (
                          <TableRow key={p.id || idx} className="hover:bg-muted/30">
                            <TableCell className="text-center">
                              <Checkbox checked={p.selected} onCheckedChange={() => handleToggleSelect(p.id)} />
                            </TableCell>
                            <TableCell className="text-center text-xs font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <img src={p.avatar} alt={p.page_name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                                <span className="text-xs font-semibold text-foreground">{p.page_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input value={p.keyword} onChange={(e) => handleKeywordChange(p.id, e.target.value)} className="h-7 text-xs" />
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
                {isRunning && <span className="text-primary font-normal animate-pulse text-[11px]">● Đang xử lý</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="h-36 rounded-md bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300 overflow-y-auto space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className={log.includes("✓") ? "text-emerald-400" : log.includes("dừng") ? "text-amber-400" : ""}>{log}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
