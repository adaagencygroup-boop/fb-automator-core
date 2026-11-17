"""Fixed account-manager trial and grace period; reading never extends a license."""
from datetime import datetime, timedelta, timezone

ACCOUNT_FEATURE = "fb_account"
ACCOUNT_FREE_DAYS = 30


def as_utc(value):
    if value is None:
        return None
    try:
        date = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return date.astimezone(timezone.utc).replace(tzinfo=None) if date.tzinfo else date


def account_license_expiry(created_at, features):
    """Signup + 30 days, or latest subscribed module expiry + 30 days.

    Keep expired subscriptions in the calculation so grace counts down from
    their actual end date instead of restarting whenever the user logs in.
    """
    anchor = as_utc(created_at)
    if anchor is None:
        raise ValueError("A registration date is required to calculate the free license")
    for feature in features:
        key = feature.get("feature_key", feature.get("key"))
        if key == ACCOUNT_FEATURE or not (feature.get("is_enabled") or (feature.get("days_granted") or 0) > 0):
            continue
        expiry = as_utc(feature.get("expired_at"))
        if expiry is not None:
            anchor = max(anchor, expiry)
    return anchor + timedelta(days=ACCOUNT_FREE_DAYS)
