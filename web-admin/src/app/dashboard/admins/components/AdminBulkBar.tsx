import { IconLockSmall, IconDetailTrash } from "./AdminIcons";

interface AdminBulkBarProps {
  selectedCount: number;
  onBulkBan: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function AdminBulkBar({
  selectedCount,
  onBulkBan,
  onBulkDelete,
  onClearSelection,
}: AdminBulkBarProps) {
  const disabled = selectedCount === 0;
  const hint = "Vui lòng chọn ít nhất một tài khoản";

  return (
    <div className="adm-bulk-bar">
      <span className="adm-bulk-info">
        {disabled ? (
          "Chưa chọn tài khoản nào"
        ) : (
          <>
            Đã chọn <strong>{selectedCount}</strong> tài khoản
          </>
        )}
      </span>
      {!disabled && (
        <button type="button" className="adm-bulk-clear" onClick={onClearSelection}>
          Bỏ chọn
        </button>
      )}

      <div className="adm-bulk-actions">
        <button
          type="button"
          className="adm-bulk-btn adm-bulk-btn--lock"
          disabled={disabled}
          title={disabled ? hint : "Khóa các tài khoản đã chọn"}
          onClick={onBulkBan}
        >
          <IconLockSmall />
          Khóa tài khoản
        </button>
        <button
          type="button"
          className="adm-bulk-btn adm-bulk-btn--delete"
          disabled={disabled}
          title={disabled ? hint : "Xóa vĩnh viễn các tài khoản đã chọn"}
          onClick={onBulkDelete}
        >
          <IconDetailTrash />
          Xóa
        </button>
      </div>
    </div>
  );
}
