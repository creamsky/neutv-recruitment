# NEUTV 招新物料可复用工程

这是东北大学党委宣传部融媒体中心电视台（NEUTV）2026 招新宣传单与易拉宝的完整 HTML/CSS 制作工程。项目将版式、字体、品牌素材、透明插画、二维码、渲染脚本和自动检查放在一起，下一届可以更新年份、群号和二维码后直接继续使用。

当前成品包括：

- A4 宣传单正面：300 dpi PNG
- A4 宣传单反面：300 dpi PNG
- 80 × 200 cm 易拉宝：200 dpi PNG
- 可编辑 HTML/CSS 源文件与全部必要素材

当前正式交付不包含 PDF。仓库保留可选的矢量 PDF 导出脚本，只有印厂明确需要时再使用。

## 快速开始

环境要求：Node.js 20 或更高版本。

```bash
npm install
npx playwright install chromium
npm run render
npm run qa
npm run release
```

输出位置：

- 渲染中间件：`output/png/`
- 中文最终版：`output/东北大学电视台<年份>招新物料_最终版/`

如果本机已有 Chrome、Edge 或 Chromium，脚本会自动发现。也可以手动指定：

```bash
NEUTV_CHROME_PATH=/path/to/chrome npm run render
```

PowerShell：

```powershell
$env:NEUTV_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run render
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run render` | 导出 A4 正反面和 80 × 200 cm 易拉宝 PNG |
| `npm run render:rollup` | 只导出易拉宝 |
| `npm run qa` | 检查尺寸、dpi、素材、文字、溢出和关键业务约束 |
| `npm run release` | 渲染、检查并复制到中文最终版目录 |
| `npm run annual:update -- --year 2027 ...` | 更新下一年度文字和配置 |
| `npm run export:pdf` | 可选 PDF 导出；当前正式交付不使用 |

## 年度更新

先在独立分支或备份中运行：

```bash
npm run annual:update -- \
  --year 2027 \
  --nanhu-group 1234567890 \
  --hunnan-group 1234567891
```

然后手动替换：

- `assets/qr/nanhu-qq.png`
- `assets/qr/hunnan-qq.png`

完整步骤见 [docs/ANNUAL_UPDATE.md](docs/ANNUAL_UPDATE.md)。

## 项目结构

```text
assets/                  品牌、字体、透明插画、二维码
docs/                    设计、年度更新、素材与发布说明
scripts/                 渲染、QA、年度更新和交付脚本
project.config.json      年份、群号、dpi 等年度配置
neutv-recruitment-*.html 可编辑设计源
HANDOFF.md               当前状态与接手说明
AGENTS.md                AI/自动化修改时必须遵守的约束
references/              2026 原始输入与追溯资料
examples/                已验证的当前年度成品参考
```

## 授权边界

项目代码和原创文档采用 MIT License。字体按各自 SIL OFL 1.1 授权；NEUTV 标识、东北大学校徽、二维码、参考资料和视觉素材不自动纳入 MIT License。公开发布前必须阅读 [ASSET_LICENSES.md](ASSET_LICENSES.md) 和 [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md)。

## 接手入口

第一次维护请按顺序阅读：

1. [HANDOFF.md](HANDOFF.md)
2. [AGENTS.md](AGENTS.md)
3. [docs/ANNUAL_UPDATE.md](docs/ANNUAL_UPDATE.md)
4. [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
5. [docs/ASSET_PROVENANCE.md](docs/ASSET_PROVENANCE.md)
6. [docs/GITHUB_PUBLISH.md](docs/GITHUB_PUBLISH.md)
