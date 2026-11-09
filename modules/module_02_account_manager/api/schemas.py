"""Accounts page contracts; old raw-text import is intentionally replaced."""
from typing import Optional
from pydantic import BaseModel, Field, AliasChoices, ConfigDict, field_validator, model_validator
from ..utils.paths import validate_uid
from ..automation.proxy_bridge import parse_proxy, ProxyFormatError

class OwnerRequest(BaseModel):
    owner_username: Optional[str] = Field(None, max_length=100)
    user_id: Optional[str] = Field(None, max_length=100)

class AccountInput(OwnerRequest):
    model_config = ConfigDict(populate_by_name=True)
    uid: str
    category_id: Optional[int] = Field(None, ge=1)
    password: str = ""
    two_fa: Optional[str] = Field(None, validation_alias=AliasChoices("two_fa", "twofa_secret"))
    cookie: Optional[str] = None
    token: Optional[str] = None
    email: Optional[str] = Field(None, max_length=150)
    pass_mail: Optional[str] = Field(None, validation_alias=AliasChoices("pass_mail", "passmail"))
    mail_recovery: Optional[str] = Field(None, max_length=150, validation_alias=AliasChoices("mail_recovery", "mailkhoiphuc"))
    token_hotmail: Optional[str] = Field(None, validation_alias=AliasChoices("token_hotmail", "tokenhotmail"))
    client_id: Optional[str] = Field(None, max_length=100, validation_alias=AliasChoices("client_id", "clientId"))
    proxy: Optional[str] = Field(None, max_length=255)

    @field_validator("proxy")
    @classmethod
    def valid_proxy(cls, value):
        if value is None:
            return None
        value = value.strip()
        try:
            parse_proxy(value)
        except (ProxyFormatError, ValueError) as exc:
            raise ValueError("Proxy không hợp lệ. Dùng HOST:PORT, HOST:PORT:USER:PASS hoặc URL HTTP/HTTPS/SOCKS5.") from exc
        return value

    @model_validator(mode="before")
    @classmethod
    def sanitize_mail_and_token(cls, data):
        if isinstance(data, dict):
            mail_rec = data.get("mail_recovery") or data.get("mailkhoiphuc")
            if isinstance(mail_rec, str) and (len(mail_rec) > 150 or "MsaArtifacts" in mail_rec or mail_rec.startswith("M.C")):
                if not data.get("token_hotmail") and not data.get("tokenhotmail"):
                    data["token_hotmail"] = mail_rec
                    data.pop("mail_recovery", None)
                    data.pop("mailkhoiphuc", None)
                else:
                    data["mail_recovery"] = mail_rec[:150]
        return data

    @field_validator("uid")
    @classmethod
    def valid_uid(cls, value):
        return validate_uid(value)

class SingleAccountInput(AccountInput):
    original_uid: Optional[str] = None
    create_only: bool = False

    @field_validator("original_uid")
    @classmethod
    def valid_original_uid(cls, value):
        return validate_uid(value) if value is not None else None

class ImportRequest(OwnerRequest):
    accounts: list[AccountInput] = Field(max_length=100)
    check_status: bool = False
    skip_existing: bool = False

class UidsRequest(OwnerRequest):
    uids: list[str]

    @field_validator("uids")
    @classmethod
    def valid_uids(cls, values):
        return list(dict.fromkeys(validate_uid(uid) for uid in values))

class DeleteAccountsRequest(UidsRequest):
    delete_pages: bool = False


class CategoryCreate(OwnerRequest):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class CategoryUpdate(CategoryCreate):
    name: Optional[str] = Field(None, min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def name_not_null(cls, value):
        if value is None:
            raise ValueError("Name cannot be null")
        return value


class BulkSetCategoryRequest(UidsRequest):
    uids: list[str] = Field(min_length=1, max_length=100)
    category_id: Optional[int] = Field(..., ge=1)

class LoginRequest(UidsRequest):
    threads: int = Field(3, ge=1, le=10)

class OpenBrowserRequest(OwnerRequest):
    uid: str
    target_url: Optional[str] = Field(None, max_length=2048)

    @field_validator("uid")
    @classmethod
    def valid_uid(cls, value):
        return validate_uid(value)

    @field_validator("target_url")
    @classmethod
    def valid_target_url(cls, value):
        if value is None:
            return None
        value = str(value).strip()
        if not value:
            return None
        if not value.startswith(("http://", "https://")):
            raise ValueError("target_url must be an http(s) URL")
        return value

class TestProxyRequest(BaseModel):
    proxy: str = Field(min_length=1)
