# Google 表格客户线索邮件自动通知系统

> 当前版本：**v1.1.2**  
> 更新日期：**2026-08-20**  
> 技术组合：**Google Sheets + Google Apps Script + Gmail**

本项目用于把 Google 表格中的新客户线索自动整理为邮件，并发送到指定业务邮箱，同时在表格中记录发送状态、发送时间和错误信息，避免重复通知。

v1.1.2 是一次以**稳定性和长期维护**为目标的修复版本，重点解决了实际运行中出现的两个问题：

- Apps Script 读取错误标签页，导致真实业务数据没有进入发送流程；
- `Session.getEffectiveUser().getEmail()` 需要额外的 `userinfo.email` 权限，导致多条线索被标记为 `Failed`。

当前版本已经移除对 `Session.getEffectiveUser()` 的依赖，并改用可选的固定 `REPLY_TO` 配置；同时修复了测试函数在“第一条发送失败”时继续尝试后续记录的问题。

---

## 目录

- [一、系统目标与适用范围](#一系统目标与适用范围)
- [二、系统架构与运行流程](#二系统架构与运行流程)
- [三、表格字段说明](#三表格字段说明)
- [四、三个邮箱概念必须区分](#四三个邮箱概念必须区分)
- [五、项目目录](#五项目目录)
- [六、部署前检查](#六部署前检查)
- [七、完整部署步骤](#七完整部署步骤)
- [八、核心配置说明](#八核心配置说明)
- [九、发送状态与重试机制](#九发送状态与重试机制)
- [十、测试与上线流程](#十测试与上线流程)
- [十一、自动触发器管理](#十一自动触发器管理)
- [十二、常见错误与排查](#十二常见错误与排查)
- [十三、v1.1.2 故障复盘](#十三v112-故障复盘)
- [十四、安全与公开仓库注意事项](#十四安全与公开仓库注意事项)
- [十五、长期维护原则](#十五长期维护原则)
- [十六、版本记录](#十六版本记录)
- [十七、文件说明](#十七文件说明)
- [十八、快速复用清单](#十八快速复用清单)

---

## 一、系统目标与适用范围

### 1. 系统目标

系统只负责一件事：

```text
新客户线索进入 Google Sheets
        ↓
Apps Script 定时扫描
        ↓
找到尚未成功发送的记录
        ↓
生成客户线索通知邮件
        ↓
发送到 customer_email
        ↓
回写 Sent / Failed、发送时间和错误信息
```

### 2. 适用场景

- Facebook / Instagram 广告表单线索通知；
- Google 表格客户询盘提醒；
- 销售人员或代理商线索分发；
- 每日少量或中等数量的内部业务通知；
- 小规模 CRM 前置通知流程。

### 3. 不适合的场景

本项目是内部业务通知工具，不是营销群发平台。

| 场景 | 建议 |
|---|---|
| 每天几十条线索 | 适合 |
| 每天上百条线索 | 需要关注 Gmail / Apps Script 配额 |
| 内部销售通知 | 适合 |
| 批量营销邮件 | 不建议 |
| 需要退订、追踪、营销统计 | 建议使用专业邮件服务 |

---

## 二、系统架构与运行流程

### 1. 参与组件

| 组件 | 作用 |
|---|---|
| Google Sheets | 保存客户线索、接收邮箱和发送状态 |
| Google Apps Script | 读取数据、生成邮件、发送邮件、回写状态 |
| Gmail / MailApp | 实际发出通知邮件 |
| 时间触发器 | 每 5 分钟运行一次主发送函数 |
| LockService | 防止手动运行与定时触发器并发导致重复发送 |

### 2. 完整流程

```text
广告 / 表单产生客户线索
        ↓
线索写入 Google 表格
        ↓
Apps Script 每 5 分钟执行
        ↓
按 SPREADSHEET_ID + SHEET_ID 精确找到标签页
        ↓
检查表头和必要字段
        ↓
读取第一个非空 customer_email
        ↓
跳过 email_send_status = Sent 的记录
        ↓
提取 6 个客户字段
        ↓
生成 HTML + 纯文本邮件
        ↓
MailApp.sendEmail()
        ↓
成功：写入 Sent + 时间
失败：写入 Failed + 错误信息
```

邮件从**授权并运行 Apps Script 的 Google 账号**发出。

---

## 三、表格字段说明

### 1. 邮件正文中的 6 个客户字段

| 表格字段 | 邮件显示名称 | 用途 |
|---|---|---|
| `business_type` | Business Type | 客户类型 |
| `requirements` | Requirements | 客户需求 |
| `full_name` | Full Name | 客户姓名 |
| `phone_number` | Phone Number | 联系电话 |
| `email` | Email Address | 客户自己的邮箱 |
| `street_address` | Street Address | 客户地址 |

字段位置示例：

![邮件字段](assets/screenshots/15-email-fields.png)

### 2. 必须存在的业务字段

```text
business_type
requirements
full_name
phone_number
email
street_address
customer_email
```

### 3. 脚本使用的状态字段

```text
email_send_status
email_sent_time
email_error_message
```

如果缺少这 3 个状态字段，脚本会自动追加到表格末尾。

不要随意改名，否则脚本将无法正确判断发送状态。

---

## 四、三个邮箱概念必须区分

这是本项目最容易混淆的地方。

| 项目 | 含义 | 来源 |
|---|---|---|
| `email` | 线索客户自己的邮箱，只显示在通知正文中 | Google 表格 |
| `customer_email` | 真正接收客户线索通知的业务邮箱 | Google 表格 |
| `CONFIG.REPLY_TO` | 收到通知后点击“回复”时使用的回复地址 | Apps Script 配置 |

系统实际发送关系：

```text
客户 email / 姓名 / 电话 / 地址等
        ↓
整理成通知邮件
        ↓
发送到 customer_email
        ↓
如果设置了 REPLY_TO
点击“回复”时回复到该固定邮箱
```

### `customer_email` 的规则

当前版本会从上到下查找 `customer_email` 列，并使用**第一个非空邮箱**作为统一通知接收邮箱。

因此，如果整个标签页只应该发送到一个业务邮箱，建议该列只保留一个有效接收地址，避免历史旧邮箱优先被读取。

> 当前版本不是“每一行发送到不同邮箱”的分发模式。

---

## 五、项目目录

```text
google-sheets-lead-email-automation/
├── README.md
├── CHANGELOG.md
├── .gitattributes
├── src/
│   ├── Code.gs
│   ├── Code.txt
│   └── Google-Sheets-test-URL.txt
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
        ├── 12-trigger-list.png
        ├── 13-missing-column-error.png
        ├── 14-fixed-execution-log.png
        ├── 15-email-fields.png
        └── README-screenshots.md
```

### 本次结构调整

旧仓库中存在多份中英文脚本副本，其中旧脚本仍包含已经确认会触发权限错误的 `Session.getEffectiveUser()` 调用。

v1.1.2 将脚本统一为：

```text
src/Code.gs
src/Code.txt
```

两份内容保持一致，避免以后误复制旧版本。

---

## 六、部署前检查

部署前确认：

- Google 表格第一行是字段名；
- 第二行开始才是客户数据；
- 7 个业务字段完整存在；
- `customer_email` 中至少有一个有效接收邮箱；
- 当前 Google 账号有权访问目标表格；
- 当前 Google 账号可以使用 Gmail / MailApp 发信；
- `SPREADSHEET_ID` 正确；
- `SHEET_ID` 与真正业务标签页 URL 中的 `gid` 一致；
- 正式上线前先运行单条测试，不要直接恢复批量触发器。

---

## 七、完整部署步骤

### 步骤 1：确认 Google 表格结构

第一行必须为字段名。

![表格整体结构](assets/screenshots/01-sheet-overview.png)

重点检查：

```text
business_type
requirements
full_name
phone_number
email
street_address
customer_email
```

### 步骤 2：确认通知接收邮箱

`customer_email` 是业务通知邮箱，不是客户自己的 `email`。

![customer_email 字段](assets/screenshots/02-customer-email-column.png)

### 步骤 3：获取 Spreadsheet ID 与工作表 gid

Google 表格 URL 通常类似：

```text
https://docs.google.com/spreadsheets/d/表格ID/edit?gid=工作表gid
```

对应：

```javascript
SPREADSHEET_ID: '表格ID',
SHEET_ID: 工作表gid,
```

`SHEET_ID` 是数字，不加引号。

### 步骤 4：打开 Apps Script

```text
Google 表格 → 扩展程序 → Apps Script
```

![打开 Apps Script](assets/screenshots/03-open-apps-script.png)

### 步骤 5：复制最新版代码

复制：

```text
src/Code.gs
```

到 Apps Script 编辑器中。

![粘贴代码](assets/screenshots/04-paste-code.png)

### 步骤 6：检查 CONFIG

至少检查：

```javascript
const CONFIG = {
  // Google 表格 ID：URL 中 /d/ 与 /edit 之间的内容
  SPREADSHEET_ID: '1tC4jW9Sy-Euer9F1VZRLxBuvIzrMXmo1d3u0xQOx_9s',
  // 目标工作表 gid：URL 中 gid= 后面的数字
  SHEET_ID: 579167497,
  // 每次执行最多发送多少封邮件
  MAX_SEND_PER_RUN: 20,
  // 发件人显示名称
  SENDER_NAME: 'Customer Enquiries',
  // 邮件标题前缀
  EMAIL_SUBJECT_PREFIX: 'New Customer Enquiry',
  // 邮件正文标题
  EMAIL_HEADING: 'New Customer Enquiry',
  // 可选固定回复邮箱；留空时不显式设置 replyTo，避免额外用户邮箱权限依赖
  // 如确需指定回复邮箱，请填写固定业务邮箱，例如：'sales@example.com'
  REPLY_TO: 'chinabarefoot@gmail.com'
};
```

如果不需要指定回复地址：

```javascript
REPLY_TO: '',
```

**不要再使用：**

```javascript
Session.getEffectiveUser().getEmail()
```

来动态生成 `replyTo`。

### 步骤 7：保存项目

![保存项目](assets/screenshots/05-save-project.png)

### 步骤 8：先检查目标工作表

运行：

```javascript
debugTargetSheetHeaders
```

日志应确认：

```text
Sheet name: 真正业务标签页名称
Sheet gid: 与 URL 中 gid 完全一致
Headers: 包含 customer_email 及全部业务字段
```

### 步骤 9：运行单条测试

运行：

```javascript
testSendFirstLeadToCustomerEmail
```

![运行测试函数](assets/screenshots/06-run-test-function.png)

v1.1.2 中，该函数只会尝试第一条尚未标记为 `Sent` 的有效记录。

即使这一条失败，也不会继续把后面的记录批量标记为 `Failed`。

### 步骤 10：首次授权

第一次运行可能需要 Google 授权。

![首次授权](assets/screenshots/07-authorize-script.png)

脚本核心需要：

- 读取和修改目标 Google 表格；
- 通过当前账号发送邮件；
- 创建和管理 Apps Script 触发器。

v1.1.2 不再为了读取当前用户邮箱而依赖 `Session.getEffectiveUser()`。

### 步骤 11：检查执行日志

正确日志应类似：

```text
Target sheet: 昆州客户自动群发表 | gid: 579167497
Notification recipient: example@example.com
Row 55 sent successfully. Recipient: example@example.com
Total attempted this run: 1. Total emails sent this run: 1.
```

### 步骤 12：检查表格状态

成功：

```text
email_send_status = Sent
email_sent_time = 实际发送时间
email_error_message = 空
```

失败：

```text
email_send_status = Failed
email_sent_time = 空
email_error_message = 具体错误
```

![发送状态](assets/screenshots/09-sheet-status-sent.png)

### 步骤 13：检查邮件

确认：

- 收件人来自 `customer_email`；
- 邮件标题包含客户姓名和客户类型；
- 正文只包含 6 个指定字段；
- 点击回复时，若配置 `REPLY_TO`，回复地址正确；
- 邮件没有进入垃圾邮件。

![邮件预览](assets/screenshots/10-gmail-sent-preview.png)

### 步骤 14：恢复自动触发器

单条测试完全正常后，再运行一次：

```javascript
createAutoSendLeadTriggerEvery5Minutes
```

![创建触发器](assets/screenshots/11-create-trigger.png)

触发器应为：

```text
函数：sendLeadInfoToCustomerEmail
来源：时间驱动
频率：每 5 分钟
```

![触发器列表](assets/screenshots/12-trigger-list.png)

---

## 八、核心配置说明

### `SPREADSHEET_ID`

定位整个 Google 表格文件。

```javascript
SPREADSHEET_ID: '...'
```

### `SHEET_ID`

定位真正业务标签页。

```javascript
SHEET_ID: 579167497
```

本项目不再使用：

```javascript
ss.getSheets()[0]
```

来默认读取第一个标签页。

### `MAX_SEND_PER_RUN`

```javascript
MAX_SEND_PER_RUN: 20
```

正常自动任务每次最多成功发送 20 封。

### `SENDER_NAME`

```javascript
SENDER_NAME: 'Customer Enquiries'
```

这是收件箱中看到的发件人显示名称。

### `EMAIL_SUBJECT_PREFIX`

```javascript
EMAIL_SUBJECT_PREFIX: 'New Customer Enquiry'
```

最终标题示例：

```text
New Customer Enquiry | Warren Wink | homeowner
```

### `EMAIL_HEADING`

```javascript
EMAIL_HEADING: 'New Customer Enquiry'
```

用于 HTML 和纯文本正文标题。

### `REPLY_TO`

```javascript
REPLY_TO: 'your-business-email@example.com'
```

这是可选固定回复邮箱。

如果留空：

```javascript
REPLY_TO: ''
```

脚本不会设置 `replyTo`，也不会读取当前 Google 用户邮箱。

---

## 九、发送状态与重试机制

### 状态含义

| 状态 | 含义 |
|---|---|
| 空白 | 尚未成功发送 |
| `Sent` | 已成功发送，以后跳过 |
| `Failed` | 上次失败，后续仍会继续尝试 |

当前代码只有 `Sent` 会被跳过。

因此故障修复后，原来已经标记为 `Failed` 的记录**无需手工清空状态**，下一次运行会自动重新尝试。

### 防重复机制

主函数使用：

```javascript
LockService.getScriptLock()
```

防止：

- 手动运行与定时触发器重叠；
- 两次定时触发器同时运行；
- 并发情况下重复发送同一记录。

### 测试模式

v1.1.2 的测试函数不再临时修改 `CONFIG.MAX_SEND_PER_RUN`，而是通过独立的 `testMode` 控制流程。

测试模式规则：

```text
找到第一条有效且未 Sent 的记录
        ↓
只尝试这一条
        ↓
成功或失败都立即停止
```

这避免了旧版本“第一条失败后继续尝试下一条”的问题。

---

## 十、测试与上线流程

推荐固定使用以下顺序：

```text
1. 保存代码
2. debugTargetSheetHeaders
3. 检查 Sheet name / gid / Headers
4. testSendFirstLeadToCustomerEmail
5. 确认只尝试 1 条
6. 确认邮件收到
7. 确认表格写入 Sent
8. 再创建或恢复 5 分钟触发器
```

不建议在未知故障状态下直接运行主函数或直接恢复自动触发器，因为可能存在积压的 `Failed` 记录。

---

## 十一、自动触发器管理

### 创建 / 重建 5 分钟触发器

运行一次：

```javascript
createAutoSendLeadTriggerEvery5Minutes
```

该函数会先删除所有指向：

```javascript
sendLeadInfoToCustomerEmail
```

的旧触发器，然后重新创建一个 5 分钟触发器，避免重复创建。

### 停止自动发送

运行：

```javascript
deleteAutoSendLeadTriggers
```

或者在 Apps Script 左侧“触发器”页面手动删除。

### 是否需要打开电脑

不需要。

触发器运行在 Google Apps Script 云端，浏览器和电脑关闭后仍会继续执行。

---

## 十二、常见错误与排查

### 1. `Missing required columns: customer_email`

常见原因：

- 读取错标签页；
- `SHEET_ID` 不正确；
- 表头拼写错误；
- 表头中存在空格、BOM 或零宽字符。

![字段缺失错误](assets/screenshots/13-missing-column-error.png)

排查：

```javascript
debugTargetSheetHeaders
```

确认日志里的 `Sheet gid` 与浏览器 URL 中 `gid=` 后面的数字一致。

当前代码会自动运行 `normalizeHeader_()` 清理 BOM、零宽字符和首尾空格。

### 2. 脚本执行成功，但 `Total emails sent this run: 0`

检查：

- 是否读取到了真正业务标签页；
- 新线索是否已经是 `Sent`；
- 是否有有效客户字段；
- 是否真的存在待处理的新记录。

### 3. `customer_email` 没有找到

检查：

- `customer_email` 表头是否存在；
- 该列是否至少有一个非空邮箱；
- 是否填写在正确标签页；
- 是否被公式返回为空字符串。

### 4. `Invalid customer_email address`

确保格式类似：

```text
name@example.com
```

### 5. `Invalid REPLY_TO address`

检查 `CONFIG.REPLY_TO`。

不需要 Reply-To 时直接设置：

```javascript
REPLY_TO: '',
```

### 6. `You do not have permission to call Session.getEffectiveUser`

这是 v1.1.0 / 旧脚本中已经确认的故障。

典型错误：

```text
You do not have permission to call Session.getEffectiveUser.
Required permissions: https://www.googleapis.com/auth/userinfo.email
```

原因是旧代码使用：

```javascript
Session.getEffectiveUser().getEmail()
```

读取当前 Google 用户邮箱并作为 `replyTo`。

**v1.1.2 已彻底移除该调用。**

正确方式是：

```javascript
REPLY_TO: '固定业务邮箱'
```

或者：

```javascript
REPLY_TO: ''
```

### 7. 多条记录突然全部变成 `Failed`

如果旧测试函数在第一条发送失败后继续遍历，因为 `sentCount` 没有增加，它可能继续尝试后面的记录。

v1.1.2 已修复：

```text
测试函数 = 无论成功或失败，只尝试第一条有效待发送记录
```

### 8. Gmail 当日发送额度不足

代码会检查：

```javascript
MailApp.getRemainingDailyQuota()
```

额度耗尽时会停止，并给出明确错误。

### 9. 自动触发器没有运行

检查：

- Apps Script 左侧是否存在触发器；
- 执行记录中是否有失败；
- 授权账号是否仍有表格和 Gmail 权限；
- `SPREADSHEET_ID` / `SHEET_ID` 是否变化；
- 是否修改过主函数名称；
- 是否仍在运行旧脚本项目。

### 10. 修改代码后仍像旧版本

检查：

- 是否保存；
- 项目内是否仍有旧的同名函数；
- 是否复制错旧脚本文件；
- 触发器是否指向正确主函数。

v1.1.2 仓库已经只保留 `Code.gs` / `Code.txt` 两个等价副本，减少版本混淆。

---

## 十三、v1.1.2 故障复盘

### 故障 A：脚本读取“测试自动发送”，真实业务表没有发送

实际业务标签页：

```text
昆州客户自动群发表
```

实际业务 gid：

```text
579167497
```

故障排查中发现脚本曾经运行在另一个测试标签页，因此日志虽然显示“执行完成”，却没有处理真正的新客户数据。

修复原则：

```text
永远使用 SPREADSHEET_ID + SHEET_ID 精确定位
```

并在改动后先运行：

```javascript
debugTargetSheetHeaders
```

### 故障 B：切回真实业务表后，多条记录变成 `Failed`

错误日志：

```text
You do not have permission to call Session.getEffectiveUser.
Required permissions: https://www.googleapis.com/auth/userinfo.email
```

错误链：

```text
找到待发送客户
        ↓
生成邮件
        ↓
读取 Session.getEffectiveUser().getEmail()
        ↓
缺少 userinfo.email 权限
        ↓
当前记录 Failed
```

### 为什么不采用“继续增加权限”的方案

可选方案有两个：

1. 增加 `userinfo.email` 授权，继续读取当前用户邮箱；
2. 删除不必要的 Session 依赖，使用固定可选 `REPLY_TO`。

本项目选择第二种。

原因：

- Reply-To 不是核心业务逻辑；
- 固定业务邮箱更容易维护；
- 避免因为账号、授权变化导致触发器再次失败；
- 自动触发器执行时不能依赖交互式授权流程；
- 架构更简单：Sheets → MailApp，而不是 Sheets → Session/OAuth → MailApp。

### 故障 C：测试模式连续标记多条 Failed

旧测试逻辑通过临时把：

```javascript
CONFIG.MAX_SEND_PER_RUN = 1
```

来限制测试数量。

但 `MAX_SEND_PER_RUN` 实际限制的是“成功发送数量”。

如果第一条失败：

```text
sentCount 仍然是 0
```

循环会继续尝试后面的记录。

v1.1.2 改为独立 `testMode`：

```text
attemptedCount >= 1 → 立即停止
```

因此测试函数真正实现“只尝试一条”。

---

## 十四、安全与公开仓库注意事项

表格可能包含：

- 客户姓名；
- 电话；
- 邮箱；
- 地址；
- 客户需求。

建议：

- Google 表格保持私有；
- 只授权必要人员；
- GitHub 截图中的真实客户信息必须打码；
- 公开仓库前检查 `SPREADSHEET_ID`；
- 公开仓库前检查 `SHEET_ID`；
- 公开仓库前检查 `REPLY_TO` 是否允许公开；
- 公开仓库前检查 `src/Google-Sheets-test-URL.txt`；
- 不要把 OAuth token、密码、API 密钥或账号凭证写入仓库。

> Spreadsheet ID 本身不等于访问权限，但没有必要时仍不建议公开真实业务配置。

---

## 十五、长期维护原则

### 1. 先保持架构简单

核心依赖保持为：

```text
Google Sheets
    ↓
Apps Script
    ↓
MailApp / Gmail
```

不要为了一个可选功能引入额外账号权限依赖。

### 2. 配置集中在 `CONFIG`

以后修改：

- 表格 ID；
- gid；
- 发件人名称；
- 邮件标题；
- Reply-To；
- 每次发送数量；

优先从 `CONFIG` 修改，不要把业务配置散落到多个函数。

### 3. 不再保留多份功能重复的脚本

仓库只维护：

```text
Code.gs
Code.txt
```

两者内容一致。

Git 历史已经可以保存旧版本，不需要在当前目录继续保留可能误用的旧脚本。

### 4. 出现故障先看执行记录

推荐顺序：

```text
执行记录
→ Target sheet / gid
→ Headers
→ Notification recipient
→ Failed error_message
→ Gmail 配额
→ 触发器
```

不要第一时间重写代码。

---

## 十六、版本记录

### v1.1.2 - 2026-08-20

- 修复真实业务标签页定位问题，确认使用正确 `SHEET_ID`；
- 移除 `Session.getEffectiveUser().getEmail()`；
- 修复 `userinfo.email` 权限不足导致批量 `Failed`；
- 新增可选固定 `CONFIG.REPLY_TO`；
- 修复测试函数失败后继续尝试后续记录的问题；
- 测试模式改为独立 `testMode` + `attemptedCount`；
- 日志同时输出尝试数量和成功数量；
- 保留 `Failed` 自动重试机制；
- 统一仓库代码为 `src/Code.gs` 和 `src/Code.txt`；
- 删除当前目录中仍包含旧权限逻辑的重复脚本副本；
- 重写 README 的部署、排错、故障复盘与长期维护说明。

### v1.1.0 - 2026-07-02

- 通过工作表 `gid` 精确定位目标标签页；
- 修复 `Missing required columns: customer_email`；
- 新增 `debugTargetSheetHeaders()`；
- 增加表头空格、BOM 和零宽字符清理；
- 邮件正文精简为 6 个指定字段；
- 新增 `requirements` 字段；
- 增加 Gmail 剩余额度检查；
- 增加脚本锁；
- 增加发送状态、错误日志和 HTML 邮件。

### v1.0.0

- 完成 Google Sheets 客户线索读取；
- 支持发送到 `customer_email`；
- 支持状态、时间和错误记录；
- 支持单条测试；
- 支持每 5 分钟定时执行。

---

## 十七、文件说明

| 文件 | 说明 |
|---|---|
| `README.md` | 当前完整安装、配置、故障复盘和维护文档 |
| `CHANGELOG.md` | 版本更新记录 |
| `src/Code.gs` | **当前唯一推荐复制到 Apps Script 的完整代码** |
| `src/Code.txt` | 与 `Code.gs` 内容完全相同，方便普通文本编辑器查看 |
| `src/Google-Sheets-test-URL.txt` | 测试表格地址；公开仓库前必须复核 |
| `assets/screenshots/` | 原安装步骤、历史错误和修复截图 |
| `assets/screenshots/README-screenshots.md` | 截图命名说明 |

---

## 十八、快速复用清单

按顺序操作：

1. 复制 `src/Code.gs`；
2. 修改或确认 `SPREADSHEET_ID`；
3. 修改或确认 `SHEET_ID`；
4. 修改或确认 `REPLY_TO`；
5. 核对 7 个业务字段；
6. 检查 `customer_email`；
7. 运行 `debugTargetSheetHeaders`；
8. 确认目标工作表名称和 gid；
9. 运行 `testSendFirstLeadToCustomerEmail`；
10. 确认 `Total attempted this run: 1`；
11. 确认 `Total emails sent this run: 1`；
12. 检查邮件实际到达；
13. 检查对应行变为 `Sent`；
14. 最后运行 `createAutoSendLeadTriggerEvery5Minutes`；
15. 定期查看 Apps Script“执行记录”和“触发器”。

至此，系统即可恢复为稳定的自动客户线索邮件通知流程。
