# 准备运行环境与维护构建

本仓库发布 Carb 5.6.13 的应用快照、维护覆盖代码、品牌资源和打包工具。仓库包含从当前应用整理的 JavaScript／资源，不是完整的原始 TypeScript 工程；不能据此保证通过 `npm install`、`npm run dev` 或 `npm run build` 复现原工程。

应用快照分为 `app/asar`（归档中的主程序与 `@harness` 业务代码）和 `app/resources`（Web、内置技能等资源）。其范围与文件指纹见 `app/README.md` 及 `app/snapshot-manifest.json`。

普通使用可下载安装版；需要在仓库旁准备完整可运行环境时，使用下面的便携载荷准备脚本。该脚本取得已经发布的应用载荷，不执行源码编译。

## 从仓库准备并运行 Windows 版

需要 Windows x64、Git 和 PowerShell 7。准备脚本本身不需要 Node.js、Python 或 Inno Setup；模型连接及任务工具仍须按实际使用另行配置。

```powershell
git clone https://github.com/HIUPAC/Carb.git
Set-Location .\Carb
pwsh -File .\scripts\prepare-payload.ps1
```

脚本读取 `release/windows-x64.json` 中的版本、便携 ZIP 文件名、官方 GitHub 资产地址和 SHA-256。当前对应：

```text
https://github.com/HIUPAC/Carb/releases
Carb-5.6.13-win-x64-portable.zip
```

打开 GitHub Releases 后，选择 5.6.13 并下载对应 ZIP。也可以将已下载的 ZIP 路径传给脚本；使用此方式不会再次下载载荷：

```powershell
pwsh -File .\scripts\prepare-payload.ps1 `
  -ArchivePath C:\Downloads\Carb-5.6.13-win-x64-portable.zip
```

脚本先比对 SHA-256，通过后检查 ZIP 内容，再在仓库 `.build/` 下解压。ZIP 的顶层目录应为 `Carb-5.6.13`；准备完成后的入口为：

```powershell
& .\.build\Carb-5.6.13\Carb.exe
```

脚本不会启动应用、执行安装向导、覆盖已有目标目录或修改输入 ZIP。目标目录已经存在时会停止；先退出运行中的 Carb，再将该目录改名保存，或使用新的仓库目录重新准备。下载或校验失败时应检查 Release 附件、网络和清单，不应绕过摘要检查。

这里的“便携载荷”指无需安装向导即可从文件夹启动，不表示用户资料都写在该文件夹。桌面资料默认仍位于 `%APPDATA%\CarbData`；具体配置与备份方式见根目录 README。

## 修改代码与应用快照的关系

`.build/Carb-5.6.13/` 是独立的已发布运行载荷。编辑仓库中的快照或 `carb-work/overlay` 不会自动更新这个运行目录。

Electron 主程序与后端的大量代码位于 `resources/app.asar`，部分原生模块位于 `resources/app.asar.unpacked`，前端文件位于 `resources/web`。ASAR 成员及 Windows 可执行文件之间存在完整性校验。修改归档内容时，需要正确重建 ASAR 成员摘要及归档摘要，并同步更新 EXE 中相关完整性资源；直接把修改后的 JavaScript 复制进目录不能视为完成打包。

新增或修改前端资源还需要检查入口文件、导入关系和资源路径。原生模块必须匹配 Electron 版本、操作系统和架构。完成变更后应重新验证功能、成果交付和许可文件，再产生新的发布包、SHA-256 及发行清单。不要把当前官方载荷的摘要继续用于修改后的文件。

准备脚本只接受发行清单中的官方资产和摘要，不承担开发构建、热更新或将修改应用到载荷的功能。

## `carb-work` 的旧基包维护流水线

`carb-work/tools/stage-carb.mjs` 保留的是当前维护所用的“指定基包 + 覆盖代码 + 品牌处理 + 验证 + 安装器”流程。它以 `Test-0.5.11-ux-enhancements` 为起点，并明确校验该基包产品名为 `Test`、版本为 `0.5.11`。当前 5.6.13 便携载荷不能直接替代这个旧基包。

只有具备完整基包及下列外部环境的维护者，才能在核对并迁移路径后使用这条流水线：

| 依赖 | 用途与当前限制 |
| --- | --- |
| 完整 `Test-0.5.11-ux-enhancements` 基包 | 需要 `Test.exe`、`resources/app.asar`、Electron 运行时、原生模块与完整资源；可用 `CARB_BASELINE` 指定位置 |
| `repack-test/tools/rebuild-asar-overlay.mjs` | 重建 ASAR 与 Windows EXE 资源；参考副本位于 `maintenance/rebuild-asar-overlay.mjs`，旧暂存脚本仍使用原本机绝对路径 |
| `pe-library`、`resedit` | PE 资源与品牌处理；旧脚本从 `D:/UIAgent/.../node_modules` 加载 |
| Inno Setup `ISCC.exe` | 编译 Windows 安装包；`Build-Carb.ps1` 支持 `-IsccPath` |
| 简体中文 Inno Setup 语言文件 | 仓库有副本，但旧打包脚本还会读取并比较 `D:/UIAgent/installer/ChineseSimplified.isl` |
| `repack-test/verification/onboarding-motion-0.5.11/backend-app` | 成果验收使用其中真实 API runtime 及 `sax`、`js-yaml`；这些路径仍需补齐或迁移 |
| `carb-work/verification/backend-app` | 部分功能检查依赖此处解包后的后端与依赖，不能用空目录代替 |
| Python 与 `python-pptx`、`python-docx`、`openpyxl` | 生成五格式验收中的 Office 文件；独立检查脚本另使用 Python 标准库 |
| Node.js、PowerShell | 运行暂存、变换、检查与安装包脚本；原维护机器核对版本为 Node.js 24.21.0、PowerShell 7.6.9，并非已验证的最低版本 |

旧工具仍有 `D:/TasteCode/...` 和 `D:/UIAgent/...` 等本机绝对路径。发布的准备脚本不调用这些工具，也不依赖这些路径。迁移旧流水线时，应逐一处理路径、依赖版本、基包来源及其许可，不能把执行顺序当作完整环境配置。

在**完整维护环境已经准备好且旧路径已经适配**的工作区根目录，原流程如下：

```powershell
# 可选：使用实际持有的、已确认兼容的旧基包。
$env:CARB_BASELINE = 'E:\CarbBuild\Test-0.5.11-ux-enhancements'

node .\carb-work\tools\stage-carb.mjs
node .\carb-work\tools\verify-carb-payload.mjs
node .\carb-work\tools\verify-artifact-workflow.mjs
node .\carb-work\tools\verify-release-artifacts.mjs
& .\carb-work\tools\Build-Carb.ps1
```

现有载荷存在时，暂存步骤要求显式使用 `--refresh`，旧载荷会保存至 `verification/payload-backups`。`CARB_PAYLOAD` 可指定载荷输出目录，但它必须是 `carb-work` 的直接子目录。

`Build-Carb.ps1` 支持 `-Version`、`-PayloadDirectory`、`-OutputDirectory`、`-IconFile` 和 `-IsccPath`。调用前仍需满足其语言资源与验收依赖；同名安装包已存在时会拒绝覆盖。打包前要求五格式成果验收成功，且验收记录、源码指纹与成果摘要保持一致。修改相关源文件后需要重新验收。

上述检查包含模拟模型回复与实际文件／工具执行，不代表已经测试所有真实模型服务，也不能替代最终的界面、安装和成果排版检查。

## macOS 工具状态

`carb-work/tools/build-mac.py` 为另一条打包工具，需要已暂存桌面载荷、固定版本 Electron 43.4.0 的 macOS x64／arm64 ZIP、指定版本原生模块包及 `rcodesign`。它不是本页 Windows 准备脚本的一部分。

已有 macOS 预览产物的版本与签名状态应按对应发行说明判断，不能从工具文件的存在推断当前 5.6.13 已有正式 macOS 发行或已通过 Apple 公证。
