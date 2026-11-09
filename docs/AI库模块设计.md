# AI 库模块设计（知识 & 工具收藏区）

> 2026-11-09 设计稿。目标：给随记增加第三个独立分区「AI 库」，专门收藏 AI 相关的
> 开源项目、Skill、工具、知识文章，支持四态流转、感想时间流、与随记双向互链。
> 实现完全对齐书影模块的既有模式（03-Lists → payload.lists → 书影视图）。

## 1. 定位与边界

- 「AI 库」是**收藏与跟踪**区，不是知识库正文。条目 = 一个轻量 frontmatter + 感想时间流，
  与书影条目同构（标题即名称、正文是感想、不受随记三段式约束）。
- 与随记的关系：试用某个项目/工具产生**值得记的念头**时，写随记并互链；
  条目感想足够完整时可用 promote 升格为随记（复用书影的升格机制）。
- 四类条目：**开源项目 / Skill / 工具 / 知识文章**（用户已确认）。

## 2. 数据形态

### 2.1 目录与文件名

```
vault/04-AI/
  Project-xxx.md     # 开源项目
  Skill-xxx.md       # AI 技能包
  Tool-xxx.md        # 工具（网站/App/CLI/平台）
  Article-xxx.md     # 知识文章（教程/论文/博客/文档）
```

文件名前缀用英文类型名（比中文单字歧义少）；文件名其余部分复用 `sanitize()`（书影同款）。

### 2.2 frontmatter（以 Project 为例）

```yaml
---
added: 2026-11-09
type: project            # project | skill | tool | article
title: AutoGen
url: https://github.com/microsoft/autogen    # 项目主页 / 仓库 / 文章链接（可空）
creator: Microsoft       # 作者 / 组织（可空，搜索确认，不编造）
status: want             # want | trying | kept | dropped（四态）
why: 多智能体协作框架，想看看适不适合做自动化工作流   # 一句话缘由
tags:
  - 多智能体
  - 自动化
attachments:             # 截图 / PDF / 文档，挂载规则与书影完全一致
  - 2026-11-09-autogen-架构图.png
---

## 感想

## 关联
```

### 2.3 四态语义

| 状态 | 含义 | 卡片徽章色 |
|---|---|---|
| `want` 想试 | 收藏了、还没动手 | 灰/蓝（同书影 want） |
| `trying` 在试 | 正在试用、搭建、读 | 橙（同书影 doing） |
| `kept` 已用 | 沉淀进自己的工具箱 / 已读完吸收 | 绿（同书影 done） |
| `dropped` 淘汰 | 试过不合适，弃用（**在感想里留一句弃用原因**，避免以后重复踩坑） | 红（新增色） |

状态允许回退（`kept → trying` 等），与书影一致。

### 2.4 特殊字段

- `url`：唯一**公开链接**。网页端卡片与详情页可点、新标签打开（CSP 已允许 https）。
  仅 http(s) 开头才渲染成链接；留空则不显示。
- `creator`：作者/组织，卡片 meta 行显示（书影同款）。
- `why`：一句话缘由，作为卡片的默认 excerpt（没有感想时展示它）。

## 3. 工具链

### 3.1 新工具 `tools/ai.js`（命令同构书影 list.js）

```bash
# 入库存（type 四选一；url/creator 先搜索确认，不编造）
node tools/ai.js add project "AutoGen" --url https://github.com/microsoft/autogen --creator Microsoft --why "想试试多智能体"
node tools/ai.js add skill "某技能包" --why "..." --tags 写作
node tools/ai.js add tool "某工具" --url https://... --tags 效率
node tools/ai.js add article "某文章" --url https://... --creator 作者名

# 状态流转（want/trying/kept/dropped，允许回退）
node tools/ai.js status "AutoGen" trying
node tools/ai.js status "AutoGen" kept     # 沉淀进工具箱
node tools/ai.js status "AutoGen" dropped  # 淘汰（会在感想里提示补原因）

# 感想（同书影 remark：日期默认今天、小标题可省）
node tools/ai.js remark "AutoGen" "跑通了多智能体对话示例，配置比想象中简单"

# 关联随记 / 感想升格随记（同书影 link / promote）
node tools/ai.js link "AutoGen" "01-Journals/2026/11/2026-11-09"
node tools/ai.js promote "AutoGen" 11-09 "01-Journals/2026/11/2026-11-09"

# 改名 / 移除（自动登记墓碑，跨设备生效；同书影，直接删文件会被对账复活）
node tools/ai.js rename "AutoGen" "AutoGen（Microsoft）"
node tools/ai.js rm "某工具"

# 查看 / 列出
node tools/ai.js show "AutoGen"
node tools/ai.js list [--type project|skill|tool|article] [--status want|trying|kept|dropped]
# 通用参数 --push：构建后直接推送
```

### 3.2 数据流改动

- `tools/lib.js`：新增 `scanAI(config)`，读取 `vault/04-AI/`，输出条目
  （字段：rel/added/type/title/url/creator/status/why/tags/remarks/links/body/attachments）。
  status 合法值集合扩展为四态。
- `tools/build.js`：载荷新增 `ai` 字段（`{ notes, lists, ai, tombstones, built_at }`），
  附件走同一 `finalize()` 加密打包流程；孤儿附件校验把 ai 条目纳入引用集合。
- `tools/sync.js`：对账把 `04-AI` 目录纳入扫描范围（03-Lists 同款）；
  墓碑机制天然复用（路径 `04-AI/xxx.md`），附件墓碑检查同样覆盖。
- 旧载荷没有 `ai` 字段 → 前端 `hasAI=false`，侧栏不显示（与书影 `hasLists` 同款降级）。

## 4. 网页端

### 4.1 导航

- 侧栏新增「AI 库」按钮（`◈` 图标，位于「书影清单」下方），隐藏条件同书影（`hasAI`）。
- 移动端 view-switch 新增第三 tab「AI库」（时间轴 / 书影 / AI库）。

### 4.2 视图（view-ai，整体复用书影 UI 骨架）

- 工具栏：标题「AI 库」+ 计数 + 排序（最近添加 / 最近更新 / 类型）。
- 筛选三排：类型（全部/项目/技能/工具/文章）× 状态（全部/想试/在试/已用/淘汰）× 标签。
- 卡片网格：类型徽章（项/技/具/文）+ 状态徽章、标题（可点进详情）、
  封面（挂载的图片附件，无则显示类型图标占位）、url 链接（新标签）、meta 行（creator · 添加日期）、
  excerpt（最新感想 > why）、标签、按钮。
- 统计行：`想试 N · 在试 N · 已用 N · 淘汰 N`。
- 详情：复用 reader 弹窗（深链 anchor `ai-XXX`，hash 路由与书影并列），
  展示 url（可点）、creator、状态、感想时间流、关联随记（双向可点）、附件区。
- 搜索框：主搜索同时检索 ai 条目（书影已如此）。

### 4.3 双向互链

- 随记正文 `[[04-AI/Project-AutoGen]]` → resolveWiki 支持 `04-AI` 前缀，
  点击打开 AI 库条目详情（与 03-Lists/02-Collection/01-Journals 并列）。
- 条目「关联」段 `[[01-Journals/…]]` → 点回随记（复用既有逻辑）。
- 条目详情里显示互链随记条目数/入口。

## 5. 与书影的异同（实现时对齐点）

| 维度 | 书影 | AI 库 |
|---|---|---|
| 目录 | 03-Lists | 04-AI |
| 载荷字段 | lists | ai |
| 状态 | want/doing/done | want/trying/kept/dropped |
| 类型 | book/movie | project/skill/tool/article |
| 封面 | 海报附件 | 截图附件（无图给类型图标占位） |
| url | 无（作品信息） | 有（公开链接，卡片可点） |
| 感想/互链/墓碑/加密 | ✓ | ✓（完全复用） |

## 6. 安全与规范

- 加密链路不变：条目明文只在 vault，载荷全加密；**不改 tools/ 加密逻辑**。
- `vault/` 永不 git add；04-AI 同样在 .gitignore 范围内（vault 整体已排除）。
- 附件挂载规范不变：frontmatter `attachments:` 唯一挂载方式，正文不出现文件名；
  孤儿附件警告覆盖 ai 条目。
- `url` 只收 http(s)；详情页外链新标签打开，主站 CSP 不变（img-src 已允许 https）。
- 条目同样**三条豁免**（标题=名称、正文=感想时间流、tags=纯主题词），入库存前
  **搜索确认名称/作者/链接，绝不编造**。

## 7. 实施顺序

1. `tools/lib.js`：scanAI + 导出。
2. `tools/ai.js`：新工具（以 list.js 为模板改造，字段按第 3 节）。
3. `tools/build.js` + `tools/sync.js`：载荷 ai 字段、孤儿校验、对账纳入 04-AI。
4. `app.js` + `index.html` + `styles.css`：侧栏按钮、移动 tab、视图、卡片、详情、深链。
5. 沙箱测试：增删改查、四态流转、感想、互链、墓碑、加密包、旧载荷兼容。
6. `skill/SKILL.md` 增补「AI 库」章节 + 触发词，同步三份副本。
7. `docs/AI库模块设计.md`（本文档）定稿，publish 推送上线。

## 8. 已确认的命名

- 分区名：**AI 库**（用户 2026-11-09 确认）。
- `dropped` 中文名：**淘汰**（用户 2026-11-09 确认）。
