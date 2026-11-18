# Carb 本机工作台

本机启动器使用你已安装或已解压的 Carb 5.6.13 Windows x64 发行包，在浏览器打开同一套工作台界面，并连接实际的 Carb 本机核心。适合在浏览器中打开电脑项目、连接模型或独立 CLI、查看文件和 Git 变更、使用技能或运行终端。

## 启动

需要 Windows x64、Node.js 24 或更新版本，以及 Carb 5.6.13 Windows x64 安装版或便携版。安装目录中应有 `resources/app.asar`、`resources/app.asar.unpacked` 和 `resources/web`。可从 [Carb Releases](https://github.com/HIUPAC/Carb/releases) 获取发行包。

从 [Carb 仓库下载源码 ZIP](https://github.com/HIUPAC/Carb/archive/refs/heads/main.zip) 并解压。在解压后仓库根目录打开 PowerShell，再运行下列命令，将 `--payload` 后的路径换成实际安装或解压位置。

```powershell
node .\scripts\web-workbench\start.mjs --payload "C:\Apps\Carb-5.6.13"
```

打开终端输出的完整访问链接。链接仅供本机使用，请勿转发。浏览器可直接输入项目的完整本机路径，比如 `C:\Projects\my-app`。连接模型和 CLI 使用各自的凭据，项目操作由 Carb 核心处理。退出时，在启动器窗口按 `Ctrl+C`。

浏览器模式默认把项目记录、对话和配置保存在 `%LOCALAPPDATA%\Carb\BrowserWorkbench`，可用 `--data-dir` 指定独立目录。页面服务使用本机 `127.0.0.1:16482`。如果端口已占用，可加上 `--port 16483` 换用其他端口。已有桌面版应用包无需改动，项目文件位于你选择的目录。

## 桌面系统集成

浏览器使用自身的窗口、剪贴板和文件选择行为。依赖 Electron 的系统文件选择框、Explorer 定位、嵌入式浏览器捕获、应用更新、窗口材质和系统通知在本机浏览器模式中可能不可用。桌面端的原生功能通过 Carb 桌面应用使用。
