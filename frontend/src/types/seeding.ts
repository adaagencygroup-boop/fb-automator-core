// Kiểu dữ liệu trả về từ các API /api/seeding/* (khớp với be/seeding_routes.py của Module 8)

export type SeedingTargetType = "PAGE" | "PROFILE" | "POST";

// Một dòng trong bảng mục tiêu (Seeding Page / Trang cá nhân / Bài viết)
export interface SeedingTargetItem {
  id: number;
  stt: number;
  url: string;
  fb_id: string;
  display_name: string | null;
  target_type?: SeedingTargetType;
  created_at?: string | null;
}

// Mục tiêu trong phần chi tiết của một chiến dịch
export interface SeedingCampaignTargetDetail {
  target_id: number;
  url: string;
  fb_id: string;
  display_name: string;
  target_type: SeedingTargetType;
  planned_count: number;
  success_count: number;
  failed_count: number;
  note: string | null;
  source: string;
}

// Một tác vụ (1 tài khoản x 1 hành động x 1 mục tiêu) trong phần chi tiết
export interface SeedingTaskDetail {
  id: number;
  account_uid: string;
  account_name: string | null;
  action: string;
  action_display: string;
  status: string;
  status_display: string;
  error_message: string | null;
  target_url: string | null;
  target_name: string | null;
}

export interface SeedingInteractionBreakdownItem {
  title: string;
  subtitle: string;
  enabled: boolean;
  planned: number;
  success: number;
  failed: number;
  reactions?: string[];
  comments_count?: number;
  comments?: string[];
}

export interface SeedingInteractionsBreakdown {
  react?: SeedingInteractionBreakdownItem;
  comment?: SeedingInteractionBreakdownItem;
  share?: SeedingInteractionBreakdownItem;
}

// Một dòng ở trang Lịch sử. Các trường tuỳ chọn chỉ có khi gọi /campaigns/{id}/detail
export interface SeedingCampaign {
  id: number;
  created_at: string | null;
  created_at_display: string;
  name: string;
  campaign_type: SeedingTargetType;
  campaign_type_display: string;
  target_summary: string;
  actions: string[];
  reactions: string[];
  account_count: number;
  total_planned: number;
  total_success: number;
  total_failed: number;
  status: string;
  status_display: string;
  is_batch_active?: boolean;
  primary_target_url?: string | null;
  primary_target_name?: string | null;
  targets?: SeedingCampaignTargetDetail[];
  tasks?: SeedingTaskDetail[];
  comments?: string[];
  interactions_breakdown?: SeedingInteractionsBreakdown;
}

// Bốn thẻ thống kê ở trang Lịch sử
export interface SeedingStats {
  total_campaigns: number;
  total_interactions: number;
  total_success: number;
  total_failed: number;
}
