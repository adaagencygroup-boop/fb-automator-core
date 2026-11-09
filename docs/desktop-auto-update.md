# Desktop auto-update (Tauri + GitHub Actions)

Luồng: **tag `v*` → Actions build → GitHub Release + `latest.json` → app check khi mở**.

## 1. Secrets trên GitHub (bắt buộc)

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Nội dung |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Toàn bộ nội dung file `src-tauri/keys/fb-automator.key` (private key) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password lúc generate key (máy lead đã generate) |

Public key đã nằm trong [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) (`plugins.updater.pubkey`).

Private key **không** commit (đã `.gitignore` `src-tauri/keys/`). Lead giữ bản backup offline.

Nếu mất private key / password → phải generate key mới, đổi pubkey trong `tauri.conf.json`, và gửi bản cài mới thủ công cho user (bản cũ không verify được chữ ký mới).

### Generate lại key (khi cần)

```bash
npx @tauri-apps/cli signer generate -w src-tauri/keys/fb-automator.key -f --ci -p "YOUR_PASSWORD"
```

Copy dòng public key in ra → dán vào `plugins.updater.pubkey`.

## 2. Bump version trước khi phát hành

Đổi cùng một số version (SemVer) ở:

- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `package.json` → `version` (root)

Ví dụ `2.0.0` → `2.0.1`.

## 3. Phát hành (lệnh trên Git)

```bash
git add -A
git commit -m "release: v2.0.1"
git push origin main
git tag v2.0.1
git push origin v2.0.1
```

Actions `Build Desktop Installer` chạy → job `publish-release` tạo Release + upload installer + `latest.json`.

Hoặc: GitHub → Actions → **Build Desktop Installer** → Run workflow (chỉ artifact, **không** tạo Release trừ khi push tag).

## 4. Phía app

- Plugin: `tauri-plugin-updater` + `tauri-plugin-process`
- UI: [`frontend/src/components/DesktopUpdater.jsx`](../frontend/src/components/DesktopUpdater.jsx) — banner góc phải khi có bản mới
- Endpoint: `https://github.com/adaagencygroup-boop/fb-automator-core/releases/latest/download/latest.json`

**Lưu ý quan trọng — repo Private:** URL Release mặc định **không** tải được nếu user chưa login GitHub. Để updater chạy được cho khách:

1. Làm Release assets public (repo public / mirror public), **hoặc**
2. Host `latest.json` + file `.exe` trên CDN/S3 public, đổi `endpoints` trong `tauri.conf.json`.

Bản cài **đầu tiên** có updater phải gửi tay cho user. Từ bản đó trở đi, các tag sau mới tự báo cập nhật.

## 5. Kiểm tra nhanh

1. Gắn secrets → push tag thử `v2.0.1`
2. Vào Releases xem có `.exe`, `.sig`, `latest.json`
3. Máy có bản `2.0.0` (đã build với updater) mở app → banner “Có phiên bản mới”
