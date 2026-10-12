import UserProfileModule from "@/modules/module_09_user_profile";
import { pageMetadata } from "@/config/navigation";

// Trang: Hồ sơ cá nhân (/profile)
export const metadata = pageMetadata("profile");

export default function Page() {
  return <UserProfileModule subPage="profile" />;
}
