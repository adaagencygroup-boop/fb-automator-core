# HƯỚNG DẪN SỬ DỤNG HỆ THỐNG GIAO DIỆN SHADCN UI & DESIGN SYSTEM

> **Tài liệu chuẩn hóa giao diện**: Hướng dẫn sử dụng hệ thống Design Tokens (Facebook Light Theme), cấu trúc Layout và toàn bộ bộ Component **shadcn/ui** trong dự án `fb-automator-core`.  
> Lập trình viên chỉ cần tham khảo tài liệu này để xây dựng các màn hình, module và giao diện mới đồng bộ 100% theo chuẩn thiết kế Figma.

---

## 1. TỔNG QUAN HỆ THỐNG DESIGN TOKENS (FACEBOOK LIGHT THEME)

Giao diện được xây dựng theo phong cách **Facebook Brand Light Modern UI**:
* **Heading Font**: `Plus Jakarta Sans` (`font-heading`) – dành cho Header, Card Title, Metric Stats, Tab Navigation.
* **Body Font**: `Inter` (`font-sans`) – dành cho dữ liệu bảng (Table), ô nhập liệu (Input), nhãn và văn bản.
* **Màu chủ đạo (Primary)**: `#1877F2` (Xanh thương hiệu Facebook).

### Bảng tra cứu Màu sắc (Tailwind Utility Classes)
| Nhóm màu | Class Tailwind | Mã HEX | Vai trò & Mục đích sử dụng |
| :--- | :--- | :--- | :--- |
| **Nền Canvas** | `bg-background` | `#F0F4F9` | Nền toàn bộ khung làm việc của ứng dụng |
| **Bề mặt Card** | `bg-card text-card-foreground` | `#FFFFFF` | Bề mặt các thẻ chức năng, modal, khung bảng dữ liệu |
| **Viền Card/Bảng** | `border-border` | `#E2E8F0` | Đường kẻ ngang bảng, viền ô input, viền thẻ card |
| **Chữ Chính** | `text-foreground` | `#0F172A` | Tiêu đề, văn bản chính, dữ liệu quan trọng (Slate 900) |
| **Chữ Phụ** | `text-muted-foreground` | `#64748B` | Mô tả phụ, ngày giờ, placeholder, nhãn phụ (Slate 500) |
| **Nút Chính (Primary)** | `bg-primary hover:bg-primary-hover` | `#1877F2` | Nút hành động chính (`+ Đăng bài`, `Bắt đầu`, `Lưu`) |
| **Highlight Nhẹ** | `bg-primary-subtle text-primary` | `#E7F3FF` | Nền hàng được chọn trong bảng, tab active, tag nổi bật |
| **Thành công (Live)** | `bg-success text-white` / `variant="success"` | `#10B981` | Trạng thái Fanpage hoạt động, đăng bài thành công |
| **Chờ / Cảnh báo** | `bg-warning text-white` / `variant="warning"` | `#F59E0B` | Đang lên lịch, chờ duyệt, tiến trình đang chạy |
| **Lỗi / Checkpoint**| `bg-destructive text-white` / `variant="destructive"` | `#EF4444` | Tài khoản checkpoint, lỗi token, thất bại |
| **Tiến trình / AI** | `bg-info text-white` / `variant="info"` | `#2563EB` | AI đang tạo nội dung, tiến trình tải video |

---

## 2. DANH SÁCH & HƯỚNG DẪN BỘ SHADCN UI COMPONENTS

Tất cả các component nằm tại `@/components/ui/` và sẵn sàng import:

### A. Nút bấm (`Button`)
```jsx
import { Button } from "@/components/ui/button";

// 1. Nút hành động chính (Facebook Blue)
<Button variant="default">Lưu Cấu Hình</Button>

// 2. Nút phụ / Thứ cấp (Nền xám nhạt)
<Button variant="secondary">Hủy Bỏ</Button>

// 3. Nút viền trắng (Outline)
<Button variant="outline">🔄 Làm Mới</Button>

// 4. Nút Subtle (Nền xanh nhạt, chữ xanh đậm)
<Button variant="subtle">+ Thêm Fanpage</Button>

// 5. Nút Thành công (Xanh lá)
<Button variant="success">Kích Hoạt</Button>

// 6. Nút Nguy hiểm (Đỏ)
<Button variant="destructive">Xóa Dữ Liệu</Button>

// Các kích thước: size="sm" (nhỏ) | size="default" (vừa) | size="lg" (lớn) | size="icon" (icon vuông)
<Button size="sm">Nút Nhỏ</Button>
<Button size="icon">⚙️</Button>
```

---

### B. Huy hiệu trạng thái nghiệp vụ (`Badge`)
```jsx
import { Badge } from "@/components/ui/badge";

<Badge variant="success">● Đang hoạt động</Badge>
<Badge variant="warning">● Chờ lên lịch</Badge>
<Badge variant="destructive">● Checkpoint</Badge>
<Badge variant="info">● Đang cào media</Badge>
<Badge variant="outline">Mặc định</Badge>
```

---

### C. Khung chứa Thẻ (`Card`)
```jsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

<Card>
  <CardHeader>
    <CardTitle>Cấu Hình Đăng Bài Tự Động</CardTitle>
    <CardDescription>Thiết lập thời gian và nội dung bài viết tự động</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Các ô nhập liệu hoặc bảng */}
  </CardContent>
  <CardFooter className="justify-end gap-2">
    <Button variant="outline">Đặt Lại</Button>
    <Button>Lưu Thay Đổi</Button>
  </CardFooter>
</Card>
```

---

### D. Bảng Dữ liệu (`Table`)
Hỗ trợ đầy đủ Header cố định, hover hàng, và hàng được chọn (selected):
```jsx
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Tên Fanpage</TableHead>
      <TableHead>Page ID</TableHead>
      <TableHead>Tự Động Đăng</TableHead>
      <TableHead>Trạng Thái</TableHead>
      <TableHead className="text-right">Hành Động</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {pages.map((p) => (
      <TableRow key={p.id} data-state={p.selected ? "selected" : undefined}>
        <TableCell className="font-semibold text-foreground">{p.name}</TableCell>
        <TableCell className="font-mono text-muted-foreground">{p.page_id}</TableCell>
        <TableCell>
          <span className={p.autoPost ? "text-primary font-semibold" : "text-muted-foreground"}>
            {p.autoPost ? "● Đang bật" : "○ Tắt"}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant={p.status === "ACTIVE" ? "success" : "destructive"}>
            {p.status}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <Button size="sm" variant="subtle">Chi Tiết</Button>
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

---

### E. Chuyển đổi Phân hệ Con (`Tabs`)
```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

<Tabs defaultValue="posts">
  <TabsList>
    <TabsTrigger value="posts">Đăng Bài AI</TabsTrigger>
    <TabsTrigger value="reels">Đăng Reels</TabsTrigger>
    <TabsTrigger value="media">Tải Media Hàng Loạt</TabsTrigger>
  </TabsList>

  <TabsContent value="posts">
    {/* Giao diện Đăng bài */}
  </TabsContent>
  <TabsContent value="reels">
    {/* Giao diện Đăng reels */}
  </TabsContent>
  <TabsContent value="media">
    {/* Giao diện Tải media */}
  </TabsContent>
</Tabs>
```

---

### F. Hộp thoại Popup / Modal (`Dialog`)
```jsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AddPageModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Thêm Mới</Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm Fanpage Mới</DialogTitle>
            <DialogDescription>Nhập thông tin token để đồng bộ vào hệ thống.</DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <label className="text-xs font-semibold text-foreground">User Token:</label>
            <Input placeholder="Dán Access Token..." className="font-mono text-xs" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
            <Button onClick={() => setOpen(false)}>Xác Nhận</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

---

### G. Các Component Nhập liệu & Trực quan khác
* **`Input`**: 
  ```jsx
  import { Input } from "@/components/ui/input";
  <Input placeholder="Tìm kiếm theo tên hoặc ID..." />
  ```
* **`Textarea`**:
  ```jsx
  import { Textarea } from "@/components/ui/textarea";
  <Textarea rows={4} placeholder="Nhập danh sách UID|PASS..." />
  ```
* **`Switch` (Công tắc bật/tắt)**:
  ```jsx
  import { Switch } from "@/components/ui/switch";
  <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
  ```
* **`Checkbox` (Chọn nhiều dòng)**:
  ```jsx
  import { Checkbox } from "@/components/ui/checkbox";
  <Checkbox checked={isSelected} onCheckedChange={setIsSelected} />
  ```
* **`Avatar` (Ảnh đại diện Fanpage / User)**:
  ```jsx
  import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
  <Avatar>
    <AvatarImage src="/page-logo.png" />
    <AvatarFallback>FP</AvatarFallback>
  </Avatar>
  ```
* **`Progress` (Thanh tiến trình phần trăm)**:
  ```jsx
  import { Progress } from "@/components/ui/progress";
  <Progress value={75} />
  ```

---

### H. Hệ thống Icons & Logo (Quy Định Bắt Buộc Dùng SVG Gốc Từ Figma)

> ⚠️ **QUY ĐỊNH BẮT BUỘC DÀNH CHO DEVELOPER**:  
> **Toàn bộ Logo thương hiệu và Icon chức năng (nút bấm, bảng, trạng thái, modal, input, sidebar...) BẮT BUỘC PHẢI LẤY ĐÚNG SVG GỐC TỪ BẢN VẼ FIGMA** tải về thư mục `frontend/public/icons/`.  
> **TUYỆT ĐỐI KHÔNG TỰ Ý LẤY ICON TỪ THƯ VIỆN NGOÀI (LUCIDE, HEROICONS,...)** để đảm bảo 100% đúng tỷ lệ nét vẽ (stroke), bo góc và phong cách nhận diện chuẩn của bản thiết kế.

#### 1. Vị trí lưu trữ tài nguyên Icon
* Toàn bộ file SVG tải về phải được đặt tập trung tại:  
  👉 `frontend/public/icons/`
* Các icon thường dùng hoặc cần tương tác class màu có thể bọc thành Component tại:  
  👉 `frontend/src/components/icons/`

#### 2. Quy trình lấy Icon gốc từ Figma về dự án
1. **Cách 1 - Xuất trực tiếp từ Figma (Nhanh nhất - 1 Click)**:
   - Mở file thiết kế Figma: [Figma FB Design](https://www.figma.com/design/wJSwDkSGVASfuRQ482NwMP/FB).
   - Chọn các icon cần lấy trên canvas.
   - Bấm phím tắt **`Ctrl + Shift + E`** (hoặc menu góc trái: *File > Export...*).
   - Chọn định dạng **SVG**, bấm **"Export All"** để tải file `.zip`.
   - Giải nén toàn bộ các file `.svg` vào thư mục `frontend/public/icons/`.
2. **Cách 2 - Tự động tải qua Script Batch Exporter**:
   - Sử dụng script batch có sẵn của dự án:
     ```bash
     node scripts/fetch_figma_icons.mjs
     # Hoặc truyền token cá nhân:
     FIGMA_TOKEN=figd_xxx node scripts/fetch_figma_icons.mjs
     ```

#### 3. Quy ước đặt tên file SVG trong `public/icons/`
Đặt tên viết thường hoàn toàn theo dạng `snake_case`, phản ánh đúng chức năng:
* **Logo & Brand**: `app_brand_logo.svg`, `app_brand_logo_login.svg`, `zalo_logo.svg`, `zalo_chat_icon.svg`, `orbiting_ring.svg`...
* **Icon chức năng**: `icon_shield_check.svg`, `icon_arrow_right.svg`, `icon_alert_triangle.svg`, `icon_lock.svg`, `icon_eye.svg`, `icon_eye_slash.svg`, `icon_key.svg`, `icon_cpu.svg`, `icon_user.svg`, `icon_chevron_left.svg`, `icon_chevron_right.svg`, `icon_circle_check.svg`, `icon_x_circle.svg`, `icon_info.svg`...

#### 4. Cách sử dụng Icon chuẩn trong mã nguồn

**Cách A: Dùng trực tiếp qua thẻ `<img>` từ `public/icons/`**:
```jsx
// Sử dụng trong Button, Table hoặc Input
<img 
  src="/icons/icon_shield_check.svg" 
  alt="Bảo mật" 
  className="w-4 h-4 inline-block" 
/>
```

**Cách B: Sử dụng qua bộ Component tập trung (`@/components/icons`)**:
```jsx
import { 
  FacebookIcon, 
  TikTokIcon, 
  YouTubeIcon, 
  ZaloIcon, 
  ReelsIcon, 
  SparkleAIIcon 
} from "@/components/icons";

<FacebookIcon className="w-5 h-5 text-primary" />
<TikTokIcon className="w-5 h-5 text-foreground" />
<YouTubeIcon className="w-5 h-5 text-red-600" />
<ReelsIcon className="w-5 h-5 text-primary" />
<SparkleAIIcon className="w-5 h-5 text-amber-500" />
```

---

## 3. CHECKLIST DÀNH CHO LẬP TRÌNH VIÊN GIAO DIỆN

Khi xây dựng màn hình hoặc module mới, lập trình viên cần tự kiểm tra:
1. [ ] **Icon & Logo**: ĐÃ LẤY ĐÚNG SVG GỐC TỪ FIGMA vào thư mục `public/icons/`, KHÔNG tự ý lấy icon từ thư viện Lucide.
2. [ ] **Cấu trúc thư mục**: Đặt file giao diện trong đúng thư mục `src/modules/module_xx_.../`
3. [ ] **Container Thẻ**: Bọc giao diện trong các thẻ `<Card>` với nền trắng `bg-card` và viền xám `border-border`
4. [ ] **Typography**: Sử dụng font tiêu đề `font-heading font-bold` cho các tiêu đề chính, `font-sans` cho dữ liệu
5. [ ] **Huy hiệu trạng thái**: Dùng đúng các biến thể `<Badge>` theo trạng thái (`success`, `warning`, `destructive`, `info`)
6. [ ] **Nút bấm**: Dùng `<Button>` có variant phù hợp (`default` cho nút chính, `subtle` cho bảng, `outline` cho nút phụ)
7. [ ] **Đăng ký Module**: Đăng ký module vào `src/modules/index.js` để tự động hiển thị tab trên Sidebar

