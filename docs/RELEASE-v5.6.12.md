# Carb 5.6.12 · Windows x64

Release 发布时间（北京时间 UTC+8）：**2026-11-17 11:55:16**。

Carb 是面向 AI 新手的桌面工作台，支持连接 API／CLI 模型、打开本地项目、处理文件、检查变更、使用终端并按任务扩展技能。

## 下载

| 文件 | 用途 | 大小 | 文件上传时间（北京时间 UTC+8） | 文件更新时间（北京时间 UTC+8） |
| --- | --- | --- | --- | --- |
| [Carb-Setup-5.6.12-win-x64.exe](https://github.com/HIUPAC/Carb/releases/download/v5.6.12/Carb-Setup-5.6.12-win-x64.exe) | 当前用户安装版，默认安装到 `%LocalAppData%\Programs\Carb` | 163,308,043 字节 | 2026-11-17 11:50:47 | 2026-11-17 11:54:06 |
| [Carb-Setup-5.6.12-win-x64.exe.sha256](https://github.com/HIUPAC/Carb/releases/download/v5.6.12/Carb-Setup-5.6.12-win-x64.exe.sha256) | 安装包 SHA-256 | 97 字节 | 2026-11-17 11:50:47 | 2026-11-17 11:50:47 |
| [Carb-Setup-5.6.12-win-x64.manifest.json](https://github.com/HIUPAC/Carb/releases/download/v5.6.12/Carb-Setup-5.6.12-win-x64.manifest.json) | 版本、签名状态及载荷文件摘要清单 | 3,185,238 字节 | 2026-11-17 11:50:47 | 2026-11-17 11:50:52 |
| [Carb-5.6.12-win-x64-portable.zip](https://github.com/HIUPAC/Carb/releases/download/v5.6.12/Carb-5.6.12-win-x64-portable.zip) | 同版本完整运行载荷，解压后运行 `Carb-5.6.12/Carb.exe` | 211,864,078 字节 | 2026-11-17 11:50:47 | 2026-11-17 11:54:30 |
| [Carb-5.6.12-win-x64-portable.zip.sha256](https://github.com/HIUPAC/Carb/releases/download/v5.6.12/Carb-5.6.12-win-x64-portable.zip.sha256) | 便携包 SHA-256 | 100 字节 | 2026-11-17 11:50:47 | 2026-11-17 11:50:47 |

所有可运行软件及校验附件均在 [v5.6.12 Release](https://github.com/HIUPAC/Carb/releases/tag/v5.6.12) 展示。上表时间来自 GitHub Release 附件 `created_at` 与 `updated_at`，均换算为北京时间；它们分别表示上传记录创建时间和文件记录最后更新时间。

安装包 SHA-256：

```text
4da826fb0b947001036ba07ad1ed32fecd92caf04cb8ed958fbca57d5cbdb0b8
```

便携包 SHA-256：

```text
d1795b8e4ba71882c597dc1d02c44c08deb9b04c36a5ceadbf16080a2ec97878
```

安装包和运行载荷未经数字签名。更新前请退出 Carb 并备份重要资料；**卸载安装版会永久删除默认本地设置、会话、凭据和缓存**。便携包仍使用默认的用户资料路径，不是完全自包含的用户资料模式。

## 本版内容

此版本首次在本 GitHub 仓库整理发布。发行内容包括 API／CLI 模型连接、本地项目与对话、文件查看与变更审查、终端、10 个内置技能、本地技能导入、维护代码与发布资源快照。该说明记录本仓库首次发布的内容，不能视为相对更早版本的全部新增功能。

## 发行范围

本次仅发布 Windows x64。API／CLI 模型服务、额度和相关任务工具需要另行配置。技能是工作流与工具指导，不是附带的大模型。

仓库同时提供当前维护覆盖代码、发布 JavaScript／资源快照、10 个内置技能、安装器及完整随包许可材料。当前没有完整原始 TS／TSX 工程；从 GitHub 自动生成的 Source code 压缩包不会包含 Electron 运行时。

主程序继承 Apache-2.0 并保留 TasteCode NOTICE；第三方组件、技能和商业 SDK 遵循各自条款，见仓库 README 及 `docs/LICENSING.md`。

## 已完成的验证

- 当前安装包 SHA-256 与现有 manifest 和校验文件一致。
- 14,099 个导出快照文件逐个核对字节数与 SHA-256。
- 文档本地链接、许可材料和发行清单完整性检查通过。
- 便携包校验与载荷准备脚本经本地解压验证。

这些检查不代替模型任务、完整安装流程及 Office 成果的内容与排版验收。

## 版本记录

| 版本 | Release 发布时间（北京时间 UTC+8） | 该版本修改内容 | 安装包与完整便携包 |
| --- | --- | --- | --- |
| 5.6.13 | 以 GitHub Release 页面时间为准 | 设置新增「联系我们」「检查更新」网页按钮，支持中／日／英与失败地址提示；更新发行快照与校验资料，统一 Release 下载入口并记录附件上传时间 | [全部附件](https://github.com/HIUPAC/Carb/releases/tag/v5.6.13) |
| 5.6.12 | 2026-11-17 11:55:16 | 首次在本仓库整理发布 Windows x64 安装包、完整便携包、维护快照与许可材料 | [全部附件](https://github.com/HIUPAC/Carb/releases/tag/v5.6.12) |
