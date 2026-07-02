/************************************
 * Google 表格客户线索邮件自动通知脚本
 * 六字段优化版
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
  SENDER_NAME: '昆州客户线索通知',

  // 邮件标题前缀
  EMAIL_SUBJECT_PREFIX: '新客户询盘通知',

  // 邮件正文标题
  EMAIL_HEADING: '新客户询盘',

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
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    // 防止手动运行与定时触发器同时执行，避免重复发送
    lock.waitLock(30000);
    lockAcquired = true;

    const sheet = getTargetSheet_();

    Logger.log(
      '目标工作表：' +
      sheet.getName() +
      ' | gid：' +
      sheet.getSheetId()
    );

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 2 || lastColumn < 1) {
      Logger.log('没有可发送的客户线索。');
      return;
    }

    // 读取并清理第一行表头
    let headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getDisplayValues()[0]
      .map(normalizeHeader_);

    Logger.log('原始表头：' + JSON.stringify(headers));

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
      throw new Error('customer_email 列中没有找到接收邮箱。');
    }

    if (!isValidEmail_(recipientEmail)) {
      throw new Error('customer_email 邮箱格式无效：' + recipientEmail);
    }

    Logger.log('通知接收邮箱：' + recipientEmail);

    // 获取当前账号当天剩余的邮件发送额度
    const remainingQuota = MailApp.getRemainingDailyQuota();

    if (remainingQuota <= 0) {
      throw new Error('当前账号今天的邮件发送额度已经用完。');
    }

    // 本次实际发送上限不能超过剩余额度
    const maxSendThisRun = Math.min(
      CONFIG.MAX_SEND_PER_RUN,
      remainingQuota
    );

    let sentCount = 0;

    for (let i = 0; i < rows.length; i++) {
      if (sentCount >= maxSendThisRun) {
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

      // 提取截图箭头标记的 6 个客户字段
      const lead = extractLeadData_(row, col);

      // 六个字段全部为空时，视为空记录并跳过
      if (!hasLeadContent_(lead)) {
        continue;
      }

      try {
        const subject = buildEmailSubject_(lead);
        const htmlBody = buildLeadEmailHtml_(lead);
        const plainBody = buildLeadEmailText_(lead);

        // 使用对象参数发送邮件，便于设置名称、HTML 正文和回复地址
        const mailOptions = {
          to: recipientEmail,
          subject: subject,
          body: plainBody,
          htmlBody: htmlBody,
          name: CONFIG.SENDER_NAME
        };

        // 有效时设置回复地址
        const replyTo = Session.getEffectiveUser().getEmail();

        if (replyTo && isValidEmail_(replyTo)) {
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
          '第 ' +
          rowNumber +
          ' 行发送成功，接收邮箱：' +
          recipientEmail
        );

      } catch (err) {
        const errorMessage = getErrorMessage_(err);

        // 单条发送失败时记录错误，但不影响后续记录继续处理
        writeResult_(
          sheet,
          rowNumber,
          col,
          CONFIG.STATUS_FAILED,
          '',
          errorMessage
        );

        Logger.log(
          '第 ' +
          rowNumber +
          ' 行发送失败：' +
          errorMessage
        );
      }
    }

    SpreadsheetApp.flush();

    Logger.log('本次共发送：' + sentCount + ' 封邮件。');

  } catch (err) {
    Logger.log('脚本执行错误：' + getErrorMessage_(err));
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
  const oldMax = CONFIG.MAX_SEND_PER_RUN;

  try {
    CONFIG.MAX_SEND_PER_RUN = 1;
    sendLeadInfoToCustomerEmail();

  } finally {
    // 即使测试时报错，也恢复原来的发送数量
    CONFIG.MAX_SEND_PER_RUN = oldMax;
  }
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

  Logger.log('自动触发器创建成功：每 5 分钟执行一次。');
}


/**
 * 停止自动发送时，手动运行此函数。
 */
function deleteAutoSendLeadTriggers() {
  deleteAutoSendLeadTriggers_();
  Logger.log('自动发送触发器已删除。');
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
    Logger.log('目标工作表没有任何字段。');
    return;
  }

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(normalizeHeader_);

  Logger.log('工作表名称：' + sheet.getName());
  Logger.log('工作表 gid：' + sheet.getSheetId());
  Logger.log('表头字段：' + JSON.stringify(headers));
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
 * 示例：新客户询盘通知｜Warren Wink｜homeowner
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

  return subjectParts.join('｜');
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
        系统收到一条新的客户线索，请及时查看并跟进。
      </p>
    </div>

    <table cellpadding="0" cellspacing="0" style="
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #dce6f5;
    ">
      ${buildHtmlFieldRow_('客户类型', businessType)}
      ${buildHtmlFieldRow_('客户需求', requirements)}
      ${buildHtmlFieldRow_('客户姓名', fullName)}
      ${buildHtmlFieldRow_('联系电话', phone)}
      ${buildHtmlFieldRow_('客户邮箱', email)}
      ${buildHtmlFieldRow_('客户地址', address)}
    </table>

    <p style="
      margin: 18px 0 0;
      color: #64748b;
      font-size: 13px;
    ">
      本邮件由昆州客户线索通知系统自动发送，请及时处理。
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
    '系统收到一条新的客户线索，请及时查看并跟进。',
    '',
    '客户类型：' + (lead.businessType || '-'),
    '客户需求：' + (lead.requirements || '-'),
    '客户姓名：' + (lead.fullName || '-'),
    '联系电话：' + (lead.phone || '-'),
    '客户邮箱：' + (lead.email || '-'),
    '客户地址：' + (lead.address || '-'),
    '',
    '本邮件由昆州客户线索通知系统自动发送。'
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
      '未找到目标工作表，SHEET_ID：' +
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
      '缺少必要字段：' +
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
    return '未知错误';
  }

  if (err.message) {
    return String(err.message);
  }

  return String(err);
}
