import os
import requests
import asyncio
from typing import Dict, Any
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.repositories import PageRepository
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError, FacebookAuthService

FACEBOOK_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0")

# Enum NAY LAY TU CHINH LOI CUA GRAPH, khong phai tu tai lieu — tai lieu cua canh
# /reactions ghi la SORRY va khong he co CARE, ca hai deu sai. Gui SORRY thi Graph
# tra:
#   (#100) For field 'reactions': Param type must be one of
#   {NONE, LIKE, LOVE, WOW, HAHA, SAD, ANGRY, THANKFUL, PRIDE, CARE, FIRE, HUNDRED}
# Ca 7 loai di chung mot lenh goi nen chi can mot loai sai la mat sach phan chia
# nho. Dung sua danh sach nay theo tai lieu; sua theo loi Graph tra ve.
REACTION_TYPES = ("LIKE", "LOVE", "CARE", "HAHA", "WOW", "SAD", "ANGRY")

# Hai gia tri cua tham so `order` tren canh page-post/comments.
# BAT BUOC loc qua allowlist: gia tri di THANG vao chuoi `fields` gui len Graph,
# noi thang thu nhan tu client la mo duong cho nguoi ta chen them truong khac.
COMMENT_ORDERS = ("chronological", "reverse_chronological")

# So binh luan / cau tra loi lay moi lan. Truoc day lay thang 100 roi do het ra
# mot danh sach phang; gio phan cap va phan trang nen lay it, con lai de "Xem them".
COMMENTS_PAGE_SIZE = 25
REPLIES_PAGE_SIZE = 3
MAX_PAGE_SIZE = 100

# `from` tran khong kem anh dai dien — phai xin ro `picture`, va xin kem kich
# thuoc de khoi nhan ve anh 50px roi hien mo tren man hinh retina.
# Luu y: Page phai duoc them vao Meta App thi Graph moi tra `from`; chua them
# thi ca ten lan anh deu bi bo im lang, khong bao loi gi.
COMMENT_FIELDS = (
    # user_likes = Page NAY da thich chua, can_like = co thich duoc khong.
    # Thieu user_likes thi FE phai doan, tai lai trang la mat trang thai.
    # permalink_url -> mo dung binh luan tren Facebook. Khong lay duoc trang ca
    # nhan nguoi binh luan (truong `link` cua User bi gat im lang, va `from.id`
    # la app-scoped ID khong phai dia chi cong khai), nen day la duong vong:
    # mo binh luan roi bam vao ten, de Facebook tu phan giai danh tinh.
    "id,message,created_time,like_count,is_hidden,user_likes,can_like,permalink_url,"
    "from{id,name,picture.width(100).height(100){url}},"
    "reactions.summary(total_count),"
    "attachment{media,target,type,url,subattachments},parent{id}"
)

class FacebookPostService:
    def __init__(self, db: Session):
        self.db = db
        self.page_repo = PageRepository(db)
        self.auth_service = FacebookAuthService(db)

    def is_internal_page_post(self, post_id: str, page_id: str) -> bool:
        if not post_id or not page_id:
            return False
        if "_" in str(post_id):
            target_id = str(post_id).split("_")[0]
            return target_id == str(page_id)
        return True

    async def _fetch_reaction_breakdown(self, post_id: str, access_token: str) -> Dict[str, int]:
        """Dem cam xuc theo tung loai.

        Goi TACH RIENG khoi lenh lay chi tiet bai viet, co chu y: cu phap
        `.as(alias)` khong nam trong tai lieu chinh thuc cua Meta. Neu Graph tu
        choi thi ca lenh goi do se loi — tach ra thi chi mat phan chia nho,
        bai viet va binh luan van hien binh thuong.

        Tra ve {} khi khong lay duoc, hoac bo qua loai co 0 luot.
        """
        fields = ",".join(
            f"reactions.type({t}).summary(total_count).limit(0).as({t.lower()})"
            for t in REACTION_TYPES
        )
        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}"
        params = {"fields": fields, "access_token": access_token}

        try:
            response = await asyncio.to_thread(requests.get, url, params=params, timeout=15)
            data = response.json()
        except Exception as e:
            print(f"[FacebookPostService] Reaction breakdown skipped (network): {e}")
            return {}

        if not isinstance(data, dict) or "error" in data:
            err = (data or {}).get("error", {}) if isinstance(data, dict) else {}
            print(f"[FacebookPostService] Reaction breakdown skipped: {err.get('message', 'unknown')}")
            return {}

        breakdown: Dict[str, int] = {}
        for t in REACTION_TYPES:
            key = t.lower()
            node = data.get(key)
            if not isinstance(node, dict):
                continue
            summary = node.get("summary")
            count = summary.get("total_count") if isinstance(summary, dict) else None
            if isinstance(count, int) and count > 0:
                breakdown[key] = count
        return breakdown

    async def _fetch_comment_total(self, post_id: str, access_token: str):
        """Tong so binh luan KE CA cau tra loi.

        Canh /comments dem theo `filter`: toplevel chi dem binh luan goc. Danh
        sach chinh gio lay toplevel de phan cap, nen phai hoi rieng mot lan nua
        bang stream, khong thi con so "N binh luan" tut han xuong.

        Goi tach rieng (khong gop vao lenh chinh) vi gop thi phai dung `.as()`
        de tranh trung ten truong `comments` — hong alias la hong ca bai viet.

        Tra ve None khi khong lay duoc -> FE tu lui ve dem toplevel.
        """
        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}"
        params = {
            "fields": "comments.filter(stream).summary(total_count).limit(0)",
            "access_token": access_token,
        }
        try:
            response = await asyncio.to_thread(requests.get, url, params=params, timeout=15)
            data = response.json()
        except Exception as e:
            print(f"[FacebookPostService] Comment total skipped (network): {e}")
            return None

        if not isinstance(data, dict) or "error" in data:
            err = (data or {}).get("error", {}) if isinstance(data, dict) else {}
            print(f"[FacebookPostService] Comment total skipped: {err.get('message', 'unknown')}")
            return None

        summary = (data.get("comments") or {}).get("summary")
        count = summary.get("total_count") if isinstance(summary, dict) else None
        return count if isinstance(count, int) else None

    async def get_comments(
        self,
        object_id: str,
        page_id: str,
        order: str = None,
        after: str = None,
        limit: int = COMMENTS_PAGE_SIZE,
        nest_replies: int = 0,
        deep: bool = False,
    ) -> Dict[str, Any]:
        """Mot trang binh luan cua `object_id` (bai viet HOAC binh luan).

        Canh /{object_id}/comments giong het nhau cho ca hai, chi khac `filter`:
          - duoi bai viet  -> toplevel, va long san vai cau tra loi dau
          - duoi binh luan -> stream (deep=True), lay moi cap con gop phang

        Tra ve nguyen {data, paging} cua Graph de FE dung con tro `after`.
        """
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        fields = COMMENT_FIELDS
        if nest_replies > 0:
            inner = f"comments.filter(stream).summary(true).limit({int(nest_replies)})"
            fields = COMMENT_FIELDS + "," + inner + "{" + COMMENT_FIELDS + "}"

        try:
            size = int(limit)
        except (TypeError, ValueError):
            size = COMMENTS_PAGE_SIZE

        params = {
            "fields": fields,
            "filter": "stream" if deep else "toplevel",
            "limit": max(1, min(size, MAX_PAGE_SIZE)),
            "access_token": page.page_access_token,
        }
        order = str(order or "").strip().lower()
        if order in COMMENT_ORDERS:
            params["order"] = order
        if after:
            params["after"] = str(after)

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{object_id}/comments"
        try:
            response = await asyncio.to_thread(requests.get, url, params=params, timeout=15)
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error fetching comments: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        return response_json

    async def get_post_reactions(
        self,
        post_id: str,
        page_id: str,
        reaction_type: str = None,
        after: str = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """Danh sach NGUOI da tha cam xuc len bai viet.

        Canh nay co tra ve that, nhung CHI nhung nguoi ma app duoc phep nhin
        thay — thuong la nguoi co vai tro tren Meta App hoac da cap quyen cho
        app. Do tren du lieu that: bai 2 luot tra du 2 nguoi, nhung bai 502 luot
        tra ve mang rong, khong bao loi gi.

        Vi vay noi goi PHAI chiu duoc `data` rong trong khi `summary` van co so:
        FE lui ve hien so luong theo tung loai nhu cu.

        `summary` truyen nhu THAM SO rieng, khong nhet vao `fields` — canh nay
        khong nhan cu phap .summary() long trong fields.
        """
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        try:
            size = int(limit)
        except (TypeError, ValueError):
            size = 100

        params = {
            "fields": "id,name,type,profile_type,picture{url,is_silhouette}",
            "summary": "total_count",
            "limit": max(1, min(size, 100)),
            "access_token": page.page_access_token,
        }
        # Loc theo loai cam xuc — allowlist vi gia tri di thang vao query
        rt = str(reaction_type or "").strip().upper()
        if rt in REACTION_TYPES:
            params["type"] = rt
        if after:
            params["after"] = str(after)

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}/reactions"
        try:
            response = await asyncio.to_thread(requests.get, url, params=params, timeout=15)
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error fetching reactions: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        return response_json

    async def get_post_details(self, post_id: str, page_id: str, order: str = None) -> Dict[str, Any]:
        """Chi tiet bai viet + binh luan.

        `order` la thu tu binh luan: chronological (cu truoc) hoac
        reverse_chronological (moi truoc). Gia tri la -> bo qua, dung mac dinh
        cua Graph. Luu y day chi la nguyen vong: tai lieu ghi neu binh luan xep
        hang duoc thi thu tu ranked thang gia tri gui len.
        """
        if not self.is_internal_page_post(post_id, page_id):
            print(f"[FacebookPostService] Post {post_id} belongs to external group/page. Returning external post payload.")
            return {
                "id": post_id,
                "is_external": True,
                "message": "📌 Bài viết này được đăng trong Nhóm hoặc Trang khác.",
                "created_time": None,
                "full_picture": None,
                "source": None,
                "comments": {"data": [], "summary": {"total_count": 0}},
                "reactions": {"summary": {"total_count": 0}},
                "shares": {"count": 0}
            }

        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        order = str(order or "").strip().lower()

        # Cap ngoai: CHI binh luan goc (toplevel). Truoc day dung stream nen cau
        # tra loi bi tra ve lan vao danh sach goc, mat sach thu bac.
        outer = "comments.filter(toplevel)"
        if order in COMMENT_ORDERS:
            outer += f".order({order})"
        outer += f".summary(true).limit({COMMENTS_PAGE_SIZE})"

        # Cap trong: stream = moi cap con, gop phang duoi binh luan goc — dung
        # nhu cach Facebook hien mot mach cau tra loi, khong long them nua.
        inner = f"comments.filter(stream).summary(true).limit({REPLIES_PAGE_SIZE})"
        # `shares` la truong tieu chuan cua Post, doc duoc bang page token san co.
        # Them vao cung mot lenh goi nen khong ton them vong mang. Luu y Graph CHI
        # tra ve khi > 0 -> FE phai chiu duoc truong thieu.
        # Noi chuoi tuong minh thay vi long ngoac trong f-string: chuoi fields
        # cua Graph cung dung {} nen f-string long nhau rat de dem sai.
        comments_field = (
            outer + "{" + COMMENT_FIELDS + "," + inner + "{" + COMMENT_FIELDS + "}}"
        )
        # likes.summary  -> Page NAY da thich bai chua (has_liked), co thich duoc khong
        # viewer_reaction -> Page da tha LOAI cam xuc nao; day la thu duy nhat canh
        #                    /reactions chiu tra ve, vi no la cam xuc cua chinh minh
        fields = (
            "id,message,created_time,shares,"
            "reactions.summary(total_count,viewer_reaction),"
            "likes.summary(total_count,can_like,has_liked).limit(0),"
            "attachments{media,url,type},"
            + comments_field
        )
        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}"
        params = {
            "fields": fields,
            "access_token": page.page_access_token
        }

        try:
            # Chay song song de khong cong them mot vong doi mang.
            # _fetch_reaction_breakdown tu bat moi loi nen gather chi co the
            # vang loi tu lenh lay chi tiet bai viet.
            response, breakdown, comment_total = await asyncio.gather(
                asyncio.to_thread(requests.get, url, params=params, timeout=15),
                self._fetch_reaction_breakdown(post_id, page.page_access_token),
                self._fetch_comment_total(post_id, page.page_access_token),
            )
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error fetching post details: {str(e)}")

        if "error" in response_json:
            err_detail = response_json.get("error", {})
            err_code = err_detail.get("code")
            if err_code in (10, 200, 100):
                return {
                    "id": post_id,
                    "is_external": True,
                    "message": f"📌 {err_detail.get('message', 'Bài viết không thuộc quyền quản lý của Fanpage.')}",
                    "comments": {"data": [], "summary": {"total_count": 0}},
                    "reactions": {"summary": {"total_count": 0}}
                }

        self.auth_service.handle_api_errors(response_json)

        if "attachments" in response_json and isinstance(response_json["attachments"], dict):
            attachments = response_json["attachments"].get("data", [])
            if attachments and isinstance(attachments, list) and len(attachments) > 0:
                att = attachments[0]
                if isinstance(att, dict):
                    att_type = att.get("type", "")
                    media = att.get("media") or {}
                    if not isinstance(media, dict):
                        media = {}

                    if "video" in str(att_type):
                        response_json["source"] = media.get("source", "") or att.get("url", "")
                    else:
                        img_dict = media.get("image") or {}
                        if not isinstance(img_dict, dict):
                            img_dict = {}
                        img_src = img_dict.get("src", "")
                        response_json["full_picture"] = img_src or att.get("url", "")

        # Rong = Graph khong tra duoc; FE tu lui ve hien tong so nhu cu
        if breakdown:
            response_json["reaction_breakdown"] = breakdown

        # Danh sach chinh dem theo toplevel; day moi la con so ke ca tra loi
        if comment_total is not None:
            response_json["comment_total"] = comment_total

        return response_json

    async def set_post_like(self, post_id: str, page_id: str, liked: bool = True) -> Dict[str, Any]:
        """Thich / bo thich bai viet duoi ten Page.

        Canh /{post_id}/likes: POST de thich, DELETE de bo thich. Tai lieu ghi ca
        hai "khong duoc ho tro", nhung do thuc te cho thay bai viet tra ve
        `can_like: true` — va binh luan thi da chung minh POST chay that.
        """
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}/likes"
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post if liked else requests.delete, url, params=params, timeout=15
            )
            response_json = response.json()
            print(f"[Post Like] liked={liked} -> {response_json}", flush=True)
        except Exception as e:
            raise FacebookAPIError(f"Network error liking post: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        return response_json

    async def create_post_comment(self, post_id: str, page_id: str, message: str, attachment_url: str = None) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}/comments"
        payload = {}
        if message:
            payload["message"] = message
        if attachment_url:
            payload["attachment_url"] = attachment_url

        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=15
            )
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error creating comment on post: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        return response_json
