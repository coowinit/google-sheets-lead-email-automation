# 截图命名说明

- `01-sheet-overview.png`：步骤 01：表格整体结构预览。展示原始广告线索表格、主要字段和多条客户数据。
- `02-customer-email-column.png`：步骤 02：新增 customer_email 接收邮箱列。展示 customer_email 字段及接收线索的邮箱地址。
- `03-open-apps-script.png`：步骤 03：从 Google 表格打开 Apps Script。路径：扩展程序 → Apps Script。
- `04-paste-code.png`：步骤 04：粘贴 Apps Script 代码。展示 Code.gs 中粘贴的完整脚本代码。
- `05-save-project.png`：步骤 05：保存 Apps Script 项目。展示保存按钮和项目名称。
- `06-run-test-function.png`：步骤 06：运行测试函数。函数选择：testSendFirstLeadToCustomerEmail。
- `07-authorize-script.png`：步骤 07：首次运行授权。展示 Google 授权流程。
- `08-execution-log-success.png`：步骤 08：执行日志发送成功。日志应显示：Lead info sent to: customer_email。
- `09-sheet-status-sent.png`：步骤 09：表格自动写入发送状态。展示 email_send_status、email_sent_time、email_error_message。
- `10-gmail-sent-preview.png`：步骤 10：Gmail 已发送邮件预览。展示邮件标题、收件人和线索详情。
- `11-create-trigger.png`：步骤 11：创建定时触发器。函数：createAutoSendLeadTriggerEvery5Minutes。
- `12-trigger-list.png`：步骤 12：触发器列表确认。展示每 5 分钟自动运行的触发器。
- `13-final-overview.png`：步骤 13：最终效果总览。汇总表格、日志、邮件和自动触发器。
