# -*- coding: utf-8 -*-
"""
File: config/styles.py
"""
import os

HACKER_STYLE_QSS = """
    QMainWindow {
        background-color: #0c0d12;
        color: #e0e6ed;
    }
    QGroupBox {
        font-size: 10pt;
        font-weight: bold;
        color: #00ff66;
        border: 2px solid #1c2333;
        border-radius: 8px;
        margin-top: 15px;
        padding-top: 15px;
    }
    QGroupBox::title {
        subcontrol-origin: margin;
        subcontrol-position: top left;
        left: 15px;
        padding: 0 5px;
        background-color: #0c0d12;
    }
    QLabel {
        color: #a0aec0;
        font-size: 9pt;
    }
    QLineEdit, QTextEdit {
        background-color: #12161a;
        color: #00ff66;
        border: 1px solid #1c2333;
        border-radius: 4px;
        padding: 6px;
        font-family: 'Consolas', 'Courier New', monospace;
    }
    QLineEdit:focus, QTextEdit:focus {
        border-color: #00ff66;
    }
    QPushButton {
        background-color: #1a1f26;
        color: #e0e6ed;
        border: 1px solid #1c2333;
        border-radius: 4px;
        padding: 6px 12px;
        font-weight: bold;
    }
    QPushButton:hover {
        background-color: #242b35;
        border-color: #00ff66;
        color: #00ff66;
    }
    QPushButton:pressed {
        background-color: #00ff66;
        color: #0c0d12;
    }
    QComboBox {
        background-color: #12161a;
        color: #e0e6ed;
        border: 1px solid #1c2333;
        border-radius: 4px;
        padding: 4px;
        padding-right: 25px;
        min-width: 60px;
    }
    QComboBox:focus {
        border-color: #00ff66;
    }
    QComboBox::drop-down {
        subcontrol-origin: padding;
        subcontrol-position: top right;
        width: 20px;
        border-left-width: 0px;
        border-top-right-radius: 3px;
        border-bottom-right-radius: 3px;
    }
    QComboBox::down-arrow {
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 5px solid #00ff66;
    }
    QComboBox::down-arrow:on {
        border-top: none;
        border-bottom: 5px solid #00ff66;
    }
    QComboBox QAbstractItemView {
        background-color: #12161a;
        color: #e0e6ed;
        selection-background-color: #00ff66;
        selection-color: #0c0d12;
        border: 1px solid #1c2333;
    }
    QSpinBox {
        background-color: #12161a;
        color: #e0e6ed;
        border: 1px solid #1c2333;
        border-radius: 4px;
        padding: 4px;
    }
    QSpinBox:focus {
        border-color: #00ff66;
    }
    QTabWidget::pane {
        border: 1px solid #1c2333;
        background-color: #0c0d12;
        border-radius: 5px;
    }
    QTabBar::tab {
        background-color: #12161a;
        color: #a0aec0;
        border: 1px solid #1c2333;
        border-bottom-color: none;
        border-top-left-radius: 4px;
        border-top-right-radius: 4px;
        padding: 8px 16px;
        margin-right: 2px;
    }
    QTabBar::tab:selected {
        background-color: #0c0d12;
        color: #00ff66;
        border-bottom: 2px solid #00ff66;
        font-weight: bold;
    }
    QTabBar::tab:hover {
        background-color: #1c2333;
        color: #e0e6ed;
    }
    QTableWidget {
        background-color: #12161a;
        color: #e0e6ed;
        gridline-color: #1c2333;
        border: 1px solid #1c2333;
        selection-background-color: rgba(0, 255, 102, 0.15);
        selection-color: #00ff66;
        border-radius: 4px;
    }
    QTableWidget::item {
        padding: 5px;
    }
    QHeaderView::section {
        background-color: #1a1f26;
        color: #00ff66;
        padding: 5px;
        border: 1px solid #1c2333;
        font-weight: bold;
    }
    QScrollBar:vertical {
        border: none;
        background-color: #0c0d12;
        width: 10px;
        margin: 0px;
    }
    QScrollBar::handle:vertical {
        background-color: #1c2333;
        min-height: 20px;
        border-radius: 5px;
    }
    QScrollBar::handle:vertical:hover {
        background-color: #00ff66;
    }
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
        height: 0px;
    }
    QCheckBox {
        spacing: 5px;
        color: #e0e6ed;
    }
    QCheckBox::indicator {
        width: 16px;
        height: 16px;
        border: 1px solid #2c3540;
        border-radius: 3px;
        background-color: #12161a;
    }
    QCheckBox::indicator:unchecked:hover {
        border-color: #00ff66;
    }
    QCheckBox::indicator:checked {
        background-color: #0c2a18;
        border-color: #00ff66;
        image: url(check.png);
    }
    QTableWidget QCheckBox {
        margin-left: 20px;
    }
    QPushButton[class="neon-large-green"] {
        background-color: #0c2a18;
        color: #00ff66;
        border: 2px solid #00ff66;
        font-weight: bold;
        padding: 10px 20px;
        font-size: 10pt;
        border-radius: 6px;
    }
    QPushButton[class="neon-large-green"]:hover {
        background-color: #00ff66;
        color: #0c0d12;
    }
    QPushButton[class="neon-large-green"]:disabled {
        background-color: #1a1a1a;
        color: #555555;
        border-color: #333333;
    }
    QPushButton[class="neon-large-red"] {
        background-color: #2a0c0c;
        color: #ff3366;
        border: 2px solid #ff3366;
        font-weight: bold;
        padding: 10px 20px;
        font-size: 10pt;
        border-radius: 6px;
    }
    QPushButton[class="neon-large-red"]:hover {
        background-color: #ff3366;
        color: #0c0d12;
    }
    QPushButton[class="neon-large-red"]:disabled {
        background-color: #1a1a1a;
        color: #555555;
        border-color: #333333;
    }
"""

def generate_check_icon():
    try:
        from PyQt5.QtGui import QImage, QPainter, QPen, QColor
        from PyQt5.QtCore import Qt
        
        image = QImage(16, 16, QImage.Format_ARGB32)
        image.fill(Qt.transparent)
        
        painter = QPainter(image)
        painter.setRenderHint(QPainter.Antialiasing, True)
        
        pen = QPen(QColor("#00ff66"), 2)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        
        # Vẽ dấu tích V: (3, 8) -> (7, 12) -> (13, 4)
        painter.drawLine(3, 8, 7, 12)
        painter.drawLine(7, 12, 13, 4)
        painter.end()
        
        image.save("check.png")
    except Exception:
        pass
