# GitHub 发布说明

## 推荐仓库信息

- 仓库名：`neutv-recruitment-kit`
- 中文描述：`东北大学电视台 NEUTV 招新宣传单与易拉宝的可复用 HTML/CSS 设计、渲染与年度交接工程。`
- 可选 Topics：`neutv`、`recruitment`、`poster-design`、`print-design`、`html-css`、`playwright`、`chinese-design`
- 可见性：确认品牌和二维码公开范围后再选择 Public；如未确认，先使用 Private。

## 上传前

完成 `docs/PUBLIC_RELEASE_CHECKLIST.md`，尤其确认：

- NEUTV Logo 与东北大学校徽是否可以公开；
- 当前两个招新群二维码和群号是否适合长期公开；
- `references/` 中的材料是否允许一并发布。

## 使用 GitHub CLI

在解压后的交接包根目录执行：

```bash
git init
git add .
git commit -m "开源 NEUTV 2026 招新物料可复用工程"
gh repo create neutv-recruitment-kit \
  --public \
  --description "东北大学电视台 NEUTV 招新宣传单与易拉宝的可复用 HTML/CSS 设计、渲染与年度交接工程。" \
  --source . \
  --remote origin \
  --push
```

如果品牌或二维码公开授权尚未确认，把 `--public` 改为 `--private`。

## 使用网页上传

1. 在 GitHub 新建空仓库，不勾选自动生成 README、License 或 `.gitignore`。
2. 按页面提示执行 `git init`、`git remote add origin ...`、`git push`。
3. 仓库描述使用上方中文描述。
4. 首个 Release 建议命名为 `v1.0.0-2026`，将三张成品 PNG 作为 Release Assets 上传；不要持续把每年高分辨率成品堆入 Git 历史。

## 推荐首条 Release 说明

```text
NEUTV 招新物料可复用工程首个公开版本。

- A4 双面宣传单：300 dpi PNG
- 80 × 200 cm 易拉宝：200 dpi PNG
- 配置驱动的年份、群号和输出规格
- 跨平台 Chromium 渲染
- 自动 QA、年度更新和交接文档

品牌标识、校徽、二维码和参考素材不自动纳入 MIT License，请阅读 ASSET_LICENSES.md。
```
