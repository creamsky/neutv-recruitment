# 年度更新操作手册

## 目标

每年只更新年份、群号、二维码和必要文案，不重新搭建设计系统。

## 1. 建立新分支

```bash
git switch -c recruitment-2027
```

## 2. 更新年份和群号

```bash
npm run annual:update -- \
  --year 2027 \
  --nanhu-group 1234567890 \
  --hunnan-group 1234567891
```

工具会：

- 更新 `project.config.json`；
- 替换 HTML 和文字稿中的旧年份、旧群号；
- 把带年份的 HTML 文件名更新到新年份；
- 保留二维码图片不动，并提醒人工替换。

先预览变更可以增加 `--dry-run`。

## 3. 替换二维码

请从 QQ 提供的原始二维码中导出清晰图片，分别覆盖：

- `assets/qr/nanhu-qq.png`
- `assets/qr/hunnan-qq.png`

要求：

- 使用真实二维码，不重绘、不使用 AI 生成或生成式超分；
- 建议至少 900 × 900 px；
- 可使用透明背景，但页面中的 `.qr-box` 必须保持纯白；
- 四周保留完整静区；
- 覆盖后用手机分别扫码确认群号。

`scripts/extract_qq_qr.cjs` 只对应 2026 原始截图坐标，新截图不要直接套用。

## 4. 更新文案

检查：

- 主办名称是否变化；
- 官方平台范围是否变化；
- 部门职责是否变化；
- 是否新增截止时间、地点或报名方式；
- 是否仍面向全体在校生。

如职责发生变化，同时更新 `HANDOFF.md`、`AGENTS.md` 和 QA 规则。

## 5. 渲染与检查

```bash
npm run render
npm run qa
```

必须人工打开完整 PNG，不能只看局部缩略图。二维码还需实际扫码。

## 6. 生成中文交付目录

```bash
npm run release
```

正式发布前再执行 `docs/PUBLIC_RELEASE_CHECKLIST.md`。
