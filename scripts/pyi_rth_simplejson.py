"""PyInstaller runtime hook: ép requests dùng stdlib json.

Trên máy build nếu có package simplejson, PyInstaller hay đóng gói
bản dở → ImportError: cannot import name 'JSONDecodeError' from 'simplejson'.
Alias sang json trước mọi import của app.
"""
import json
import sys

sys.modules["simplejson"] = json
