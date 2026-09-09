# MDFriday Publish — 设计规范

> Obsidian 插件「发布到 MDFriday」交互与视觉规范（中文 UI）  
> 原型：`index.html` · 信息架构：**右侧边栏（side leaf）** · 视觉：**apple.com** · 2026-09

---

## 1. 目标与原则

### 目标
- **一键上线**：右键笔记/文件夹 → 右侧边栏 Publish 面板 → 拿到可分享的公开 URL。
- **选择即分叉**：单篇笔记与文件夹走不同发布模式（见 §3）。
- **项目记忆**：同一路径再次打开时恢复上次模式、主题、密码开关、域名偏好。
- **可回滚 / 可撤销**：成功发布可写入历史；**回滚为 Personal**；各计划均可撤销发布使站点下线。
- **计划可见但不抢戏**：Guest → Free → Personal 以 **pill** 出现在面板标题区；点击 pill 打开紧凑 popover，**不是**第三 Tab。

### 原则
1. **UI 住在右侧边栏** — View type / side leaf，**不是**居中 Modal。面板宽度约 **320–360px**（原型 340px）。
2. **apple.com 气质** — 大留白、克制字阶、软灰次要文字、极细分割线；主 CTA 为 `#0071E3`。
3. **对比陈述** — 暗色静音 Obsidian 壳 + 浅色 Apple 右栏。
4. **一个主操作** — 面板底部粘性操作栏（全宽）：「预览」（次要灰底）+「发布」/「验证并发布」（主色蓝）；与滚动区分离，始终可达。
5. **短文案、有信心** — 状态一句话说清；锁定能力用小字说明升级路径，不弹阻塞对话框。
6. **发布优先于变现** — 在 ~340px 窄栏里，不让「计划」与「发布 / 历史」争抢同等权重。

---

## 2. 信息架构（右侧边栏）

```
Obsidian 全视口
├─ 左：文件树（静音暗色）
├─ 中：Markdown 编辑器（静音暗色）
└─ 右：MDFriday Publish 面板（浅色 Apple）← 设计英雄
        ├─ Header：标题「发布」+ 计划 pill（点开 popover）+ 关闭（右上 chrome）
        ├─ Tab：发布 | 历史          ← 仅两个对等 Tab
        ├─ 发布 Tab（panel-scroll：flex 1 1 0%，可滚动）
        │   ├─ 项目记忆条：已发布 / 已撤销·未公开 / 未发布
        │   │              + 本地预览进行中 / 上次预览·已停止（可选）
        │   ├─ 发布对象 + 单篇|文件夹切换（原型演示分叉）
        │   ├─ 发布方式（随选择类型分叉）
        │   ├─ 主题 / Wiki 皮肤列表（含 Live demo）
        │   ├─ Soft banner（Guest/Free 存储与保留说明）
        │   ├─ 高级选项：访问密码 · 自定义域名
        │   └─ Idle / Verify / Building / Result / Soft-gate
        ├─ 历史 Tab：Personal 可见版本列表 · 查看 · 回滚 · 撤销发布
        │            Guest/Free：锁定空态 + 升级 CTA
        └─ 底部粘性栏（全宽）：[预览] [发布]   ← 仅 Idle 显示
```

### 为什么去掉「计划」作为对等 Tab？

| 理由 | 说明 |
|------|------|
| **Job-to-be-done 优先** | 用户打开侧栏是为了「发布 / 再发 / 回看历史」，不是管理订阅。 |
| **Apple 式情境变现** | 计划状态以 capsule/pill 常驻；需要时弹出轻量对比 + 软升级 CTA，而不是第三套全屏信息架构。 |
| **窄栏不宜三 Tab** | ~340px 宽度下三个对等 Tab 会互相稀释注意力，文案被迫截断，主路径变糊。 |
| **完整订阅另有归宿** | **完整订阅管理（计费、发票、取消、额度明细）住在 Obsidian 设置 → MDFriday**；侧栏只展示 **当前状态 + 软升级**。 |

### 计划 pill → Popover（Apple 式档位卡片）

- 点击标题区计划 pill，打开紧凑 popover / inline sheet。
- 内容：三张档位卡片（Guest / Free / Personal），每张含：
  - **Best for**（最适合）
  - **价格**
  - **利益点列表**
  - **CTA**（安装插件 / 免费注册 / 升级到 Personal）
  - **当前** 标签高亮当前档
- 页脚注明：完整管理请前往 **设置 → MDFriday**。
- Escape / 点击外部关闭。原型中点选卡片可切换演示；Free/Personal CTA 可 toast 或打开账号页。

### 关键用户流

```
笔记/文件夹 右键 →「发布到 MDFriday」
    → 打开右侧边栏 Publish 面板
        → 若该路径曾发布（含已撤销）：恢复上次设置 + 展示项目条
        → 按选择类型展示发布方式分叉
        → [可选] 高级：密码 / 自定义域名（受计划门控）
        → 底部：[预览]（本地构建，无 Turnstile） / [发布]
            → 预览：Building（本地预览）→ Result kind=preview（不写历史）
            → 发布：[Guest 且未完成首次验证] Verify → mdfriday.com Turnstile
                 → Building（发布）→ Result kind=publish（写入历史；Personal 可回滚）
            或 Soft-gate（引导认领 Free）
```

---

## 3. 发布方式分叉（MUST）

### 3.1 单篇笔记（单 note）

| 模式 | 默认？ | 说明 |
|------|--------|------|
| **原样发布 (As-is)** | ✓ 默认 | 尽量保留 Obsidian 本地预览：自定义主题、社区插件渲染、CSS / snippets（以本地预览管线能力为上限） |
| **单页主题** | 可选切换 | 精选单页主题列表；每行：主题名 + **Live demo** 链接 |

用户可在「原样发布 | 单页主题」之间切换。

### 3.2 文件夹（folder）

| 模式 | 默认？ | 说明 |
|------|--------|------|
| **原样发布** | ✗ **不支持** | UI 中禁用并展示清晰说明：多页结构需 Wiki 引擎解析双向链接与图谱 |
| **Wiki 发布** | ✓ 唯一主路径 | Quartz / Obsidian Publish 风格数字花园（图谱、wikilinks、多页） |
| Wiki 皮肤变体 | 可选 | 如 Quartz Garden 等，带 Live demo |

### 3.3 原型要求
必须提供「单篇笔记 | 文件夹」切换，以便评审者即时观察分叉 UI。

### 3.4 Live demo URL 约定
占位示例（可点击后 toast「打开 Live demo」）：
- `https://demo.mdfriday.com/themes/note`
- `https://demo.mdfriday.com/themes/essay`
- `https://demo.mdfriday.com/themes/quartz`
- 等同类路径

---

## 4. 项目管理与记忆

- 每个已发布目标是一个 **Project**，绑定 **笔记路径** 或 **文件夹路径**。
- 再次打开同一路径时，恢复：
  - 发布模式（原样 / 单页 / Wiki）
  - 主题 / 皮肤
  - 密码开关（及偏好）
  - 域名偏好 / 绑定状态
- **撤销发布后仍保留记忆**：设置不丢，便于一键再发。
- 发布 Tab 顶部项目条展示：
  - 状态：`未发布` / `已发布` / `已撤销 · 未公开`
  - 上次发布时间（或撤销说明）
  - 公开 URL（撤销后禁用 / 划线）
  - 徽标：「已记住上次设置」

---

## 5. 历史、回滚与撤销发布

### 5.1 历史 Tab
- **Personal only**：发布历史与回滚是 Personal 差异化能力。
- Guest / Free：历史 Tab 展示**锁定空态**（🔒）+ 说明 +「升级到 Personal」CTA；不展示可操作版本列表，回滚隐藏或显示为锁。
- Personal：列出该 Project 的历次发布。
- 每条记录字段：时间、模式、主题、状态、URL。
- 操作：
  - **查看** — 打开该版本公开页 / 预览
  - **回滚** — 二次确认后用该历史版本覆盖当前已发布站点；站点仍保持公开；条目可标「已回滚」
  - **撤销发布** — 仅对当前 **live** 的成功条目展示；二次确认后站点下线（各计划在 Success 仍可撤销）

### 5.2 撤销发布（Unpublish）

| | 撤销发布 | 回滚 |
|--|----------|------|
| 结果 | 站点 **下线**，公开 URL 不可访问 | 站点仍公开，内容换成历史版本 |
| 项目状态 | `已撤销 / 未公开` | 仍为 `已发布` |
| 设置记忆 | **保留**，便于再发 | 可随回滚版本更新展示 |
| 入口 | 发布 Result 次要操作；历史 live 条目 | 历史任意版本 |

发布 Result 视图在「复制 / 打开 / 返回」之外，提供次要危险操作 **撤销发布**（带确认）。预览 Result 对应 **停止预览**。

### 5.3 每次 Success 发布
自动追加一条历史，并标记为当前 live。

---

## 6. 预览与发布连续性（Preview ↔ Publish）

Preview 与 Publish 是**同一类结果**（构建完成 → 拿到可打开的 URL），共用同一套进度 / 结果 chrome，但身份与后果必须一眼可辨。

### 6.1 产品规则

| | 预览 (Preview) | 发布 (Publish) |
|--|----------------|----------------|
| 本质 | **本地构建** + 启动 **本地 webserver** → 本机浏览器打开 | 构建 + **上传到 MDFriday** → 公开 URL |
| 示例 URL | `http://127.0.0.1:4321/`（或本机分配端口） | `https://….mdfriday.com/…` / 自定义域名 |
| Turnstile / 计划门控 | **无**（Guest 也可预览；纯本地） | Guest 首次发布需 Turnstile；域名/历史等按计划 |
| 写入历史 | **否** — 预览永不进入「历史」Tab | **是** — Success 追加 live 历史（Personal 可回滚） |
| 进度态 | 共享 `building` | 共享 `building` |
| 结果态 | 共享 `result` · `kind=preview` | 共享 `result` · `kind=publish` |

### 6.2 共享进度态 `building`

- 标题固定：**正在构建…**
- 副标题切换：
  - 预览：`本地预览 · 启动本地服务`（阶段可细化为生成本地页面 / 应用主题 / 启动本地服务）
  - 发布：`发布到 MDFriday · 上传资源`（生成页面 / 应用主题 / 上传资源…）
- 进度条 UI 相同（spinner + track/fill）

### 6.3 共享结果态 `result`（参数化）

同一结果视图，按 `kind` 区分：

| 元素 | Preview | Publish |
|------|---------|---------|
| Badge | **本地预览**（蓝灰） | **已发布**（绿色） |
| 标题 | 预览已就绪 | 发布成功 |
| 说明 | 本地构建完成，已在本机启动预览服务 | 内容已上线，可分享给任何人 |
| URL 区 | 本地 URL + 复制 + 打开 | 公开 URL + 复制 + 打开 |
| 次要操作 | **停止预览**（停本地服务）、返回 | **撤销发布**、返回 |
| Helper | 「预览仅在本机有效，不会写入发布历史」 | 无（或省略） |

### 6.4 项目条连续性（Idle）

在发布 Tab 空闲态项目条上：

- 若已发布：展示公开 URL +「已发布」（既有）
- 若本地预览正在运行：额外一行「**本地预览进行中**」+ 本地 URL + **停止**
- 若上次预览已停止：可选弱化「上次预览 · 已停止」
- **发布历史仅记录 Publish**；预览不产生历史条目

### 6.5 为何共用 chrome？

连续性降低认知切换成本（两次「构建 → 链接」体感一致）；badge / 主机名 / 次要操作 / helper / 无历史 保证不会把本地预览误当成已上线。

---

## 7. Guest 首次发布与 Turnstile

### 规则
- 当计划为 **Guest**，且该账号/项目 **尚未完成过首次发布验证**（`firstPublishVerified = false`）：
  1. 主按钮文案变为 **「验证并发布」**；或点击「发布」进入中介态。
  2. 中介态标题：**需要人机验证**。
  3. 说明：首次发布需在 **mdfriday.com** 完成 Cloudflare Turnstile。
  4. 主按钮：**前往 mdfriday.com 验证**。
  5. 原型提供 **「我已完成验证」**，将 `firstPublishVerified` 置 true 后继续 Publishing → Success。
- **Free / Personal** 跳过此门。
- Guest **后续发布**（已验证）跳过 Turnstile。
- 原型顶栏提供 **Guest 验证：未验证 / 已验证** 开关，便于评审切换。

### 为何放在 mdfriday.com？
插件内嵌完整人机验证体验脆弱且难维护；跳转到官网完成一次验证后，侧栏继续主任务（发布），符合「侧栏轻、官网重」的边界。

---

## 8. 自定义域名与高级选项

- 位置：发布 Tab「高级选项」。
- 字段：自定义域名输入 + 状态 pill：`未绑定` / `已绑定 example.com`。
- **计划软门控**（Personal 差异化：域名 + 历史/回滚；密码保持 Personal-aligned 高级能力）：

| 计划 | 自定义域名 | 发布历史 / 回滚 | 访问密码 |
|------|------------|-----------------|----------|
| Guest | 锁定 → 升级 Personal | 锁定空态 | 锁定 |
| Free | 锁定 → 升级 Personal | 锁定空态 | 锁定 |
| Personal | 可配置 · 自动 HTTPS | ✓ | 可用 |

计划阶梯保持：**Guest → Free → Personal**。

---

## 9. 发布 Tab 结构（单篇示例）

1. Header + 计划 pill（popover）+ 关闭（右上）  
2. Tab：发布 | 历史  
3. 可滚动主体（`panel-scroll` · `flex: 1 1 0%`）  
4. 项目条：公开 URL / 状态 / 上次时间 /「已记住」+ 可选本地预览行  
5. 发布对象 + 单篇|文件夹切换  
6. **发布方式** 分段控件（随类型分叉，见 §3）  
7. 若「单页主题」/ Wiki：主题列表 + Live demo  
8. Soft banner（Guest/Free 存储与保留现实）  
9. 高级：密码、域名快捷入口  
10. **底部粘性全宽操作栏**：[预览] [发布] / [验证并发布]（仅 Idle）  

状态替换主体：Idle / Verify / Building / Result / Soft-gate（见 §6）。

---

## 10. 屏幕清单

| 屏幕 | 用途 | 关键元素 |
|------|------|----------|
| Obsidian Chrome | 情境衬底 | 左树 + 中编辑器（暗色静音） |
| Context Menu | 入口 | 「发布到 MDFriday」 |
| 发布 · Idle | 主屏 | 项目条（含预览行）、对象、模式分叉、主题、banner、高级；底部预览/发布 |
| 发布 · Verify | Guest 首次发布 | 说明 + 前往 mdfriday.com + 我已完成验证（预览不进此态） |
| 共享 · Building | 预览或发布进度 | 「正在构建…」+ 切换副标题 + 同款进度条 |
| 共享 · Result | 预览或发布结果 | Badge / 标题 / URL / 复制·打开；停止预览 或 撤销发布 |
| 发布 · Soft-gate | 引导 Free | 免费注册认领 / 稍后再说 |
| 历史 | 版本 | **仅 Publish**；Personal：列表·回滚·撤销；Guest/Free：锁定空态 |
| 计划 Popover | 轻量变现 | Apple 档位卡片、Best for、利益点、CTA、指向设置 |

~~居中弹窗~~ 已废弃。  
~~计划作为第三 Tab~~ 已废弃（见 §2）。

---

## 11. 计划门控规则（Publish UI）

权威产品事实（UI 可用中文标签表述同一事实）：

### Guest — 最适合：第一次试试
- 无需账号即可发布
- 站点 / 构建 / 导出不限次数
- **5 MB** 存储
- 全球 CDN 与分享链接
- Note & Wiki 主题 · 本地预览
- **内容在下一个 UTC 00:00 清空**（认领到 Free 可保留）
- CTA：安装插件（https://obsidian.md/plugins?search=mdfriday-publish）
- 保留：首次发布需在 mdfriday.com 完成 Turnstile

### Free — 最适合：持续免费发布
- 注册、认领 Guest 站点、按月继续发布
- 包含 Guest 全部能力，外加：
- **50 MB** 存储
- **站点于每月 1 日清空**
- 认领 Guest 站点并保留同一 URL
- 在账号中管理站点与发布
- CTA：免费注册（产品文案用 https://mdfriday.com/account/；原型注释可用 localhost:8080/account/）

### Personal — **$5 / 月** — 最适合：自己的域名与长期站点
- 包含 Free 全部能力，外加：
- **1 GB** 存储
- **永久保留**站点
- **3 个自定义域名** · 自动 HTTPS
- **发布历史与回滚**
- CTA：升级到 Personal（账号 URL）

### 能力对照表

| 能力 | Guest | Free | Personal |
|------|-------|------|----------|
| 定位 | 第一次试试 | 持续免费发布 | 域名与长期站点 |
| 价格 | 免费 · 无需账号 | 免费 · 注册 | $5 / 月 |
| 存储 | 5 MB | 50 MB | 1 GB |
| 保留策略 | 下一个 UTC 00:00 清空 | 每月 1 日清空 | 永久保留 |
| 站点/构建/导出次数 | 不限 | 不限 | 不限 |
| 首次 Turnstile | ✓ 首次必过 | 跳过 | 跳过 |
| 原样 / 单页 / Wiki | ✓（按选择类型） | ✓ | ✓ |
| CDN / 分享链接 | ✓ | ✓ | ✓ |
| 认领 Guest 同 URL | — | ✓ | ✓ |
| 账号内管理站点 | ✗ | ✓ | ✓ |
| 访问密码（高级） | ✗ 锁定 | ✗ 锁定 | ✓ |
| 自定义域名 + HTTPS | ✗ 锁定 | ✗ 锁定 | ✓（最多 3 个） |
| 发布历史 + 回滚 | ✗ 锁定空态 | ✗ 锁定空态 | ✓ |
| Soft banner | 存储 + UTC 清空 + 验证 | 存储 + 月初清空 + 升级提示 | 无 |

**UI 编码约定**
- 锁定字段：`disabled` + 小字「Personal 计划可用…」
- Guest 横幅：5 MB · UTC 00:00 清空 · 首次验证状态 ·「查看计划」
- Free 横幅：50 MB · 每月 1 日清空 · 升级 Personal 解锁域名 / 永久保留 / 历史
- Personal：无升级横幅；高级选项与历史全部可用
- 侧栏 **不** 承载完整订阅管理

---

## 12. 文案指南（中文）

### 关键字符串

| 位置 | 文案 |
|------|------|
| 菜单项 | 发布到 MDFriday |
| Tab | 发布 \| 历史 |
| 计划 pill / popover | Guest / Free / Personal · 查看计划 · 设置 → MDFriday |
| 对象类型 | 单篇笔记 / 文件夹 |
| 模式 | 原样发布 / 单页主题 / Wiki 发布 |
| 文件夹原样禁用 | 文件夹无法原样发布：多页结构需要 Wiki 引擎… |
| 主题操作 | Live demo |
| 项目条 | 已发布 / 未发布 / 已撤销 · 未公开 / 已记住上次设置 |
| 高级折叠 | 高级选项 |
| 密码 | 访问密码 · 留空则公开访问 |
| 域名状态 | 未绑定 / 已绑定 example.com |
| 底部主按钮 | 发布 / 验证并发布 |
| 底部次按钮 | 预览 |
| Verify | 需要人机验证 · 前往 mdfriday.com 验证 · 我已完成验证（仅发布） |
| Building | 正在构建… / 本地预览·启动本地服务 或 发布到 MDFriday·上传资源 |
| Result · 发布 | 已发布 · 发布成功 · 复制 / 打开 / 撤销发布 / 返回 |
| Result · 预览 | 本地预览 · 预览已就绪 · 复制 / 打开 / 停止预览 / 返回 · 不写历史 helper |
| 项目条预览 | 本地预览进行中 · 停止 / 上次预览 · 已停止 |
| Soft-gate | 认领到 Free 以继续 · 免费注册 / 稍后再说 |
| 历史锁定 | 发布历史与回滚 · Personal 计划可用 · 升级到 Personal |
| 历史操作 | 查看 / 回滚 / 撤销发布 |
| 计划 CTA | 安装插件 / 免费注册 / 升级到 Personal |
| 回滚确认 | 回滚到此版本？ |
| 撤销确认 | 撤销发布？ · 站点将下线… |
| Toast | 打开 Live demo · 已复制 · 发布成功 · 已写入历史 · 已撤销发布 |

### 避免
- 把 Publish UI 描述为「弹窗 / Modal」
- 把「计划」做成与发布同等的第三 Tab
- 长段落解释产品哲学
- 「错误：权限不足」类系统腔
- 同时堆多个升级按钮
- 混淆「撤销发布」与「回滚」
- 把发布历史做成 Guest/Free 可用能力
- 把预览结果写入发布历史
- 给本地预览套用 Turnstile / 计划硬门控

---

## 13. 视觉 Token（apple.com）

### 壳层（Obsidian，暗色静音）

| Token | 值 |
|-------|-----|
| `--ob-bg` | `#1a1a1a` |
| `--ob-sidebar` | `#141414` |
| `--ob-text` | `#c8c8c8` |
| `--ob-muted` | `#7a7a7a` |
| `--ob-border` | `rgba(255,255,255,0.08)` |

### 右栏（Apple）

| Token | 值 | 用途 |
|-------|-----|------|
| Background | `#F5F5F7` | 面板底 |
| Section | `#FBFBFD` / `#FFFFFF` | 顶区 / 卡片 |
| Text primary | `#1D1D1F` | 标题正文 |
| Text secondary | `#86868B` | 标签说明 |
| Accent / CTA | `#0071E3` | 主按钮、链接 |
| Secondary fill | `#E8E8ED` | 次按钮 |
| Success | `#34C759` | 成功态 |
| Warning soft | `#FF9F0A` | Guest 提示 / 已撤销 |
| Danger | `#FF3B30` | 撤销发布 |

间距基数 4；常用 8 / 12 / 16 / 20 / 24。面板水平内边距约 22px；卡片圆角 12px；主按钮全圆角 pill。

字体：系统栈 + PingFang SC。面板标题约 22px / semibold；正文 13–14px；caption 11–12px。

---

## 14. 无障碍与交互细节

- Escape 关闭上下文菜单、确认框、计划 popover。
- 密码字段 `type=password`；锁定时 toggle / input disabled。
- Soft-gate、Verify、Building、Result 时隐藏底部「预览+发布」操作栏。
- 计划 pill 打开 Apple 式档位卡片 popover（原型内点卡片/CTA 可切档演示）。
- 底部操作栏全宽粘性；面板关闭与计划 pill 保持右上 chrome。
- Preview 不触发 Turnstile，不写历史。
- Live demo 链接使用真实观感 URL；原型内以 toast 代替跳转亦可。
- 撤销与回滚均需二次确认；撤销用危险色主按钮。

---

## 15. 原型使用说明（给评审）

顶部控制栏：
- **Plan**：Guest / Free / Personal — 观察 pill、横幅、密码/域名锁定、popover
- **State**：Idle / Verify / Publishing / Success / Soft-gate / **Previewing** / **Preview result**
- **Guest 验证**：未验证 / 已验证 — 仅影响 **发布**（预览无视）
- **Show context menu / Open publish panel / Reset memory**

面板内：
- 底部粘性栏：[预览] [发布]（Building/Result 时隐藏）
- 点 **预览** → Building（本地）→ Result「本地预览」→ 可 **停止预览**；历史不变
- 点 **发布**（Guest 未验证）→ Verify → Building → Result「已发布」→ 写入历史
- 项目条观察「本地预览进行中 / 上次预览·已停止」与已发布 URL 并存
- 点击计划 pill → Apple 档位卡片
- 切换「单篇笔记 | 文件夹」观察发布方式分叉
- Guest/Free 打开 **历史** → 锁定空态；Personal 可见列表与 **回滚**
- 发布 Result 试用 **撤销发布**
- 展开高级选项：域名 / 密码（Personal 解锁）

布局约束（已验证）：`100vh` 壳 + `grid-template-rows: minmax(0,1fr)` + `panel-scroll { flex: 1 1 0% }` + 底部粘性全宽操作栏。

本规范与 `index.html` 一一对应；实现插件时使用 Obsidian **ItemView / WorkspaceLeaf（right sidebar）**，不要用 Modal；完整订阅管理放在 **Plugin Setting Tab**。
