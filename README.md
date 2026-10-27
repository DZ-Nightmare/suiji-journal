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

## 工具链

| 命令 | 作用 |
| --- | --- |
| `node tools/import.js <文件…> [--text 文本] [--date 日期] [--tags 标签] [--source 来源] [--title 标题] [--collection] [--push]` | 把随笔/图片/音频/文档收进 vault，自动改写附件引用并构建（`--push` 一步推送） |
| `node tools/build.js` | 把 vault 明文加密成 `journal.enc.json` + `media/` |
| `node tools/publish.js --message "…"` | 构建 + git 提交 + 推送（Pages 自动更新） |

## 目录结构

```
suiji-journal/
├── index.html / styles.css / app.js   # 网页端（解锁、时间轴、日历、阅读器）
├── journal.enc.json                   # 加密随记数据（入库）
├── media/*.bin                        # 加密附件（入库）
├── vault/                             # 明文工作区（不入库！）
│   ├── 01-Journals/2026/10/2026-10-19.md
│   ├── 02-Collection/处世哲学-顺势而为.md
│   └── Attachments/*.webp
├── tools/                             # 构建 / 导入 / 推送脚本
├── journal.config.json                # 查看密码等本机配置（不入库）
└── journal.config.example.json        # 配置样例（入库）
```

## 网页端功能

- 密码解锁（错误密码无法解密，AES-GCM 认证失败）
- 时间轴卡片流：引文 + 感想 + 配图 + 标签
- 月份 / 主题 / 标签 / 关键词 / 有图 五种筛选，日历点日回看
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
