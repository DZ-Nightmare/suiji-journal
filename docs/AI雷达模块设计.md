# AI 雷达模块设计

> 2026-11-25 定稿。目标：随记第四个分区「AI 雷达」——实时看 AI 圈公开信号（GitHub 新项目 /
> Hacker News 热帖 / HuggingFace 每日论文），值得跟的**收进随记**（加密入库），
> 与 AI 库、随记双向互链。实现完全对齐 AI 库模块的既有模式（04-AI → payload.ai → AI 库视图）。

## 1. 定位与边界

- 「AI 雷达」= **发现流 + 精选收藏**，不是知识库正文。
  - 信号流：每次打开雷达视图，浏览器**实时直连**三个公开 API（不缓存、不入载荷）。
  - 收进雷达：点信号卡复制一句话给随记 AI → 落盘 `vault/05-Radar` → 随构建加密进载荷，
    成为「已收」条目（可流转四态、记感想、与随记互链）。
- 与 AI 库的关系：雷达是「看到什么值得跟」，AI 库是「试过沉淀进工具箱」。
  试过真有用的雷达条目，建议 `kept` 并再 `ai.js add` 进 AI 库（两区可同时存在）。
- 条目同样**不是随记**：标题=名称、正文=感想时间流、tags=纯主题词（三条豁免同书影/AI 库）。

## 2. 数据形态

### 2.1 目录与文件名

```
vault/05-Radar/
  模型-xxx.md      # 文件名前缀用分类名（模型/工具/实践/论文/行业）
  工具-xxx.md
  ...
```

文件名其余部分复用 `sanitize()`（AI 库同款）。

### 2.2 frontmatter（以工具类为例）

```yaml
---
added: 2026-11-25
category: 工具        # 模型 | 工具 | 实践 | 论文 | 行业
title: xxx
url: https://github.com/...    # 信号来源链接（可空，但收进雷达时通常有）
why: 一句话缘何关注（FDE 三问）  # 作为卡片的「为什么值得看」
status: want          # want | trying | kept | dropped（四态，复用 AI 库）
tags:
  - 多智能体
---

## 感想

## 关联
```

### 2.3 四态语义

与 AI 库完全一致：`want` 想试（收藏了没动手）/ `trying` 在试 / `kept` 已用（沉淀进工具箱）/
`dropped` 淘汰（感想里留一句弃用原因）。

## 3. 信号流（前端实时，不落盘）

### 3.1 数据源

| 源 | 接口 | 分类 | 备注 |
|---|---|---|---|
| GitHub Trending | `api.github.com/search/repositories`（近 7 天新建，按星降序） | 工具 | 直连 ✅ CORS `*` |
| Hacker News | `hn.algolia.com/api/v1/search_by_date` | 行业 | CORS 允许 `dz-nightmare.github.io` ✅ |
| HF Daily Papers | `hf-mirror.com/api/daily_papers`（镜像） | 论文 | 主站不通；镜像 CORS 允许本站 ✅ |

CSP 已放行三域名（`connect-src 'self' https://api.github.com https://hn.algolia.com https://hf-mirror.com`）。

### 3.2 过滤与排序

- 每条解析成：来源 / 分类 / 标题 / 摘要 / url / 「为什么值得看」（FDE 三问模板）/ 分数（star/points/votes）。
- 去重（来源+标题）→ 分数降序 → 取前 90。
- 视图内筛选：分类五选一 + 时间窗（今天/本周/全部）。

### 3.3 为什么实时不缓存

- 随记是纯静态 GitHub Pages 站，无后端；加密载荷只放**已收**条目。
- 信号流属于「看外面」，不是「我的内容」——每次打开现拉，不占加密包、不堆历史。

## 4. 工具链

### 4.1 新工具 `tools/radar.js`（命令同构 ai.js）

```bash
node tools/radar.js add "标题" --category 模型 --url https://... --why "..." [--tags 标签]
node tools/radar.js status "标题" trying          # 四态，允许回退
node tools/radar.js remark "标题" "试了一下…"
node tools/radar.js link "标题" "01-Journals/…"
node tools/radar.js promote "标题" 11-25 "01-Journals/…"
node tools/radar.js show "标题" ｜ list [--category 模型] [--status want]
node tools/radar.js rename "旧" "新" ｜ rm "某条"   # 自动登记墓碑
```

与 ai.js 的差别：无 `type` 字段，换成 `category`（模型/工具/实践/论文/行业）；
文件名前缀按分类；无 `creator`/`brief` 字段。

### 4.2 数据流改动

- `tools/lib.js`：新增 `scanRadar(config)`，读取 `vault/05-Radar/`（与 scanAI 同构）。
- `tools/build.js`：载荷新增 `radar` 字段；孤儿附件校验纳入 radar 条目。
- `tools/sync.js`：对账把 `05-Radar` 纳入扫描范围（kind=「雷达」）；墓碑机制天然复用。
- 旧载荷没有 `radar` 字段 → 前端 `hasRadar=false`，侧栏不显示（与 `hasAI` 同款降级）。

## 5. 网页端

### 5.1 导航

- 侧栏新增「AI 雷达」按钮（`◉`，位于「AI 库」下方），隐藏条件 `hasRadar`。
- 移动端 view-switch 新增第四 tab「雷达」。

### 5.2 视图（view-radar）

- Hero：全页唯一深色「夜视屏」卡 + 雷达扫描动画（CSS，`radar-spin` 3.2s 一圈 + 呼吸亮点）；
  显示拉取时间和来源行。
- 工具栏：标题 + 计数 + 「刷新 ↻」按钮（重新现拉）。
- 筛选：分类五选一 × 时间窗（今天/本周/全部）×（已收条目存在时）四态。
- 信号卡片：分类色左条（模型蓝/工具紫/实践绿/论文橙/行业青）+ 来源·时间 + 标题 +
  摘要（2 行截断）+「为什么值得看」（FDE 三问）+ 关键词胶囊 + 打开 ↗ + 「收进雷达」按钮。
- 「收进雷达」点开菜单：说明站点加密只读 → 复制一句话给随记 AI 完成落盘。
- 渠道目录：三栏纸面卡片（每天扫一眼 / 每周订阅 / 官方一手），链接新标签打开。
- 已收条目：stat 行显示四态计数；详情与感想走随记 AI 工具链（站点只读）。

### 5.3 双向互链

- 随记正文 `[[05-Radar/工具-xxx]]` → 打开雷达条目（与 01/02/03/04 并列）。
- 条目「关联」段 `[[01-Journals/…]]` → 点回随记（复用既有逻辑）。

## 6. 与 AI 库的异同（实现对齐点）

| 维度 | AI 库 | AI 雷达 |
|---|---|---|
| 目录 | 04-AI | 05-Radar |
| 载荷字段 | ai | radar |
| 分类 | type（project/skill/tool/article） | category（模型/工具/实践/论文/行业） |
| 状态 | want/trying/kept/dropped | 同左（完全复用） |
| url | 有（公开链接） | 有（信号来源） |
| 实时信号流 | 无 | 有（前端直连三源，不入载荷） |
| 感想/互链/墓碑/加密 | ✓ | ✓（完全复用） |

## 7. 安全与规范

- 加密链路不变：条目明文只在 vault，载荷全加密；**不改 tools/ 加密逻辑**。
- CSP 只放行三个信号 API 域名（connect-src 白名单，见 3.1）；其余仍 `'self'`。
- 信号流是公开数据，无隐私风险；**已收条目**随载荷加密，与非加密信号天然隔离。
- `vault/` 永不 git add；05-Radar 同样在 .gitignore 范围内（vault 整体已排除）。
- 附件挂载规范不变：frontmatter `attachments:` 唯一挂载方式，正文不出现文件名；
  孤儿附件警告覆盖 radar 条目。
- 入库存前**搜索确认标题/链接，绝不编造**（信号卡给的是候选）。

## 8. 实施顺序（已全部完成）

1. `tools/lib.js`：scanRadar + 导出。 ✅
2. `tools/radar.js`：新工具（ai.js 为模板改造）。 ✅
3. `tools/build.js` + `tools/sync.js`：载荷 radar 字段、孤儿校验、对账纳入 05-Radar。 ✅
4. `index.html` + `app.js` + `radar.js` + `styles.css`：CSP、侧栏按钮、移动 tab、视图、
   信号卡片、收进雷达菜单、渠道目录、雷达动画。 ✅
5. 浏览器实测：解锁、雷达视图、信号拉取、分类筛选、收进雷达菜单。 ✅
6. `skill/SKILL.md` 增补「AI 雷达」章节 + 触发词，同步三份副本。 ✅
7. 本文档定稿，publish 推送上线。 ⏳

## 9. 已确认的命名

- 分区名：**AI 雷达**（用户 2026-11-25 定：从 logistics-devops 管理后台迁来随记）。
- 收纳动作：**收进雷达**；条目目录 `05-Radar`；工具 `tools/radar.js`。
