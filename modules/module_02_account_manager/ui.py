"""
Module 2: Quản lý Account Facebook
Phụ trách: Mạnh Cường
Chức năng: Quản lý danh sách tài khoản, Import (UID|PASS|2FA|COOKIE|TOKEN...), Export, Check Live/Die, Gán Proxy
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTableWidget, QTableWidgetItem, QHeaderView, QDialog, 
    QTextEdit, QComboBox, QMessageBox, QProgressBar
)
from PyQt5.QtCore import Qt
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_02_account_manager.worker import CheckLiveAccountWorker

class ImportAccountsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Nhập Tài Khoản Facebook Hàng Loạt")
        self.resize(600, 450)
        self.setStyleSheet("background-color: #0b0e14; color: #f1f5f9;")

        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        lbl = QLabel("Định dạng: UID|Pass|2FA|Cookie|Token|Email|PassMail|Proxy (Mỗi tài khoản 1 dòng)")
        lbl.setStyleSheet("color: #38bdf8; font-weight: bold;")
        layout.addWidget(lbl)

        self.txt_input = QTextEdit()
        self.txt_input.setPlaceholderText("100012345678|MatKhau123|JBSWY3DPEHPK3PXP|datr=...|EAA...|mail@gmail.com|pass|127.0.0.1:8080")
        layout.addWidget(self.txt_input)

        btn_box = QHBoxLayout()
        btn_import = QPushButton("Xác Nhận Nhập")
        btn_import.setProperty("class", "btn-primary")
        btn_import.clicked.connect(self.accept)
        btn_cancel = QPushButton("Hủy")
        btn_cancel.clicked.connect(self.reject)

        btn_box.addStretch()
        btn_box.addWidget(btn_cancel)
        btn_box.addWidget(btn_import)
        layout.addLayout(btn_box)

    def get_data(self) -> str:
        return self.txt_input.toPlainText()


class AccountManagerTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_02_account_manager",
            module_title="Quản Lý Tài Khoản Facebook",
            author="Mạnh Cường",
            parent=parent
        )

    def init_ui(self):
        # Header Toolbar
        btn_import = QPushButton("➕ Nhập Tài Khoản")
        btn_import.setProperty("class", "btn-primary")
        btn_import.clicked.connect(self.open_import_dialog)
        self.header_actions_layout.addWidget(btn_import)

        btn_check = QPushButton("⚡ Check Live / Die")
        btn_check.setProperty("class", "btn-warning")
        btn_check.clicked.connect(self.start_check_live)
        self.header_actions_layout.addWidget(btn_check)

        btn_delete = QPushButton("🗑️ Xóa Đã Chọn")
        btn_delete.setProperty("class", "btn-danger")
        btn_delete.clicked.connect(self.delete_selected)
        self.header_actions_layout.addWidget(btn_delete)

        # Thanh tiến trình
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #1e293b;
                border-radius: 4px;
                text-align: center;
                background-color: #0f172a;
                color: #00f0ff;
                height: 18px;
            }
            QProgressBar::chunk {
                background-color: #0284c7;
            }
        """)
        self.main_layout.addWidget(self.progress_bar)

        # Bảng danh sách tài khoản
        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["ID", "UID", "Tên / Ghi Chú", "Trạng Thái", "Proxy", "2FA", "Cookie / Token"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.main_layout.addWidget(self.table)

        self.load_accounts()

    def load_accounts(self):
        accounts = db.fetch_all("SELECT * FROM accounts ORDER BY id DESC")
        self.table.setRowCount(len(accounts))

        for row_idx, acc in enumerate(accounts):
            self.table.setItem(row_idx, 0, QTableWidgetItem(str(acc["id"])))
            self.table.setItem(row_idx, 1, QTableWidgetItem(str(acc.get("uid", ""))))
            self.table.setItem(row_idx, 2, QTableWidgetItem(str(acc.get("notes") or acc.get("tags") or "")))
            
            # Tô màu trạng thái
            status = acc.get("status", "NEW")
            item_status = QTableWidgetItem(status)
            if status == "LIVE":
                item_status.setForeground(Qt.green)
            elif status == "DIE":
                item_status.setForeground(Qt.red)
            elif status == "CHECKPOINT":
                item_status.setForeground(Qt.yellow)
            self.table.setItem(row_idx, 3, item_status)

            self.table.setItem(row_idx, 4, QTableWidgetItem(str(acc.get("proxy") or "Chưa gán")))
            self.table.setItem(row_idx, 5, QTableWidgetItem("Có" if acc.get("fa2") else "Không"))
            self.table.setItem(row_idx, 6, QTableWidgetItem("Sẵn sàng" if (acc.get("cookie") or acc.get("token")) else "Thiếu"))

    def open_import_dialog(self):
        dlg = ImportAccountsDialog(self)
        if dlg.exec_() == QDialog.Accepted:
            raw_data = dlg.get_data().strip()
            if not raw_data:
                return

            lines = raw_data.split("\n")
            count = 0
            for line in lines:
                parts = [p.strip() for p in line.split("|")]
                if not parts or not parts[0]:
                    continue
                uid = parts[0]
                pwd = parts[1] if len(parts) > 1 else ""
                fa2 = parts[2] if len(parts) > 2 else ""
                cookie = parts[3] if len(parts) > 3 else ""
                token = parts[4] if len(parts) > 4 else ""
                mail = parts[5] if len(parts) > 5 else ""
                mail_pass = parts[6] if len(parts) > 6 else ""
                proxy = parts[7] if len(parts) > 7 else ""

                try:
                    db.execute(
                        """INSERT OR REPLACE INTO accounts 
                        (uid, password, fa2, cookie, token, mail, mail_pass, proxy, status) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW')""",
                        (uid, pwd, fa2, cookie, token, mail, mail_pass, proxy)
                    )
                    count += 1
                except Exception as e:
                    self.log("ERROR", f"Lỗi nhập UID {uid}: {e}")

            self.log("SUCCESS", f"Đã nhập thành công {count} tài khoản vào hệ thống!")
            self.load_accounts()

    def start_check_live(self):
        accounts = db.fetch_all("SELECT * FROM accounts")
        if not accounts:
            QMessageBox.warning(self, "Thông báo", "Chưa có tài khoản nào trong danh sách.")
            return

        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.progress_bar.setMaximum(len(accounts))

        self.worker = CheckLiveAccountWorker(accounts)
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_progress.connect(self._on_progress)
        self.worker.sig_finished.connect(self._on_check_finished)
        self.worker.start()

    def _on_progress(self, current: int, total: int, status_text: str):
        self.progress_bar.setValue(current)

    def _on_check_finished(self, success: bool, msg: str):
        self.progress_bar.setVisible(False)
        self.load_accounts()
        QMessageBox.information(self, "Kết quả", msg)

    def delete_selected(self):
        selected_rows = set(index.row() for index in self.table.selectedIndexes())
        if not selected_rows:
            return
        
        reply = QMessageBox.question(self, "Xác nhận", f"Bạn có chắc muốn xóa {len(selected_rows)} tài khoản đã chọn?",
                                     QMessageBox.Yes | QMessageBox.No)
        if reply == QMessageBox.Yes:
            for row in selected_rows:
                acc_id = self.table.item(row, 0).text()
                db.execute("DELETE FROM accounts WHERE id = ?", (acc_id,))
            self.load_accounts()
            self.log("INFO", f"Đã xóa {len(selected_rows)} tài khoản.")
