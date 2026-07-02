# 更新日志

## v1.1.0 - 2026-07-02

- 通过工作表 `gid` 精确定位目标标签页；
- 修复 `Missing required columns: customer_email`；
- 新增表头调试函数 `debugTargetSheetHeaders()`；
- 自动清理表头中的空格、BOM 和零宽字符；
- 邮件正文精简为 `business_type`、`requirements`、`full_name`、`phone_number`、`email`、`street_address` 六个字段；
- 优化中文发件人名称和邮件标题；
- 优化 HTML 邮件样式和纯文本备用正文；
- 增加 `replyTo`、每日发信额度检查和脚本锁；
- 一次性读取表格数据，减少重复 API 调用；
- 补充垃圾邮件、字段缺失、触发器和重复发送排查说明；
- 增加真实错误与修复截图。

## v1.0.0

- 完成 Google Sheets 客户线索读取；
- 支持把线索发送到 `customer_email`；
- 支持发送状态、时间和错误记录；
- 支持单条测试和每 5 分钟定时执行。
