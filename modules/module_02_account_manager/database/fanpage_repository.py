"""Fanpage links accessed through the account transaction, without host imports."""
from sqlalchemy import bindparam, inspect, text


class FanpageRepository:
    @staticmethod
    def counts(db, uids):
        if not uids or not inspect(db.connection()).has_table("pages"):
            return {}
        statement = text(
            "SELECT account_uid, COUNT(*) AS count FROM pages "
            "WHERE account_uid IN :uids GROUP BY account_uid"
        ).bindparams(bindparam("uids", expanding=True))
        return {row.account_uid: row.count for row in db.execute(statement, {"uids": uids})}

    @staticmethod
    def related_ids(db, uid):
        if not inspect(db.connection()).has_table("pages"):
            return []
        statement = "SELECT id FROM pages WHERE account_uid = :uid"
        if db.get_bind().dialect.name == "postgresql":
            statement += " FOR UPDATE"
        return list(db.execute(text(statement), {"uid": uid}).scalars())

    @staticmethod
    def remove_links(db, page_ids, delete_pages=False):
        if not page_ids:
            return 0
        statement = (
            "DELETE FROM pages WHERE id IN :ids" if delete_pages else
            "UPDATE pages SET account_uid = NULL WHERE id IN :ids"
        )
        return db.execute(
            text(statement).bindparams(bindparam("ids", expanding=True)),
            {"ids": page_ids},
        ).rowcount
