# 随记 · A Little Journal

一本**端到端加密**的私人随记时间轴，部署在自己的 GitHub Pages 上。
仓库里只有密文（`journal.enc.json` + `media/*.bin`），明文随记只存在本机 `vault/`，
查看密码派生密钥（PBKDF2 60 万次 + AES-256-GCM）只在浏览器内解密。

线上地址：`https://dz-nightmare.github.io/suiji-journal/`

## 怎么记一条随记（三种方式）

### ① 对任意 AI 助手说一句话（推荐，已安装 suiji-journal skill）

对运行在本机、能执行命令的 AI 工具（DeepSeek 桌面端 / 豆包 / 任意 agent 工具）说：

> 记一条随记：<你的素材，可以带图片、文件、聊天记录、链接>

AI 会按「触点 / 思考 / 关联」模板生成随笔，调用工具链加密并自动推送上线（约 1 分钟生效）。
沉淀专题说「沉淀一条：<主题>」即可。

### ② 命令行（AI 已经帮你写好草稿，或从别的工具导出 md 时）

```bash
cd "/Users/dingze/Documents/工作目录/AI/项目/suiji-journal"
node tools/import.js 草稿.md 图片1.webp --date 2026-10-20 --tags 随笔,观影 --source 照片 --push
```

### ③ 纯文本直接记

```bash
node tools/import.js --text "随笔全文（可含 frontmatter）" --date 2026-10-20 --tags 随笔 --push
```

### 怎么管书影清单（想读 / 想看）

对 AI 说「想读《沙丘》」「想看《银翼杀手2049》」即可入清单；「《沙丘》在读了，
看到 217 页」「《X》看完了，4 星」流转状态；「对《X》记个感想：……」追加感想。
清单操作不算随记，不占「一次一条」配额。命令行用 `node tools/list.js`（见工具链）。

## 工具链

| 命令 | 作用 |
| --- | --- |
| `node tools/import.js <文件…> [--text 文本] [--date 日期] [--tags 标签] [--source 来源] [--title 标题] [--collection] [--push]` | 把随笔/图片/音频/文档收进 vault，自动改写附件引用并构建（`--push` 一步推送） |
| `node tools/list.js add 书\|影 "标题" [参数…]` | 书影清单管理：add / status / progress / remark / link / promote / show / list（`--push` 一步推送） |
| `node tools/build.js` | 把 vault 明文加密成 `journal.enc.json` + `media/` |
| `node tools/publish.js --message "…"` | 多设备闭环：拉取远端 → 对账补明文 → 构建 → 提交 → 推送（被拒自动重试） |
| `node tools/sync.js [--pull]` | 从远端密文载荷长出本地 vault 缺的明文（只增不删；新设备冷启动/灾后恢复） |

### 多设备使用（不固定设备记录）

任何设备记录后走 `--push` 或 `node tools/publish.js`（闭环会先把其它设备记的明文
对账进本地 vault 再全量构建，谁后推送谁的包里天然包含所有记录）。**不要手动
build + 手动 push**。新设备三步接入：`git clone` → 配 `journal.config.json`（同一个
查看密码）→ `node tools/sync.js`。同一条目双改时本地为准，远端版本留痕
`vault/_sync-conflicts/`。详见 `docs/多设备同步设计.md`。

## 目录结构

```
suiji-journal/
├── index.html / styles.css / app.js   # 网页端（解锁、时间轴、日历、书影、阅读器）
├── viewer.html                        # 附件（HTML）沙箱查看器
├── journal.enc.json                   # 加密随记+书影数据（入库）
├── media/*.bin                        # 加密附件（入库）
├── vault/                             # 明文工作区（不入库！）
│   ├── 01-Journals/2026/10/2026-10-19.md
│   ├── 02-Collection/处世哲学-顺势而为.md
│   ├── 03-Lists/书-沙丘.md            # 书影清单条目（想读 / 想看）
│   └── Attachments/*.webp
├── tools/                             # 构建 / 导入 / 清单 / 推送脚本
├── skill/SKILL.md                     # suiji-journal skill 真源（入库）
├── docs/                              # 设计文档（书影模块设计等）
├── journal.config.json                # 查看密码等本机配置（不入库）
└── journal.config.example.json        # 配置样例（入库）
```

## 网页端功能

- 密码解锁（错误密码无法解密，AES-GCM 认证失败）
- 时间轴卡片流：引文 + 感想 + 配图 + 标签
- 月份 / 主题 / 标签 / 关键词 / 有图 五种筛选，日历点日回看
- 书影清单：想读/在读/读完状态流转、感想时间流、类型/状态/标签/搜索筛选、与随记双向互链
- 「偶遇一条旧念头」随机翻页
- 全文阅读器：Markdown 渲染、附件（图片/音频/视频/文件）、一键导出原始 md
- 30 分钟无操作自动锁定

## 安全说明

1. **仓库不含明文**：`vault/` 与 `journal.config.json` 已在 `.gitignore` 中，永不提交。
2. 加密：查看密码经 PBKDF2（600000 次, SHA-256）派生 AES-256-GCM 密钥；
   附件逐个加密并以内容哈希绑定（AAD），换密码需全部重新构建。
3. 换密码：修改 `journal.config.json` 的 `password` → `node tools/publish.js`。
4. 备份明文：`vault/` 是唯一明文来源，建议另建**私有仓库**或本机定期备份。

## 部署（重建 / 迁移）

```bash
gh repo create <用户名>/suiji-journal --public --source . --push
gh api repos/<用户名>/suiji-journal/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

GitHub Pages 从 `main` 分支根目录直接发布，`.nojekyll` 已放置。
