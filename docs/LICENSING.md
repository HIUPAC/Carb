# 许可证、上游归属与再分发

本文说明 Carb GitHub 仓库及其对应 **Carb 5.6.13 Windows x64** 发行包的许可来源。整理日期：2026-11-17。

## 1. 主程序与 TasteCode 上游

仓库顶层 [LICENSE](../LICENSE) 从当前发行包的 `resources/LICENSE` 原样复制，内容为 **Apache License 2.0**。顶层 [NOTICE](../NOTICE) 同样保留发行包中的原始署名：Carb 基于 TasteCode，并保留 `Copyright 2026 TasteCode contributors`。

Apache-2.0 是主程序所继承的许可入口，不会替换第三方组件、字体、技能、商业 SDK 或其他带有独立声明的内容的许可。已有文件中的版权、归属和许可声明继续适用；本仓库整理许可证不构成对第三方权利的重新分配。

修改或再分发 Apache-2.0 覆盖的内容时，应遵守该许可证，包括附带许可副本、保留适用的署名与 NOTICE、对修改文件作出明确说明。该许可证不授予上游商标使用权。

## 2. 第三方组件与完整许可文本

下列材料来自当前发行包。许可证正文保留原文；顶层第三方清单中的本地许可路径已按仓库目录调整。

| 仓库路径 | 对应发行包内容 |
| --- | --- |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | `resources/THIRD_PARTY_NOTICES.md`，依赖与上游材料清单 |
| [THIRD_PARTY_LICENSES.txt](../THIRD_PARTY_LICENSES.txt) | `resources/THIRD_PARTY_LICENSES.txt`，汇总许可正文 |
| [licenses/third-party/](../licenses/third-party/) | `resources/licenses/`，已随包保存的逐项许可及依赖清单 |
| [运行时依赖清单](../licenses/third-party/direct-runtime-dependencies.json) | 原 `resources/licenses/direct-runtime-dependencies.json` |
| [Electron 许可](../licenses/third-party/LICENSE.electron.txt) | 发行包根目录 `LICENSE.electron.txt` |
| [Chromium 许可](../licenses/third-party/LICENSES.chromium.html) | 发行包根目录 `LICENSES.chromium.html` |
| [技能许可副本](../licenses/third-party/skills/) | `resources/default-skills/skills/` 中已有的 LICENSE、LICENSE.txt 与 NOTICE 文件 |

依赖清单记录的是继承的发行包清单，不能代替对后续版本新增或更新依赖的检查。其中涉及原上游工程的脚本、目录或历史来源标识，仍按原说明保留。

主要许可包括：

| 组件或资源 | 许可证／条款 |
| --- | --- |
| Electron、React、React DOM、xterm、node-pty、Tabler Icons、Shiki、KaTeX、ws、zod 等 | MIT |
| Streamdown、Pierre diffs、Codex 协议生成类型等 | Apache-2.0 |
| semver | ISC |
| 部分传递依赖，例如 Electron extract-zip | BSD-2-Clause |
| Geist、Geist Mono、Inter、JetBrains Mono 字体 | SIL Open Font License 1.1（OFL-1.1） |
| Chromium 及其组件 | 逐项许可，见完整 Chromium 声明 |
| Claude Agent SDK | Anthropic 商业条款，见下节 |

MIT、ISC、BSD 组件分别保留其版权声明、许可文本及适用条款。随包字体继续遵循 OFL；修改字体或再分发字体文件时还需遵守相应字体名称等限制。OFL 不会自动要求使用这些字体制作的文档也采用 OFL。软件界面提供的本机中文字体选项，不代表项目获得了微软雅黑、宋体、苹方等系统字体的再分发权。

## 3. Claude Agent SDK 与外部服务

`@anthropic-ai/claude-agent-sdk` 在原清单中标记为 `LicenseRef-Anthropic-Commercial-Terms`。其随包声明为 Anthropic 保留权利，使用受相应法律协议约束；**这不是开源许可证**，不能把它重新标注为 MIT 或 Apache-2.0。

原始声明保存在 [THIRD_PARTY_LICENSES.txt](../THIRD_PARTY_LICENSES.txt) 的对应 SDK 条目，条款入口为 [Anthropic 法律与合规文档](https://code.claude.com/docs/en/legal-and-compliance)。外部模型、API、CLI、账户、订阅及服务的使用同样受各服务商条款约束。

因此，不能把整个安装包描述成“所有组件均为开源”“所有内容统一采用 Apache-2.0／MIT”或“所有第三方组件均可不受限制地使用”。

## 4. 内置技能与附属资源

已发现独立许可的技能如下，正文已复制到 [licenses/third-party/skills/](../licenses/third-party/skills/)：

| 技能 | 已有声明 |
| --- | --- |
| `cinetic` | MIT |
| `design-taste-frontend` | MIT |
| `cook` | MIT |
| `ppt-master` | MIT，Copyright 2025–2026 Hugo He |

`ppt-master` 的部分 DrawingML 几何数据另有 Apache POI 的 Apache-2.0 声明和 Open XML SDK 的 MIT 声明。相关原始 [NOTICE](../licenses/third-party/skills/ppt-master/scripts/pptx_shapes/data/NOTICE.md) 及两个许可文件一并保留；技能主许可证不替换这些附属声明。

当前发行包中的 `image-recognition`、`voice-input`、`program-ui-design`、`request-optimizer`、`trae-programming`、`workbuddy-agent` 未发现独立许可证文件。不能仅因它们位于同一技能目录，就将其统一声明为 MIT，也不能从缺少独立声明推导出额外的再许可权利。发布或修改相关文件时，应按实际来源和权利人声明核对许可范围。

技能内的模板、图标、示例、字体、引用数据和其他素材仍以各自已有声明为准。这里保存已发现的许可文本，不代表为所有素材授予新的授权。

## 5. 原 Gitee 仓库的 MIT 声明

原 Gitee 仓库 `https://gitee.com/hiupac/card` 在核对时带有 `Copyright (c) 2026 冰轮` 的 MIT 声明。原文另存为 [licenses/gitee-repository-MIT.txt](../licenses/gitee-repository-MIT.txt)，以保留当时仓库已有文件的许可记录。

该 MIT 记录仅说明原 Gitee 仓库已有文件的原有声明，**不是本仓库、整个软件发行包或所有第三方内容的统一许可证**。在 Gitee 选择 MIT 不会重新许可 TasteCode 的 Apache-2.0 上游、第三方 SDK、字体或技能；本仓库保留各部分已有权利及义务。

## 6. 发布与后续维护

发布安装包时继续保留包内原有 LICENSE、NOTICE、第三方许可全文、Chromium 声明及技能附属声明。仓库中的副本方便查看，不能代替在分发文件中履行附带声明的要求。

后续新增或更新依赖、技能或素材时，应同步维护实际许可文本、来源和清单。上述内容依据当前文件整理，不等同于对所有第三方内容的全面许可审计。
