from sqlalchemy.orm import Session
from typing import Optional
from modules.module_06_omnichannel_chat.models import Account
from modules.module_06_omnichannel_chat.schemas import AccountCreate

class AccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_facebook_user_id(self, facebook_user_id: str) -> Optional[Account]:
        """Query Facebook User Account from database using the facebook_user_id."""
        return self.db.query(Account).filter(Account.facebook_user_id == facebook_user_id).first()

    def create_or_update_account(self, account_in: AccountCreate) -> Account:
        """Create or update a Facebook User Account."""
        account = self.get_by_facebook_user_id(account_in.facebook_user_id)
        if account:
            account.name = account_in.name
            account.user_access_token = account_in.user_access_token
            account.system_user_id = account_in.system_user_id
        else:
            account = Account(
                facebook_user_id=account_in.facebook_user_id,
                name=account_in.name,
                system_user_id=account_in.system_user_id,
                user_access_token=account_in.user_access_token
            )
            self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return account

    upsert = create_or_update_account

    def update_long_lived_token(self, facebook_user_id: str, long_lived_token: str) -> Optional[Account]:
        """Updates the account's long-lived access token."""
        account = self.get_by_facebook_user_id(facebook_user_id)
        if account:
            account.user_access_token_long_lived = long_lived_token
            self.db.commit()
            self.db.refresh(account)
        return account
