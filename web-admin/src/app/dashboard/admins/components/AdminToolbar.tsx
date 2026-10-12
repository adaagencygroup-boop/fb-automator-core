import { IconSearch, IconDownload } from "./AdminIcons";

interface AdminToolbarProps {
  search: string;
  setSearch: (val: string) => void;
  filterStatus: string;
  setFilterStatus: (val: string) => void;
  sortOrder: "newest" | "oldest";
  setSortOrder: (val: "newest" | "oldest") => void;
  onResetPage: () => void;
  onExportCSV: () => void;
}

export function AdminToolbar({
  search,
  setSearch,
  filterStatus,
  setFilterStatus,
  sortOrder,
  setSortOrder,
  onResetPage,
  onExportCSV,
}: AdminToolbarProps) {
  return (
    <div className="adm-toolbar">
      {/* Search */}
      <div className="adm-search">
        <span className="adm-search-icon">
          <IconSearch />
        </span>
        <input
          type="text"
          className="adm-search-input"
          placeholder="Tìm username / thông tin liên hệ..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onResetPage();
          }}
        />
      </div>

      {/* Status filter */}
      <div className="adm-select-wrap">
        <select
          className="adm-select"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            onResetPage();
          }}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="locked">Đã khóa</option>
        </select>
      </div>

      {/* Date sort */}
      <div className="adm-select-wrap">
        <select
          className="adm-select"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
        >
          <option value="newest">Ngày tạo: Mới nhất</option>
          <option value="oldest">Ngày tạo: Cũ nhất</option>
        </select>
      </div>

      {/* Export */}
      <button type="button" className="adm-tool-btn" onClick={onExportCSV}>
        <IconDownload />
        Xuất dữ liệu
      </button>
    </div>
  );
}
