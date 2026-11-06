; Tomo's additions to the electron-builder NSIS uninstaller (nsis.include in electron-builder.yml).
; Uninstalling asks once whether to delete the student's Tomo data as well (default: keep it). Updates run the old
; uninstaller with --updated and silent uninstalls (/S) never ask and never delete anything.
; All of Tomo's data lives in %LOCALAPPDATA%\Tomo (src/main/paths.ts), Electron's profile included.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent tomo_keep_data
    System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
    StrCpy $1 "Also delete your Tomo data on this computer?$\r$\n$\r$\nThis removes your chats, what Tomo remembers, your AI keys and profile, the AI engine, and the sign-ins in Tomo's browser. It cannot be undone.$\r$\n$\r$\nChoose No to keep them, for example to install Tomo again later."
    ${if} $0 == 1041
      StrCpy $1 "このコンピューターの Tomo のデータも削除しますか？$\r$\n$\r$\n会話、Tomo の記憶、AI のキーとプロフィール、AI エンジン、Tomo のブラウザーのログイン情報が削除されます。元に戻せません。$\r$\n$\r$\n後で Tomo を入れ直す場合などは「いいえ」を選ぶと残ります。"
    ${elseif} $0 == 2052
      StrCpy $1 "是否同时删除这台电脑上的 Tomo 数据？$\r$\n$\r$\n这会删除你的对话、Tomo 记住的内容、AI Key 和个人资料、AI 引擎，以及 Tomo 浏览器里的登录状态，无法恢复。$\r$\n$\r$\n如果以后还想重新安装 Tomo，请选择“否”保留这些数据。"
    ${endif}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$1" IDNO tomo_keep_data
    ; Tomo is closed by now (the uninstaller asks for that); its engine, browser and terminal commands ended with it
    RMDir /r "$LOCALAPPDATA\Tomo"
    tomo_keep_data:
  ${endIf}
!macroend
