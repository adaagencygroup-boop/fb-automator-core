import OmnichannelChatModule from "@/modules/module_06_omnichannel_chat";
import { pageMetadata } from "@/config/navigation";

// Trang: Quản lý Chat Page (/chat)
export const metadata = pageMetadata("chat");

export default function Page() {
  return <OmnichannelChatModule subPage="chat" />;
}

