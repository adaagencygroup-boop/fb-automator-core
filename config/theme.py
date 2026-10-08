"""
Cyberpunk / Dark Hacker Theme for Facebook Automator Pro
"""

CYBERPUNK_QSS = """
/* ===================================================================
   CYBERPUNK DARK THEME - FACEBOOK AUTOMATOR PRO
   =================================================================== */

QMainWindow, QDialog, QWidget#centralWidget {
    background-color: #0b0e14;
    color: #e2e8f0;
    font-family: 'Segoe UI', 'Roboto', 'Arial', sans-serif;
    font-size: 13px;
}

/* Sidebar Navigation */
QWidget#sidebarContainer {
    background-color: #080a0f;
    border-right: 1px solid #1a2234;
    min-width: 250px;
    max-width: 250px;
}

QLabel#brandTitle {
    color: #00f0ff;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 1px;
    padding: 10px 0px;
}

QLabel#brandSubtitle {
    color: #718096;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 12px;
}

QPushButton.nav-btn {
    background-color: transparent;
    color: #94a3b8;
    text-align: left;
    padding: 11px 18px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    margin: 2px 8px;
}

QPushButton.nav-btn:hover {
    background-color: #131b2e;
    color: #38bdf8;
    border-left: 3px solid #38bdf8;
}

QPushButton.nav-btn:checked, QPushButton.nav-btn[active="true"] {
    background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0f172a, stop:1 #1e293b);
    color: #00f0ff;
    border-left: 4px solid #00f0ff;
    font-weight: 700;
}

/* Cards & Content Panels */
QFrame.card, QWidget.card {
    background-color: #111827;
    border: 1px solid #1f293d;
    border-radius: 10px;
    padding: 16px;
}

QFrame.stat-card {
    background-color: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 14px;
}

QLabel.stat-title {
    color: #94a3b8;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
}

QLabel.stat-value {
    color: #38bdf8;
    font-size: 26px;
    font-weight: 800;
    margin-top: 4px;
}

/* Header Area */
QWidget#headerBar {
    background-color: #0d121d;
    border-bottom: 1px solid #1e293b;
    padding: 8px 16px;
}

/* Push Buttons */
QPushButton {
    background-color: #1e293b;
    color: #f1f5f9;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 600;
}

QPushButton:hover {
    background-color: #334155;
    border-color: #475569;
}

QPushButton:pressed {
    background-color: #0f172a;
}

QPushButton.btn-primary {
    background-color: #0284c7;
    border: 1px solid #38bdf8;
    color: #ffffff;
}

QPushButton.btn-primary:hover {
    background-color: #0369a1;
}

QPushButton.btn-success {
    background-color: #059669;
    border: 1px solid #10b981;
    color: #ffffff;
}

QPushButton.btn-success:hover {
    background-color: #047857;
}

QPushButton.btn-danger {
    background-color: #dc2626;
    border: 1px solid #ef4444;
    color: #ffffff;
}

QPushButton.btn-danger:hover {
    background-color: #b91c1c;
}

QPushButton.btn-warning {
    background-color: #d97706;
    border: 1px solid #f59e0b;
    color: #ffffff;
}

QPushButton.btn-warning:hover {
    background-color: #b45309;
}

/* LineEdit & TextEdit */
QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox, QDoubleSpinBox {
    background-color: #0b101b;
    color: #f8fafc;
    border: 1px solid #1e293b;
    border-radius: 6px;
    padding: 8px 12px;
    selection-background-color: #0284c7;
}

QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QComboBox:focus {
    border: 1px solid #00f0ff;
    background-color: #0d1424;
}

/* Tables */
QTableWidget, QTableView {
    background-color: #0d121e;
    color: #f1f5f9;
    border: 1px solid #1e293b;
    border-radius: 8px;
    gridline-color: #1a2333;
    selection-background-color: #1e3a5f;
    selection-color: #00f0ff;
}

QHeaderView::section {
    background-color: #131c2e;
    color: #94a3b8;
    padding: 8px;
    border: none;
    border-bottom: 2px solid #1e293b;
    font-weight: 700;
}

/* Tab Widgets */
QTabWidget::pane {
    border: 1px solid #1e293b;
    background-color: #101623;
    border-radius: 8px;
}

QTabBar::tab {
    background-color: #090d14;
    color: #94a3b8;
    padding: 9px 18px;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    margin-right: 2px;
}

QTabBar::tab:selected {
    background-color: #101623;
    color: #00f0ff;
    border-bottom: 2px solid #00f0ff;
    font-weight: 700;
}

QTabBar::tab:hover:!selected {
    background-color: #131c2e;
    color: #e2e8f0;
}

/* Checkbox */
QCheckBox {
    color: #cbd5e1;
    spacing: 8px;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #334155;
    background-color: #0f172a;
}

QCheckBox::indicator:checked {
    background-color: #0284c7;
    border-color: #38bdf8;
}

/* Scrollbars */
QScrollBar:vertical {
    border: none;
    background: #090d14;
    width: 8px;
    margin: 0px;
}

QScrollBar::handle:vertical {
    background: #1e293b;
    min-height: 20px;
    border-radius: 4px;
}

QScrollBar::handle:vertical:hover {
    background: #00f0ff;
}

QScrollBar:horizontal {
    border: none;
    background: #090d14;
    height: 8px;
}

QScrollBar::handle:horizontal {
    background: #1e293b;
    min-width: 20px;
    border-radius: 4px;
}

/* Console Log Area */
QPlainTextEdit#consoleLog {
    background-color: #06090e;
    color: #00ff66;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    border: 1px solid #1e293b;
    border-radius: 6px;
}
"""
