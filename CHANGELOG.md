# 更新日志

## v1.1.2 - 2026-08-20

### 修复

- 修复脚本曾读取错误标签页、真实业务线索未进入发送流程的问题；
- 确认真实业务表使用正确 `SHEET_ID`；
- 移除 `Session.getEffectiveUser().getEmail()`，不再依赖 `userinfo.email` 权限；
- 修复 `You do not have permission to call Session.getEffectiveUser` 导致多条记录变为 `Failed`；
- 修复测试函数在第一条发送失败后继续尝试后续记录的问题。

### 调整

- 新增可选固定 `CONFIG.REPLY_TO`；
- `REPLY_TO` 留空时不显式设置回复地址；
- 测试函数改为独立 `testMode`，成功或失败都只尝试一条有效待发送记录；
- 执行日志同时记录 `attemptedCount` 与 `sentCount`；
- 保留 `Failed` 状态后续自动重试逻辑；
- 统一仓库脚本为 `src/Code.gs` 与 `src/Code.txt`；
- 移除当前目录中包含旧权限逻辑的重复中英文脚本副本；
- 重新整理 README 的部署、配置、测试、排错、故障复盘和维护说明。

## v1.1.0 - 2026-07-02

- 通过工作表 `gid` 精确定位目标标签页；
- 修复 `Missing required columns: customer_email`；
- 新增表头调试函数 `debugTargetSheetHeaders()`；
- 自动清理表头中的空格、BOM 和零宽字符；
- 邮件正文精简为 `business_type`、`requirements`、`full_name`、`phone_number`、`email`、`street_address` 六个字段；
- 优化发件人名称、邮件标题、HTML 邮件和纯文本备用正文；
- 增加每日发信额度检查和脚本锁；
- 一次性读取表格数据，减少重复 API 调用；
- 补充垃圾邮件、字段缺失、触发器和重复发送排查说明。

## v1.0.0

- 完成 Google Sheets 客户线索读取；
- 支持把线索发送到 `customer_email`；
- 支持发送状态、时间和错误记录；
- 支持单条测试和每 5 分钟定时执行。
