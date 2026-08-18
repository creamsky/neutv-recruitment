# 公开发布前检查清单

## 权利与隐私

- [ ] 已确认有权公开 NEUTV 标识和东北大学校徽。
- [ ] 已阅读并保留两份字体 OFL 1.1 文本。
- [ ] 已确认 AI 生成素材符合组织政策与适用条款。
- [ ] 已决定是否公开当前招新群二维码和群号。
- [ ] `references/` 中没有不应公开的聊天记录、个人信息或无授权材料。
- [ ] README 明确说明仓库采用限制性使用声明，不是 MIT 等开放许可证。
- [ ] `BRAND_POLICY.md` 明确说明官方标识不授予任何使用权。

## 技术

- [ ] `npm install` 成功。
- [ ] `npx playwright install chromium` 成功，或已配置浏览器路径。
- [ ] `npm run render` 成功。
- [ ] `npm run qa` 显示 `QA PASS`。
- [ ] 三张完整 PNG 均已人工目检。
- [ ] 两个二维码均已用手机实际扫码。
- [ ] 发布目录中的文件名、尺寸和 dpi 正确。
- [ ] 没有提交 `tmp/`、`node_modules/`、浏览器缓存或旧压缩包。

## 仓库

- [ ] `LICENSE`、`BRAND_POLICY.md` 和 `ASSET_LICENSES.md` 同时存在且内容一致。
- [ ] `HANDOFF.md`、`AGENTS.md` 与当前业务一致。
- [ ] `CHANGELOG.md` 已更新。
- [ ] 发布标签使用明确版本号，例如 `v1.0.0-2026`。
- [ ] 大型二进制文件的仓库策略已确认；如长期累积多年度成品，优先放 GitHub Release，而不是持续提交到 Git 历史。
