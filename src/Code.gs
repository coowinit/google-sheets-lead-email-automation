/************************************
 * Google 表格客户线索邮件自动通知脚本
 *
 * 作用：
 * 1. 从 Google Sheets 读取客户线索数据；
 * 2. 读取 customer_email 列中的接收邮箱；
 * 3. 将每一条未发送的线索发送到 customer_email；
 * 4. 发送成功后写入 Sent，避免重复发送；
 * 5. 支持手动测试，也支持每 5 分钟自动执行。
 ************************************/

const CONFIG = {
  // Google 表格 ID：来自表格 URL 中 /d/ 和 /edit 之间的那一段
  SPREADSHEET_ID: '1AHVfBIQzy1aN5Dbhc2F70UDEA-IUe2lCFIVzAdwFlqM',

  // 工作表名称。为空时默认读取第一个工作表
  SHEET_NAME: '',

  // 每次最多发送多少条，防止一次运行发送过多
  MAX_SEND_PER_RUN: 20,

  // 邮件发送人显示名称
  SENDER_NAME: 'Lead Notification',

  // 邮件标题前缀
  EMAIL_SUBJECT_PREFIX: 'New Customer Lead',

  // 表格字段
  COL_CREATED_TIME: 'created_time',
  COL_PLATFORM: 'platform',
  COL_FORM_NAME: 'form_name',
  COL_CUSTOMER_TYPE: 'please_select_y',
  COL_FULL_NAME: 'full_name',
  COL_PHONE: 'phone_number',
  COL_LEAD_EMAIL: 'email',
  COL_ADDRESS: 'street_address',
  COL_LEAD_STATUS: 'lead_status',

  // 真正接收邮件的客户邮箱字段
  COL_CUSTOMER_EMAIL: 'customer_email',

  // 脚本自动新增的发送状态字段
  COL_SEND_STATUS: 'email_send_status',
  COL_SENT_TIME: 'email_sent_time',
  COL_ERROR_MESSAGE: 'email_error_message',

  STATUS_SENT: 'Sent',
  STATUS_FAILED: 'Failed'
};


/**
 * 主函数：扫描表格，把每条新线索发送给 customer_email
 */
function sendLeadInfoToCustomerEmail() {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const sheet = getTargetSheet_();
    const data = sheet.getDataRange().getValues();

    if (data.length < 2) {
      Logger.log('No data rows found.');
      return;
    }

    let headers = data[0].map(h => String(h).trim());

    // 如果表格中没有发送状态列，则自动新增
    headers = ensureRequiredColumns_(sheet, headers, [
      CONFIG.COL_SEND_STATUS,
      CONFIG.COL_SENT_TIME,
      CONFIG.COL_ERROR_MESSAGE
    ]);

    const col = buildColumnMap_(headers);

    validateRequiredColumns_(col, [
      CONFIG.COL_FULL_NAME,
      CONFIG.COL_PHONE,
      CONFIG.COL_LEAD_EMAIL,
      CONFIG.COL_CUSTOMER_EMAIL
    ]);

    // 从 customer_email 列读取第一个非空邮箱，作为统一接收邮箱
    const recipientEmail = getFirstCustomerEmail_(sheet, col, headers.length);

    if (!recipientEmail) {
      throw new Error('No customer_email found.');
    }

    if (!isValidEmail_(recipientEmail)) {
      throw new Error('Invalid customer_email: ' + recipientEmail);
    }

    let sentCount = 0;

    for (let i = 1; i < data.length; i++) {
      if (sentCount >= CONFIG.MAX_SEND_PER_RUN) break;

      const rowNumber = i + 1;
      const row = getFullRow_(sheet, rowNumber, headers.length);

      const sendStatus = getCell_(row, col, CONFIG.COL_SEND_STATUS);

      // 已发送过的不再重复发送
      if (String(sendStatus).trim() === CONFIG.STATUS_SENT) {
        continue;
      }

      const fullName = getCell_(row, col, CONFIG.COL_FULL_NAME);
      const phone = getCell_(row, col, CONFIG.COL_PHONE);
      const leadEmail = getCell_(row, col, CONFIG.COL_LEAD_EMAIL);

      // 空行跳过
      if (!fullName && !phone && !leadEmail) {
        continue;
      }

      try {
        const subject = buildEmailSubject_(row, col);
        const htmlBody = buildLeadEmailHtml_(row, col);
        const plainBody = buildLeadEmailText_(row, col);

        MailApp.sendEmail(
          recipientEmail,
          subject,
          plainBody,
          {
            name: CONFIG.SENDER_NAME,
            htmlBody: htmlBody
          }
        );

        writeResult_(sheet, rowNumber, col, CONFIG.STATUS_SENT, new Date(), '');
        sentCount++;

        Logger.log('Lead info sent to: ' + recipientEmail);

      } catch (err) {
        writeResult_(sheet, rowNumber, col, CONFIG.STATUS_FAILED, '', err.message);
        Logger.log('Failed to send row ' + rowNumber + ': ' + err.message);
      }
    }

    Logger.log('Total sent this run: ' + sentCount);

  } catch (err) {
    Logger.log('Script error: ' + err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}


/**
 * 测试函数：只发送第一条未发送线索
 *
 * 测试阶段建议先运行这个函数。
 * 每运行一次，只会发送一条未发送记录。
 */
function testSendFirstLeadToCustomerEmail() {
  const oldMax = CONFIG.MAX_SEND_PER_RUN;
  CONFIG.MAX_SEND_PER_RUN = 1;
  sendLeadInfoToCustomerEmail();
  CONFIG.MAX_SEND_PER_RUN = oldMax;
}


/**
 * 创建每 5 分钟自动运行一次的触发器
 *
 * 测试成功后，只需要运行一次这个函数。
 */
function createAutoSendLeadTriggerEvery5Minutes() {
  deleteAutoSendLeadTriggers_();

  ScriptApp.newTrigger('sendLeadInfoToCustomerEmail')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Auto trigger created: every 5 minutes.');
}


/**
 * 手动删除自动触发器
 *
 * 如果后期想停止自动发送，可以运行这个函数。
 */
function deleteAutoSendLeadTriggers() {
  deleteAutoSendLeadTriggers_();
  Logger.log('Auto triggers deleted.');
}


function deleteAutoSendLeadTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'sendLeadInfoToCustomerEmail') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


/**
 * 生成邮件标题
 */
function buildEmailSubject_(row, col) {
  const name = getCell_(row, col, CONFIG.COL_FULL_NAME) || 'Unknown Customer';
  const platform = getCell_(row, col, CONFIG.COL_PLATFORM);
  const formName = getCell_(row, col, CONFIG.COL_FORM_NAME);

  let subject = CONFIG.EMAIL_SUBJECT_PREFIX + ' - ' + name;

  if (platform) {
    subject += ' - ' + platform;
  }

  if (formName) {
    subject += ' - ' + formName;
  }

  return subject;
}


/**
 * 生成 HTML 邮件内容
 */
function buildLeadEmailHtml_(row, col) {
  const createdTime = escapeHtml_(getCell_(row, col, CONFIG.COL_CREATED_TIME));
  const platform = escapeHtml_(getCell_(row, col, CONFIG.COL_PLATFORM));
  const formName = escapeHtml_(getCell_(row, col, CONFIG.COL_FORM_NAME));
  const customerType = escapeHtml_(getCell_(row, col, CONFIG.COL_CUSTOMER_TYPE));
  const fullName = escapeHtml_(getCell_(row, col, CONFIG.COL_FULL_NAME));
  const phone = escapeHtml_(getCell_(row, col, CONFIG.COL_PHONE));
  const leadEmail = escapeHtml_(getCell_(row, col, CONFIG.COL_LEAD_EMAIL));
  const address = escapeHtml_(getCell_(row, col, CONFIG.COL_ADDRESS));
  const leadStatus = escapeHtml_(getCell_(row, col, CONFIG.COL_LEAD_STATUS));

  return `
  <div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #333;">
    <h2 style="margin-bottom: 16px;">New Customer Lead</h2>

    <p>A new customer lead has been received. Details are below:</p>

    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #ddd;">
      ${createdTime ? `<tr><td><strong>Created Time</strong></td><td>${createdTime}</td></tr>` : ''}
      ${platform ? `<tr><td><strong>Platform</strong></td><td>${platform}</td></tr>` : ''}
      ${formName ? `<tr><td><strong>Form Name</strong></td><td>${formName}</td></tr>` : ''}
      ${customerType ? `<tr><td><strong>Customer Type</strong></td><td>${customerType}</td></tr>` : ''}
      ${fullName ? `<tr><td><strong>Full Name</strong></td><td>${fullName}</td></tr>` : ''}
      ${phone ? `<tr><td><strong>Phone Number</strong></td><td>${phone}</td></tr>` : ''}
      ${leadEmail ? `<tr><td><strong>Email</strong></td><td>${leadEmail}</td></tr>` : ''}
      ${address ? `<tr><td><strong>Street Address</strong></td><td>${address}</td></tr>` : ''}
      ${leadStatus ? `<tr><td><strong>Lead Status</strong></td><td>${leadStatus}</td></tr>` : ''}
    </table>

    <p style="margin-top: 20px;">
      Please contact this customer as soon as possible.
    </p>
  </div>
  `;
}


/**
 * 生成纯文本邮件内容
 */
function buildLeadEmailText_(row, col) {
  return `
New Customer Lead

Created Time: ${getCell_(row, col, CONFIG.COL_CREATED_TIME)}
Platform: ${getCell_(row, col, CONFIG.COL_PLATFORM)}
Form Name: ${getCell_(row, col, CONFIG.COL_FORM_NAME)}
Customer Type: ${getCell_(row, col, CONFIG.COL_CUSTOMER_TYPE)}
Full Name: ${getCell_(row, col, CONFIG.COL_FULL_NAME)}
Phone Number: ${getCell_(row, col, CONFIG.COL_PHONE)}
Email: ${getCell_(row, col, CONFIG.COL_LEAD_EMAIL)}
Street Address: ${getCell_(row, col, CONFIG.COL_ADDRESS)}
Lead Status: ${getCell_(row, col, CONFIG.COL_LEAD_STATUS)}

Please contact this customer as soon as possible.
`;
}


/**
 * 读取 customer_email 列中第一个非空邮箱
 */
function getFirstCustomerEmail_(sheet, col, totalColumns) {
  const lastRow = sheet.getLastRow();

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = getFullRow_(sheet, rowNumber, totalColumns);
    const email = getCell_(row, col, CONFIG.COL_CUSTOMER_EMAIL);

    if (email) {
      return email;
    }
  }

  return '';
}


/**
 * 获取目标工作表
 */
function getTargetSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  if (CONFIG.SHEET_NAME) {
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      throw new Error('Sheet not found: ' + CONFIG.SHEET_NAME);
    }
    return sheet;
  }

  return ss.getSheets()[0];
}


/**
 * 如果缺少指定列，则自动新增到表格末尾
 */
function ensureRequiredColumns_(sheet, headers, requiredColumns) {
  requiredColumns.forEach(colName => {
    if (!headers.includes(colName)) {
      const newColIndex = headers.length + 1;
      sheet.getRange(1, newColIndex).setValue(colName);
      headers.push(colName);
    }
  });

  return headers;
}


/**
 * 建立字段名和列号的对应关系
 */
function buildColumnMap_(headers) {
  const map = {};

  headers.forEach((header, index) => {
    if (header) {
      map[String(header).trim()] = index + 1;
    }
  });

  return map;
}


/**
 * 检查必要字段是否存在
 */
function validateRequiredColumns_(col, requiredColumns) {
  const missing = requiredColumns.filter(name => !col[name]);

  if (missing.length > 0) {
    throw new Error('Missing required columns: ' + missing.join(', '));
  }
}


/**
 * 读取整行数据
 */
function getFullRow_(sheet, rowNumber, totalColumns) {
  return sheet.getRange(rowNumber, 1, 1, totalColumns).getValues()[0];
}


/**
 * 根据字段名读取单元格内容
 */
function getCell_(row, col, colName) {
  if (!col[colName]) return '';
  return String(row[col[colName] - 1] || '').trim();
}


/**
 * 写入发送结果
 */
function writeResult_(sheet, rowNumber, col, status, sentTime, errorMessage) {
  sheet.getRange(rowNumber, col[CONFIG.COL_SEND_STATUS]).setValue(status);
  sheet.getRange(rowNumber, col[CONFIG.COL_SENT_TIME]).setValue(sentTime || '');
  sheet.getRange(rowNumber, col[CONFIG.COL_ERROR_MESSAGE]).setValue(errorMessage || '');
}


/**
 * 邮箱格式检查
 */
function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}


/**
 * HTML 转义，避免特殊字符影响邮件结构
 */
function escapeHtml_(value) {
  if (!value) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
