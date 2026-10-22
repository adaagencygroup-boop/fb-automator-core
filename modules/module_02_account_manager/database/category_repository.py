"""Category queries always use the account plugin's current owner."""
from fastapi import HTTPException
from .models import AccountCategory
from ..context import owner_context


class CategoryRepository:
    @staticmethod
    def query(db):
        return db.query(AccountCategory).filter(AccountCategory.user_id == owner_context.get())

    @staticmethod
    def require(db, category_id, *, lock=False):
        query = CategoryRepository.query(db).filter(AccountCategory.id == category_id)
        if lock:
            query = query.with_for_update()
        category = query.first()
        if category is None:
            raise HTTPException(404, "Category not found")
        return category

    @staticmethod
    def validate_assignment(db, data):
        if data.get("category_id") is not None:
            CategoryRepository.require(db, data["category_id"], lock=True)
