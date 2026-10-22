"""Owner-scoped persistence. Plaintext is encrypted exactly once on write."""
from datetime import datetime, timezone
from sqlalchemy import func
from .models import Account
try:
    from ..context import owner_context, normalize_owner
except (ImportError, ValueError):
    from contextvars import ContextVar
    owner_context = ContextVar("owner_context", default=None)
    def normalize_owner(v):
        return v.strip().lower() if v else None

try:
    from ..security.encryption import encrypt_data
except (ImportError, ValueError):
    def encrypt_data(v):
        return v

try:
    from ..utils.paths import validate_uid
except (ImportError, ValueError):
    import re
    def validate_uid(uid):
        if not uid or not re.match(r"^[0-9A-Za-z._-]+$", str(uid)):
            raise ValueError(f"UID không hợp lệ: {uid}")
        return str(uid).strip()

_UNSET = object()

def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

class AccountRepository:
    @staticmethod
    def query(db, owner_username=_UNSET, user_id=_UNSET):
        owner = user_id if user_id is not _UNSET else owner_username
        owner = owner_context.get() if owner is _UNSET else normalize_owner(owner)
        return db.query(Account).filter(Account.user_id == owner)

    @staticmethod
    def get_all(db, owner_username=_UNSET, **kwargs):
        return AccountRepository.query(db, owner_username, **kwargs).order_by(Account.id.desc()).all()

    @staticmethod
    def get_by_uid(db, uid, owner_username=_UNSET, **kwargs):
        return AccountRepository.query(db, owner_username, **kwargs).filter(Account.uid == validate_uid(uid)).first()

    @staticmethod
    def upsert(db, data, owner_username=_UNSET, user_id=_UNSET):
        from .category_repository import CategoryRepository
        # Resolve assignment against the same explicit/context owner as the account.
        from ..context import owner_scope
        assignment_owner = user_id if user_id is not _UNSET else owner_username
        assignment_owner = owner_context.get() if assignment_owner is _UNSET else normalize_owner(assignment_owner)
        with owner_scope(assignment_owner):
            CategoryRepository.validate_assignment(db, data)
        uid = validate_uid(data["uid"])
        query = AccountRepository.query(db, owner_username, user_id)
        account = query.filter(Account.uid == uid).first()
        owner = user_id if user_id is not _UNSET else owner_username
        owner = owner_context.get() if owner is _UNSET else normalize_owner(owner)
        if account is None:
            account = Account(uid=uid, user_id=owner)
            db.add(account)
        AccountRepository.apply_fields(account, data)
        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    def apply_fields(account, data):
        writable = {"password", "two_fa", "cookie", "token", "email", "pass_mail", "mail_recovery", "token_hotmail", "client_id", "proxy", "profile_path", "category_id"}
        for key in writable & data.keys():
            value = data[key]
            if key in {"password", "two_fa", "pass_mail"} and value:
                value = encrypt_data(value)
            setattr(account, key, value)
            if key in {"password", "two_fa", "pass_mail"}:
                account.credential_encryption_version = 2
        account.credential_encryption_version = 2

    @staticmethod
    def update_login_status(db, uid, status, profile_name=None, owner_username=_UNSET, *, avatar_url=None):
        account = AccountRepository.get_by_uid(db, uid, owner_username)
        if account:
            account.login_status = {"logged_in": "LOGGED_IN", "not_logged_in": "NOT_LOGGED", "failed": "ERROR"}.get(status, status)
            if account.login_status == "LOGGED_IN":
                if avatar_url:
                    account.avatar_url = avatar_url
                now = utc_now()
                account.last_login_at = now
                # COALESCE is evaluated by the database, not a stale ORM snapshot.
                AccountRepository.query(db, owner_username).filter(Account.id == account.id).update(
                    {Account.first_login_at: func.coalesce(Account.first_login_at, now)},
                    synchronize_session=False,
                )
                account.status = "LIVE"
                account.status_checked_at = now
            if profile_name:
                account.profile_name = profile_name
            db.commit()
            # Production sessions keep ORM objects after commit; reload the atomic timestamp.
            db.refresh(account)
        return account

    @staticmethod
    def update_identity(db, uid, profile_name=None, avatar_url=None):
        account = AccountRepository.get_by_uid(db, uid)
        if account:
            if profile_name:
                account.profile_name = profile_name
            if avatar_url:
                account.avatar_url = avatar_url
            db.commit()
        return account

    @staticmethod
    def update_cookies(db, uid, cookie_str, owner_username=_UNSET):
        account = AccountRepository.get_by_uid(db, uid, owner_username)
        if account and cookie_str and cookie_str.strip():
            account.cookie = cookie_str.strip()
            db.commit()
        return account

    @staticmethod
    def update_profile_statuses(db, statuses, owner_username=_UNSET):
        for account in AccountRepository.query(db, owner_username).filter(Account.uid.in_(statuses)).all():
            status = statuses[account.uid]
            if status in ("live", "die"):
                account.status = status.upper()
                account.status_checked_at = utc_now()
        db.commit()

    @staticmethod
    def delete(db, uid, owner_username=_UNSET, *, commit=True):
        account = AccountRepository.get_by_uid(db, uid, owner_username)
        if not account:
            return False
        db.delete(account)
        if commit:
            db.commit()
        return True
