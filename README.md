# Google 表格客户线索邮件自动通知系统

本仓库用于记录并复用一套 **Google Sheets + Google Apps Script + Gmail** 的自动化流程。

它的作用是：

> 当 Google 表格中出现新的客户线索数据时，脚本自动读取该行信息，并把线索内容发送到表格中指定的 `customer_email` 邮箱，同时在表格中写入发送状态，避免重复发送。

本项目适合用于：

- 广告表单线索通知；
- Facebook / Instagram 表单线索转发；
- Google 表格中的客户询盘自动提醒；
- 内部销售线索自动分发；
- 小规模客户数据自动邮件通知。

---

## 目录

- [一、实现原理](#一实现原理)
- [二、适用场景](#二适用场景)
- [三、表格建立注意事项](#三表格建立注意事项)
- [四、字段说明](#四字段说明)
- [五、项目目录结构](#五项目目录结构)
- [六、完整操作步骤](#六完整操作步骤)
- [七、正式启用自动发送](#七正式启用自动发送)
- [八、如何防止重复发送](#八如何防止重复发送)
- [九、如何修改接收邮箱](#九如何修改接收邮箱)
- [十、常见问题](#十常见问题)
- [十一、安全和权限建议](#十一安全和权限建议)
- [十二、最终效果](#十二最终效果)
- [十三、文件说明](#十三文件说明)

---

## 一、实现原理

整个流程的核心是：

```text
Google 表格
   ↓
Google Apps Script 脚本
   ↓
读取未发送的客户线索
   ↓
读取 customer_email 指定的接收邮箱
   ↓
生成邮件标题和邮件正文
   ↓
通过 Gmail 发送邮件
   ↓
回写发送状态到表格
```

### 1. Google 表格负责存储数据

Google 表格中保存广告表单或客户询盘生成的数据，例如：

- 客户姓名；
- 客户电话；
- 客户邮箱；
- 客户地址；
- 来源平台；
- 表单名称；
- 线索状态。

### 2. Apps Script 负责自动处理

Google Apps Script 是 Google 提供的脚本工具，可以直接读取 Google 表格，也可以调用 Gmail 发送邮件。

本项目中的脚本会自动完成：

- 查找未发送的线索；
- 读取 `customer_email`；
- 生成邮件；
- 发送邮件；
- 写入 `Sent` 状态；
- 记录发送时间；
- 记录错误信息。

### 3. Gmail 负责实际发送邮件

邮件会从运行 Apps Script 的 Google 账号发出。

例如你使用 `coowiniris@gmail.com` 授权运行脚本，那么邮件就会从这个账号发出。

### 4. 触发器负责定时运行

测试成功后，可以创建一个定时触发器，让脚本每 5 分钟自动运行一次。

这样后续表格中有新线索时，不需要人工点击运行。

---

## 二、适用场景

本方案适合：

| 场景 | 是否适合 |
|---|---|
| 每天几十条广告线索 | 适合 |
| 每天几百条客户询盘 | 视 Gmail 额度而定 |
| 自动通知销售人员或代理客户 | 适合 |
| 小规模 CRM 自动提醒 | 适合 |
| 大批量营销群发邮件 | 不建议 |
| 需要退订管理的营销邮件 | 不建议 |

如果每天要发送大量营销邮件，建议使用专业邮件服务，例如 SendGrid、Brevo、Mailchimp、Amazon SES。

---

## 三、表格建立注意事项

在建立 Google 表格时，需要特别注意以下几点。

### 1. 第一行必须是字段名

脚本是根据第一行字段名识别数据列的。

例如：

```text
full_name
phone_number
email
street_address
lead_status
customer_email
```

字段名不要随便改动。  
如果字段名改变，代码中的字段配置也要同步修改。

---

### 2. 必须保留 customer_email 字段

`customer_email` 是真正接收线索通知的邮箱字段。

注意：

- `email` 是线索客户自己的邮箱；
- `customer_email` 是接收线索通知的邮箱。

本项目的需求是：

> 不直接给线索客户发邮件，而是把线索信息统一发送给 `customer_email` 中设置的客户邮箱。

---

### 3. customer_email 可以只填写一行

如果所有线索都发送给同一个邮箱，可以只在第一条数据的 `customer_email` 中填写邮箱，例如：

```text
chinabarefoot@gmail.com
```

脚本会自动读取 `customer_email` 列中第一个非空邮箱，并把所有未发送线索都发送给这个邮箱。

---

### 4. 不要删除脚本自动新增的状态列

脚本会自动新增以下三列：

```text
email_send_status
email_sent_time
email_error_message
```

这三列用于判断是否已经发送。

如果删除或清空 `email_send_status`，可能导致重复发送。

---

### 5. 不建议公开包含客户信息的表格

如果表格中包含客户姓名、电话、邮箱、地址，不建议把表格设置为公开。

建议设置为：

- 仅内部人员可访问；
- 仅授权账号可编辑；
- 不要公开客户联系方式。

---

## 四、字段说明

### 1. 原始数据字段

| 字段名 | 说明 |
|---|---|
| `ad_id` | 广告 ID |
| `ad_name` | 广告名称 |
| `adset_id` | 广告组 ID |
| `adset_name` | 广告组名称 |
| `campaign_id` | 广告系列 ID |
| `campaign_name` | 广告系列名称 |
| `form_id` | 表单 ID |
| `form_name` | 表单名称 |
| `is_organic` | 是否自然流量 |
| `platform` | 来源平台，例如 fb / ig |
| `please_select_y` | 客户类型 |
| `full_name` | 线索客户姓名 |
| `phone_number` | 线索客户电话 |
| `email` | 线索客户邮箱 |
| `street_address` | 线索客户地址 |
| `lead_status` | 线索状态 |
| `customer_email` | 接收线索通知的邮箱 |

### 2. 脚本自动新增字段

| 字段名 | 说明 |
|---|---|
| `email_send_status` | 邮件发送状态 |
| `email_sent_time` | 邮件发送时间 |
| `email_error_message` | 邮件发送失败原因 |

发送成功后：

```text
email_send_status = Sent
```

发送失败后：

```text
email_send_status = Failed
```

失败原因会写入：

```text
email_error_message
```

---

## 五、项目目录结构

本仓库建议使用以下结构：

```text
google-sheets-lead-email-automation-cn/
├── README.md
├── src/
│   └── Code.gs
└── assets/
    └── screenshots/
        ├── 01-sheet-overview.png
        ├── 02-customer-email-column.png
        ├── 03-open-apps-script.png
        ├── 04-paste-code.png
        ├── 05-save-project.png
        ├── 06-run-test-function.png
        ├── 07-authorize-script.png
        ├── 08-execution-log-success.png
        ├── 09-sheet-status-sent.png
        ├── 10-gmail-sent-preview.png
        ├── 11-create-trigger.png
        └── 12-trigger-list.png
```

截图文件已经预留。  
后期只需要用真实截图替换对应文件即可，文件名保持不变。

---

## 六、完整操作步骤

### 步骤 1：准备 Google 表格

先准备好客户线索表格，确保表格中已经包含客户线索字段。

重点检查这些字段：

```text
full_name
phone_number
email
street_address
lead_status
```

截图路径：

```text
assets/screenshots/01-sheet-overview.png
```

![步骤 1：表格整体结构预览](assets/screenshots/01-sheet-overview.png)

---

### 步骤 2：新增 customer_email 字段

在表格最后新增一列：

```text
customer_email
```

然后在第一条数据对应的 `customer_email` 单元格中填写接收线索的邮箱，例如：

```text
chinabarefoot@gmail.com
```

注意：

- 这个邮箱才是真正接收邮件的邮箱；
- 原来的 `email` 字段只是线索客户自己的邮箱；
- 如果所有线索都发给同一个邮箱，只填写一行即可。

截图路径：

```text
assets/screenshots/02-customer-email-column.png
```

![步骤 2：新增 customer_email 接收邮箱列](assets/screenshots/02-customer-email-column.png)

---

### 步骤 3：打开 Apps Script

在 Google 表格顶部菜单中点击：

```text
扩展程序 → Apps Script
```

截图路径：

```text
assets/screenshots/03-open-apps-script.png
```

![步骤 3：从 Google 表格打开 Apps Script](assets/screenshots/03-open-apps-script.png)

---

### 步骤 4：粘贴脚本代码

打开 Apps Script 后，删除默认代码，把 `src/Code.gs` 中的代码完整复制进去。

需要重点确认配置中的表格 ID：

```javascript
SPREADSHEET_ID: '1AHVfBIQzy1aN5Dbhc2F70UDEA-IUe2lCFIVzAdwFlqM'
```

表格 ID 来自 Google 表格地址中 `/d/` 和 `/edit` 之间的部分。

截图路径：

```text
assets/screenshots/04-paste-code.png
```

![步骤 4：粘贴 Apps Script 代码](assets/screenshots/04-paste-code.png)

---

### 步骤 5：保存项目

点击 Apps Script 顶部的保存按钮。

建议项目名称可以设置为：

```text
Google 表格客户线索邮件自动通知
```

截图路径：

```text
assets/screenshots/05-save-project.png
```

![步骤 5：保存 Apps Script 项目](assets/screenshots/05-save-project.png)

---

### 步骤 6：运行测试函数

在 Apps Script 顶部函数下拉框中选择：

```text
testSendFirstLeadToCustomerEmail
```

然后点击运行。

这个函数每次只发送第一条未发送的线索，适合测试阶段使用。

截图路径：

```text
assets/screenshots/06-run-test-function.png
```

![步骤 6：运行测试函数](assets/screenshots/06-run-test-function.png)

---

### 步骤 7：完成首次授权

第一次运行脚本时，Google 会要求授权。

一般流程是：

```text
查看权限
选择 Google 账号
高级
转到项目
允许
```

授权完成后，脚本才可以读取表格并发送邮件。

截图路径：

```text
assets/screenshots/07-authorize-script.png
```

![步骤 7：首次运行授权](assets/screenshots/07-authorize-script.png)

---

### 步骤 8：查看执行日志

运行成功后，执行日志中应该出现类似内容：

```text
Lead info sent to: chinabarefoot@gmail.com
Total sent this run: 1
执行完毕
```

这表示脚本已经把一条线索发送到了 `customer_email` 中设置的邮箱。

截图路径：

```text
assets/screenshots/08-execution-log-success.png
```

![步骤 8：执行日志发送成功](assets/screenshots/08-execution-log-success.png)

---

### 步骤 9：检查表格发送状态

回到 Google 表格，表格末尾应该会自动新增三列：

```text
email_send_status
email_sent_time
email_error_message
```

发送成功的行会显示：

```text
Sent
```

截图路径：

```text
assets/screenshots/09-sheet-status-sent.png
```

![步骤 9：表格自动写入发送状态](assets/screenshots/09-sheet-status-sent.png)

---

### 步骤 10：检查 Gmail 已发送邮件

进入发送账号的 Gmail，打开“已发送邮件”。

确认邮件：

- 已发送到 `customer_email`；
- 邮件标题包含客户姓名、平台和表单名称；
- 邮件正文包含客户姓名、电话、邮箱、地址等信息。

邮件标题示例：

```text
New Customer Lead - Josephine Gonzalez - fb - 2026年1月份广告通用模板
```

截图路径：

```text
assets/screenshots/10-gmail-sent-preview.png
```

![步骤 10：Gmail 已发送邮件预览](assets/screenshots/10-gmail-sent-preview.png)

---

## 七、正式启用自动发送

测试成功后，再创建自动触发器。

在 Apps Script 中运行：

```text
createAutoSendLeadTriggerEvery5Minutes
```

这个函数只需要运行一次。

运行后，系统会创建一个每 5 分钟执行一次的定时任务。

截图路径：

```text
assets/screenshots/11-create-trigger.png
```

![步骤 11：创建定时触发器](assets/screenshots/11-create-trigger.png)

---

### 查看触发器是否创建成功

进入 Apps Script 左侧的“触发器”页面，确认存在以下触发器：

```text
函数名称：sendLeadInfoToCustomerEmail
触发方式：定时触发
执行频率：每 5 分钟
```

截图路径：

```text
assets/screenshots/12-trigger-list.png
```

![步骤 12：触发器列表确认](assets/screenshots/12-trigger-list.png)

---

## 八、如何防止重复发送

脚本通过 `email_send_status` 判断是否已经发送。

如果某一行已经是：

```text
Sent
```

脚本会跳过这一行，不会重复发送。

所以正式使用时不要随意清空：

```text
email_send_status
```

如果你手动清空了 `Sent`，脚本会认为这条线索没有发送过，可能重新发送。

---

## 九、如何修改接收邮箱

后期如果要修改接收线索的邮箱，不需要修改代码。

只需要修改表格中的：

```text
customer_email
```

例如从：

```text
chinabarefoot@gmail.com
```

改为：

```text
new-customer@example.com
```

修改后，后续新线索就会发送到新的邮箱。

---

## 十、常见问题

### 1. 为什么邮件发给了 email 列，而不是 customer_email？

通常是因为还在运行旧函数。

旧函数可能是：

```text
testSendFirstPendingCustomer
```

新函数应该是：

```text
testSendFirstLeadToCustomerEmail
```

正式主函数应该是：

```text
sendLeadInfoToCustomerEmail
```

---

### 2. 为什么运行测试函数后，每次都会发送下一条？

这是正常的。

测试函数每运行一次，只发送第一条未发送记录。

如果第一条已经是 `Sent`，脚本会自动跳过，继续发送下一条未发送记录。

---

### 3. 为什么没有发送？

常见原因：

- `customer_email` 没有填写；
- `customer_email` 邮箱格式不正确；
- 必要字段名被修改；
- Google 账号没有授权；
- Gmail 发送额度超限；
- 当前行已经是 `Sent`。

---

### 4. 如何重新测试某一行？

如果确实需要重新测试某一行，可以清空该行的以下字段：

```text
email_send_status
email_sent_time
email_error_message
```

然后重新运行测试函数。

注意：清空后会导致这条线索重新发送。

---

### 5. 如何停止自动发送？

运行以下函数：

```text
deleteAutoSendLeadTriggers
```

或者进入 Apps Script 左侧“触发器”页面，手动删除对应触发器。

---

## 十一、安全和权限建议

### 1. 不建议公开客户信息表格

如果表格里包含客户姓名、电话、邮箱、地址等信息，不建议公开访问。

建议设置为：

- 私有；
- 仅内部账号可访问；
- 仅必要人员可编辑。

---

### 2. 使用公司专用账号运行脚本

建议使用公司统一邮箱或业务专用邮箱授权运行 Apps Script。

这样客户收到邮件时，发件人更正式，也方便后期管理。

---

### 3. 注意 Gmail 发送额度

Google 账号每天可发送邮件数量有限。

如果线索量很大，建议改用专业邮件服务。

---

### 4. 不要把敏感数据提交到公开仓库

如果 GitHub 仓库是公开的，不建议提交真实客户数据、邮箱、电话、地址等信息。

`README.md` 中可以使用示例邮箱和打码数据。

---

## 十二、最终效果

本项目完成后，整体效果如下：

```text
广告线索进入 Google 表格
        ↓
Apps Script 自动读取新线索
        ↓
发送邮件到 customer_email
        ↓
邮件内容展示客户姓名、电话、邮箱、地址等信息
        ↓
表格自动写入 Sent
        ↓
后续不再重复发送
```

最终效果截图路径：

```text
assets/screenshots/13-final-overview.png
```

---

## 十三、文件说明

| 文件 | 说明 |
|---|---|
| `README.md` | 项目说明文档 |
| `src/Code.gs` | Google Apps Script 代码 |
| `assets/screenshots/` | 操作步骤截图目录 |

后续如果要复用，只需要：

1. 复制 `src/Code.gs` 代码；
2. 修改 `SPREADSHEET_ID`；
3. 保证表格字段名一致；
4. 在表格中填写 `customer_email`；
5. 测试成功后启用触发器。