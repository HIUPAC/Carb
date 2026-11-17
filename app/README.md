# Carb 5.6.13 发布代码快照

本目录保存 Carb 5.6.13 Windows 发行载荷中的应用 JavaScript、界面资源与内置技能，供阅读、审查和维护。它是发布代码快照，**不是原作者的 TypeScript / TSX 源码工程**；未提供原始工作区、完整构建配置、源映射或上游根锁文件。压缩后的界面分块按发行原样保留，不能据此承诺运行 npm install 后直接编译整个应用。

| 路径 | 来源与范围 |
| --- | --- |
| asar/package.json、asar/dist、asar/assets | resources/app.asar 中相同路径的原样成员 |
| asar/node_modules/@harness | 同一 ASAR 内的应用业务包；不含其他第三方 node_modules |
| resources/web | 当前发行包的完整 Web 界面资源 |
| resources/default-skills | 当前发行包的完整内置技能资源，排除 Python 缓存 |
| snapshot-manifest.json | 每个导出文件的字节数、SHA-256 与逻辑来源，以及原 ASAR 的摘要 |

ASAR 将部分设计参考资源放在 app.asar.unpacked。本快照补齐其中的两个文本文件，目标路径仍在 asar 下：

- node_modules/@harness/design-agent/references/library/catalog.json
- node_modules/@harness/design-agent/references/library/style-profiles.json

它们的来源为 resources/app.asar.unpacked 中的对应路径。另有 316 个外置参考图像不在此代码导出范围；其完整资源由 Release 的运行载荷提供。ASAR 内原本已打包的参考资源仍按原样保留。

本快照不包含 Electron 运行时、原生绑定或其他第三方 node_modules。应用使用的 Claude Agent SDK 等商业 SDK 实现未复制到本目录；适配器中的依赖声明和导入仍保持原样。这些依赖不因被应用引用而获得本仓库的开源许可，使用时应遵循各自条款。运行应用请使用 Release 的完整运行载荷；恢复依赖或改造构建流程时，应匹配该版本的依赖和平台。

保留现有版权声明、上游包名、NOTICE 与各技能及素材自身的许可说明。@harness 是既有业务包的兼容命名空间，不能仅通过改名或复制重新归属。修改和再分发时请同时核对仓库根目录的许可、第三方声明，以及目标文件或资源所附的独立条款；本 README 不为第三方代码、字体、图像或声音重新授权。

完整性验证以 snapshot-manifest.json 的 files 为准：每条 path 均相对本目录，source 为相对发行包的逻辑来源，未包含本机绝对路径。清单仅包含发行包中的原始快照文件，不包含本 README 或清单文件本身。原 ASAR 摘要用于核对快照所对应的发行归档；单个导出文件可按其 SHA-256 独立核对。
