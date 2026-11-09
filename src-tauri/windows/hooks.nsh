; Kill sidecar + app trước khi NSIS ghi đè local_engine\_internal\*.pyd
; (bản cũ không gọi prepare_for_update → chỉ hook này cứu được update in-place)

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping FB_Page_Automator / local_engine before file copy..."
  nsExec::ExecToLog 'taskkill /F /IM local_engine.exe /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM FB_Page_Automator.exe /T'
  Pop $0
  ; Chrome/Chromium do engine spawn đôi khi vẫn giữ handle dưới thư mục cài
  nsExec::ExecToLog 'taskkill /F /IM chromedriver.exe /T'
  Pop $0
  Sleep 2500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping FB_Page_Automator / local_engine before uninstall..."
  nsExec::ExecToLog 'taskkill /F /IM local_engine.exe /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM FB_Page_Automator.exe /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM chromedriver.exe /T'
  Pop $0
  Sleep 1500
!macroend
