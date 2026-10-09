from sqlalchemy.orm import Session
from typing import Optional, List
from modules.module_06_omnichannel_chat.models import Customer
from modules.module_06_omnichannel_chat.schemas import CustomerCreate

class CustomerRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_psid(self, psid: str) -> Optional[Customer]:
        """Lấy thông tin khách hàng theo PSID Facebook."""
        return self.db.query(Customer).filter(Customer.psid == psid).first()

    def upsert_customer(
        self, psid: str, name: Optional[str] = None, avatar_url: Optional[str] = None, phone: Optional[str] = None, notes: Optional[str] = None, tags: Optional[str] = None
    ) -> Customer:
        """Tạo mới hoặc cập nhật thông tin khách hàng vào CSDL (thay thế file JSON cache)."""
        customer = self.get_by_psid(psid)
        if customer:
            if name: customer.name = name
            if avatar_url: customer.avatar_url = avatar_url
            if phone: customer.phone = phone
            if notes: customer.notes = notes
            if tags: customer.tags = tags
        else:
            customer = Customer(
                psid=psid,
                name=name,
                avatar_url=avatar_url,
                phone=phone,
                notes=notes,
                tags=tags
            )
            self.db.add(customer)
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def update_tags(self, psid: str, tags: str) -> Optional[Customer]:
        """Cập nhật nhãn phân loại cho khách hàng."""
        customer = self.get_by_psid(psid)
        if customer:
            customer.tags = tags
            self.db.commit()
            self.db.refresh(customer)
        return customer
