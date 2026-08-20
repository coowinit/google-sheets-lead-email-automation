# v1.1.2 发布说明

本版本修复 Google 表格客户线索邮件自动通知系统在实际运行中出现的权限与测试逻辑问题。

## 主要修复

- 修复脚本读取错误标签页导致真实客户线索未发送；
- 移除 `Session.getEffectiveUser().getEmail()`；
- 修复 `userinfo.email` 权限不足导致线索连续标记为 `Failed`；
- 新增可选固定 `REPLY_TO`；
- 修复单条测试失败后继续尝试多条记录的问题；
- 统一仓库脚本入口为 `src/Code.gs` / `src/Code.txt`；
- 重新整理 README 与故障排查文档。

## 升级建议

升级后先运行：

1. `debugTargetSheetHeaders`
2. `testSendFirstLeadToCustomerEmail`
3. 确认邮件成功、状态写入 `Sent`
4. 再运行 `createAutoSendLeadTriggerEvery5Minutes`

已有 `Failed` 记录无需手工清空，修复后会在后续运行中继续尝试。
