import AccountManagerModule from "@/modules/module_02_account_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Quản lý tài khoản Facebook (/accounts)
export const metadata = pageMetadata("accounts");

export default function Page() {
  return <AccountManagerModule subPage="accounts" />;
}

