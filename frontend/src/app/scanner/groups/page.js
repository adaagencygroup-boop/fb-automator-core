import { redirect } from "next/navigation";

/** Alias cũ "Danh sách nhóm page" → Danh sách page */
export default function Page() {
  redirect("/scanner/list");
}
