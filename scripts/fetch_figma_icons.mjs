/**
 * =============================================================================
 * FIGMA BATCH SVG ICON EXPORTER (Node 18+)
 * Tối ưu hóa tải SVG hàng loạt theo Batch từ Figma REST API
 * Tránh rate-limit 429 bằng cách gộp nhiều Node IDs vào 1 request /v1/images
 * =============================================================================
 *
 * Cách chạy:
 *   node scripts/fetch_figma_icons.mjs
 *   FIGMA_TOKEN=figd_xxx node scripts/fetch_figma_icons.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../frontend/public/icons");

const TOKEN =
  process.env.FIGMA_TOKEN ||
  process.env.FIGMA_ACCESS_TOKEN ||
  process.env.FIGMA_API_KEY ||
  "figd_kmIBcUIg84SxbZWp_O6ZPSF-ee8bHlRLTVcLPhRR";

const FILE_KEY =
  process.env.FIGMA_FILE_KEY || "wJSwDkSGVASfuRQ482NwMP";

const BATCH_SIZE = 50; // Gộp 50-60 nodes/request để giảm số lượng API calls

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Danh mục các Node Icon & Logo đã được định danh trên bản vẽ Figma wJSwDkSGVASfuRQ482NwMP
 */
const KNOWN_NODES = {
  // Brand & App Logos
  "402:674": "app_brand_logo",
  "404:824": "app_brand_logo_login",
  "565:10607": "zalo_logo",
  "565:10609": "zalo_chat_icon",
  "565:10859": "orbiting_ring",

  // Core System Icons
  "395:249": "user_input_icon",
  "395:256": "lock_icon",
  "395:260": "eye_icon",
  "565:10867": "icon_shield_check",
  "565:10877": "icon_arrow_right",
  "408:1649": "icon_alert_triangle",
  "415:7349": "symbol_key",
  "415:7406": "icon_cpu_chip",
  "565:10858": "icon_lock_large",
  "402:708": "icon_chevron_left",
  "402:717": "icon_chevron_right",
  "402:746": "icon_circle_check",
  "402:758": "icon_eye_slash",
  "402:769": "icon_eye_visible",
  "402:803": "icon_x_circle",
  "402:807": "icon_info",
  "404:858": "icon_login_arrow",
  "404:867": "icon_user_profile",
  "395:257": "icon_vector_user",
  "395:261": "icon_vector_key",
  "395:262": "icon_vector_eye",
};

/**
 * Wrapper gọi Figma API có xử lý Header, Diagnostics và Backoff khi gặp 429
 */
async function fetchFigma(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Figma-Token": TOKEN,
      },
    });

    const planTier = res.headers.get("x-figma-plan-tier") || "unknown";
    const rateLimitType = res.headers.get("x-figma-rate-limit-type") || "unknown";
    const upgradeLink = res.headers.get("x-figma-upgrade-link");
    const retryAfter = res.headers.get("retry-after");

    if (res.status === 429) {
      const waitSec = Number(retryAfter) || 2 ** attempt * 5;
      console.warn(`\n⚠️ [Figma 429 Rate Limit] Plan: ${planTier} | Type: ${rateLimitType}`);
      if (upgradeLink) {
        console.warn(`👉 Tài khoản bị dính Paywall của gói Starter: ${upgradeLink}`);
      }
      if (waitSec > 300) {
        // Nếu Retry-After tính bằng giờ/ngày, không thể chờ
        console.error(`❌ Figma yêu cầu chờ ${waitSec} giây (~${(waitSec / 3600).toFixed(1)} giờ). Token hiện tại đã hết quota API tháng.`);
        return { error: true, status: 429, planTier, waitSec, upgradeLink };
      }

      console.warn(`⏳ Đang chờ ${waitSec}s trước khi thử lại (lần ${attempt}/${tries})...`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (!res.ok) {
      const errorText = await res.text();
      return { error: true, status: res.status, message: errorText, planTier };
    }

    const data = await res.json();
    return { error: false, status: res.status, data, planTier };
  }

  return { error: true, status: 429, message: "Exceeded max retries" };
}

/**
 * Tự động tìm kiếm icon COMPONENT từ tài liệu Figma (nếu token có quyền file_read)
 */
function collectComponents(node, acc = []) {
  if (node.type === "COMPONENT") {
    acc.push({ id: node.id, name: node.name });
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectComponents(child, acc);
    }
  }
  return acc;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log("==================================================================");
  console.log("🛠️  FIGMA BATCH SVG ICON EXPORTER");
  console.log(`📁 File Key: ${FILE_KEY}`);
  console.log(`🔑 Token:    ${TOKEN ? `${TOKEN.slice(0, 10)}...${TOKEN.slice(-4)}` : "None"}`);
  console.log(`📂 Output:   ${OUTPUT_DIR}`);
  console.log("==================================================================\n");

  let iconsToFetch = [];

  // Bước 1: Thử lấy danh sách COMPONENT từ API
  console.log("🔍 Đang kiểm tra cấu trúc File / Components từ Figma...");
  const fileCheck = await fetchFigma(
    `https://api.figma.com/v1/files/${FILE_KEY}?depth=2`
  );

  if (!fileCheck.error && fileCheck.data?.document) {
    const discovered = collectComponents(fileCheck.data.document);
    console.log(`✅ Tìm thấy ${discovered.length} component trong file.`);
    if (discovered.length > 0) {
      iconsToFetch = discovered.map((item) => ({
        id: item.id,
        name: item.name.replace(/[\\/:*?"<>|\s]+/g, "-").toLowerCase(),
      }));
    }
  } else {
    console.log(`ℹ️ Không thể lấy component động (${fileCheck.status || "429"}). Chuyển sang danh mục Node đã định danh (${Object.keys(KNOWN_NODES).length} icons).`);
    iconsToFetch = Object.entries(KNOWN_NODES).map(([id, name]) => ({
      id,
      name,
    }));
  }

  if (iconsToFetch.length === 0) {
    console.log("❌ Không có icon nào để tải.");
    return;
  }

  console.log(`\n🚀 Bắt đầu tải ${iconsToFetch.length} icons theo Batch (${BATCH_SIZE} nodes/request)...`);
  const nameById = new Map(iconsToFetch.map((i) => [i.id, i.name]));
  let downloadedCount = 0;

  for (let i = 0; i < iconsToFetch.length; i += BATCH_SIZE) {
    const chunk = iconsToFetch.slice(i, i + BATCH_SIZE);
    const ids = chunk.map((x) => x.id).join(",");

    console.log(`\n📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Gửi request cho ${chunk.length} nodes...`);
    const result = await fetchFigma(
      `https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=svg`
    );

    if (result.error) {
      console.error(`❌ Batch này thất bại với mã HTTP ${result.status}.`);
      if (result.status === 429) {
        console.error(`💡 Lý do: Token dính rate-limit của Figma (${result.planTier} plan).`);
        console.error(`👉 Bạn chỉ cần tạo một Personal Access Token mới trong Figma Settings > Account và chạy lại script.`);
        break;
      }
      continue;
    }

    const images = result.data?.images || {};
    const downloadPromises = Object.entries(images).map(async ([id, s3Url]) => {
      if (!s3Url) return;
      const baseName = nameById.get(id) || `icon_${id.replace(":", "_")}`;
      const fileName = `${baseName}.svg`;
      const filePath = path.join(OUTPUT_DIR, fileName);

      try {
        // Tải trực tiếp từ URL S3 (Figma S3 CDN không tính vào API rate limit)
        const svgRes = await fetch(s3Url);
        if (svgRes.ok) {
          const svgContent = await svgRes.text();
          await fs.writeFile(filePath, svgContent, "utf-8");
          console.log(`  ✅ Đã lưu: public/icons/${fileName}`);
          downloadedCount++;
        }
      } catch (err) {
        console.warn(`  ⚠️ Lỗi tải file từ S3 cho node ${id}: ${err.message}`);
      }
    });

    await Promise.all(downloadPromises);
    console.log(`🏁 Tiến độ: ${Math.min(i + BATCH_SIZE, iconsToFetch.length)}/${iconsToFetch.length}`);

    if (i + BATCH_SIZE < iconsToFetch.length) {
      await sleep(1500); // Nghỉ giữa các batch
    }
  }

  console.log(`\n🎉 Hoàn thành! Đã lưu thành công ${downloadedCount} icons vào ${OUTPUT_DIR}\n`);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
});
