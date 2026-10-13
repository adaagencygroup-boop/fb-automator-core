import DashboardModule from "@/modules/module_01_dashboard";
import { pageMetadata } from "@/config/navigation";

// Trang: Tổng quan (/)
export const metadata = pageMetadata("dashboard");

export default function Page() {
  return <DashboardModule subPage="dashboard" />;
}
