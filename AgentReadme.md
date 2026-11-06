# AgentReadme

> 面向后续 AI Agent 的快速上手指南。读完本文即可理解本项目的目标、架构、关键机制与已踩过的坑，避免重复调查。

---

## 1. 项目是什么

**Huarnessy** 是一个用 **Electron + React 从零编写的 opencode 图形客户端**。

- 不修改开放源代码内核，而是把官方 `opencode` 作为**本地 HTTP/SSE 服务**拉起（`opencode serve`），前端通过双版本适配器使用对应官方 SDK 与 SSE 和内核交互。
- 定位是 **WebUI 外壳**：内核负责会话/模型/工具执行，外壳负责界面与流式展示。
- 视觉风格为「液态玻璃」（窗口内部 CSS `backdrop-filter`，不穿透桌面、不依赖 Win32/DWM）。
- 主窗口启用透明无边框（`transparent: true`、`backgroundColor: '#00000000'`、`hasShadow: false`），由渲染层的 `.hui-window-shell` 绘制 20px 圆角轮廓；最大化/全屏时经 `window:state` 去掉圆角。不要改回不透明窗口底色：DWM 会保留固定圆角和 1px 亮边，窗口拖到不同 DPI 的副屏后两侧会出现白边。
- 侧栏与聊天区外层面板使用固定的毛玻璃；顶部「设置 → 对话气泡折射」控制用户消息、等待气泡及助手步骤/回复气泡的实验性曲面折射，偏好保存在 `hui.liquidGlass`，默认关闭。`LiquidGlass.tsx` 按每个气泡的尺寸与圆角生成 PNG 置换图：边缘折射带按短边约 16% 计算，位移在带的内外边界归零、中段最强；RGB 三次采样产生真实背景色散，采样位移随折射带厚度缩放，避免短气泡出现过强的彩边。镜面反光由曲面法线生成，只占折射带靠外的一小段，强度低于最初的大面板版本。尺寸变化经 ResizeObserver 防抖后更新，置换图的宽、高分别上限 384px，使很长的回复不会把横向圆角压成几像素。SVG 滤镜 URL 必须以内联样式引用，确保生产构建的独立 CSS 文件不会把片段标识相对自身解析。**主聊天框自身不能再有 `backdrop-filter`**：它会成为后代气泡的 Backdrop Root，挡住框外壁纸。现在毛玻璃由主框的第一个子元素 `.hui-chat-pane-backdrop` 绘制，消息滚动区与输入区作为其上方的兄弟层；侧栏仍直接模糊。模糊滤镜以内联样式声明，以免生产版计算结果为 `none`。`npm run test:stream -- --production --screenshot --visual-only` 会在 `out/` 生成带运行编号的普通背景与斜线背景对照截图，后者暂时撤除主面板模糊以凸显气泡的折射；视觉检查与完整流式测试应分别执行。
- 气泡顶部的位移向**气泡内侧**取样。若沿外法线取样，靠近聊天框顶部的气泡会把框的边线拉进折射带，形成一条不相关的彩弧。液态气泡的实体浅色描边和内侧亮线也已移除，只保留较弱的法线反光；否则平滑渐变背景下，描边比真实像素位移更显眼。`scripts/reply-ui-regressions.cjs` 会检查置换图上沿的纵向通道确实指向内部。平滑纯渐变缺少高频纹理，实际几何位移的可见性天然低于有线条/文字的背景；不能靠固定彩色边线假装它发生了明显折射。

### 用户意图（核心诉求，务必遵守）

1. **真・中断式流式**：内核每吐出一个分组（delta），界面必须**立即渲染**。
   - **通常拒绝人工平滑、打字机和蓄意延迟**。唯一例外：等待气泡展开后，允许将动画期间积攒的首批文字在不超过 0.75 秒内轻微带出；追上后必须直接按真实 SSE 增量显示。
   - 曾误加过全程平滑层，被用户否决并移除；不要把首批文字过渡扩展成全程播放队列。
2. 流式过程中要能实时渲染 **Markdown / LaTeX（KaTeX）/ 代码高亮**。
3. 交互体验要与「opencode 官方 GUI」一样丝滑（ms 级、逐 token 观感）。

### 界面空间层级（用户明确约定）

整个界面从下到上按以下空间关系组织。这是设计约束，不是对当前 CSS 已完全符合的描述：

| 层级 | 内容 |
|---|---|
| 1（最底层） | 背景：流动的光 |
| 2 | 左侧会话列表底板、右侧聊天底板 |
| 3 | 聊天底板上的气泡，包括消息、步骤与工具气泡 |
| 4 | 底板与气泡上的内容，包括文字、代码、按钮、小提示图标及其展开的生成详情玻璃 |
| 5（前景） | 输入框及其操作控件 |

- **输入框始终高于聊天底板上的全部子内容。** 气泡、代码、工具内容、生成详情玻璃等与输入框重叠时，应由输入框覆盖；在悬停、展开、收回、滚动和生成期间也必须保持这一关系。
- 生成详情玻璃是气泡局部内容的延伸，不能因为通过 portal 挂到 `document.body`，就变成高于输入框的全局浮层。Portal 用于定位、避免裁切与毛玻璃取样，不改变元素的空间归属。
- 分层应同时体现在视觉遮挡、玻璃取样和鼠标命中上。输入框应能采样其下方滚过的聊天内容，重叠处不能被聊天详情遮挡或拦截操作。实现时检查完整 stacking context，不能只比较不同上下文里的局部 `z-index` 数字。
- 实现约定：聊天内容、body 上的详情 portal、输入区分别使用共享的 `--hui-layer-chat-content`、`--hui-layer-chat-details`、`--hui-layer-composer`（1 / 2 / 3）。聊天底板不创建隔离输入区的独立 stacking context，确保 portal 与输入框在同一文档层级中可比较；详情玻璃始终位于输入框下方。不要重新给聊天详情设置脱离这套约定的全局高 z-index。

> 旧调查结论仅作背景；应以当前代码与可复现的性能测量判断瓶颈。详见第 5 节。

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 41 |
| 构建 | electron-vite 5（Vite 7） |
| UI | React 19 + TypeScript 7 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） |
| 界面字体 | 本地打包的 Noto Sans SC Variable（SIL OFL 1.1；授权副本在 `src/renderer/public/licenses/`） |
| Markdown | Worker 中的 `unified` + `remark-parse` + `remark-gfm` + `remark-math` + `remark-rehype` + `rehype-stringify`；`react-markdown` 提供安全 URL 转换 |
| 高亮/公式 | `highlight.js`、`katex` |
| 内核通信 | 1.x：`@opencode-ai/sdk/client` + EventSource；2.x：`@opencode/client@2.0.32` + 鉴权 SSE |

---

## 3. 目录结构

```
Huarnessy/
├─ electron.vite.config.ts     # electron-vite 配置（@ 别名、React、Tailwind 插件）
├─ tsconfig.json               # TS 配置（ES2022 / Bundler / react-jsx / paths:@）
├─ package.json                # 脚本：dev / build / preview / typecheck / test:stream / test:workspace
├─ .vscode/launch.json         # F5 调试（Main / Renderer / 复合 Debug All）
├─ scripts/
│  ├─ stream-benchmark.mjs     # 启动开发服务器或生产页面及 Electron 测试进程
│  ├─ stream-benchmark.cjs     # 流式性能测量与显示/事件/滚动回归断言
│  ├─ stream-benchmark-preload.cjs # 页面加载前注入假内核，无真实模型请求
│  ├─ composer-regressions.cjs # 输入区附件、伸缩、选择面板及 Question 回归
│  ├─ workspace-regressions.cjs # 工作空间切换、目录作用域及迟到请求回归
│  ├─ workspace-store.test.mjs # 工作空间持久化、路径验证与目录比较测试
│  └─ kernel-launch.test.mjs  # 内核二进制解析优先级与未安装时的回退验证
└─ src/
   ├─ main/
   │  ├─ index.ts              # Electron 主进程：创建无边框窗口、IPC、调试端口开关
   │  ├─ opencode-server.ts    # 内核生命周期：选端口、净化 env、spawn、健康检查
   │  └─ workspace.ts         # 工作空间路径验证、持久化和启动回退
   ├─ preload/
   │  └─ index.ts              # contextBridge 暴露 window.api
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ main.tsx           # 挂载 + 引入 katex/highlight 的 CSS
         ├─ App.tsx            # 全部界面与事件处理（核心文件）
         ├─ SessionContextMenu.tsx # 会话右键菜单、定位、关闭与焦点管理
         ├─ workspace-path.ts # 工作空间目录精确比较，兼容 Windows 大小写与斜杠
         ├─ stream-state.ts   # 按 SSE 顺序归并消息事件
         ├─ StreamingMarkdown.tsx # 即时文本展示、格式化调度与 DOM 复用
         ├─ markdown.worker.ts # Markdown / KaTeX / 高亮计算与有界缓存
         ├─ markdown-types.ts  # Worker 请求、响应与渲染片段的数据类型
         ├─ styles.css         # 液态玻璃 + .hui-md Markdown 样式
         ├─ env.d.ts           # window.api 类型声明
         └─ assets.d.ts        # 静态资源类型
```

**进程分工**

- **Main**：拉起/回收内核、创建窗口、IPC 转发、原生工作空间文件夹选择与本地设置保存。
- **Preload**：`contextBridge` 暴露 `getWorkspacePath / chooseWorkspacePath / getServerInfo / restartServer / onServerStatus / window.{minimize,maximize,close}`。
- **Renderer**：直接连接本地内核的 REST 与 SSE，管理消息状态、交互和 DOM 更新。
- **Markdown Worker**：承担 Markdown 解析、公式排版、代码高亮与格式化缓存，不负责消息接收或发送。

---

## 4. 运行 / 调试 / 构建

```bash
npm install
npm run dev          # 开发（HMR）
npm run typecheck    # tsc --noEmit
npm run build        # 生产构建（out/）
npm run preview      # 运行生产构建
npm run app          # 从 out/ 的独立快照启动，不监听源码（用于“用它改本项目”）
npm run app:build    # 先构建再按快照启动
npm run test:stream  # 假内核驱动的 Electron 流式性能与功能回归
npm run test:workspace # 工作空间设置与目录隔离的单元验证
npm run test:kernel    # 内核二进制解析与启动失败分类的单元验证
npm run package:release # 构建并组装 release/Huarnessy-v<版本>-win-x64 便携发行版
```

便携发行包仅包含 `out/main`、`out/preload` 和 `out/renderer`，避免把测试日志、截图等构建目录临时文件带入发行包；根目录附带 `RELEASE_NOTES.md`。当前发行版本为 v0.2.0。

- `npm run dev` 会监听 `src/`：改渲染层触发 HMR 重载、改主进程直接重启 Electron。若正用该窗口与本项目对话，源码改动会打断当前窗口。需要一边改源码一边保持对话窗口存活时，用 `npm run app`（或 `npm run app:build`）：`scripts/run-standalone.mjs` 把 `out/` 拷贝到仓库外的稳定目录（Windows 为 `%LOCALAPPDATA%\Huarnessy\standalone`）再启动，之后 `npm run build` 覆盖仓库内 `out/` 不会影响运行中的实例。该快照仍是独立进程，带自己的 `opencode serve` 内核，与 VSCode 内的 opencode 实例互不影响。要看到新的源码改动，需重新执行 `npm run app:build` 并接受新窗口替换旧窗口。

- **VSCode 调试**：F5 → `Debug All`（Main 用 node 调试、Renderer 用 chrome 9222 attach）。
  `Debug Main Process` 已注入 `REMOTE_DEBUGGING_PORT=9222`；`src/main/index.ts` 仅在该环境变量存在时开启远程调试端口（便于 CDP 自动化排查）。
- 若安装 Electron 缓慢，可用镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

---

## 5. 流式渲染设计（2026-10-06 修订）

### 数据流
`opencode serve` → 版本适配器（1.x `/event`、2.x `/api/event`）→ 统一有序消息事件队列 → 每帧提交 React 状态 → 立即显示新文本。
Markdown / KaTeX / 高亮由独立 Worker 计算；格式化结果在下一绘制帧应用，期间新增文本始终可见。

### 已验证的问题

旧实现只用空行切分 `splitStreaming()`。连续列表、表格、无空行长段落仍是一个不断增长的尾块，每次 delta 都在主线程完整执行 Markdown、公式、高亮，并且 ReactMarkdown 每次重新创建处理器、注册高亮语言。缓存已完成的段落不能覆盖这些输入。
另外，delta 推迟到 rAF 才提交，而 `message.part.updated` 快照直接提交，会颠倒 SSE 原始顺序，导致重复追加、回退；切换会话时未清理的 delta 还可能串入新会话。

本机 Electron 开发模式固定数据复现（80 条连续列表、5,660 字符、40 字符/批、4ms 发送间隔）：旧实现输出过程约 10.2s，前四分之一每批平均 19.1ms、后四分之一 114.1ms，83 次 >50ms 主线程长任务。此数据来自离线假内核，不受模型速度影响。不能仅以“dev 模式开销”解释该缺陷。

### 当前实现

1. `stream-state.ts` 对 delta、部件快照、消息元信息与删除事件按接收顺序归并。同帧只复制一次消息数组及受影响部件数组，保持未变化消息的引用。
2. 会话切换、连接清理时取消待提交事件。REST 返回结果检查会话代次及事件版本，避免覆盖更新中的 SSE 状态。
3. `StreamingMarkdown.tsx` 在通常流式阶段立即展示已收到的新文本；格式化尚未完成的后缀临时以原始文本显示，并在 `useLayoutEffect` 中接到当前段落、列表项或开放代码块的原位置，继承该处字体和行高。Worker 的 `tailKind` 指示续写位置；新段落使用独立文本块。首条回复在气泡展开后有一次有界短过渡，详见下文；后续没有打字机、字符播放队列或固定等待计时器。
4. `markdown.worker.ts` 在 Worker 中解析完整 Markdown，保留跨段引用链接、列表、表格语义；复用 unified 处理器及高亮器。未闭合围栏暂不高亮。
5. 段落、列表项、代码块的格式化结果使用有界缓存（最多 512 项、约 8,000,000 个序列化字符的预算）。旧列表项及表格行保留 DOM；跨 Worker 消息仅传变化的片段，已有片段通过 ID 复用。
6. 格式化请求最多一个执行中，每个部件只保留最新待执行快照；格式化结果每帧最多应用一次。格式化计算不阻塞文字显示，也不堆积历史快照。
7. 原始 HTML 保持转义；链接沿用 ReactMarkdown 的安全 URL 转换。渲染进程只插入本项目流水线生成的 HTML。
8. 自动吸底在 ResizeObserver 的布局后、绘制前阶段更新滚动位置，同时跟踪文字增长和异步排版，并区分用户滚动与排版引起的滚动事件。此处不再另排下一帧，避免先显示旧位置再跳到底部。助手气泡占满聊天滚动区的可用宽度，用户气泡仍限制在 82%，滚动区预留滚动条位置；普通消息表面不叠加第二层背景模糊，启用实验效果时仅气泡使用边缘折射。
9. Vite 使用 `worker` 导出条件，确保 Markdown 的字符实体解码不调用 `document`；预优化 Worker 依赖，避免第一次生成回复时触发依赖发现后的整页重载。

### 回归验证

```bash
npm run typecheck
npm run build
npm run test:stream                  # Electron + Vite 开发模式
npm run test:stream -- --large        # 约 1.7 万字列表、2 万字段落、近 3 万字符代码
npm run test:stream -- --production   # 直接加载 out/renderer/index.html，验证 file:// Worker
npm run test:stream -- --layout-only  # 只验证流式气泡尺寸、滚动与代码续写
```

测试内核为假的，不创建真实会话、不请求模型。覆盖流式列表/长段落/多段落/代码、公式、高亮、自动吸底，以及快照与 delta 顺序、删除、会话切换、引用链接、HTML 转义、安全 URL、未知代码语言。测试打印输出耗时、帧间隔、主线程长任务、前后段处理耗时；机器负载不同会改变数值，不应把一次测试当成所有输入的性能保证。

### 本次修复的验证结果（2026-10-06）

`typecheck`、`build`、开发模式常规测试、开发模式长回复压力测试、生产页面测试均已通过。生产测试直接在 Electron 中加载构建后的 `file://` 页面，包含 Worker 的实际加载过程。

同一份 80 条连续列表输入的开发模式对比：

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| 输出过程耗时 | 10,208ms | 1,047ms |
| 后四分之一每批平均耗时 | 114.1ms | 7.2ms |
| 主线程 >50ms 长任务 | 83 次 | 0 次 |
| 帧间隔第 95 百分位 | 133ms | 17ms |

长回复压力测试覆盖 17,300 字符列表、20,640 字符长段落、8,770 字符多段落和 28,818 字符代码。列表、多段落、代码未出现主线程长任务；长段落出现一次约 52ms 的长任务，说明浏览器布局仍有成本，不能宣称所有长度和格式下都绝无卡顿。

最终生产测试通过 13 项功能回归断言，除上述内容外，还覆盖嵌套代码围栏闭合前后高亮、用户向上滚动后保持位置、回到底部后恢复自动跟随。测试中的输出过程耗时包含发送计时器和末尾等待，不是单次解析耗时，也不是模型生成速度。

当前测试为离线假内核验证；真实模型的网络延迟、分组大小与生成速度未由这些数据证明。后续如遇不同输入的卡顿，应保留输入与运行模式，先运行同类复现并测量主线程长任务，再判断是否需要调整。

### 流式气泡抖动修复（2026-10-06）

先前将原始后缀放在已格式化段落外，Worker 返回后又把它合并到段落内。这会反复制造额外一行，再撤掉这一行；气泡随内容改变宽度，加上吸底推迟到下一绘制帧，会进一步放大高度和滚动位置的跳动。

固定输入的开发模式复现中，短回复宽度变化约 595px；文字持续追加时，气泡高度下降 6 次，滚动位置后退 6 次。修复后同类输入的宽度变化、高度下降、滚动后退均为 0；代码续写也验证了当前行、真实换行与空行不会被丢失或移位。这些断言已加入 `test:stream`，且可以单独通过 `--layout-only` 执行；`--record-layout` 只记录数据，不做布局断言，便于对比旧实现。

注意：未闭合代码围栏的 HTML 会补一个末尾换行。续写同一行时移除这个合成换行，已有源码换行则保留；Worker 替换宿主 DOM 后，在绘制前重新挂载纯文本后缀。不要把后缀重新放到段落外，也不要用固定高度或滚动动画掩盖排版跳动。标题、表格、公式等结构在真正形成时仍可能合理改变高度，测试针对的是无结构变化的连续文字反复收缩。

### 会话切换预渲染与 keep-alive（2026-11-05）

- `openSession` 对当前会话的重复点击直接返回（面板为空且空闲时仍作为打开失败后的重试路径），不再清空重拉历史。
- `sessionViews` 按会话缓存视图快照（LRU 上限 12）：消息、撤回边界、轮次 key、滚动位置与吸底状态。切换会话时先渲染缓存快照立即出内容，REST 历史在后台对账；内容相同则 memo 化的消息组件保持挂载不动。
- `SessionConversation`（`App.tsx`）把聊天滚动区、吸底观察器、输入框预留（`--hui-composer-reserve`）与收起滚动补偿（`CollapseScrollContext`）下沉为每会话一个实例。最近打开的 `KEEP_ALIVE_SESSIONS`（3）个会话保持挂载、用 `display:none` 隐藏：Worker 渲染的 Markdown DOM、步骤展开状态与 LiquidGlass 置换图全部保留，切回时零重渲染，只恢复滚动位置。
- 隐藏视图的观察器自行让位：吸底/滚动恢复的 ResizeObserver 在 `!active` 时跳过；`useLiquidGlassMap` 在零尺寸时跳过重建、显示后按真实尺寸重生成，无需额外开关。`display:none` 会重置 `scrollTop`，所以每会话滚动位置实时写入快照（`onScrollState`），重新显示时在布局效应中恢复；非吸底会话在 1.5 秒窗口内随 Worker 重排版的内容增长重新贴位。
- 发送时 `followNonce` 递增，让活动视图重新吸底；没有活动会话时渲染 `key="empty-pane"` 的空状态视图。删除会话与工作空间切换会清理对应缓存与 keep-alive 列表。
- 回归断言中"内容不得泄漏到当前会话"的查询必须限定 `.hui-chat-scroll[data-active="true"]`：keep-alive 下隐藏视图合法保留后台会话自己的 DOM（`stream-benchmark.cjs`、`reply-details-regressions.cjs` 已按此调整）。

### 回复等待与入场动效

- `ReplyPresentation.tsx` 在发送后显示紧凑的“等待回复”玻璃气泡，圆点通过 CSS 缩放、圆环、旋转和颜色变化呈现等待状态；收到用户消息回显前也能立即显示。
- `MessageView` 不为空正文、空思考或协议记账部件创建气泡。首条正文、思考、工具、文件或重试内容到来时，同一个气泡依次经历文字向左渐隐、宽度收至以圆环为中心的 38px 圆角方块、圆点消失、气泡展开承载正文。`ReplyPresentation` 根据 CSS 动画结束事件推进阶段，不另设定时器；后续 delta 不重新触发动效。
- 等待状态以当前一轮消息的可见内容判断，历史回复不能消除新请求的等待条。支持系统减少动态效果设置。错误、停止后的 idle、会话及工作空间切换会清理等待状态。
- `scripts/reply-ui-regressions.cjs` 随 `test:stream` 验证气泡同一 DOM 节点贯穿等待与正文、阶段顺序、空消息隐藏、首条思考过渡、后续增量不重放动画、下一轮等待及错误清理。测试使用假内核。
- 各轮用户消息及助手回复在 `App.tsx` 中保持固定的 React 父节点与稳定 key；新一轮发送不能把历史助手消息从当前回复容器移到另一容器，否则 Markdown Worker 生成的 DOM 会卸载重建并使页面跳动。发送前等待条也使用当前请求的稳定 key，以便用户消息回显后继续复用同一气泡。
- 展开阶段的玻璃气泡固定为 38px 高度，正文在宽度展开结束后才进入布局；否则正文在 38px 窄宽下先撑成高列，形成竖向玻璃残影。回归测试用长思考内容验证展开期间高度及上一轮 Markdown 节点的连续性。
- 气泡展开期间接收的文字继续保存在 SSE 消息状态中。展开结束后，`ReplyPresentation` 只对首批已收到的文本做一次最多 560ms 的逐帧追赶，并将期间新到的文字纳入当前追赶目标；总过渡低于用户要求的 0.75 秒。追上后撤掉可见字符上限，后续 SSE 文字立即按原速显示。仅影响本轮助手气泡，历史 Markdown 不重放。系统减少动态效果时跳过该过渡。
- 思考部件由 `ReasoningBlock`（`App.tsx`）渲染：原始文本超过 400 字符后自动折叠一次，并出现「思考」标题行（chevron + 展开/收起），手动展开/收起后不再被后续增量覆盖；短思考保持原样、无标题行。折叠态是**底部预览窗**而不是零高：`.hui-reasoning` 用 `max-height: 8.415em`（约 8–9 行）+ `justify-content: flex-end` 钉住最新几行，流式思考在预览底部实时滚动可见；顶部渐隐用注册属性 `--hui-reasoning-fade` 驱动的 `mask-image` 渐变淡出文字本身，不叠色块、不破坏毛玻璃底色。自动折叠必须从当前全高**动画收缩**到预览高：Chromium 无法插值 `max-height: none`，所以 `ReasoningBlock` 用 Web Animations 在实测的前后高度之间动画（420ms `cubic-bezier(.2,.85,.28,1)`），结束时交还给 CSS 值，不能瞬间跳变。折叠态子元素必须 `flex: none`，否则会被压进预览窗而不是向上溢出，最新行也就不会钉在底部；flex-end 的溢出在起始侧，`scrollHeight` 不计入，断言要看子元素自身高度。折叠不卸载 DOM，Markdown Worker 复用与流式显示不受影响；减少动态效果时过渡缩至 1ms。回归见 `scripts/reply-ui-regressions.cjs`（短思考无标题行、越阈自动折叠、中途高度介于全高与预览高之间、底部钉住最新行、旧行被裁在上方、手动展开/再收起）。
- 同一轮中的可见 assistant 消息按调用分组：只有工具调用、没有正文或思考的后续消息并入前一个步骤，工具卡片按原顺序留在其中；有正文、思考或其他可见内容的消息才新建步骤。当前最后一组保持普通回复气泡，不标为“步骤”；下一组出现可见内容后，上一组才变成自动折叠的“步骤 N”。步骤标题跨组内所有消息按工具类型汇总调用次数并沿用工具配色，收起时宽度随摘要内容变化；可手动重新展开，后续增量不会反复覆盖手动状态。分组以第一条消息 ID 作稳定 React key，折叠只隐藏内容，不卸载 Markdown DOM；加载历史时最后一组保持普通回复。
- 超长步骤列表由 `StepList` 做第二级收纳：每轮保留最近 4 个步骤独立显示，更早的步骤**滑动式**吸进摘要——第 6 步出现时 1–2 立刻收成“步骤 1–2”，之后每来一步就多吸一步（“步骤 1–3”……），不再等攒满 10 步才一次性折叠；摘要至少 2 步，单步不成组。区间按从第 1 步起封顶 10 步，尾部只剩 1 步时并入前一区间（允许“步骤 1–11”）而不是生成“步骤 N–N”的单步摘要，因此 15 步是“1–11”，16 步起变成“1–10”+“11–12”。摘要显示彩色工具调用总数。收起时摘要气泡底下露出两层浅卡片边；展开时摘要气泡本身保持原样，第一张卡片从摘要下方滑出，之后每张都从上一张卡片的位置向下滑至原位，位移按相邻卡片的实际间距测量，避免第 3 张之后出现断层。卡片始终保持较高不透明度，只做 110ms 的轻微透明度衔接；列表容器的高度裁剪负责逐步露出卡片，避免长时间淡入造成“凭空出现”。收起时卡片反向上滑，动画结束后卸载隐藏的步骤 DOM。展开旧区间会暂停自动吸底，避免标题被推出视口。打开区间后仍可逐步展开；新区间仅在用户跟随对话底部时自动形成，用户上滚查看历史时延后收纳，返回底部再更新。`scripts/step-range-regressions.cjs` 用 23 个假调用验证编号、摘要、展开、阅读历史时的稳定性和最终回复；`npm run test:stream -- --production --screenshot --step-preview-only` 输出收起、展开中途及完成后的截图用于视觉检查。
- Bash 工具卡片在 `state.status === 'running'` 时优先用 `state.input.command` 显示正在执行的命令；完成后的标题仍优先用内核提供的 `state.title`。运行中的 Bash / Web 卡片外缘由 `ToolBeam` 的 SVG 光带沿边框快速滚动，状态结束即停止。光带由亮核加多层嵌套、逐层更短更淡并整体做 `blur` 的尾迹组成，形成向尾部平滑衰减的彗星；`stroke-dasharray` 用测量到的周长（`--hui-perimeter`）闭环，长度取周长约 6%–18%（`--hui-beam` / `--hui-comet`，随气泡自适应），单圈时长 `0.0375*P^0.45`。系统要求减少动态效果时保留静态光边。
- Read 文件工具卡片在摘要中显示起始行；完成后优先根据 `state.metadata.display.lineStart/lineEnd` 显示实际读取行数，旧会话缺少该元数据时从带行号的输出统计，不能把输入的 `limit` 当成实际读取行数。目录、图片等没有文本行数的完成结果不显示行数。Edit 完成后优先使用 `state.metadata.filediff.additions/deletions` 显示新增和移除行数，旧结果只有 `diff` 时统计补丁的增删行；计数不可用时不显示虚构数字。
- 读取图片的 `read` 调用显示为 `PicRead`：`isImageRead()` 在 `state.attachments` 含 `image/*`、`metadata.mime/display.mime` 是图片、或 `input.filePath` 以图片扩展名结尾时判定，工具气泡标签与步骤摘要的计数都用 `PicRead`（步骤里 `PicRead` 与普通 `Read` 分开计数，但沿用 `read` 的配色）。标签文字用 `.hui-pic-read` 做左→右渐变：前半段是比 `--tool-accent`（Read 为 `#a9dbff`）略深的蓝 `#7cb6e6`，后半段完全回到 `#a9dbff`，中间过渡；用 `background-clip: text` + 透明填充实现。`scripts/reply-ui-regressions.cjs` 用假内核验证气泡标签与折叠步骤计数。
- 步骤展开和收起使用非线性的宽度与网格行高过渡，且两个方向错峰主导以贴合内容排版：展开时宽度先快速铺开（400ms `cubic-bezier(.16,.84,.24,1)`），网格行高随后大幅展开（560ms `cubic-bezier(.55,.05,.28,1)`）；收起时反过来，行高先大幅收缩（400ms `cubic-bezier(.2,.85,.28,1)`），宽度再收回（520ms `cubic-bezier(.55,.08,.3,1)`）。两者始终同时运行，只是曲线一个前重一个后重，形成 Apple 式的错峰非线性节奏，而非先后串行的两段动画。正文、思考及 ToolCall 随后渐显和轻微位移。折叠时内容保持在 DOM 中并设为不可聚焦，系统启用减少动态效果时将过渡缩至 1ms（选择器需覆盖 `[data-expanded='false']` 分支，否则更高优先级会漏掉）。不要恢复 `hidden` 切换，否则面板会瞬间跳变。
- `LiquidGlass` 的置换图按元素尺寸生成，尺寸变化后重新采样。展开/收起期间元素逐帧改变大小，若仍沿用旧的“等尺寸稳定后再更新”策略，折叠时的小图会被拉伸到变宽的盒子上，把低分辨率的边缘放大成锯齿。因此 `useLiquidGlassMap` 在 `ResizeObserver` 回调里用 `element.getAnimations()` 判断当前是否有过渡/动画：有则每帧刷新置换图，没有（如流式正文持续长高）则沿用尾随防抖，避免逐帧重算拖慢流式。映射图生成也做了优化（复用画布、安全内部区域早退、去掉 `Math.hypot`/多余 `Math.pow`）。`test:stream` 在步骤展开中途断言图宽高至少为元素的 60%，防止回退成拉伸折叠图。
- 折叠内容虽压至零高，仍可能参与 `fit-content` 的固有宽度计算；`.hui-call-reveal` 通过 `contain: inline-size` 隔离这部分宽度，让收起气泡及悬停区域只包住步骤标题和摘要。`test:stream` 验证最终宽度；`--screenshot` 生成正常与悬停的步骤截图供视觉核对。
- 展开后过长的步骤卡或压缩摘要卡，其标题栏会被推到屏幕外，需滚回顶部才能收起。因此在卡片底部（`.hui-call-reveal` 之后）放一个小小的圆形毛玻璃收起按钮 `.hui-call-foot > .hui-call-collapse`，仅在展开时渲染。折叠方向朝上，故按钮内复用 `.hui-call-chevron` 但用更高优先级规则覆盖成朝上（`rotate(-135deg)`），不受卡片 `[data-expanded='true']` 的朝下旋转影响。步骤卡与压缩卡都带此按钮。`test:stream` 断言展开时按钮可见、点击可折叠。
- 步骤卡/压缩卡高于一屏时，卡片顶部会滚出视口上方；此时收起会在极短时间内抽走视口上方的一大段高度，而 `.hui-chat-scroll` 设了 `overflow-anchor: none`（浏览器不自动补偿滚动），下方内容便猛地向上跳，像被「唰」地抽走。为此 `CallBlock` / `CompactionBlock` 的收起按钮通过 `CollapseScrollContext` 通知 `App`：`adjustScrollForCollapse` 在该卡片**顶部高于视口顶**且未吸底时启动 rAF 循环，逐帧读取卡片正在动画的高度，把滚动位置按已收缩量向上平移（`scrollTop = startTop - 已收缩量`），使下方内容在视口里保持不动，整轮收起读作一次平滑上滚。吸底（`stickBottom`）时交给既有的 `ResizeObserver` 跟随，卡顶仍在视口内时跳过（本就是原地折叠）。回归见 `scripts/collapse-scroll-regressions.cjs`（断言收起时滚动位置上移、且折叠前后下方标记位置几乎不变）。
- 步骤悬停仅提亮整个面板的边框，不在标题按钮内另画一层矩形背景；否则宽度展开时会出现双层高亮。展开和收起的内容透明度与尺寸过渡同步，避免中途出现大片空玻璃。`--screenshot` 也保存展开、收起约 130ms 的中途帧。
- `ReplyPresentation` 仍复用等待气泡完成入场动画；进入正文阶段后外层承托整轮回复的玻璃背景撤除，每条调用自己承载玻璃表面，避免所有步骤被一块大玻璃包住。
- 顶部“设置”中的“面板透明度”滑杆统一控制主面板、侧栏、输入框、消息气泡、步骤和工具调用的底色强度，默认 55%，保存于渲染进程的 `localStorage`（`hui.panelTransparency`）。当前回复和折叠步骤使用同一套玻璃底色、边框与阴影，透明度变化只影响面板底色，不改变文字透明度。
- 顶部“设置 → 背景”可切换深灰纯色、黑灰流动与深色底的彩色流动，保存在 `localStorage` 的 `hui.backgroundMode`，默认黑灰流动。彩色模式使用 GradFlow 的 WebGL `wave` 连续渐变；黑灰模式改由 `MottledBackground.tsx` 的多尺度值噪声与坐标扰动生成暗色斑驳纹理，不再使用会形成周期性横波的 `wave`。黑灰画布按窗口 65% 分辨率、约 25 FPS 绘制，暗部为近黑，亮部限于炭灰；纯色底色是 `#090a0d` 且不挂载画布。两个画布都在页面隐藏、不可见或系统减少动态效果时停止逐帧绘制。背景偏好与面板透明度独立，切换工作空间时保留。
- 顶部“设置 → 对话正文字号”滑杆即时调整 `.hui-md` 正文（13–20px，步长 0.5px，默认 15.5px），保存于 `localStorage` 的 `hui.chatFontSize`。Worker 将行内和行间公式里的 `\frac` 转成 `\dfrac`，并同步 remark-math 的渲染节点，让嵌套分式也使用清楚的展示样式。独占段落的公式改为左对齐的行间布局；嵌在文字中的公式仍保持行内。行间公式增加上下留白，避免分式被裁切。代码块保持自己的固定字体。`--screenshot` 的 `math-preview.png` 使用假内核复现带嵌套分母的 Z 变换推导，供排版目视检查。
- 用户消息气泡下方提供“复制”“撤回”。复制的是原始文本（保留 Markdown 源码）。撤回可选任意用户轮次，调用当前工作空间的 `session.revert({ messageID })`；opencode 会同时回退该轮及之后的回复与相关工作区文件改动。服务端通过会话的 `revert.messageID` 保留撤回边界，客户端据此隐藏该边界后的历史消息；输入框上方显示撤回轮数和“恢复撤回”，后者调用 `session.unrevert`。切换会话后读取 `session.get` 恢复边界；发出新一轮对话后不再提供恢复按钮，待内核清理已撤回消息。撤回进行中禁止重复点击，失败保持原对话，切换会话/工作空间时忽略迟到结果。`scripts/message-actions-regressions.cjs` 使用假内核覆盖这些操作。
- 底部 Agent/模型选择改用向上展开的玻璃菜单，带开关动画；输入框随内容增长，最高 192px，之后在输入框内部滚动。粘贴、拖拽和“＋”文件选择可添加图片或文件，发送时按 SDK 的 `FilePartInput` 用 data URL 与文本一起提交，单文件上限 25 MB。切换工作空间时清空待发送附件和未完成的文件读取。菜单面板（`.hui-picker-panel`）通过 portal 挂到 `document.body`、按触发器矩形 `position: fixed` 定位，宽度贴合内容（`width: max-content`，最小 120px、最大 300px），不会为短选项撑成固定宽条；`.hui-composer` 的 `backdrop-filter` 是 Backdrop Root，面板留在气泡内部时模糊只能采样气泡自身，看起来没有毛玻璃；挂到 body 后才能采样聊天区与壁纸。面板常驻 DOM，用 `data-open` 控制开合动画，点击外部判定需同时检查触发器与 portal 面板两个子树。提供商分组标题（`.hui-picker-group`，13px）大于模型选项（11.5px）以形成层次。输入框是浮在会话之上的独立卡片（`.hui-composer-dock` 绝对定位、点击穿透，`ResizeObserver` 给滚动区留出等高 `padding-bottom`），毛玻璃需采样身后滚过的消息。**构建陷阱**：Tailwind v4 的 Lightning CSS 在规则同时写了标准 `backdrop-filter` 与手写 `-webkit-backdrop-filter` 时**只保留 `-webkit-` 别名**，Electron/Chromium 不认该别名会导致“全透”；源码里只写标准属性，让构建自行补前缀。模型选择右侧的「思考等级」选择器读取所选模型的 `variants`（opencode 的 `reasoningEffort` 配置，如 `none`/`low`/`medium`/`xhigh`，`disabled` 项过滤掉），选中后把 `variant` 放进 `prompt_async` / `command` 请求体，切换模型或重启时校验并回退为「默认」（持久化于 `hui.variant`）。
- 输入框以 `/` 开头且尚未输入空格时，会在输入框上方弹出斜杠命令菜单（`.hui-slash-menu`）。它用中性的半透明深色底（`rgba(16,17,22,.66)`，约 2/3 不透明）+ `backdrop-filter: blur(20px) saturate(150%)` + 细边框与内侧高光：既要能透出背景表现为毛玻璃，又要保证命令与描述清晰可读；**不要**纯透明（可读性差），也**不要**不透明的蓝色渐变（既不透明也偏色）。**该菜单必须是输入框气泡的兄弟节点，不能放在气泡内部**：`.hui-composer` 带 `backdrop-filter`，会成为 Backdrop Root，后代菜单的 `backdrop-filter` 只能采样气泡自身那一层，框外没有内容可模糊，菜单看起来就是不透明黑块。现在菜单放在包裹输入框的 `.relative` 容器里、与 `.hui-composer` 同级，`backdrop-filter` 才能采样到聊天区与壁纸。标题与描述使用应用正文字体（Noto Sans SC），命令名不要用等宽字体，描述限制两行。命令列表为「客户端内置 + 当前工作空间 `command.list()`」合并去重：内置 `compact`（`session.summarize` 压缩上下文）、`new`（新建会话）、`undo` / `redo`（复用撤回与恢复流程），再并入内核返回的用户命令与技能。随命令名即时过滤；上下键移动，Escape 关闭但保留文本。**选中用户命令或技能**（Tab、回车或点击）补全为 `/name `，继续输入参数后回车调用 `session.command({ command, arguments })`，否则按普通提示发送；**选中内置命令**（compact/new/undo/redo，均无参数）则立即执行 `runBuiltin`，不再先补全再回车。命令不支持附件。回归见 `scripts/composer-regressions.cjs`。
- 输入框在任意位置输入 `@` 会弹出文件引用面板（`.hui-slash-menu hui-at-menu`，与斜杠菜单同一套玻璃样式，同样必须是 `.hui-composer` 的兄弟节点）。与斜杠的“整段匹配”不同，它按**光标位置**检测：光标紧跟 `@token`（token 前必须是行首或空白，`foo@bar` 不触发；token 内允许 `/`）即打开。文件列表**以引用时刻为准**，由内核实时提供：空查询列工作空间根目录（目录优先、过滤 ignored），有查询走服务端模糊搜索；1.x 用 `/file` 与 `/find/file?dirs=true`，2.x 用 `/api/fs/list` 与 `/api/fs/find`，`kernel-client.ts` 的 `file.list/file.find` 归一化为 `{ path, type }` 相对路径。请求防抖 120ms、限 10 条、带 epoch，切工作空间时清理缓存与迟到结果。面板对内核返回结果再做**客户端收紧**：查询必须落在跨度 ≤ 2×查询长度的窗口内（`md` 不再命中 `src/matrix-download.ts`，但 `.md` 后缀仍合法），段边界锚定的排前；散落的远距子序列被丢弃。高亮保持整段连续文本（合并命中片段，放进单个 `.hui-at-path` span，避免 flex gap 把字拆散），普通路径白灰色，命中段仅加粗纯白。↑↓ 导航、Tab/Enter 在**原 token 位置**替换为 `@相对路径 ` 并复位光标、Escape 关闭保留文本；与斜杠面板互斥。补全后的 `@path` 留在正文随文本发送，由内核原生解析 @ 提及，不走附件通道。回归见 `scripts/composer-regressions.cjs`（假内核补 `/file`、`/find/file` 端点）。
- 压缩（compact）由内核直接处理，不产生用户回声，因此单独渲染：`session.summarize` 开始时先显示居中的「等待会话压缩」气泡（复用 `ReplyPresentation` 的等待动画，通过 `waitLabel`/`center`/`wideWait` 参数定制），内核把摘要消息（`info.summary === true` 的助手消息）流式写入时复用同一气泡显示内容；消息 `time.completed` 出现后折叠成居中的步骤式卡片「会话已压缩」，点击可展开查看。压缩消息在会话渲染循环里被识别为独立块（不并入普通回复轮次），压缩进行期间抑制普通的「等待回复」气泡。不要用 `info.agent` 判定，压缩助手消息用的是 `summary: true`。回归见 `scripts/composer-regressions.cjs`（假内核用 `window.benchHoldSummarize` 挂起 summarize，以稳定断言等待→流式→折叠的完整生命周期）。
- 顶部标题栏设置按钮右侧显示上下文占用圆环（`.hui-context-meter` + SVG `stroke-dasharray/dashoffset`），环心是占用百分比，悬停 `title` 显示已用 / 上限 tokens。上限优先取当前会话**最后一条有真实用量的助手消息**记录的 `providerID/modelID` 对应模型的 `limit.context`，没有时回退到下拉框所选模型 —— 不同会话可能用不同模型，不能用所选模型硬套。已用取该消息 `tokens` 的 `input + output + cache.read + cache.write`；占用 ≥70% 变黄、≥90% 变红。查找时会**跳过用量为 0 的消息**（刚创建、尚未收到用量事件的助手条目或新步骤），否则圆环会在真实数字和 0 之间反复横跳；数字用统一正文字体而非等宽字体。切换工作空间时随模型列表一起清空。
- 界面正文统一使用随应用打包的 Noto Sans SC Variable；代码块、行内代码、工作空间路径和 KaTeX 保持各自的等宽/数学字体。字体 CSS 在 `main.tsx` 引入，构建后的字体文件无需联网加载；发布产物同时包含 `licenses/noto-sans-sc-OFL.txt`。
- `question.asked` SSE 事件及 `question.list` 用于显示当前会话的待答问题；弹出的玻璃询问框支持单选、多选和自定义回答，以当前目录调用 `question.reply` / `question.reject`。切换会话时重新读取待答列表，并忽略旧请求的迟到响应。Question 工具气泡仅显示状态，不再展开原始 JSON。`scripts/composer-regressions.cjs` 用假内核验证这些交互。

---

## 6. 内核管理要点（`src/main/opencode-server.ts`）

- 主进程异步发现：用户保存的内核路径 → `OPENCODE_BIN` → `%APPDATA%\Clonely\bin\opencode.exe` → PATH 的实际可执行文件；不扫描整块磁盘。手动选择保存在 Electron userData 的 `kernel.json`，失效时明确报错，不能静默切换内核。
- 每次启动先发布 discovering，随后 version / launching / checking / ready 或 error。版本探测上限 5 秒，健康检查上限 30 秒、单次请求 2 秒；所有状态带 attempt/sequence，旧进程及迟到结果不得覆盖新启动。
- 1.x 验证 `/global/health`；2.x 验证 `/api/info`，由本应用生成独立 `OPENCODE_PASSWORD`，并指定 `--cors null` 允许生产 file:// 页面。连接凭据通过独立 `server:connection` IPC 获取，不进入诊断状态。
- 共享状态类型位于 `src/shared/kernel.ts`。错误包括 not-found / spawn / version / port / exited / auth / protocol / timeout；stdout 和 stderr 保留最后 200 行且最多 64 KiB，清除 ANSI 并遮蔽凭据，SQLite schema 报错等必须对用户可见。
- 动态分配 127.0.0.1 本地端口；重启取消旧探测并只回收本应用启动的进程树，不接管或关闭其他 TUI 后台服务。Windows PATH 中忽略 POSIX 无扩展名 shim，cmd/bat 经显式 cmd 引用启动。
- 净化宿主注入的 OPENCODE_CLIENT、旧/新密码及历史实验环境变量；仅对 2.x 注入本次随机密码。不自动升级、降级或改写用户配置。
- `npm run test:kernel` 覆盖发现、设置、失效选择、诊断脱敏，并用真实 Node 子进程模拟两版健康接口、鉴权、中文空格路径及退出错误；模拟版本号不代表真实 OpenCode 兼容性验证。

---

### 双版本通信与连接界面

- `kernel-client.ts` 是渲染层唯一协议入口：1.x 封装 `@opencode-ai/sdk`，2.x 固定 `@opencode/client@2.0.32` Promise 客户端；界面及 PermissionGate 不再创建独立 SDK。每个客户端绑定目录与 AbortController，工作空间切换关闭事件流并取消旧请求。普通 GET 读取限时 15 秒，但事件流（`Accept: text/event-stream` 或路径含 `/event`）必须排除：`@opencode/client` 的 `/api/event` 订阅不发 Accept 头，套用该时限会周期性 abort 长连接并报 `Transport: BodyStreamBuffer was aborted`；`/command`、`/api/command`、`/api/skill` 会等待 MCP prompts，单独使用 120 秒时限，避免 MCP 冷启动（如 npx/远程 server）被误判为连接故障。
- `kernel-projection.ts` 将 2.x 原生 session.text/reasoning/tool/step/execution/compaction 事件投影到原有有序归并队列。正文及思考 ID 是 message ID + content ordinal，工具 ID 是 message ID + tool ID；结束事件是完整快照替换，不能再次追加。2.x 全局事件先按 location/已验证会话归属过滤，所有 HTTP 请求额外携带编码的 x-opencode-directory。列表及消息历史遍历分页；2.x 的 cursor 已编码 order，`order` 只能出现在首页，后续游标页再传会被内核以 `Cursor cannot be combined with order` 拒绝，空页即停止翻页。
- 2.x 会话模型、Agent 由 switchModel/switchAgent 切换；文件使用原生 URI 附件，压缩/停止/撤回/恢复分别映射原生接口。权限字段 action/resources/save 映射旧 UI；Form 通过 KernelFormDialog 展示文本、数字、整数、布尔、单选、多选、条件字段及外部步骤。
- 2.x 事件通过 SDK 的 fetch 流携带鉴权，以 1/2/4/8/10 秒间隔重连；流关闭或传输中断属于正常抖动，由重连循环静默恢复，只有握手超时或连续失败才向界面上报「事件连接失败」。重连补查历史、模型、会话、运行状态、授权及待答表单，写操作不重放。1.x 保留原生 EventSource 自动重连。Markdown Worker、缓存和有界格式化队列保持原机制。
- 标题栏文字状态可打开 ConnectionStatus 诊断面板；空白聊天页展示启动进度、失败原因和重试/选内核/恢复自动选择。会话/模型/命令加载失败在界面显示，空模型列表提示检查配置；诊断复制只序列化 ServerInfo，不包含连接凭据。命令列表不阻塞首次初始化：失败时保留内置命令，并按 3/10/30 秒自动重试，首次 SSE 握手成功后也会补拉；成功即清除提示。
- `npm run test:kernel` 同时运行启动与协议测试；协议测试使用 SDK 真实序列化和独立 HTTP 假响应，不代表真实模型输出速度。
- `npm run test:kernel-ui`（可加 `--production`）使用独立 2.x HTTP/SSE 假内核，覆盖状态快照竞态、进度/失败/诊断复制、选择与重试防重、分页、原生流式去重、目录过滤、权限、条件数字表单及断线恢复。生产测试前先 build；测试截图仅写入 out/。
- `npm run test:kernel-ui -- --production --real` 使用真实内核和隔离的临时配置/数据目录，不发送模型请求。可设置 `HUI_KERNEL_V1_BIN`、`HUI_KERNEL_V2_BIN` 指定两版二进制；默认检查 Clonely 的 1.x 和临时目录 huarnessy-real-kernel-2.0.32/opencode.exe。真实测试验证浏览器健康接口、SDK 会话/配置、带目录的 SSE，以及 file:// 生产 Origin 的鉴权和跨域。版本探测须接受 1.x 的纯版本字符串和 2.x 的 `opencode v2.0.32` 前缀。
- 首次初始化须同时完成 REST 加载及事件握手；2.x 事件握手限时 15 秒，重连超过 30 秒持续显示正在自动重试。请求诊断只保留最近 50 次的方法、路径、HTTP 状态和错误类别，不记录请求体或鉴权头。压缩通过 compact 入队后等待原生 wait 接口完成，避免把入队确认误当成压缩完成；撤回显式传 files=true。


### 双版本适配验证记录（2026-10-21）

- typecheck、build、内核启动/协议测试（10 项）和工作空间设置测试（2 项）通过。
- 独立 2.0.32 HTTP/SSE 假内核的开发与生产 UI 回归（11 项）通过；诊断面板另有截图检查及窗口内定位断言。
- test:stream 常规开发、开发 --large 和 --production 通过。长输入分别为列表 17,300 字符、段落 20,640 字符、多段落 8,803 字符、代码 28,818 字符。均为假内核受控输入，不代表真实模型速度。
- 真实 1.18.29 与 2.0.32 在隔离的临时配置/数据目录中通过开发和 file:// 生产页面的健康接口、SDK 会话/配置、目录及鉴权 SSE 检查，没有发送真实模型请求。其他版本未据此宣称已完整验证。

### 会话刷新与输入稳定性修复（2026-11-06）

- 用户提供录屏复现了三个现象：`刷新会话历史失败：Cursor cannot be combined with order` 常驻、偶发 `事件连接失败：Transport: BodyStreamBuffer was aborted`、断连瞬间输入法拼音 `li'm you'shen'me'dong'xi` 被上屏。
- 根因链：2.x 消息分页第二页重复传 `order`；`/api/event` 没有 Accept 头，被 15 秒读取时限误杀；`eventLost` 把 textarea 置为 `disabled`，浏览器因此结束 IME 组合。
- 回归：`kernel-client.test.mjs` 用假内核复现 cursor/order 服务端校验与无 Accept 头的事件流（13 项）；`composer-regressions.cjs` 覆盖历史失败提示清除、组合中输入框保持可编辑、发送仍被阻止、瞬断不上报故障、恢复后可编辑（composer 43 项）。把旧超时判断临时还原时新增协议测试如期失败，确认不是空断言。
- 验证：`npm run typecheck`、`npm run build`、`npm run test:kernel`、`npm run test:stream` 开发与生产、`npm run test:kernel-ui` 开发与生产全部通过。流式耗时来自假内核，不代表真实模型速度。

## 7. 环境与已知坑

- **数据库版本兼容**：默认 DB `~/.local/share/opencode/opencode.db` 由桌面版写入；若用旧版 CLI 会报 `SQLiteError: no such column: replacement_seq`。用 `resolveOpencodeBin()` 的优先级规避。
- **SDK 入口**：1.x 使用 `@opencode-ai/sdk/client`，旧包根入口会引入 Node `child_process`；2.x 使用 `@opencode/client` 的 Promise 入口，不能把 Node 专用 service 模块引入渲染层。
- **CORS**：1.x 反射 Origin；2.x 使用允许列表，独立服务显式传 `--cors null` 支持生产 file:// 页面，REST 和 SSE 均携带鉴权。
- **模型可用性**：`config.providers()` 返回多个 provider/模型；沙箱/离线环境常只有 `deepseek/deepseek-flash`、`deepseek/deepseek-v4-pro` 可用。默认 `config.get().model` 可能不可达。
- **发送接口**：用 `POST /session/{id}/prompt_async`（发后即返回，结果走 SSE）；停止用 `POST /session/{id}/abort`。
- TS7 已移除 `baseUrl`，`paths` 用相对 `./`。

---

## 8. 会话列表、工作空间与删除（2026-10-06）

### 工作空间

- 左侧底部显示当前工作空间完整路径，超长时截断显示，鼠标悬停可查看完整值；上方的“切换工作空间”打开原生文件夹选择对话框。取消选择或选择相同目录保留当前对话。
- 初次启动使用进程工作目录；后续优先恢复 Electron `userData/workspace.json` 中的目录。主进程验证目录存在且为文件夹，保存真实绝对路径；设置损坏或目录已删除时回退到启动目录。
- SDK 客户端通过 `createOpencodeClient({ baseUrl, directory })` 建立目录上下文；会话列表另显式传入 `query.directory`，并按会话的 `directory` 再做精确过滤。不同文件夹分别隔离，即使位于同一个 Git 仓库或属于父子目录也不合并。
- 新建、历史读取、发送、停止和删除均使用当前目录的 SDK 客户端；SSE 连接使用 `/event?directory=...`。不要重新引入未带目录的原生发送/停止请求。
- 切换时立即关闭旧 SSE、使旧客户端失效，清理会话、消息、待提交增量、输入草稿、忙碌状态及目录配置，再加载新目录会话和配置。旧客户端返回的列表、历史、配置、新建结果及删除结果不能更新新工作空间。
- 兼容普通 SSE 事件和带 `directory/payload` 的事件封装；忽略其他目录的封装事件及会话生命周期事件。Windows 路径比较兼容大小写、斜杠和末尾分隔符，非 Windows 路径保持大小写区别。
- 切换工作空间不重启内核，也不主动中断原工作空间中已经发送的模型任务；切回后可以重新选择对应会话查看历史。
- `npm run test:workspace` 验证设置保存、恢复、失效回退和目录比较；`npm run test:stream` 增加 16 项工作空间界面与请求回归，使用假内核验证目录隔离、取消/失败选择、Unicode 路径、各类请求的目录参数，以及迟到的列表、历史和新建结果。

### 会话标题

- 客户端 `session.create` 一律不传 `title`，由内核生成默认标题 `New session - <ISO 时间戳>`。内核只在标题匹配该默认格式时（`Session.isDefaultTitle`）才在小模型可用时异步总结标题并推送 `session.updated`；客户端曾传入 `New Session` 或前 48 字问题作为标题，导致内核永远跳过总结，标题停留在初始值。
- 侧边栏对匹配默认标题的会话显示"新会话"占位（`sessionLabel`），总结完成后随 `session.updated` 刷新为真实标题。
- 假内核（`stream-benchmark-preload.cjs`）模拟同样的默认标题；`workspace-regressions.cjs` 按 `新会话` 占位与 `New session - ` 前缀断言。

### 会话忙碌状态

- `App.tsx` 用 `busySessions` 集合按会话记录运行状态，`busy` 由当前活动会话推导。从正在生成的会话切换到空闲会话时右下角显示“发送”而非错误地沿用“停止”，切回仍在工作的会话会恢复“停止”。发送、内置压缩标记当前会话；`session.idle` / `session.error` 无论会话是否为当前活动都会清除对应标记；工作空间切换、删除会话与撤回成功分别清理相关标记。假内核回归见 `scripts/busy-session-regressions.cjs`。
- `session.status` 的 `retry` 状态也在界面显式呈现：当前会话在输入框上方显示黄色「模型连接中断」提示，包含尝试次数、倒计时、内核返回的错误摘要；侧栏对应会话带脉动圆点，切到其他会话时提示消失但侧栏标记保留。`retry` 期间仍视为忙碌（保留「停止」），`busy` 只清除提示，`idle` / `session.error` 同时清除提示和标记。主 SSE 断开时输入框上方显示蓝色「与内核的连接中断，正在重连…」，只阻止发送而不禁用输入框：禁用聚焦中的 textarea 会强制结束 IME 组合并把拼音预编辑串上屏；`onCompositionStart/End` 额外保护组合态，组合中不触发提交。`EventSource` 重连成功后重新拉取历史、会话列表与 `/session/status`，弥补断线期间丢失的事件；历史刷新成功会清除同类的常驻「刷新会话历史失败」提示。系统减少动态效果时圆点停止脉动。回归见 `scripts/busy-session-regressions.cjs`。

### 会话删除

- 在左侧会话条目上右键，点击“删除会话”，通过 SDK 的 `session.delete({ path: { id } })` 调用 `DELETE /session/{id}`。右键不改变当前选中的会话。
- 菜单限制在窗口可视范围内；点击外部、按 Escape/Tab、滚动会话列表、调整窗口大小或窗口失焦时关闭。
- 删除期间目标条目显示“正在删除…”，阻止重复请求；服务端确认成功后才移除列表项。删除失败保留会话并显示错误，404 视为会话已经删除。
- 删除当前会话时取消待提交增量及消息刷新，清空消息、当前会话和忙碌状态，返回初始对话界面；删除其他会话保留当前对话。
- `session.deleted` SSE 事件同样更新本地状态。会话列表请求检查请求版本及连接身份，并过滤已删除 ID，防止旧响应恢复已删除条目。
- `SessionContextMenu.tsx` 负责菜单展示；`App.tsx` 的 `deleteSession`、`forgetSession` 负责请求及状态清理。
- `npm run test:stream` 现包含 13 项会话删除回归断言，使用假内核验证菜单关闭与定位、请求目标、失败保留、重复点击、延迟响应、当前/非当前会话删除、404 和外部删除事件。该功能的类型检查、构建、开发模式回归已通过。

---

## 9. 待办 / 已知限制

- 设置中的黄色“默认无限权限”默认关闭，偏好保存为 `hui.unlimitedPermissions`。开启后自动放行当前工作空间内所有会话（包括后台会话）的待授权和新增工具权限请求；使用 `reply: once`，不写入内核永久规则，因此关闭后新请求恢复人工审批。自动回复防重；失败显示原审批弹窗，可手动重试，避免无限重试。工作空间切换仍隔离旧客户端结果。`test:stream -- --permission-only` 覆盖开关默认值、黄色样式、持久化、各类权限自动放行、后台请求、防重和关闭后的迟到回复。

- 工具访问工作空间之外的路径（例如 `%TEMP%`）会等待 `external_directory` 授权，内核仍标为 `running`。`PermissionGate.tsx` 通过 v2 SDK 的 `permission.list/reply` 及主 SSE 的 `permission.asked/replied` 显示授权弹窗；打开会话和 SSE 重连时补查。允许一次、始终允许与拒绝均带当前工作空间目录；切换会话/工作空间忽略迟到响应。使用 `npm run test:stream -- --permission-only`（可加 `--production`）以假内核验证 Read 待授权恢复、回复和会话隔离。发布前确认 `out/renderer/assets` 与独立快照包含 `工具等待授权`，避免只有构建成功却没有包含修复。

- 格式化计算期间，新增后缀先以原始文本显示，Worker 返回后更新为 Markdown；超长单段落仍存在浏览器布局成本。
- 长代码块在闭合成围栏前不高亮（有意为之，换取流式性能）。
- 尚未做会话持久化 UI、工具调用结果富展示、多模态等增强。

---

## 10. 快速改动指引

| 想改什么 | 去哪里 |
|---|---|
| 界面 / SSE 接收 / 会话切换 / 自动滚动 | `src/renderer/src/App.tsx` |
| 工作空间路径显示 / 切换 / 目录请求上下文 | `src/renderer/src/App.tsx` |
| 原生文件夹选择 / 工作空间设置 IPC | `src/main/index.ts`、`src/preload/index.ts` |
| 工作空间持久化与路径验证 | `src/main/workspace.ts` |
| 工作空间路径比较 | `src/renderer/src/workspace-path.ts` |
| 会话右键菜单 / 菜单定位与关闭 | `src/renderer/src/SessionContextMenu.tsx` |
| 会话删除请求 / 删除后的状态清理 | `src/renderer/src/App.tsx` 的 `deleteSession`、`forgetSession` |
| 有序消息归并 / delta 与快照更新 | `src/renderer/src/stream-state.ts` |
| 即时文本 / Worker 调度 / DOM 片段复用 | `src/renderer/src/StreamingMarkdown.tsx` |
| Markdown 解析 / 公式与高亮 / 格式化缓存 | `src/renderer/src/markdown.worker.ts` |
| Worker 请求、响应与片段类型 | `src/renderer/src/markdown-types.ts` |
| Markdown / 玻璃样式 | `src/renderer/src/styles.css` |
| 流式性能与功能回归 | `scripts/stream-benchmark.mjs`、`scripts/stream-benchmark.cjs`、`scripts/stream-benchmark-preload.cjs` |
| 内核启动 / env / 二进制解析 | `src/main/opencode-server.ts` |
| 窗口 / IPC / 调试端口 | `src/main/index.ts` |
| 暴露给渲染进程的 API | `src/preload/index.ts` |
| 构建 / 别名 / 插件 | `electron.vite.config.ts` |

改动后**必须**运行：`npm run typecheck && npm run build`。

### 回复生成详情

- 完成回复不再常驻显示模型/速度小字。最终 `CallBlock` 右下角的信息按钮提供 120ms 悬停打开、移入保持、点击固定及键盘聚焦；Escape、外部点击、滚动和窗口变化关闭。`ReplyDetails.tsx` 的面板通过 portal 挂到 body，避免气泡裁切与 Backdrop Root 限制；固定定位根层跟随消息内真实按钮，面板形状动画使用相对坐标，可见期间（含收回）逐帧更新根层平移，关闭完成与卸载时停止追踪，信息按钮置于 28px 同心圆形玻璃上，悬停后同一表面通过 Web Animations 改变实际位置、宽高与圆角，展开成详情卡片（520ms），移开缩回原圆（380ms）；使用先加速、长尾减速的单调曲线，无超调或末尾反弹。图标所在角（向上展开为右下角、向下展开为右上角）全过程固定 14px 半径，保留小圆的曲率和圆心，其他角可变为 18px。内容独立渐显，不缩放文字；中途反向从当前几何尺寸接续；离开等待 100ms，支持减少动态效果设置；底色不透明度 46%、模糊 12px，保留背景透视。面板只显示指标，不附加底部解释。
- 总耗时为用户消息创建到本轮最后助手完成。“观测首 token 延迟”为客户端发出 prompt/command 到收到第一条非空模型内容（正文、思考或流式工具参数）的间隔；“观测输出速度”为本轮输出及思考 token ÷ 各助手消息首末实际输出接收区间之和，排除首条输出前等待与跨调用工具间隔。`stream-observations.ts` 在目录/连接身份校验后、rAF 归并与动画前使用 performance.now 计时；空部件、相同快照、合成内容不计作输出，删除、回退及断线使不完整观测失效。隐式思考、单批输出或用量不足时速度显示“未提供”，不再用整个助手步骤耗时冒充观测输出区间。
- `scripts/reply-details-regressions.cjs` 随 `npm run test:stream` 验证长回复在输入框上方的间距、输入框伸缩后吸底、完成状态、悬停/固定/键盘/关闭、圆形玻璃、展开尺寸单调性、图标角曲率与同心位置、文字不缩放、退场与中途反向、展开/收回中连续滚动的图标对齐、详情与输入框真实重叠时的逐帧鼠标命中层级、指标口径、portal 清理、定位及构建后毛玻璃。

- 浮动输入区的高度通过 ResizeObserver 写入 `--hui-composer-reserve`，在 `.hui-chat-content` 内预留空间（含滚动区 padding 后气泡与输入框约 32px 间隔），而非命令式覆盖滚动容器的 padding-bottom；测量前保留 160px 回退留白。输入区高度变化时，仅在跟随状态下同步重新吸底。

- 观测记录按规范化工作空间目录、会话与消息 ID 隔离，接收后台会话事件也会计时，REST 历史不创建观测。完成记录限量保存于 `hui.stream-observations.v1`（256 条）；重新打开会话可复用，没有历史记录时显示“未提供”。工作空间切换/断线清理在途计时；消息、部件或会话删除使对应记录移除/失效。
- `node --test scripts/stream-observations.test.mjs` 验证计时、空部件/快照去重、工具间隔、持久化、目录/会话隔离、迟到元信息及断线/删除；`test:stream` 的详情回归还验证实际发送与 SSE 观测、后台接收、面板数字及历史重开。测试使用假内核与受控输出，不代表真实模型速度。
