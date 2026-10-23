export function facebook_picture_url(uid) {
  if (!uid) return "";
  return `https://graph.facebook.com/${encodeURIComponent(uid)}/picture?type=square&width=80&height=80`;
}
