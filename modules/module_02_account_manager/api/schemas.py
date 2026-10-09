"""Accounts page contracts; old raw-text import is intentionally replaced."""
from typing import Optional
from pydantic import BaseModel, Field, AliasChoices, ConfigDict, field_validator
from ..utils.paths import validate_uid

class OwnerRequest(BaseModel):
    owner_username: Optional[str] = Field(None, max_length=100)

class AccountInput(OwnerRequest):
    model_config = ConfigDict(populate_by_name=True)
    uid: str
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

    @field_validator("uid")
    @classmethod
    def valid_uid(cls, value):
        return validate_uid(value)

class ImportRequest(OwnerRequest):
    accounts: list[AccountInput] = Field(max_length=100)
    check_status: bool = False

class UidsRequest(OwnerRequest):
    uids: list[str]

    @field_validator("uids")
    @classmethod
    def valid_uids(cls, values):
        return list(dict.fromkeys(validate_uid(uid) for uid in values))

class LoginRequest(UidsRequest):
    threads: int = Field(3, ge=1, le=10)

class OpenBrowserRequest(OwnerRequest):
    uid: str

    @field_validator("uid")
    @classmethod
    def valid_uid(cls, value):
        return validate_uid(value)

class TestProxyRequest(BaseModel):
    proxy: str = Field(min_length=1)
