# macOS 本地网络访问（Local Network）

桌面端连接局域网内的 OpenAI 兼容推理服务（如 `http://192.168.x.x:8080/v1`）受 macOS
Local Network 隐私策略约束。该策略由 NECP 在内核层执行：**未授权进程发出的私网 TCP
SYN 会被直接丢弃**，上层表现为 `connect EHOSTUNREACH`，连接根本无法建立。

## 规则

0. **归属权在打包层。** `NSLocalNetworkUsageDescription` 是唯一能让系统为该 bundle
   弹出授权框的声明；缺失该 key 时系统不提示、默认拒绝，且设置面板里也不出现条目。
   声明必须在签名前写入，否则签名哈希与 plist 不一致。
1. **声明必须覆盖发起连接的进程身份。** Local Network 按发起连接进程的签名身份归因
   （日志 `LocalNetwork: found bundle id …`）。打包态 agent 由
   `ELECTRON_RUN_AS_NODE` 的 Helper 进程执行，归因在
   `Contents/Frameworks/<Product> Helper*.app` 的 bundle id 上，而不是主 app。
   因此主 app 与全部 Helper 子 bundle 的 `Info.plist` 都必须声明。
   - 打包态：`electron-builder.config.js` 的 `mac.extendInfo` 写主 app；
     `afterPack` 钩子调 `patchMacBundleLocalNetworkUsage` 补齐 Helper 子包
     （electron-builder 没有 Helper plist 的配置入口）。
   - Dev 态：`devElectronAppBundle.mjs` 在复制 raw Electron 副本时同样对主包 +
     Helper 子包声明（Helper 保留 `com.github.Electron` 身份，归因不变）。
2. **授权对话框文案**统一由 `macosLocalNetworkUsageDescription(productName)` 生成，
   跟随产品名，不硬编码。

## 失败语义

- 授权被拒 / 未授权：内核对私网目标 `EHOSTUNREACH`（errno 65，`reason: NECP`），
  与「目标主机离线」在协议层无法区分。诊断以内核日志
  `tcp drop outgoing … reason: NECP` + `UserEventAgent LocalNetwork` 归因为准，
  而不是以 curl 等终端进程可达性为准（终端进程的授权身份不同）。
- 公网连接不受该策略影响；只有私网地址（RFC1918、链路本地、`.local` 等）会被检查。
- ad-hoc 签名（本地未开 `ZCODE_ENABLE_MAC_SIGN`）时 bundle id 本身可作为
  Local Network 身份，但每次重签 cdhash 变化，授权可能不持久；正式发布必须用
  Developer ID 稳定签名。

## 验证

1. 打包后检查：`plutil -extract NSLocalNetworkUsageDescription raw` 对主 app 与全部
   `Contents/Frameworks/*.app/Contents/Info.plist` 均应有值。
2. 功能验证：在「系统设置 → 隐私与安全性 → 本地网络」重置后，向局域网推理服务发送
   真实 prompt，应出现系统授权框；允许后请求成功（不再是 `EHOSTUNREACH`）。
