"use client";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { importAccounts } from "../service";
export default function AddPageModal({ open, onOpenChange, onSuccess }) {
  const [step, setStep] = useState("notice");
  const [rawText, setRawText] = useState("100084920491823|AdminPass#992|JBSMY3DPEHPK3PXP|c_user=100084920491823;xs=38%3A12903|EAAAAUaZA...|nguyen.dev88@gmail.com|MailPass@2024|recovery.mail@outlook.com|hot_tok_99182a|CID_4819204|103.142.12.88:8080:user:pass\n100072049182041|SecureFb!2024|KZXW65TFOJZHK33U|c_user=100072049182041;xs=12%3A98211|EAAAAUaZB...|hoang.anh.digital@outlook.com|P@ssword991|backup.hoanganh@gmail.com|hot_tok_77211b|CID_5521903|45.120.89.12:9090:proxy:pass");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [checkLive, setCheckLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const handleClose = () => {
    setStep("notice");
    onOpenChange(false);
  };
  const handleContinue = () => {
    setStep("import");
  };
  const handleImport = async () => {
    setLoading(true);
    const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
    const accounts = lines.map((line) => {
      const parts = line.split("|");
      return {
        uid: parts[0]?.trim() || "",
        password: parts[1]?.trim() || "",
        two_fa: parts[2]?.trim() || "",
        cookie: parts[3]?.trim() || "",
        token: parts[4]?.trim() || "",
        email: parts[5]?.trim() || "",
        pass_mail: parts[6]?.trim() || "",
      };
    });
    await importAccounts({ accounts, skip_duplicates: skipDuplicates, check_status: checkLive });
    setLoading(false);
    handleClose();
    if (onSuccess) onSuccess();
  };
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={step === "notice" ? "max-w-md p-6 bg-card" : "max-w-4xl p-6 bg-card"}>
        {step === "notice" ? (
          <div className="flex flex-col items-center text-center space-y-4">
            <h2 className="text-xl font-heading font-bold text-foreground">Thêm Page vào hệ thống</h2>
            <p className="text-sm text-muted-foreground">Để thêm Fanpage, vui lòng đăng nhập bằng tài khoản Facebook đang quản lý các Page cần thêm.</p>
            <div className="w-full flex justify-center py-4">
              <div className="w-48 h-28 rounded-xl border border-border bg-background flex flex-col items-center justify-center p-3 relative shadow-subtle">
                <div className="w-full flex items-center gap-1 mb-2">
                  <div className="w-2 h-2 rounded-full bg-red-400"></div>
                  <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                </div>
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg">f</div>
                <div className="w-20 h-2 bg-primary/20 rounded-full mt-2"></div>
              </div>
            </div>
            <div className="p-3 bg-primary-subtle border border-primary/20 rounded-lg flex items-start gap-2.5 text-left">
              <span className="text-primary text-base">ℹ</span>
              <div>
                <p className="text-xs font-semibold text-primary">Thông tin đăng nhập sẽ được lưu trên hệ thống</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">Thông tin đăng nhập của tài khoản Facebook sẽ được lưu để duy trì kết nối, quản lý các Page liên quan và phục vụ các chức năng tự động hóa. Thông tin được bảo mật theo chính sách an toàn.</p>
              </div>
            </div>
            <div className="w-full flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Hủy</Button>
              <Button variant="default" onClick={handleContinue}>Tiếp tục</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">👤</div>
                <div>
                  <h2 className="text-base font-heading font-bold text-foreground">Nhập tài khoản Facebook</h2>
                  <p className="text-xs text-muted-foreground">Nhập danh sách tài khoản theo định dạng phân tách để tự động giải mã và lưu trữ an toàn</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Dữ liệu tài khoản</span>
                  <span className="text-muted-foreground bg-muted px-2 py-0.5 rounded">2 / 100 dòng</span>
                </div>
                <Textarea rows={7} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Dán tài khoản theo dạng UID|PASS|2FA|COOKIE|TOKEN..." className="font-mono text-[11px] leading-tight" />
                <div className="flex items-center justify-between pt-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Phân cách:</span>
                    <span className="font-mono px-2 py-0.5 bg-muted rounded border border-border">| (dấu gạch đứng)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setRawText("")}>Xóa trắng</Button>
                    <Button variant="subtle" size="sm">Xem trước</Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2 bg-muted/40 p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Field Mapping</span>
                  <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[11px] font-medium">Tự động nhận dạng 11/11 cột</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    { col: "Cột 1", name: "UID (Facebook ID) *" },
                    { col: "Cột 2", name: "Mật khẩu (Pass) *" },
                    { col: "Cột 3", name: "Mã bảo mật (2FA Key)" },
                    { col: "Cột 4", name: "Cookie chuỗi" },
                    { col: "Cột 5", name: "Access Token (EAAB...)" },
                    { col: "Cột 6", name: "Email đăng nhập" },
                    { col: "Cột 7", name: "Mật khẩu Email (Pass Mail)" },
                  ].map((f, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5 border-b border-border/50">
                      <span className="text-muted-foreground">{f.col}</span>
                      <span className="font-medium text-foreground">{f.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-3 bg-background">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-foreground">Xem trước cấu trúc (2 dòng đầu tiên)</span>
                <span className="text-emerald-600 font-medium">● Đã khớp hợp lệ 11/11 trường</span>
              </div>
              <div className="overflow-x-auto text-[11px] font-mono">
                <table className="w-full text-left">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="p-1">#</th>
                      <th className="p-1">UID</th>
                      <th className="p-1">MẬT KHẨU</th>
                      <th className="p-1">2FA KEY</th>
                      <th className="p-1">COOKIE</th>
                      <th className="p-1">TOKEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      <td className="p-1">1</td>
                      <td className="p-1 font-semibold">100084920491823</td>
                      <td className="p-1 text-muted-foreground">••••••••••</td>
                      <td className="p-1 text-primary">JBSMY3DPEH...</td>
                      <td className="p-1 text-muted-foreground truncate max-w-[120px]">c_user=100084...</td>
                      <td className="p-1 text-muted-foreground">EAAAAUa...</td>
                    </tr>
                    <tr className="border-t border-border">
                      <td className="p-1">2</td>
                      <td className="p-1 font-semibold">100072049182041</td>
                      <td className="p-1 text-muted-foreground">••••••••••</td>
                      <td className="p-1 text-primary">KZXW65TFOJ...</td>
                      <td className="p-1 text-muted-foreground truncate max-w-[120px]">c_user=100072...</td>
                      <td className="p-1 text-muted-foreground">EAAAAUa...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={skipDuplicates} onCheckedChange={setSkipDuplicates} />
                  <span>Bỏ qua UID trùng lặp</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={checkLive} onCheckedChange={setCheckLive} />
                  <span>Kiểm tra Live/Die ngay</span>
                </label>
                <span className="text-emerald-600 font-medium">🛡 Mã hóa AES-256</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleClose}>Hủy</Button>
                <Button variant="default" disabled={loading} onClick={handleImport}>{loading ? "Đang import..." : "Import ngay"}</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
