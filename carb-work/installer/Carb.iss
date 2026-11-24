#ifndef AppVersion
  #define AppVersion "5.6.14"
#endif
#ifndef PayloadDir
  #error PayloadDir must identify the complete Carb application directory.
#endif
#ifndef OutputDir
  #error OutputDir must identify the installer output directory.
#endif
#ifndef IconFile
  #error IconFile is required.
#endif
#ifndef CarbDataDir
  #define CarbDataDir "{userappdata}\CarbData"
#endif
#ifndef CarbAppUserModelId
  #define CarbAppUserModelId "Icewheel.Carb"
#endif
#ifndef CarbShortcutName
  #define CarbShortcutName "Carb"
#endif

[Setup]
AppId={{65CB7ABA-432C-4AC1-BA3E-93F8CA097145}
AppName=Carb
AppVersion={#AppVersion}
AppVerName=Carb {#AppVersion}
AppPublisher=冰轮
DefaultDirName={localappdata}\Programs\Carb
DefaultGroupName=Carb
DisableProgramGroupPage=yes
AllowNoIcons=yes
DisableWelcomePage=no
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Carb-Setup-{#AppVersion}-win-x64
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Carb.exe
UninstallDisplayName=Carb
WizardStyle=modern
Compression=lzma2/normal
SolidCompression=yes
LZMAUseSeparateProcess=yes
CloseApplications=no
RestartApplications=no
SetupMutex=Icewheel.Carb.Setup
VersionInfoCompany=冰轮
VersionInfoProductName=Carb
VersionInfoDescription=Carb Installer
VersionInfoVersion={#AppVersion}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[CustomMessages]
english.LaunchCarb=Launch Carb
chinesesimplified.LaunchCarb=启动 Carb
japanese.LaunchCarb=Carb を起動する
english.CreateDesktopShortcut=Create a desktop shortcut
chinesesimplified.CreateDesktopShortcut=创建桌面快捷方式
japanese.CreateDesktopShortcut=デスクトップにショートカットを作成する
english.AdditionalShortcuts=Additional shortcuts:
chinesesimplified.AdditionalShortcuts=其他快捷方式：
japanese.AdditionalShortcuts=追加のショートカット:
english.CloseCarbBeforeUpgrade=Quit Carb from its system tray menu before installing this update.
chinesesimplified.CloseCarbBeforeUpgrade=请从系统托盘菜单退出 Carb，再继续安装更新。
japanese.CloseCarbBeforeUpgrade=更新をインストールする前に、通知領域のメニューから Carb を終了してください。
english.CloseCarbFailed=Carb is still running. Quit the app from its tray menu and try uninstalling again.
chinesesimplified.CloseCarbFailed=Carb 仍在运行。请从系统托盘菜单退出应用，再重试卸载。
japanese.CloseCarbFailed=Carb がまだ実行されています。通知領域のメニューから終了し、アンインストールをやり直してください。
english.CarbDataInUse=Carb's data is in use. Quit all copies of Carb and try again.
chinesesimplified.CarbDataInUse=Carb 数据正在使用。请退出所有 Carb 实例，再重试卸载。
japanese.CarbDataInUse=Carb のデータが使用中です。すべての Carb を終了してから再試行してください。
english.CleanCarbCredentialsFailed=The Carb data cleanup could not complete. Repair the installation if its files are missing, then try again.
chinesesimplified.CleanCarbCredentialsFailed=未能完成 Carb 数据清理。如果安装文件缺失，请修复安装后重试。
japanese.CleanCarbCredentialsFailed=Carb のデータを消去できませんでした。インストールファイルが欠けている場合は再インストールしてから再試行してください。
english.CleanCarbPathFailed=Carb could not remove %1. Close programs using this location and try again.
chinesesimplified.CleanCarbPathFailed=无法删除 %1。请关闭正在使用该位置的程序，再重试。
japanese.CleanCarbPathFailed=%1 を削除できませんでした。この場所を使用しているプログラムを閉じてから再試行してください。
english.CleanCarbRegistryFailed=Carb could not remove the registry entry %1. Check its permissions and try again.
chinesesimplified.CleanCarbRegistryFailed=无法删除注册表项 %1。请检查该项的权限后重试。
japanese.CleanCarbRegistryFailed=レジストリキー %1 を削除できませんでした。アクセス権を確認して再試行してください。
english.WriteUninstallTargetFailed=Setup could not write the Carb uninstall entry point.
chinesesimplified.WriteUninstallTargetFailed=安装程序无法写入 Carb 卸载入口。
japanese.WriteUninstallTargetFailed=Carb のアンインストール情報を書き込めませんでした。

[Messages]
english.ConfirmUninstall=Uninstall %1 and permanently delete its local settings, chats, credentials, and caches?
chinesesimplified.ConfirmUninstall=确定卸载 %1 并永久删除本地设置、会话、凭据和缓存吗？
japanese.ConfirmUninstall=%1 をアンインストールし、ローカルの設定、会話、認証情報、キャッシュを完全に削除しますか？

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; GroupDescription: "{cm:AdditionalShortcuts}"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\branding-manifest.json"
Type: files; Name: "{app}\japanese-native-patch-report.json"
Type: files; Name: "{app}\resources\default-skills\skills\design-taste-frontend\evals\evals.json"
Type: files; Name: "{app}\resources\app.asar.unpacked\node_modules\@harness\design-agent\references\library\README.md"
Type: files; Name: "{app}\resources\app.asar.unpacked\node_modules\@harness\design-agent\references\app-screens\README.md"

[Icons]
Name: "{autoprograms}\{#CarbShortcutName}"; Filename: "{app}\Carb.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Carb.exe"; AppUserModelID: "{#CarbAppUserModelId}"; Check: CanCreateCarbShortcut(ExpandConstant('{autoprograms}\{#CarbShortcutName}.lnk'))
Name: "{autodesktop}\{#CarbShortcutName}"; Filename: "{app}\Carb.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Carb.exe"; AppUserModelID: "{#CarbAppUserModelId}"; Tasks: desktopicon; Check: CanCreateCarbShortcut(ExpandConstant('{autodesktop}\{#CarbShortcutName}.lnk'))

[Run]
Filename: "{app}\Carb.exe"; Description: "{cm:LaunchCarb}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\uninstall-target.txt"
Type: dirifempty; Name: "{app}"

#include "Particles.iss"
#include "Uninstall.iss"
