/************************************
 * Google 表格客户线索邮件自动通知脚本
 * 六字段优化版 · v1.1.2 权限修复版
 *
 * 邮件中仅发送以下字段：
 * 1. business_type   客户类型
 * 2. requirements    客户需求
 * 3. full_name       客户姓名
 * 4. phone_number    联系电话
 * 5. email           客户邮箱
 * 6. street_address  客户地址
 *
 * 功能说明：
 * 1. 通过 Spreadsheet ID 和工作表 gid 精确定位工作表；
 * 2. 从 customer_email 列读取统一通知接收邮箱；
 * 3. 自动发送尚未通知的客户线索；
 * 4. 自动维护发送状态、发送时间和错误信息；
 * 5. 已标记为 Sent 的记录不会重复发送；
 * 6. 支持单条测试和每 5 分钟自动执行；
 * 7. 自动清理表头中的空格、BOM 和零宽字符。
 ************************************/

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
  REPLY_TO: 'chinabarefoot@gmail.com',

  // 邮件正文中需要展示的 6 个字段
  COL_BUSINESS_TYPE: 'business_type',
  COL_REQUIREMENTS: 'requirements',
  COL_FULL_NAME: 'full_name',
  COL_PHONE: 'phone_number',
  COL_LEAD_EMAIL: 'email',
  COL_ADDRESS: 'street_address',

  // 统一接收通知邮件的邮箱字段
  COL_CUSTOMER_EMAIL: 'customer_email',

  // 脚本自动新增的发送状态字段
  COL_SEND_STATUS: 'email_send_status',
  COL_SENT_TIME: 'email_sent_time',
  COL_ERROR_MESSAGE: 'email_error_message',

  // 状态值
  STATUS_SENT: 'Sent',
  STATUS_FAILED: 'Failed'
};


/**
 * 主函数：
 * 扫描目标工作表，将尚未发送的客户线索发送到 customer_email。
 */
function sendLeadInfoToCustomerEmail() {
  sendLeadInfoToCustomerEmailCore_(false);
}


/**
 * 发送核心逻辑。
 *
 * @param {boolean} testMode
 *   false：正常模式，最多成功发送 CONFIG.MAX_SEND_PER_RUN 封；
 *   true：测试模式，只尝试第一条尚未标记为 Sent 的有效线索。
 */
function sendLeadInfoToCustomerEmailCore_(testMode) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    // 防止手动运行与定时触发器同时执行，避免重复发送
    lock.waitLock(30000);
    lockAcquired = true;

    const sheet = getTargetSheet_();

    Logger.log(
      'Target sheet: ' +
      sheet.getName() +
      ' | gid: ' +
      sheet.getSheetId()
    );

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 2 || lastColumn < 1) {
      Logger.log('No customer leads are available to send.');
      return;
    }

    // 读取并清理第一行表头
    let headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getDisplayValues()[0]
      .map(normalizeHeader_);

    Logger.log('Original headers: ' + JSON.stringify(headers));

    // 缺少状态字段时，自动添加到表格末尾
    headers = ensureRequiredColumns_(sheet, headers, [
      CONFIG.COL_SEND_STATUS,
      CONFIG.COL_SENT_TIME,
      CONFIG.COL_ERROR_MESSAGE
    ]);

    const col = buildColumnMap_(headers);

    // 检查发送所需的字段是否存在
    validateRequiredColumns_(col, [
      CONFIG.COL_BUSINESS_TYPE,
      CONFIG.COL_REQUIREMENTS,
      CONFIG.COL_FULL_NAME,
      CONFIG.COL_PHONE,
      CONFIG.COL_LEAD_EMAIL,
      CONFIG.COL_ADDRESS,
      CONFIG.COL_CUSTOMER_EMAIL
    ]);

    // 一次性读取全部数据，减少反复访问表格
    const rows = sheet
      .getRange(2, 1, lastRow - 1, headers.length)
      .getDisplayValues();

    // 从 customer_email 列中读取第一个非空邮箱，
    // 作为所有客户线索的统一通知接收邮箱
    const recipientEmail = getFirstCustomerEmailFromRows_(rows, col);

    if (!recipientEmail) {
      throw new Error('No recipient email was found in the customer_email column.');
    }

    if (!isValidEmail_(recipientEmail)) {
      throw new Error('Invalid customer_email address: ' + recipientEmail);
    }

    Logger.log('Notification recipient: ' + recipientEmail);

    // 固定 Reply-To 为可选配置。
    // 留空时不显式设置 Reply-To，因此不需要读取当前用户邮箱。
    const replyTo = String(CONFIG.REPLY_TO || '').trim();

    if (replyTo && !isValidEmail_(replyTo)) {
      throw new Error('Invalid REPLY_TO address: ' + replyTo);
    }

    // 获取当前账号当天剩余的邮件发送额度
    const remainingQuota = MailApp.getRemainingDailyQuota();

    if (remainingQuota <= 0) {
      throw new Error('The daily email sending quota for this account has been exhausted.');
    }

    // 测试模式只允许成功发送 1 封；正常模式按配置执行
    const configuredMaxSend = testMode
      ? 1
      : CONFIG.MAX_SEND_PER_RUN;

    // 本次实际发送上限不能超过剩余额度
    const maxSendThisRun = Math.min(
      configuredMaxSend,
      remainingQuota
    );

    let sentCount = 0;
    let attemptedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      if (sentCount >= maxSendThisRun) {
        break;
      }

      // 测试模式无论成功还是失败，都只尝试第一条有效待发送记录
      if (testMode && attemptedCount >= 1) {
        break;
      }

      const row = rows[i];
      const rowNumber = i + 2;

      const sendStatus = getCell_(
        row,
        col,
        CONFIG.COL_SEND_STATUS
      );

      // 已发送成功的记录直接跳过
      if (
        String(sendStatus).trim().toLowerCase() ===
        CONFIG.STATUS_SENT.toLowerCase()
      ) {
        continue;
      }

      // 提取需要发送的 6 个客户字段
      const lead = extractLeadData_(row, col);

      // 六个字段全部为空时，视为空记录并跳过
      if (!hasLeadContent_(lead)) {
        continue;
      }

      attemptedCount++;

      try {
        const subject = buildEmailSubject_(lead);
        const htmlBody = buildLeadEmailHtml_(lead);
        const plainBody = buildLeadEmailText_(lead);

        // 使用对象参数发送邮件
        const mailOptions = {
          to: recipientEmail,
          subject: subject,
          body: plainBody,
          htmlBody: htmlBody,
          name: CONFIG.SENDER_NAME
        };

        // 仅在明确配置固定回复邮箱时才设置 Reply-To
        if (replyTo) {
          mailOptions.replyTo = replyTo;
        }

        MailApp.sendEmail(mailOptions);

        // 发送成功后记录状态和发送时间
        writeResult_(
          sheet,
          rowNumber,
          col,
          CONFIG.STATUS_SENT,
          new Date(),
          ''
        );

        sentCount++;

        Logger.log(
          'Row ' +
          rowNumber +
          ' sent successfully. Recipient: ' +
          recipientEmail
        );

      } catch (err) {
        const errorMessage = getErrorMessage_(err);

        // 单条发送失败时记录错误，但正常模式仍可继续处理后续记录
        writeResult_(
          sheet,
          rowNumber,
          col,
          CONFIG.STATUS_FAILED,
          '',
          errorMessage
        );

        Logger.log(
          'Row ' +
          rowNumber +
          ' failed: ' +
          errorMessage
        );
      }
    }

    SpreadsheetApp.flush();

    Logger.log(
      'Total attempted this run: ' +
      attemptedCount +
      '. Total emails sent this run: ' +
      sentCount +
      '.'
    );

  } catch (err) {
    Logger.log('Script error: ' + getErrorMessage_(err));
    throw err;

  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}


/**
 * 测试函数：
 * 每次只发送第一条尚未标记为 Sent 的客户线索。
 */
function testSendFirstLeadToCustomerEmail() {
  sendLeadInfoToCustomerEmailCore_(true);
}


/**
 * 创建每 5 分钟执行一次的自动触发器。
 * 测试成功后，只需手动运行一次此函数。
 */
function createAutoSendLeadTriggerEvery5Minutes() {
  // 创建前先删除旧触发器，避免重复创建
  deleteAutoSendLeadTriggers_();

  ScriptApp
    .newTrigger('sendLeadInfoToCustomerEmail')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Automatic trigger created: runs every 5 minutes.');
}


/**
 * 停止自动发送时，手动运行此函数。
 */
function deleteAutoSendLeadTriggers() {
  deleteAutoSendLeadTriggers_();
  Logger.log('Automatic email trigger deleted.');
}


/**
 * 删除所有指向主发送函数的触发器。
 */
function deleteAutoSendLeadTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
    if (
      trigger.getHandlerFunction() ===
      'sendLeadInfoToCustomerEmail'
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


/**
 * 调试函数：
 * 查看脚本实际读取的工作表名称、gid 和表头。
 */
function debugTargetSheetHeaders() {
  const sheet = getTargetSheet_();
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    Logger.log('The target sheet has no columns.');
    return;
  }

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(normalizeHeader_);

  Logger.log('Sheet name: ' + sheet.getName());
  Logger.log('Sheet gid: ' + sheet.getSheetId());
  Logger.log('Headers: ' + JSON.stringify(headers));
}


/**
 * 从当前行提取需要发送的 6 个客户字段。
 */
function extractLeadData_(row, col) {
  return {
    businessType: getCell_(
      row,
      col,
      CONFIG.COL_BUSINESS_TYPE
    ),

    requirements: getCell_(
      row,
      col,
      CONFIG.COL_REQUIREMENTS
    ),

    fullName: getCell_(
      row,
      col,
      CONFIG.COL_FULL_NAME
    ),

    phone: getCell_(
      row,
      col,
      CONFIG.COL_PHONE
    ),

    email: getCell_(
      row,
      col,
      CONFIG.COL_LEAD_EMAIL
    ),

    address: getCell_(
      row,
      col,
      CONFIG.COL_ADDRESS
    )
  };
}


/**
 * 判断当前记录是否包含客户线索内容。
 */
function hasLeadContent_(lead) {
  return Boolean(
    lead.businessType ||
    lead.requirements ||
    lead.fullName ||
    lead.phone ||
    lead.email ||
    lead.address
  );
}


/**
 * 生成邮件标题。
 * 示例：New Customer Enquiry | Warren Wink | homeowner
 */
function buildEmailSubject_(lead) {
  const subjectParts = [
    CONFIG.EMAIL_SUBJECT_PREFIX
  ];

  if (lead.fullName) {
    subjectParts.push(lead.fullName);
  }

  if (lead.businessType) {
    subjectParts.push(lead.businessType);
  }

  return subjectParts.join(' | ');
}


/**
 * 生成 HTML 邮件正文。
 * 邮件中仅展示截图箭头标记的 6 个字段。
 */
function buildLeadEmailHtml_(lead) {
  const businessType = formatMultilineHtml_(lead.businessType);
  const requirements = formatMultilineHtml_(lead.requirements);
  const fullName = formatMultilineHtml_(lead.fullName);
  const phone = formatMultilineHtml_(lead.phone);
  const email = formatMultilineHtml_(lead.email);
  const address = formatMultilineHtml_(lead.address);

  return `
  <div style="
    max-width: 680px;
    margin: 0 auto;
    padding: 24px;
    font-family: Arial, 'Microsoft YaHei', sans-serif;
    font-size: 15px;
    line-height: 1.7;
    color: #333333;
    background: #ffffff;
  ">
    <div style="
      padding: 18px 22px;
      border-radius: 8px 8px 0 0;
      background: #f3f7ff;
      border: 1px solid #dce6f5;
      border-bottom: 0;
    ">
      <h2 style="
        margin: 0;
        font-size: 21px;
        color: #1f3b64;
      ">${escapeHtml_(CONFIG.EMAIL_HEADING)}</h2>

      <p style="
        margin: 8px 0 0;
        color: #64748b;
      ">
        A new customer enquiry has been received. Please review the details below and follow up promptly.
      </p>
    </div>

    <table cellpadding="0" cellspacing="0" style="
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #dce6f5;
    ">
      ${buildHtmlFieldRow_('Business Type', businessType)}
      ${buildHtmlFieldRow_('Requirements', requirements)}
      ${buildHtmlFieldRow_('Full Name', fullName)}
      ${buildHtmlFieldRow_('Phone Number', phone)}
      ${buildHtmlFieldRow_('Email Address', email)}
      ${buildHtmlFieldRow_('Street Address', address)}
    </table>

    <p style="
      margin: 18px 0 0;
      color: #64748b;
      font-size: 13px;
    ">
      This email was sent automatically by the Queensland Customer Lead Notification System. Please follow up promptly.
    </p>
  </div>
  `;
}


/**
 * 生成 HTML 表格中的单个字段行。
 * 字段值为空时显示“-”。
 */
function buildHtmlFieldRow_(label, value) {
  return `
    <tr>
      <td style="
        width: 120px;
        padding: 12px 14px;
        border-bottom: 1px solid #e5eaf1;
        background: #fafbfc;
        color: #475569;
        font-weight: bold;
        vertical-align: top;
      ">${escapeHtml_(label)}</td>

      <td style="
        padding: 12px 14px;
        border-bottom: 1px solid #e5eaf1;
        color: #111827;
        vertical-align: top;
        word-break: break-word;
      ">${value || '-'}</td>
    </tr>
  `;
}


/**
 * 生成纯文本邮件正文。
 * 当收件邮箱不支持 HTML 时显示此版本。
 */
function buildLeadEmailText_(lead) {
  return [
    CONFIG.EMAIL_HEADING,
    '',
    'A new customer enquiry has been received. Please review the details below and follow up promptly.',
    '',
    'Business Type: ' + (lead.businessType || '-'),
    'Requirements: ' + (lead.requirements || '-'),
    'Full Name: ' + (lead.fullName || '-'),
    'Phone Number: ' + (lead.phone || '-'),
    'Email Address: ' + (lead.email || '-'),
    'Street Address: ' + (lead.address || '-'),
    '',
    'This email was sent automatically by the Queensland Customer Lead Notification System.'
  ].join('\n');
}


/**
 * 从已读取的数据中寻找第一个非空 customer_email。
 */
function getFirstCustomerEmailFromRows_(rows, col) {
  for (let i = 0; i < rows.length; i++) {
    const email = getCell_(
      rows[i],
      col,
      CONFIG.COL_CUSTOMER_EMAIL
    );

    if (email) {
      return email;
    }
  }

  return '';
}


/**
 * 根据工作表 gid 精确获取目标工作表。
 */
function getTargetSheet_() {
  const ss = SpreadsheetApp.openById(
    CONFIG.SPREADSHEET_ID
  );

  const sheet = ss
    .getSheets()
    .find(function(item) {
      return item.getSheetId() === CONFIG.SHEET_ID;
    });

  if (!sheet) {
    throw new Error(
      'Target sheet not found. SHEET_ID: ' +
      CONFIG.SHEET_ID
    );
  }

  return sheet;
}


/**
 * 缺少发送状态字段时，自动添加到表格末尾。
 */
function ensureRequiredColumns_(
  sheet,
  headers,
  requiredColumns
) {
  requiredColumns.forEach(function(colName) {
    const normalizedName = normalizeHeader_(colName);

    if (!headers.includes(normalizedName)) {
      const newColumnIndex = headers.length + 1;

      sheet
        .getRange(1, newColumnIndex)
        .setValue(normalizedName);

      headers.push(normalizedName);
    }
  });

  SpreadsheetApp.flush();

  return headers;
}


/**
 * 建立“字段名 → 表格列号”的映射。
 */
function buildColumnMap_(headers) {
  const map = {};

  headers.forEach(function(header, index) {
    const normalizedHeader = normalizeHeader_(header);

    if (normalizedHeader) {
      map[normalizedHeader] = index + 1;
    }
  });

  return map;
}


/**
 * 检查必要字段是否存在。
 */
function validateRequiredColumns_(
  col,
  requiredColumns
) {
  const missing = requiredColumns.filter(
    function(name) {
      return !col[normalizeHeader_(name)];
    }
  );

  if (missing.length > 0) {
    throw new Error(
      'Missing required columns: ' +
      missing.join(', ')
    );
  }
}


/**
 * 根据字段名读取当前行的单元格内容。
 */
function getCell_(row, col, colName) {
  const normalizedName = normalizeHeader_(colName);
  const columnNumber = col[normalizedName];

  if (!columnNumber) {
    return '';
  }

  const value = row[columnNumber - 1];

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value).trim();
}


/**
 * 写入发送状态、发送时间和错误信息。
 */
function writeResult_(
  sheet,
  rowNumber,
  col,
  status,
  sentTime,
  errorMessage
) {
  sheet
    .getRange(
      rowNumber,
      col[CONFIG.COL_SEND_STATUS]
    )
    .setValue(status);

  sheet
    .getRange(
      rowNumber,
      col[CONFIG.COL_SENT_TIME]
    )
    .setValue(sentTime || '');

  sheet
    .getRange(
      rowNumber,
      col[CONFIG.COL_ERROR_MESSAGE]
    )
    .setValue(errorMessage || '');
}


/**
 * 检查邮箱格式。
 */
function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email).trim()
  );
}


/**
 * 规范化表头：
 * 1. 删除 BOM；
 * 2. 删除零宽字符；
 * 3. 删除首尾空格。
 */
function normalizeHeader_(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}


/**
 * 将多行文本安全转换成 HTML。
 */
function formatMultilineHtml_(value) {
  return escapeHtml_(value)
    .replace(/\r\n|\r|\n/g, '<br>');
}


/**
 * HTML 转义，防止客户输入的特殊字符破坏邮件结构。
 */
function escapeHtml_(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/**
 * 统一获取错误信息。
 */
function getErrorMessage_(err) {
  if (!err) {
    return 'Unknown error';
  }

  if (err.message) {
    return String(err.message);
  }

  return String(err);
}
