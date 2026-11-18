# Carb 云端工作台

在 [Carb 网页工作台](https://houpac.top/workbench/?view=terminal) 的「终端」中可以使用 E2B，也可以用自己的 GitHub 账号启动 Codespace。两种方式都在独立 Linux 环境执行命令。

## E2B

在「终端」输入自己的 E2B API 密钥，启动一次最长 15 分钟的会话。密钥只由浏览器用于请求 E2B。需要处理工作台项目里的文件时，点「上传项目文件」。结束会话前可按项目相对路径下载成果。

## GitHub Codespaces

从工作台点「启动 GitHub 云工作区」，使用 Carb 云端工作台配置创建 Codespace。GitHub 会转发 4180 端口。保持端口为 `Private`，在 Codespaces 的终端中打开 `Carb cloud workbench:` 后的专用链接。连接码在链接的片段中，页面读取后将它从地址栏移除。请勿分享该链接。

如果没有看到专用链接，可以在 Codespaces 的终端运行 `bash cloud-workbench/start-codespace.sh`。如果端口还未转发，在 Ports 面板添加 4180 并保持 `Private`。此模式的工作目录是 Codespace 的仓库目录，关闭网页终端后可以重新连接，Codespace 本身由 GitHub 管理。

服务器只为单用户 Codespace 和明确启用的本机测试提供终端。每次启动生成独立连接码，WebSocket 校验页面来源，终端退出后关闭连接。

## CLI 与 MCP

- 在终端的 shell 提示符处选择 Codex CLI 或 Claude Code 后点「启动 CLI」。首次启动按需下载客户端，请使用对应服务商的账号或密钥登录。云端 Linux 与 Windows 的本机命令和路径有所不同。
- 侧栏的「MCP」支持可跨域访问的 HTTPS Streamable HTTP MCP 服务，以及可选 Bearer 令牌。可直接测试工具，或者在对话里逐次授权模型调用。CLI 自带的 MCP 设置可在云端终端内使用。
- 代码和文件在你选用的云环境中处理。E2B 和 GitHub Codespaces 分别使用你的账号配额。
