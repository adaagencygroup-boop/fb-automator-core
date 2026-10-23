"""Owner-scoped category CRUD and atomic account reassignment."""
from datetime import timezone
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from ..context import owner_context
from ..database.models import Account, AccountCategory
from ..database.repository import AccountRepository as Accounts
from ..database.category_repository import CategoryRepository as Categories


def serialize(category, account_count=0):
    return {
        "id": category.id, "user_id": category.user_id,
        "name": category.name, "color": category.color,
        "created_at": category.created_at.replace(tzinfo=timezone.utc).isoformat(),
        "updated_at": category.updated_at.replace(tzinfo=timezone.utc).isoformat(),
        "account_count": account_count,
    }


def list_categories(db):
    counts = dict(Accounts.query(db).with_entities(Account.category_id, func.count(Account.id))
                  .group_by(Account.category_id).all())
    return [serialize(row, counts.get(row.id, 0)) for row in Categories.query(db).order_by(AccountCategory.id).all()]


def save_category(db, request, category_id=None):
    try:
        category = Categories.require(db, category_id, lock=True) if category_id is not None else AccountCategory(user_id=owner_context.get())
        for key, value in request.model_dump(exclude_unset=True, include={"name", "color"}).items():
            setattr(category, key, value)
        db.add(category)
        db.commit()
        db.refresh(category)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Category name already exists") from exc
    count = Accounts.query(db).filter(Account.category_id == category.id).count()
    return serialize(category, count)


def delete_category(db, category_id):
    try:
        category = Categories.require(db, category_id, lock=True)
        count = Accounts.query(db).filter(Account.category_id == category.id).update(
            {Account.category_id: None}, synchronize_session="fetch")
        db.delete(category)
        db.commit()
        return {"deleted": True, "unassigned_count": count}
    except Exception:
        db.rollback()
        raise


def bulk_set_category(db, request):
    try:
        Categories.validate_assignment(db, {"category_id": request.category_id})
        rows = Accounts.query(db).filter(Account.uid.in_(request.uids)).with_for_update().all()
        if len(rows) != len(request.uids):
            raise HTTPException(404, "Account not found")
        for account in rows:
            account.category_id = request.category_id
        db.commit()
        return {"updated_count": len(rows)}
    except Exception:
        db.rollback()
        raise


def filter_accounts(db, query, category_id=None, uncategorized=False):
    if category_id is not None and uncategorized:
        raise HTTPException(422, "Category and uncategorized filters are mutually exclusive")
    if category_id is not None:
        Categories.require(db, category_id)
        return query.filter(Account.category_id == category_id)
    if uncategorized:
        return query.filter(Account.category_id.is_(None))
    return query
