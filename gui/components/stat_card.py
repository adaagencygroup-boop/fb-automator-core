"""
StatCard Component for Dashboard & Overviews
"""
from PyQt5.QtWidgets import QFrame, QVBoxLayout, QLabel
from PyQt5.QtCore import Qt

class StatCard(QFrame):
    def __init__(self, title: str, value: str = "0", subtitle: str = "", accent_color: str = "#00f0ff", parent=None):
        super().__init__(parent)
        self.setProperty("class", "stat-card")
        self.setStyleSheet(f"""
            QFrame.stat-card {{
                background-color: #0f172a;
                border: 1px solid #1e293b;
                border-left: 4px solid {accent_color};
                border-radius: 10px;
                padding: 12px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(4)

        self.lbl_title = QLabel(title.upper())
        self.lbl_title.setStyleSheet("color: #94a3b8; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;")

        self.lbl_value = QLabel(value)
        self.lbl_value.setStyleSheet(f"color: {accent_color}; font-size: 26px; font-weight: 900;")

        layout.addWidget(self.lbl_title)
        layout.addWidget(self.lbl_value)

        if subtitle:
            self.lbl_subtitle = QLabel(subtitle)
            self.lbl_subtitle.setStyleSheet("color: #64748b; font-size: 11px;")
            layout.addWidget(self.lbl_subtitle)
        else:
            self.lbl_subtitle = None

    def set_value(self, value: str):
        self.lbl_value.setText(str(value))
