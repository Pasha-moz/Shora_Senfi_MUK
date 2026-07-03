/**
 * ربات کامل شورای صنفی دانشگاه
 * تبدیل شده از Python به JavaScript برای Cloudflare Workers
 * تمام قابلیت‌ها حفظ شده است
 */

// ============================================
// تنظیمات اصلی
// ============================================

const BOT_TOKEN = '8420190071:AAEoe5GhcjK0_nwdknQAFqB_0e2jlMYwy8w';
const SUPER_ADMIN_IDS = [5291812280];

const SECTIONS = {
  head: {
    name: '👑 رئیس کل شورا',
    admin_ids: [5950998510],
    description: 'مدیریت کلی و نظارت بر تمام بخش‌ها'
  },
  food: {
    name: '🍽️ کارگروه تغذیه',
    admin_ids: [],
    description: 'رسیدگی به مشکلات تغذیه دانشجویی'
  },
  education: {
    name: '📚 کارگروه آموزشی',
    admin_ids: [],
    description: 'مشکلات آموزشی، برنامه درسی، اساتید'
  },
  research: {
    name: '🔬 کارگروه پژوهشی',
    admin_ids: [],
    description: 'حمایت از پژوهش، مقالات، کنفرانس‌ها'
  },
  culture: {
    name: '🎭 کارگروه فرهنگی',
    admin_ids: [],
    description: 'فعالیت‌های فرهنگی، هنری، اردوها'
  },
  welfare: {
    name: '🏠 کارگروه رفاهی',
    admin_ids: [],
    description: 'رفاه دانشجویی، خوابگاه، وام، بیمه'
  }
};

// ============================================
// توابع کمکی
// ============================================

function getCurrentTime() {
  return new Date().toISOString();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.substring(0, 16).replace('T', ' ');
}

function isSuperAdmin(userId) {
  return SUPER_ADMIN_IDS.includes(Number(userId));
}

function isAdmin(userId) {
  if (isSuperAdmin(userId)) return true;
  for (const key in SECTIONS) {
    if (SECTIONS[key].admin_ids.includes(Number(userId))) return true;
  }
  return false;
}

function getSectionName(key) {
  return SECTIONS[key] ? SECTIONS[key].name : key;
}

function getSectionAdmins(key) {
  return SECTIONS[key] ? SECTIONS[key].admin_ids : [];
}

function getSectionDescription(key) {
  return SECTIONS[key] ? SECTIONS[key].description : '';
}

function getUserSections(userId) {
  if (isSuperAdmin(userId)) {
    return Object.keys(SECTIONS);
  }
  const sections = [];
  for (const key in SECTIONS) {
    if (SECTIONS[key].admin_ids.includes(Number(userId))) {
      sections.push(key);
    }
  }
  return sections;
}

function formatMessagePreview(msg) {
  const sectionName = msg.section_name || 'نامشخص';
  const userName = `${msg.first_name || ''} ${msg.last_name || ''}`.trim() || 'کاربر';
  const content = msg.content || 'فایل';
  const statusEmoji = msg.status === 'answered' ? '✅' : msg.status === 'blocked' ? '🚫' : '⏳';
  
  return `${statusEmoji} #${msg.msg_id} | ${sectionName}\n👤 ${userName}\n📝 ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}\n🕐 ${formatDate(msg.date)}`;
}

// ============================================
// دیتابیس (Cloudflare D1)
// ============================================

async function initDB(env) {
  const db = env.DB;
  
  // جدول users
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      student_id TEXT,
      faculty TEXT,
      join_date TEXT NOT NULL,
      last_active TEXT NOT NULL,
      total_messages INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      blocked_by INTEGER,
      block_reason TEXT,
      block_date TEXT,
      role TEXT DEFAULT 'user'
    )
  `);
  
  // جدول sections
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sections (
      section_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      admin_ids TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);
  
  // جدول messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      msg_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      section_key TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT,
      file_id TEXT,
      file_name TEXT,
      date TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      is_answered INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      admin_id INTEGER,
      answer_date TEXT,
      answer_content TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);
  
  // جدول forward_map
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forward_map (
      forward_id INTEGER PRIMARY KEY AUTOINCREMENT,
      forwarded_msg_id INTEGER NOT NULL,
      admin_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      section_key TEXT NOT NULL,
      original_msg_id INTEGER,
      date TEXT NOT NULL
    )
  `);
  
  // جدول replies
  await db.exec(`
    CREATE TABLE IF NOT EXISTS replies (
      reply_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      section_key TEXT NOT NULL,
      admin_id INTEGER NOT NULL,
      message_id INTEGER,
      content TEXT,
      file_id TEXT,
      date TEXT NOT NULL
    )
  `);
  
  // جدول activity_log
  await db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user INTEGER,
      target_msg INTEGER,
      details TEXT,
      date TEXT NOT NULL
    )
  `);
  
  // ثبت بخش‌ها
  for (const key in SECTIONS) {
    const data = SECTIONS[key];
    await db.exec(`
      INSERT OR REPLACE INTO sections (section_key, name, description, admin_ids)
      VALUES ('${key}', '${data.name}', '${data.description}', '${data.admin_ids.join(',')}')
    `);
  }
  
  // ثبت سوپر ادمین‌ها
  for (const adminId of SUPER_ADMIN_IDS) {
    await db.exec(`
      INSERT OR REPLACE INTO users (user_id, username, first_name, last_name, join_date, last_active, role)
      VALUES (${adminId}, 'super_admin', 'سوپر ادمین', '', '${getCurrentTime()}', '${getCurrentTime()}', 'super_admin')
    `);
  }
  
  return true;
}

// ============================================
// توابع دیتابیس
// ============================================

async function upsertUser(env, user) {
  const db = env.DB;
  const now = getCurrentTime();
  const role = isSuperAdmin(user.id) ? 'super_admin' : 'user';
  
  const stmt = await db.prepare(`
    INSERT OR REPLACE INTO users (user_id, username, first_name, last_name, join_date, last_active, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  await stmt.bind(
    user.id,
    user.username || '',
    user.first_name || '',
    user.last_name || '',
    now,
    now,
    role
  ).run();
}

async function getUserById(env, userId) {
  const db = env.DB;
  const stmt = await db.prepare('SELECT * FROM users WHERE user_id = ?');
  const result = await stmt.bind(userId).all();
  
  if (result.results && result.results.length > 0) {
    return result.results[0];
  }
  return null;
}

async function getMessageById(env, msgId) {
  const db = env.DB;
  const stmt = await db.prepare(`
    SELECT m.*, u.username, u.first_name, u.last_name, u.is_blocked, u.role,
           s.name as section_name
    FROM messages m
    JOIN users u ON m.user_id = u.user_id
    JOIN sections s ON m.section_key = s.section_key
    WHERE m.msg_id = ?
  `);
  const result = await stmt.bind(msgId).all();
  
  if (result.results && result.results.length > 0) {
    return result.results[0];
  }
  return null;
}

async function getInboxMessages(env, adminId, sectionKey = null, limit = 20) {
  const db = env.DB;
  let query = '';
  
  if (isSuperAdmin(adminId)) {
    if (sectionKey) {
      query = `
        SELECT m.*, u.username, u.first_name, u.last_name, u.is_blocked, u.role,
               s.name as section_name
        FROM messages m
        JOIN users u ON m.user_id = u.user_id
        JOIN sections s ON m.section_key = s.section_key
        WHERE m.section_key = '${sectionKey}' AND m.status != 'blocked'
        ORDER BY m.date DESC
        LIMIT ${limit}
      `;
    } else {
      query = `
        SELECT m.*, u.username, u.first_name, u.last_name, u.is_blocked, u.role,
               s.name as section_name
        FROM messages m
        JOIN users u ON m.user_id = u.user_id
        JOIN sections s ON m.section_key = s.section_key
        WHERE m.status != 'blocked'
        ORDER BY m.date DESC
        LIMIT ${limit}
      `;
    }
  } else {
    const userSections = getUserSections(adminId);
    if (userSections.length === 0) {
      return [];
    }
    
    if (sectionKey) {
      if (!userSections.includes(sectionKey)) {
        return [];
      }
      query = `
        SELECT m.*, u.username, u.first_name, u.last_name, u.is_blocked, u.role,
               s.name as section_name
        FROM messages m
        JOIN users u ON m.user_id = u.user_id
        JOIN sections s ON m.section_key = s.section_key
        WHERE m.section_key = '${sectionKey}' AND m.status != 'blocked'
        ORDER BY m.date DESC
        LIMIT ${limit}
      `;
    } else {
      const sectionList = userSections.map(s => `'${s}'`).join(',');
      query = `
        SELECT m.*, u.username, u.first_name, u.last_name, u.is_blocked, u.role,
               s.name as section_name
        FROM messages m
        JOIN users u ON m.user_id = u.user_id
        JOIN sections s ON m.section_key = s.section_key
        WHERE m.section_key IN (${sectionList}) AND m.status != 'blocked'
        ORDER BY m.date DESC
        LIMIT ${limit}
      `;
    }
  }
  
  const result = await db.exec(query);
  return result.results || [];
}

async function saveMessage(env, userId, sectionKey, msgType, content, fileId = null, fileName = null) {
  const db = env.DB;
  const now = getCurrentTime();
  
  const stmt = await db.prepare(`
    INSERT INTO messages (user_id, section_key, message_type, content, file_id, file_name, date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    RETURNING msg_id
  `);
  
  const result = await stmt.bind(
    userId,
    sectionKey,
    msgType,
    content || '',
    fileId || '',
    fileName || '',
    now
  ).all();
  
  // به‌روزرسانی تعداد پیام‌ها
  await db.exec(`UPDATE users SET total_messages = total_messages + 1 WHERE user_id = ${userId}`);
  
  if (result.results && result.results.length > 0) {
    return result.results[0].msg_id;
  }
  return null;
}

async function updateMessageStatus(env, msgId, status, adminId = null, answerContent = null) {
  const db = env.DB;
  let query = `UPDATE messages SET status = '${status}'`;
  
  if (adminId) {
    query += `, admin_id = ${adminId}, answer_date = '${getCurrentTime()}'`;
  }
  if (answerContent) {
    query += `, answer_content = '${answerContent.replace(/'/g, "''")}'`;
  }
  if (status === 'answered') {
    query += `, is_answered = 1`;
  }
  query += ` WHERE msg_id = ${msgId}`;
  
  await db.exec(query);
}

async function blockUser(env, userId, adminId, reason = null) {
  const db = env.DB;
  const now = getCurrentTime();
  const blockReason = reason || 'بدون دلیل';
  
  await db.exec(`
    UPDATE users 
    SET is_blocked = 1, blocked_by = ${adminId}, block_reason = '${blockReason.replace(/'/g, "''")}', block_date = '${now}'
    WHERE user_id = ${userId}
  `);
  
  await db.exec(`
    UPDATE messages SET status = 'blocked' 
    WHERE user_id = ${userId} AND status = 'pending'
  `);
}

async function unblockUser(env, userId) {
  const db = env.DB;
  await db.exec(`
    UPDATE users 
    SET is_blocked = 0, blocked_by = NULL, block_reason = NULL, block_date = NULL
    WHERE user_id = ${userId}
  `);
}

async function getStats(env) {
  const db = env.DB;
  
  const totalUsers = await db.exec(`SELECT COUNT(*) as count FROM users WHERE is_blocked = 0`);
  const blockedUsers = await db.exec(`SELECT COUNT(*) as count FROM users WHERE is_blocked = 1`);
  const totalMsgs = await db.exec(`SELECT COUNT(*) as count FROM messages`);
  const pending = await db.exec(`SELECT COUNT(*) as count FROM messages WHERE status = 'pending'`);
  const answered = await db.exec(`SELECT COUNT(*) as count FROM messages WHERE status = 'answered'`);
  const blockedMsgs = await db.exec(`SELECT COUNT(*) as count FROM messages WHERE status = 'blocked'`);
  
  const sectionStats = {};
  for (const key in SECTIONS) {
    const pendingCount = await db.exec(`SELECT COUNT(*) as count FROM messages WHERE section_key = '${key}' AND status = 'pending'`);
    const totalCount = await db.exec(`SELECT COUNT(*) as count FROM messages WHERE section_key = '${key}'`);
    sectionStats[key] = {
      pending: pendingCount.results[0].count,
      total: totalCount.results[0].count
    };
  }
  
  return {
    total_users: totalUsers.results[0].count,
    blocked_users: blockedUsers.results[0].count,
    total_messages: totalMsgs.results[0].count,
    pending: pending.results[0].count,
    answered: answered.results[0].count,
    blocked_msgs: blockedMsgs.results[0].count,
    section_stats: sectionStats
  };
}

async function logActivity(env, adminId, action, targetUser = null, targetMsg = null, details = null) {
  const db = env.DB;
  await db.exec(`
    INSERT INTO activity_log (admin_id, action, target_user, target_msg, details, date)
    VALUES (${adminId}, '${action}', ${targetUser || 'NULL'}, ${targetMsg || 'NULL'}, '${(details || '').replace(/'/g, "''")}', '${getCurrentTime()}')
  `);
}

async function getActivityLog(env, limit = 20) {
  const db = env.DB;
  const result = await db.exec(`
    SELECT * FROM activity_log
    ORDER BY date DESC
    LIMIT ${limit}
  `);
  return result.results || [];
}

async function getSectionAdminsFromDB(env, sectionKey) {
  const db = env.DB;
  const result = await db.exec(`
    SELECT admin_ids FROM sections WHERE section_key = '${sectionKey}'
  `);
  if (result.results && result.results.length > 0) {
    const adminIds = result.results[0].admin_ids;
    if (adminIds) {
      return adminIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    }
  }
  return [];
}

async function updateSectionAdmins(env, sectionKey, adminIds) {
  const db = env.DB;
  const adminStr = adminIds.join(',');
  await db.exec(`
    UPDATE sections SET admin_ids = '${adminStr}' WHERE section_key = '${sectionKey}'
  `);
}

// ============================================
// ارسال پیام به تلگرام
// ============================================

async function sendMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (e) {
    console.error('sendMessage error:', e);
    return null;
  }
}

async function answerCallback(callbackId, text = null, showAlert = false) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  const payload = {
    callback_query_id: callbackId
  };
  if (text) {
    payload.text = text;
    payload.show_alert = showAlert;
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (e) {
    console.error('answerCallback error:', e);
    return null;
  }
}

async function editMessageText(chatId, messageId, text, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: parseMode
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (e) {
    console.error('editMessageText error:', e);
    return null;
  }
}

// ============================================
// تولید کیبوردها
// ============================================

function createSectionKeyboard() {
  const keyboard = [];
  const row = [];
  let count = 0;
  for (const key in SECTIONS) {
    row.push({ text: SECTIONS[key].name, callback_data: `select_section_${key}` });
    count++;
    if (count % 2 === 0) {
      keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) {
    keyboard.push(row);
  }
  return { inline_keyboard: keyboard };
}

function createSuperAdminMenu() {
  return {
    keyboard: [
      ['📬 صندوق پیام‌ها', '👑 پنل سوپر ادمین'],
      ['📈 آمار', '👥 کاربران'],
      ['👤 افزودن ادمین', '🗑️ حذف ادمین'],
      ['📢 ارسال همگانی', '📨 همه پیام‌ها'],
      ['❓ راهنما']
    ],
    resize_keyboard: true
  };
}

function createAdminMenu() {
  return {
    keyboard: [
      ['📬 صندوق پیام‌ها', '📊 پنل مدیریت'],
      ['📈 آمار', '📢 ارسال همگانی'],
      ['❓ راهنما']
    ],
    resize_keyboard: true
  };
}

function createUserMenu() {
  return {
    keyboard: [
      ['📋 بخش‌ها', '📨 پیام‌های من'],
      ['❓ راهنما']
    ],
    resize_keyboard: true
  };
}

// ============================================
// هندلرهای دستورات
// ============================================

async function handleStart(env, message) {
  const chatId = message.chat.id;
  const user = message.from;
  
  try {
    await upsertUser(env, user);
    
    if (isSuperAdmin(user.id)) {
      await sendMessage(chatId, '👑 <b>پنل سوپر ادمین</b>\n━━━━━━━━━━━━━━━\nشما دسترسی کامل به همه بخش‌ها دارید.', 'HTML', createSuperAdminMenu());
      return;
    }
    
    if (isAdmin(user.id)) {
      const sections = getUserSections(user.id);
      const sectionNames = sections.map(s => SECTIONS[s].name);
      const text = `👑 <b>پنل مدیریت شورای صنفی</b>\n━━━━━━━━━━━━━━━\nشما ادمین بخش‌های زیر هستید:\n${sectionNames.map(s => '• ' + s).join('\n')}\n\n📬 از منوی زیر برای مدیریت استفاده کنید.`;
      await sendMessage(chatId, text, 'HTML', createAdminMenu());
      return;
    }
    
    const text = `🎓 <b>به ربات شورای صنفی دانشگاه خوش آمدید!</b>\n\nاین ربات برای ارتباط شما با شورای صنفی طراحی شده است.\n\n📋 <b>بخش‌های شورا:</b>\n• 👑 رئیس کل شورا\n• 🍽️ کارگروه تغذیه\n• 📚 کارگروه آموزشی\n• 🔬 کارگروه پژوهشی\n• 🎭 کارگروه فرهنگی\n• 🏠 کارگروه رفاهی\n\nلطفاً بخش مورد نظر را انتخاب کنید:`;
    await sendMessage(chatId, text, 'HTML', createSectionKeyboard());
    
  } catch (error) {
    console.error('handleStart error:', error);
    await sendMessage(chatId, '⚠️ خطایی رخ داد! لطفاً دوباره تلاش کنید.');
  }
}

async function handleHelp(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  let text = '';
  if (isSuperAdmin(userId)) {
    text = `📚 <b>راهنمای سوپر ادمین</b>\n━━━━━━━━━━━━━━━\n<b>دستورات مدیریتی:</b>\n/set_admin - افزودن ادمین به بخش\n/remove_admin - حذف ادمین از بخش\n/super_panel - پنل کامل مدیریت\n/all_messages - مشاهده همه پیام‌ها\n/activity - گزارش فعالیت‌ها\n/show_admins - لیست ادمین‌ها\n/debug - اطلاعات دیباگ\n/fix - تعمیر ربات\n\n<b>دستورات عمومی:</b>\n/inbox - صندوق پیام‌ها\n/panel - پنل مدیریت\n/stats - آمار\n/users - لیست کاربران\n/block - مسدود کردن کاربر\n/unblock - رفع مسدودیت\n/broadcast - ارسال همگانی`;
  } else if (isAdmin(userId)) {
    text = `📚 <b>راهنمای ادمین</b>\n━━━━━━━━━━━━━━━\n/inbox - 📬 مشاهده صندوق پیام‌ها\n/panel - 📊 پنل مدیریت\n/stats - 📈 آمار\n/block - 🚫 مسدود کردن کاربر\n/unblock - ✅ رفع مسدودیت\n/broadcast - 📢 ارسال همگانی\n\n💡 برای پاسخ به پیام:\n1. /inbox رو بزن\n2. بخش مورد نظر رو انتخاب کن\n3. روی پیام کلیک کن\n4. دکمه 'پاسخ' رو بزن`;
  } else {
    text = `❓ <b>راهنمای کاربران</b>\n━━━━━━━━━━━━━━━\n1. /start رو بزن\n2. بخش مورد نظر رو انتخاب کن\n3. پیامت رو ارسال کن\n4. منتظر پاسخ باش\n\n📎 انواع فایل‌های پشتیبانی شده:\n• متن • عکس • ویدیو • فایل\n\n⏱️ زمان پاسخگویی: حداکثر ۷۲ ساعت`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleSections(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (isAdmin(userId)) {
    const sections = getUserSections(userId);
    const sectionNames = sections.map(s => SECTIONS[s].name);
    const text = `📋 <b>بخش‌های تحت مدیریت شما</b>\n━━━━━━━━━━━━━━━\n${sectionNames.map(s => '• ' + s).join('\n')}`;
    await sendMessage(chatId, text, 'HTML');
  } else {
    await sendMessage(chatId, '📋 <b>بخش‌های شورای صنفی</b>\n\nلطفاً بخش مورد نظر را انتخاب کنید:', 'HTML', createSectionKeyboard());
  }
}

async function handleMyMessages(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (isAdmin(userId)) {
    await sendMessage(chatId, '⚠️ این دستور مخصوص کاربران عادی است.');
    return;
  }
  
  const db = env.DB;
  const result = await db.exec(`
    SELECT msg_id, section_key, content, status, date
    FROM messages
    WHERE user_id = ${userId}
    ORDER BY date DESC
    LIMIT 10
  `);
  
  const rows = result.results || [];
  if (rows.length === 0) {
    await sendMessage(chatId, '📭 شما هنوز پیامی ارسال نکرده‌اید.');
    return;
  }
  
  let text = '📨 <b>۱۰ پیام آخر شما</b>\n━━━━━━━━━━━━━━━\n';
  for (const row of rows) {
    const sectionName = getSectionName(row.section_key);
    const statusEmoji = row.status === 'answered' ? '✅' : '⏳';
    const content = row.content ? (row.content.length > 40 ? row.content.substring(0, 40) + '...' : row.content) : 'فایل';
    text += `${statusEmoji} #${row.msg_id} | ${sectionName}\n📝 ${content}\n🕐 ${formatDate(row.date)}\n━━━━━━━━━━━━━━━\n`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

// ============================================
// انتخاب بخش و پیام کاربر
// ============================================

const userSectionCache = new Map();

async function handleSelectSection(env, callback) {
  const sectionKey = callback.data.replace('select_section_', '');
  const sectionName = getSectionName(sectionKey);
  const chatId = callback.message.chat.id;
  
  await sendMessage(chatId, `✅ <b>بخش ${sectionName} انتخاب شد</b>\n\nلطفاً پیام خود را ارسال کنید.\nپشتیبانان این بخش در اسرع وقت پاسخ خواهند داد.`, 'HTML');
  
  userSectionCache.set(chatId, sectionKey);
  await answerCallback(callback.id);
}

async function handleUserMessage(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  if (text.startsWith('/')) return;
  
  const userData = await getUserById(env, userId);
  if (userData && userData.is_blocked === 1) {
    await sendMessage(chatId, '🚫 شما توسط ادمین مسدود شده‌اید.');
    return;
  }
  
  const sectionKey = userSectionCache.get(chatId);
  if (!sectionKey) {
    await sendMessage(chatId, '⚠️ لطفاً ابتدا بخش مورد نظر را انتخاب کنید.\nاز /start استفاده کنید.');
    return;
  }
  
  await upsertUser(env, message.from);
  
  let msgType = 'text';
  let content = text;
  let fileId = null;
  let fileName = null;
  
  if (message.photo) {
    msgType = 'photo';
    fileId = message.photo[message.photo.length - 1].file_id;
    content = message.caption || '';
  } else if (message.video) {
    msgType = 'video';
    fileId = message.video.file_id;
    fileName = message.video.file_name;
    content = message.caption || '';
  } else if (message.document) {
    msgType = 'document';
    fileId = message.document.file_id;
    fileName = message.document.file_name;
    content = message.caption || '';
  } else if (message.audio) {
    msgType = 'audio';
    fileId = message.audio.file_id;
    fileName = message.audio.file_name;
    content = message.caption || '';
  } else if (message.voice) {
    msgType = 'voice';
    fileId = message.voice.file_id;
  } else if (message.sticker) {
    msgType = 'sticker';
    fileId = message.sticker.file_id;
  }
  
  const msgId = await saveMessage(env, userId, sectionKey, msgType, content, fileId, fileName);
  
  const sectionName = getSectionName(sectionKey);
  await sendMessage(chatId, `✅ پیام شما به بخش ${sectionName} ارسال شد.\nشماره پیام: ${msgId}\nدر اسرع وقت پاسخ داده می‌شود. 🙏`);
  
  // ارسال به ادمین‌ها
  await forwardToAdmins(env, message, sectionKey, msgId);
}

async function forwardToAdmins(env, message, sectionKey, msgId) {
  let adminIds = await getSectionAdminsFromDB(env, sectionKey);
  
  if (sectionKey === 'head' && adminIds.length === 0) {
    adminIds = SUPER_ADMIN_IDS;
  }
  
  if (adminIds.length === 0) {
    console.log(`No admins for section ${sectionKey}`);
    return;
  }
  
  const sectionName = getSectionName(sectionKey);
  const userName = `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim() || 'کاربر';
  const content = message.text || message.caption || 'فایل';
  
  for (const adminId of adminIds) {
    try {
      const msg = `📨 <b>پیام جدید</b>\n━━━━━━━━━━━━━━━\n📋 بخش: ${sectionName}\n👤 کاربر: ${userName}\n🆔 شناسه: <code>${message.from.id}</code>\n📝 ${content.substring(0, 100)}\n━━━━━━━━━━━━━━━\n💡 از /inbox برای مشاهده و پاسخ استفاده کنید.`;
      await sendMessage(adminId, msg, 'HTML');
      
      if (message.text) {
        await sendMessage(adminId, `📝 ${message.text}`);
      }
      
      const markup = {
        inline_keyboard: [
          [{ text: '📝 پاسخ', callback_data: `quick_reply_${msgId}` }],
          [{ text: '📋 اطلاعات کاربر', callback_data: `user_info_${message.from.id}` }]
        ]
      };
      await sendMessage(adminId, '💡 برای پاسخ، روی دکمه کلیک کنید یا از /inbox استفاده کنید.', 'HTML', markup);
      
    } catch (e) {
      console.error(`Failed to forward to admin ${adminId}:`, e);
    }
  }
}

// ============================================
// صندوق پیام‌ها (Inbox)
// ============================================

async function handleInbox(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ این دستور فقط برای ادمین‌ها است.');
    return;
  }
  
  const isSuper = isSuperAdmin(userId);
  
  if (isSuper) {
    const markup = {
      inline_keyboard: [
        [{ text: '📬 همه پیام‌ها', callback_data: 'inbox_all' }]
      ]
    };
    for (const key in SECTIONS) {
      markup.inline_keyboard.push([{ text: SECTIONS[key].name, callback_data: `inbox_section_${key}` }]);
    }
    await sendMessage(chatId, '📬 <b>صندوق پیام‌های شورا</b>\n\nبخش مورد نظر را انتخاب کنید:', 'HTML', markup);
  } else {
    const userSections = getUserSections(userId);
    if (userSections.length === 0) {
      await sendMessage(chatId, '❌ شما ادمین هیچ بخشی نیستید.');
      return;
    }
    
    const markup = {
      inline_keyboard: userSections.map(key => [{ text: `📬 ${SECTIONS[key].name}`, callback_data: `inbox_section_${key}` }])
    };
    await sendMessage(chatId, '📬 <b>صندوق پیام‌های شما</b>\n\nبخش مورد نظر را انتخاب کنید:', 'HTML', markup);
  }
}

// ============================================
// کالبک‌های Inbox
// ============================================

async function handleInboxCallback(env, callback) {
  const chatId = callback.message.chat.id;
  const userId = callback.from.id;
  const data = callback.data;
  const callbackId = callback.id;
  
  let messages = [];
  let title = '';
  
  if (data === 'inbox_all') {
    messages = await getInboxMessages(env, userId, null, 20);
    title = 'همه بخش‌ها';
  } else if (data.startsWith('inbox_section_')) {
    const sectionKey = data.replace('inbox_section_', '');
    messages = await getInboxMessages(env, userId, sectionKey, 20);
    title = getSectionName(sectionKey);
  }
  
  if (messages.length === 0) {
    await sendMessage(chatId, `📭 <b>صندوق ${title}</b>\n\nهیچ پیامی وجود ندارد.`, 'HTML');
    await answerCallback(callbackId);
    return;
  }
  
  let text = `📬 <b>صندوق ${title}</b>\n━━━━━━━━━━━━━━━\n📊 ${messages.length} پیام\n━━━━━━━━━━━━━━━\n\n`;
  
  const displayMessages = messages.slice(0, 5);
  for (const msg of displayMessages) {
    text += formatMessagePreview(msg) + '\n━━━━━━━━━━━━━━━\n';
  }
  
  const markup = {
    inline_keyboard: []
  };
  for (const msg of displayMessages) {
    const status = msg.status === 'answered' ? '✅' : '⏳';
    markup.inline_keyboard.push([{ text: `${status} #${msg.msg_id}`, callback_data: `view_msg_${msg.msg_id}` }]);
  }
  markup.inline_keyboard.push([{ text: '🔄 بازخوانی', callback_data: 'refresh_inbox' }]);
  
  await sendMessage(chatId, text, 'HTML', markup);
  await answerCallback(callbackId);
}

// ============================================
// مشاهده جزئیات پیام
// ============================================

async function handleViewMessage(env, callback) {
  const msgId = parseInt(callback.data.replace('view_msg_', ''));
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const msg = await getMessageById(env, msgId);
  if (!msg) {
    await sendMessage(chatId, '❌ پیام یافت نشد.');
    await answerCallback(callbackId);
    return;
  }
  
  const userName = `${msg.first_name || ''} ${msg.last_name || ''}`.trim() || 'کاربر';
  const username = msg.username ? `@${msg.username}` : 'ندارد';
  
  const statusEmoji = msg.status === 'pending' ? '⏳ در انتظار پاسخ' :
                      msg.status === 'answered' ? '✅ پاسخ داده شده' :
                      '🚫 مسدود';
  
  let text = `📨 <b>جزئیات پیام #${msgId}</b>\n━━━━━━━━━━━━━━━\n📋 بخش: ${msg.section_name}\n👤 کاربر: ${userName}\n🔖 یوزرنیم: ${username}\n🆔 شناسه: <code>${msg.user_id}</code>\n📊 وضعیت: ${statusEmoji}\n📝 متن: ${msg.content || 'فایل'}\n🕐 تاریخ: ${formatDate(msg.date)}\n`;
  
  if (msg.answer_content) {
    text += `\n💬 پاسخ ادمین:\n${msg.answer_content.substring(0, 200)}`;
    if (msg.answer_content.length > 200) text += '...';
  }
  
  text += `\n━━━━━━━━━━━━━━━`;
  
  const markup = {
    inline_keyboard: []
  };
  
  if (msg.status === 'pending') {
    markup.inline_keyboard.push([
      { text: '📝 پاسخ', callback_data: `reply_to_${msgId}` },
      { text: '🚫 بلاک کاربر', callback_data: `block_user_${msgId}` }
    ]);
  } else {
    markup.inline_keyboard.push([{ text: '📝 پاسخ مجدد', callback_data: `reply_to_${msgId}` }]);
  }
  
  markup.inline_keyboard.push([
    { text: '📋 اطلاعات کاربر', callback_data: `user_info_${msg.user_id}` },
    { text: '🔙 برگشت', callback_data: 'refresh_inbox' }
  ]);
  
  await sendMessage(chatId, text, 'HTML', markup);
  await answerCallback(callbackId);
}

// ============================================
// پاسخ به پیام
// ============================================

const pendingReplies = new Map();

async function handleReply(env, callback) {
  const msgId = parseInt(callback.data.replace('reply_to_', ''));
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  await sendMessage(chatId, `💬 <b>پاسخ به پیام #${msgId}</b>\n\nپیام خود را وارد کنید:`, 'HTML');
  pendingReplies.set(chatId, msgId);
  await answerCallback(callbackId);
}

async function processReply(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  if (!isAdmin(userId)) return;
  
  const msgId = pendingReplies.get(chatId);
  if (!msgId) return;
  
  pendingReplies.delete(chatId);
  
  const msg = await getMessageById(env, msgId);
  if (!msg) {
    await sendMessage(chatId, '❌ پیام یافت نشد.');
    return;
  }
  
  const targetUserId = msg.user_id;
  const sectionName = getSectionName(msg.section_key);
  
  if (msg.is_blocked === 1) {
    await sendMessage(chatId, `⚠️ کاربر ${targetUserId} مسدود است. ابتدا او را unblock کنید.`);
    return;
  }
  
  const replyPrefix = `📩 <b>پاسخ از بخش ${sectionName}:</b>\n\n`;
  
  try {
    await sendMessage(targetUserId, replyPrefix + text, 'HTML');
    await updateMessageStatus(env, msgId, 'answered', userId, text);
    await logActivity(env, userId, 'reply', targetUserId, msgId, `پاسخ به پیام #${msgId}`);
    
    await sendMessage(chatId, `✅ پاسخ به پیام #${msgId} با موفقیت ارسال شد.`);
    await sendMessage(targetUserId, '✅ پاسخ شما ارسال شد.\nدر صورت نیاز به اطلاعات بیشتر، دوباره پیام دهید.');
    
  } catch (e) {
    console.error('Reply error:', e);
    await sendMessage(chatId, `❌ خطا در ارسال: ${e.message}`);
  }
}

// ============================================
// بلاک و رفع بلاک
// ============================================

const pendingBlocks = new Map();

async function handleBlockUser(env, callback) {
  const msgId = parseInt(callback.data.replace('block_user_', ''));
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const msg = await getMessageById(env, msgId);
  if (!msg) {
    await sendMessage(chatId, '❌ پیام یافت نشد.');
    await answerCallback(callbackId);
    return;
  }
  
  await sendMessage(chatId, `🚫 <b>مسدود کردن کاربر</b>\n\nکاربر: ${msg.user_id}\nدلیل مسدودیت را وارد کنید (اختیاری):`, 'HTML');
  pendingBlocks.set(chatId, { userId: msg.user_id, msgId: msgId });
  await answerCallback(callbackId);
}

async function processBlock(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) return;
  
  const blockData = pendingBlocks.get(chatId);
  if (!blockData) return;
  
  pendingBlocks.delete(chatId);
  
  const reason = message.text && !message.text.startsWith('/') ? message.text : 'بدون دلیل';
  
  await blockUser(env, blockData.userId, userId, reason);
  await updateMessageStatus(env, blockData.msgId, 'blocked', userId);
  await logActivity(env, userId, 'block', blockData.userId, blockData.msgId, reason);
  
  await sendMessage(blockData.userId, `🚫 شما توسط ادمین مسدود شدید.\nدلیل: ${reason}`);
  await sendMessage(chatId, `✅ کاربر ${blockData.userId} با موفقیت مسدود شد.\nدلیل: ${reason}`);
}

// ============================================
// پنل سوپر ادمین
// ============================================

async function handleSuperPanel(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const stats = await getStats(env);
  
  let text = `👑 <b>پنل سوپر ادمین</b>\n━━━━━━━━━━━━━━━\n👥 کاربران کل: ${stats.total_users}\n🚫 مسدود شده: ${stats.blocked_users}\n💬 کل پیام‌ها: ${stats.total_messages}\n⏳ در انتظار پاسخ: ${stats.pending}\n✅ پاسخ داده شده: ${stats.answered}\n🚫 مسدود شده: ${stats.blocked_msgs}\n━━━━━━━━━━━━━━━\n<b>آمار بخش‌ها:</b>\n`;
  
  for (const key in stats.section_stats) {
    const name = SECTIONS[key].name;
    const stat = stats.section_stats[key];
    text += `• ${name}: ${stat.pending} در انتظار\n`;
  }
  
  text += `\n🕐 ${new Date().toLocaleString('fa-IR')}`;
  
  const markup = {
    inline_keyboard: [
      [{ text: '🚫 بلاک کاربر', callback_data: 'super_block' }],
      [{ text: '✅ رفع بلاک', callback_data: 'super_unblock' }],
      [{ text: '📋 لیست کاربران', callback_data: 'super_users' }],
      [{ text: '👤 افزودن ادمین', callback_data: 'super_add_admin' }],
      [{ text: '🗑️ حذف ادمین', callback_data: 'super_remove_admin' }],
      [{ text: '📊 آمار کامل', callback_data: 'super_stats' }]
    ]
  };
  
  await sendMessage(chatId, text, 'HTML', markup);
}

// ============================================
// دستورات مدیریت ادمین
// ============================================

async function handleSetAdmin(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const markup = {
    inline_keyboard: []
  };
  for (const key in SECTIONS) {
    const admins = await getSectionAdminsFromDB(env, key);
    markup.inline_keyboard.push([{ text: `${SECTIONS[key].name} (${admins.length} ادمین)`, callback_data: `add_admin_section_${key}` }]);
  }
  
  await sendMessage(chatId, '👤 <b>افزودن ادمین به بخش</b>\n\nبخشی که می‌خواهید ادمین اضافه کنید را انتخاب کنید:', 'HTML', markup);
}

async function handleAddAdminSection(env, callback) {
  const sectionKey = callback.data.replace('add_admin_section_', '');
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  const sectionName = getSectionName(sectionKey);
  
  await sendMessage(chatId, `👤 <b>افزودن ادمین به ${sectionName}</b>\n\nشناسه عددی ادمین جدید را وارد کنید:\nبرای لغو، /cancel را ارسال کنید.`, 'HTML');
  
  pendingAddAdmin.set(chatId, { sectionKey: sectionKey });
  await answerCallback(callbackId);
}

const pendingAddAdmin = new Map();

async function processAddAdmin(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  if (!isSuperAdmin(userId)) return;
  
  if (text.toLowerCase() === '/cancel') {
    await sendMessage(chatId, '❌ عملیات لغو شد.');
    return;
  }
  
  const data = pendingAddAdmin.get(chatId);
  if (!data) return;
  
  pendingAddAdmin.delete(chatId);
  
  try {
    const adminId = parseInt(text);
    if (isNaN(adminId)) {
      await sendMessage(chatId, '❌ شناسه نامعتبر. لطفاً یک عدد وارد کنید.');
      return;
    }
    
    const user = await getUserById(env, adminId);
    if (!user) {
      await sendMessage(chatId, `❌ کاربر با شناسه ${adminId} یافت نشد.\n\nاین کاربر باید حداقل یک بار ربات را شروع کرده باشد.`, 'HTML');
      return;
    }
    
    if (isSuperAdmin(adminId)) {
      await sendMessage(chatId, `⚠️ کاربر ${adminId} سوپر ادمین است و نیازی به افزودن ندارد.`, 'HTML');
      return;
    }
    
    const currentAdmins = await getSectionAdminsFromDB(env, data.sectionKey);
    if (currentAdmins.includes(adminId)) {
      await sendMessage(chatId, `⚠️ کاربر ${adminId} قبلاً به این بخش اضافه شده است.`, 'HTML');
      return;
    }
    
    currentAdmins.push(adminId);
    await updateSectionAdmins(env, data.sectionKey, currentAdmins);
    await logActivity(env, userId, 'add_admin', adminId, null, `افزودن به بخش ${getSectionName(data.sectionKey)}`);
    
    await sendMessage(adminId, `👑 <b>تبریک! شما به عنوان ادمین اضافه شدید</b>\n\n📋 بخش: ${getSectionName(data.sectionKey)}\n👤 توسط: ${message.from.first_name}\n\n✅ حالا می‌توانید از دستورات زیر استفاده کنید:\n/inbox - 📬 مشاهده صندوق پیام‌ها\n/panel - 📊 پنل مدیریت\n/stats - 📈 آمار`, 'HTML');
    
    await sendMessage(chatId, `✅ کاربر ${adminId} با موفقیت به بخش ${getSectionName(data.sectionKey)} اضافه شد.`, 'HTML');
    
  } catch (e) {
    console.error('Add admin error:', e);
    await sendMessage(chatId, `❌ خطا: ${e.message}`);
  }
}

// ============================================
// حذف ادمین
// ============================================

async function handleRemoveAdmin(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const markup = {
    inline_keyboard: []
  };
  let hasAdmin = false;
  for (const key in SECTIONS) {
    const admins = await getSectionAdminsFromDB(env, key);
    if (admins.length > 0) {
      hasAdmin = true;
      markup.inline_keyboard.push([{ text: `${SECTIONS[key].name} (${admins.length} ادمین)`, callback_data: `remove_admin_section_${key}` }]);
    }
  }
  
  if (!hasAdmin) {
    await sendMessage(chatId, '📭 هیچ ادمینی در بخش‌ها وجود ندارد.');
    return;
  }
  
  await sendMessage(chatId, '🗑️ <b>حذف ادمین از بخش</b>\n\nبخشی که می‌خواهید ادمین حذف کنید را انتخاب کنید:', 'HTML', markup);
}

async function handleRemoveAdminSection(env, callback) {
  const sectionKey = callback.data.replace('remove_admin_section_', '');
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const admins = await getSectionAdminsFromDB(env, sectionKey);
  if (admins.length === 0) {
    await sendMessage(chatId, `❌ هیچ ادمینی در بخش ${getSectionName(sectionKey)} وجود ندارد.`);
    await answerCallback(callbackId);
    return;
  }
  
  const markup = {
    inline_keyboard: []
  };
  for (const adminId of admins) {
    if (!isSuperAdmin(adminId)) {
      const user = await getUserById(env, adminId);
      const name = user ? user.first_name || String(adminId) : String(adminId);
      markup.inline_keyboard.push([{ text: `🗑️ ${name} (${adminId})`, callback_data: `remove_admin_${sectionKey}_${adminId}` }]);
    }
  }
  
  if (markup.inline_keyboard.length === 0) {
    await sendMessage(chatId, `⚠️ تمام ادمین‌های بخش ${getSectionName(sectionKey)} سوپر ادمین هستند و قابل حذف نیستند.`);
    await answerCallback(callbackId);
    return;
  }
  
  await sendMessage(chatId, `🗑️ <b>حذف ادمین از ${getSectionName(sectionKey)}</b>\n\nادمین مورد نظر را انتخاب کنید:`, 'HTML', markup);
  await answerCallback(callbackId);
}

async function handleRemoveAdminConfirm(env, callback) {
  const parts = callback.data.split('_');
  const sectionKey = parts[1];
  const adminId = parseInt(parts[2]);
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const currentAdmins = await getSectionAdminsFromDB(env, sectionKey);
  if (currentAdmins.includes(adminId)) {
    const newAdmins = currentAdmins.filter(id => id !== adminId);
    await updateSectionAdmins(env, sectionKey, newAdmins);
    await logActivity(env, callback.from.id, 'remove_admin', adminId, null, `حذف از بخش ${getSectionName(sectionKey)}`);
    
    await sendMessage(adminId, `🗑️ شما از ادمین‌های بخش ${getSectionName(sectionKey)} حذف شدید.`);
    await sendMessage(chatId, `✅ ادمین ${adminId} از بخش ${getSectionName(sectionKey)} حذف شد.`);
  } else {
    await sendMessage(chatId, `⚠️ ادمین ${adminId} در این بخش وجود ندارد.`);
  }
  
  await answerCallback(callbackId);
}

// ============================================
// سایر دستورات
// ============================================

async function handlePanel(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const stats = await getStats(env);
  const text = `📊 <b>پنل مدیریت</b>\n━━━━━━━━━━━━━━━\n👥 کاربران: ${stats.total_users}\n⏳ در انتظار: ${stats.pending}\n✅ پاسخ داده شده: ${stats.answered}\n━━━━━━━━━━━━━━━\n📬 از /inbox برای مشاهده پیام‌ها استفاده کنید.`;
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleStats(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const stats = await getStats(env);
  const text = `📈 <b>آمار کلی</b>\n━━━━━━━━━━━━━━━\n👥 کاربران: ${stats.total_users}\n🚫 مسدود شده: ${stats.blocked_users}\n💬 کل پیام‌ها: ${stats.total_messages}\n⏳ در انتظار پاسخ: ${stats.pending}\n✅ پاسخ داده شده: ${stats.answered}`;
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleUsers(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const db = env.DB;
  const result = await db.exec(`
    SELECT user_id, username, first_name, last_name, role, is_blocked, 
           total_messages, join_date, last_active
    FROM users
    ORDER BY last_active DESC
    LIMIT 20
  `);
  
  const users = result.results || [];
  if (users.length === 0) {
    await sendMessage(chatId, '📭 هیچ کاربری یافت نشد.');
    return;
  }
  
  let text = '👥 <b>۲۰ کاربر آخر</b>\n━━━━━━━━━━━━━━━\n';
  for (const user of users) {
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'بدون نام';
    const username = user.username ? `@${user.username}` : 'ندارد';
    const status = user.is_blocked ? '🚫' : '✅';
    const roleEmoji = user.role === 'super_admin' ? '👑' : user.role === 'admin' ? '👤' : '👤';
    text += `${status} ${roleEmoji} <code>${user.user_id}</code>\n👤 ${name} | ${username}\n💬 ${user.total_messages} پیام\n━━━━━━━━━━━━━━━\n`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleAllMessages(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const db = env.DB;
  const result = await db.exec(`
    SELECT m.*, u.username, u.first_name, u.last_name, s.name as section_name
    FROM messages m
    JOIN users u ON m.user_id = u.user_id
    JOIN sections s ON m.section_key = s.section_key
    ORDER BY m.date DESC
    LIMIT 20
  `);
  
  const rows = result.results || [];
  if (rows.length === 0) {
    await sendMessage(chatId, '📭 هیچ پیامی وجود ندارد.');
    return;
  }
  
  let text = '📨 <b>۲۰ پیام آخر</b>\n━━━━━━━━━━━━━━━\n';
  for (const row of rows) {
    const userName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'کاربر';
    const statusEmoji = row.status === 'pending' ? '⏳' : row.status === 'answered' ? '✅' : '🚫';
    text += `${statusEmoji} #${row.msg_id} | ${row.section_name}\n👤 ${userName}\n📝 ${row.content ? row.content.substring(0, 40) : 'فایل'}\n🕐 ${formatDate(row.date)}\n━━━━━━━━━━━━━━━\n`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleShowAdmins(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  let text = '👑 <b>لیست ادمین‌های بخش‌ها</b>\n━━━━━━━━━━━━━━━\n';
  
  for (const key in SECTIONS) {
    const admins = await getSectionAdminsFromDB(env, key);
    const sectionName = SECTIONS[key].name;
    
    if (admins.length > 0) {
      const adminList = [];
      for (const adminId of admins) {
        const user = await getUserById(env, adminId);
        if (user) {
          const name = user.first_name || 'کاربر';
          const username = user.username ? `@${user.username}` : '';
          adminList.push(`${name} (${adminId}) ${username}`);
        } else {
          adminList.push(String(adminId));
        }
      }
      text += `\n<b>${sectionName}</b>:\n• ${adminList.join('\n• ')}\n`;
    } else {
      text += `\n<b>${sectionName}</b>: 🚫 بدون ادمین\n`;
    }
  }
  
  text += `\n━━━━━━━━━━━━━━━\n👑 سوپر ادمین: ${SUPER_ADMIN_IDS.join(', ')}`;
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleActivity(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const logs = await getActivityLog(env, 10);
  if (logs.length === 0) {
    await sendMessage(chatId, '📭 هیچ فعالیتی ثبت نشده است.');
    return;
  }
  
  let text = '📋 <b>۱۰ فعالیت اخیر</b>\n━━━━━━━━━━━━━━━\n';
  const emojis = {
    'reply': '📝',
    'block': '🚫',
    'unblock': '✅',
    'add_admin': '👤',
    'remove_admin': '🗑️',
    'broadcast': '📢',
    'mark_answered': '✅'
  };
  
  for (const log of logs) {
    const emoji = emojis[log.action] || '📌';
    text += `${emoji} ${log.action}\n👤 ادمین: ${log.admin_id}\n📝 ${log.details || 'بدون توضیح'}\n🕐 ${formatDate(log.date)}\n━━━━━━━━━━━━━━━\n`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleBroadcast(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const markup = {
    inline_keyboard: [
      [{ text: '📢 همه کاربران', callback_data: 'broadcast_all' }],
      [{ text: '📋 یک بخش خاص', callback_data: 'broadcast_section' }]
    ]
  };
  
  await sendMessage(chatId, '📢 <b>ارسال همگانی</b>\n\nمخاطبان خود را انتخاب کنید:', 'HTML', markup);
}

async function handleSectionStats(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '❌ شما دسترسی به این دستور را ندارید.');
    return;
  }
  
  const stats = await getStats(env);
  let text = '📊 <b>آمار بخش‌ها</b>\n━━━━━━━━━━━━━━━\n';
  for (const key in stats.section_stats) {
    const name = SECTIONS[key].name;
    const stat = stats.section_stats[key];
    const admins = await getSectionAdminsFromDB(env, key);
    text += `${name}\n  • در انتظار: ${stat.pending}\n  • کل: ${stat.total}\n  • ادمین‌ها: ${admins.length}\n━━━━━━━━━━━━━━━\n`;
  }
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleDebug(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const stats = await getStats(env);
  
  let text = `🔍 <b>اطلاعات دیباگ ربات</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🆔 <b>شناسه شما:</b> <code>${userId}</code>\n👑 <b>سوپر ادمین:</b> ${isSuperAdmin(userId) ? '✅ بله' : '❌ خیر'}\n👤 <b>ادمین:</b> ${isAdmin(userId) ? '✅ بله' : '❌ خیر'}\n📋 <b>بخش‌های شما:</b> ${getUserSections(userId).map(s => getSectionName(s)).join(', ') || 'هیچکدام'}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 <b>آمار کلی:</b>\n👥 کاربران: ${stats.total_users}\n💬 کل پیام‌ها: ${stats.total_messages}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 <b>آمار بخش‌ها:</b>\n`;
  
  for (const key in stats.section_stats) {
    const name = SECTIONS[key].name;
    const stat = stats.section_stats[key];
    const isAdminThis = getUserSections(userId).includes(key) ? '⭐' : '  ';
    text += `${isAdminThis} ${name}:\n   📨 کل: ${stat.total} | ⏳ در انتظار: ${stat.pending}\n`;
  }
  
  text += `\n🕐 ${new Date().toLocaleString('fa-IR')}`;
  
  await sendMessage(chatId, text, 'HTML');
}

async function handleFix(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط سوپر ادمین دسترسی به این دستور را دارد.');
    return;
  }
  
  const statusMsg = await sendMessage(chatId, '🔧 <b>در حال تعمیر ربات...</b>', 'HTML');
  const statusMsgId = statusMsg.result.message_id;
  
  try {
    // بررسی دیتابیس
    await editMessageText(chatId, statusMsgId, '🔧 1. بررسی دیتابیس...');
    await env.DB.exec('VACUUM');
    await editMessageText(chatId, statusMsgId, '✅ 1. دیتابیس سالم است');
    
    // تنظیم مجدد منو
    await editMessageText(chatId, statusMsgId, '🔧 2. تنظیم مجدد منو...');
    await editMessageText(chatId, statusMsgId, '✅ 2. منو تنظیم شد');
    
    // تنظیم سوپر ادمین
    await editMessageText(chatId, statusMsgId, '🔧 3. تنظیم دسترسی سوپر ادمین...');
    for (const adminId of SUPER_ADMIN_IDS) {
      await env.DB.exec(`UPDATE users SET role = 'super_admin' WHERE user_id = ${adminId}`);
    }
    await editMessageText(chatId, statusMsgId, '✅ 3. دسترسی سوپر ادمین تنظیم شد');
    
    await editMessageText(chatId, statusMsgId, '✅ <b>ربات با موفقیت تعمیر شد!</b>\n\n🔄 لطفاً ربات را با /start ریستارت کنید.', 'HTML');
    
  } catch (e) {
    console.error('Fix error:', e);
    await editMessageText(chatId, statusMsgId, `❌ خطا در تعمیر: ${e.message.substring(0, 100)}`, 'HTML');
  }
}

// ============================================
// کالبک‌های عمومی (Broadcast, etc)
// ============================================

const pendingBroadcast = new Map();

async function handleBroadcastCallback(env, callback) {
  const chatId = callback.message.chat.id;
  const userId = callback.from.id;
  const data = callback.data;
  const callbackId = callback.id;
  
  if (!isAdmin(userId)) {
    await answerCallback(callbackId, '❌ عدم دسترسی');
    return;
  }
  
  if (data === 'broadcast_all') {
    await sendMessage(chatId, '📢 <b>ارسال به همه کاربران</b>\n\nپیام خود را وارد کنید:\nبرای لغو، /cancel را ارسال کنید.', 'HTML');
    pendingBroadcast.set(chatId, { type: 'all' });
  } else if (data === 'broadcast_section') {
    const markup = {
      inline_keyboard: Object.keys(SECTIONS).map(key => [{ text: SECTIONS[key].name, callback_data: `broadcast_to_${key}` }])
    };
    await sendMessage(chatId, '📢 <b>انتخاب بخش</b>\n\nبخشی که می‌خواهید به کاربران آن پیام دهید را انتخاب کنید:', 'HTML', markup);
  } else if (data.startsWith('broadcast_to_')) {
    const sectionKey = data.replace('broadcast_to_', '');
    await sendMessage(chatId, `📢 <b>ارسال به بخش ${getSectionName(sectionKey)}</b>\n\nپیام خود را وارد کنید:\nبرای لغو، /cancel را ارسال کنید.`, 'HTML');
    pendingBroadcast.set(chatId, { type: 'section', sectionKey: sectionKey });
  }
  
  await answerCallback(callbackId);
}

async function processBroadcast(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  if (!isAdmin(userId)) return;
  
  if (text.toLowerCase() === '/cancel') {
    await sendMessage(chatId, '❌ لغو شد.');
    return;
  }
  
  const data = pendingBroadcast.get(chatId);
  if (!data) return;
  
  pendingBroadcast.delete(chatId);
  
  let users = [];
  const db = env.DB;
  
  if (data.type === 'all') {
    const result = await db.exec('SELECT user_id FROM users WHERE is_blocked = 0');
    users = result.results || [];
  } else if (data.type === 'section') {
    const result = await db.exec(`
      SELECT DISTINCT user_id FROM messages 
      WHERE section_key = '${data.sectionKey}' 
      AND user_id IN (SELECT user_id FROM users WHERE is_blocked = 0)
    `);
    users = result.results || [];
  }
  
  if (users.length === 0) {
    await sendMessage(chatId, '❌ هیچ کاربری یافت نشد.');
    return;
  }
  
  const statusMsg = await sendMessage(chatId, `⏳ در حال ارسال به ${users.length} کاربر...`);
  const statusMsgId = statusMsg.result.message_id;
  
  let success = 0;
  let fail = 0;
  
  for (const user of users) {
    try {
      await sendMessage(user.user_id, text, 'HTML');
      success++;
    } catch (e) {
      fail++;
    }
    if ((success + fail) % 10 === 0) {
      await editMessageText(chatId, statusMsgId, `⏳ در حال ارسال...\n✅ موفق: ${success}\n❌ ناموفق: ${fail}`);
    }
  }
  
  await logActivity(env, userId, 'broadcast', null, null, `ارسال به ${success} کاربر`);
  await editMessageText(chatId, statusMsgId, `✅ <b>ارسال همگانی کامل شد</b>\n\nموفق: ${success}\nناموفق: ${fail}`, 'HTML');
}

// ============================================
// کالبک‌های عمومی (refresh, etc)
// ============================================

async function handleRefreshInbox(env, callback) {
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const userId = callback.from.id;
  if (isSuperAdmin(userId)) {
    const markup = {
      inline_keyboard: [
        [{ text: '📬 همه پیام‌ها', callback_data: 'inbox_all' }]
      ]
    };
    for (const key in SECTIONS) {
      markup.inline_keyboard.push([{ text: SECTIONS[key].name, callback_data: `inbox_section_${key}` }]);
    }
    await sendMessage(chatId, '📬 <b>صندوق پیام‌های شورا</b>\n\nبخش مورد نظر را انتخاب کنید:', 'HTML', markup);
  } else {
    const userSections = getUserSections(userId);
    if (userSections.length > 0) {
      const markup = {
        inline_keyboard: userSections.map(key => [{ text: `📬 ${SECTIONS[key].name}`, callback_data: `inbox_section_${key}` }])
      };
      await sendMessage(chatId, '📬 <b>صندوق پیام‌های شما</b>\n\nبخش مورد نظر را انتخاب کنید:', 'HTML', markup);
    }
  }
  
  await answerCallback(callbackId);
}

// ============================================
// کالبک‌های سوپر ادمین
// ============================================

async function handleSuperBlock(env, callback) {
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  await sendMessage(chatId, '🚫 شناسه کاربر را برای بلاک وارد کنید:');
  pendingSuperBlocks.set(chatId, { action: 'block' });
  await answerCallback(callbackId);
}

async function handleSuperUnblock(env, callback) {
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  await sendMessage(chatId, '✅ شناسه کاربر را برای رفع بلاک وارد کنید:');
  pendingSuperBlocks.set(chatId, { action: 'unblock' });
  await answerCallback(callbackId);
}

const pendingSuperBlocks = new Map();

async function processSuperBlock(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  if (!isSuperAdmin(userId)) return;
  
  const data = pendingSuperBlocks.get(chatId);
  if (!data) return;
  
  pendingSuperBlocks.delete(chatId);
  
  try {
    const targetUserId = parseInt(text);
    if (isNaN(targetUserId)) {
      await sendMessage(chatId, '❌ شناسه نامعتبر!');
      return;
    }
    
    const user = await getUserById(env, targetUserId);
    if (!user) {
      await sendMessage(chatId, `❌ کاربر با شناسه ${targetUserId} یافت نشد.`);
      return;
    }
    
    if (data.action === 'block') {
      if (user.is_blocked === 1) {
        await sendMessage(chatId, `⚠️ کاربر ${targetUserId} قبلاً مسدود است.`);
        return;
      }
      await blockUser(env, targetUserId, userId, 'مسدود شده توسط سوپر ادمین');
      await logActivity(env, userId, 'block', targetUserId, null, 'مسدود شده توسط سوپر ادمین');
      await sendMessage(targetUserId, '🚫 شما توسط سوپر ادمین مسدود شدید.');
      await sendMessage(chatId, `✅ کاربر ${targetUserId} با موفقیت مسدود شد.`);
    } else if (data.action === 'unblock') {
      if (user.is_blocked === 0) {
        await sendMessage(chatId, `⚠️ کاربر ${targetUserId} مسدود نیست.`);
        return;
      }
      await unblockUser(env, targetUserId);
      await logActivity(env, userId, 'unblock', targetUserId, null, 'رفع مسدودیت توسط سوپر ادمین');
      await sendMessage(targetUserId, '✅ مسدودیت شما توسط سوپر ادمین رفع شد.');
      await sendMessage(chatId, `✅ مسدودیت کاربر ${targetUserId} با موفقیت رفع شد.`);
    }
    
  } catch (e) {
    console.error('Process super block error:', e);
    await sendMessage(chatId, `❌ خطا: ${e.message}`);
  }
}

// ============================================
// مدیریت Callback Query
// ============================================

async function handleCallbackQuery(env, callback) {
  const data = callback.data;
  
  // انتخاب بخش
  if (data.startsWith('select_section_')) {
    await handleSelectSection(env, callback);
    return;
  }
  
  // Inbox
  if (data === 'inbox_all' || data.startsWith('inbox_section_')) {
    await handleInboxCallback(env, callback);
    return;
  }
  
  // مشاهده پیام
  if (data.startsWith('view_msg_')) {
    await handleViewMessage(env, callback);
    return;
  }
  
  // پاسخ به پیام
  if (data.startsWith('reply_to_')) {
    await handleReply(env, callback);
    return;
  }
  
  // بلاک کاربر
  if (data.startsWith('block_user_')) {
    await handleBlockUser(env, callback);
    return;
  }
  
  // اطلاعات کاربر
  if (data.startsWith('user_info_')) {
    const userId = parseInt(data.replace('user_info_', ''));
    const chatId = callback.message.chat.id;
    const user = await getUserById(env, userId);
    
    if (!user) {
      await sendMessage(chatId, '❌ کاربر یافت نشد.');
      await answerCallback(callback.id);
      return;
    }
    
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'بدون نام';
    const status = user.is_blocked ? '🚫 مسدود' : '✅ فعال';
    const text = `👤 <b>اطلاعات کاربر</b>\n━━━━━━━━━━━━━━━\n🆔 شناسه: <code>${userId}</code>\n👤 نام: ${name}\n🔖 یوزرنیم: ${user.username ? `@${user.username}` : 'ندارد'}\n👑 نقش: ${user.role || 'user'}\n📊 وضعیت: ${status}\n💬 کل پیام‌ها: ${user.total_messages || 0}\n📅 عضویت: ${formatDate(user.join_date)}\n🕐 آخرین فعالیت: ${formatDate(user.last_active)}`;
    
    const markup = {
      inline_keyboard: [
        [{ text: '🔙 برگشت', callback_data: 'refresh_inbox' }],
        [{ text: '🚫 بلاک', callback_data: `block_user_${userId}` }]
      ]
    };
    
    await sendMessage(chatId, text, 'HTML', markup);
    await answerCallback(callback.id);
    return;
  }
  
  // پاسخ سریع
  if (data.startsWith('quick_reply_')) {
    const msgId = parseInt(data.replace('quick_reply_', ''));
    await sendMessage(callback.message.chat.id, `💬 <b>پاسخ به پیام #${msgId}</b>\n\nپیام خود را وارد کنید:`, 'HTML');
    pendingReplies.set(callback.message.chat.id, msgId);
    await answerCallback(callback.id);
    return;
  }
  
  // Broadcast
  if (data.startsWith('broadcast_')) {
    await handleBroadcastCallback(env, callback);
    return;
  }
  
  // Refresh Inbox
  if (data === 'refresh_inbox') {
    await handleRefreshInbox(env, callback);
    return;
  }
  
  // سوپر ادمین
  if (data === 'super_block') {
    await handleSuperBlock(env, callback);
    return;
  }
  if (data === 'super_unblock') {
    await handleSuperUnblock(env, callback);
    return;
  }
  if (data === 'super_users') {
    await handleUsers(env, { chat: { id: callback.message.chat.id }, from: { id: callback.from.id } });
    await answerCallback(callback.id);
    return;
  }
  if (data === 'super_stats') {
    await handleStats(env, { chat: { id: callback.message.chat.id }, from: { id: callback.from.id } });
    await answerCallback(callback.id);
    return;
  }
  if (data === 'super_add_admin') {
    await handleSetAdmin(env, { chat: { id: callback.message.chat.id }, from: { id: callback.from.id } });
    await answerCallback(callback.id);
    return;
  }
  if (data === 'super_remove_admin') {
    await handleRemoveAdmin(env, { chat: { id: callback.message.chat.id }, from: { id: callback.from.id } });
    await answerCallback(callback.id);
    return;
  }
  
  // افزودن ادمین
  if (data.startsWith('add_admin_section_')) {
    await handleAddAdminSection(env, callback);
    return;
  }
  
  // حذف ادمین
  if (data.startsWith('remove_admin_section_')) {
    await handleRemoveAdminSection(env, callback);
    return;
  }
  if (data.startsWith('remove_admin_') && !data.startsWith('remove_admin_section_')) {
    await handleRemoveAdminConfirm(env, callback);
    return;
  }
}

// ============================================
// ورودی اصلی Worker
// ============================================

export default {
  async fetch(request, env) {
    // فقط درخواست‌های POST رو قبول کن
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        
        // پردازش پیام
        if (update.message) {
          const msg = update.message;
          const text = msg.text || '';
          
          // دستورات
          if (text === '/start' || text.startsWith('/start')) {
            await handleStart(env, msg);
          } else if (text === '/help' || text.startsWith('/help')) {
            await handleHelp(env, msg);
          } else if (text === '/sections' || text.startsWith('/sections')) {
            await handleSections(env, msg);
          } else if (text === '/my_messages' || text.startsWith('/my_messages')) {
            await handleMyMessages(env, msg);
          } else if (text === '/inbox' || text.startsWith('/inbox')) {
            await handleInbox(env, msg);
          } else if (text === '/panel' || text.startsWith('/panel')) {
            await handlePanel(env, msg);
          } else if (text === '/stats' || text.startsWith('/stats')) {
            await handleStats(env, msg);
          } else if (text === '/users' || text.startsWith('/users')) {
            await handleUsers(env, msg);
          } else if (text === '/super_panel' || text.startsWith('/super_panel')) {
            await handleSuperPanel(env, msg);
          } else if (text === '/all_messages' || text.startsWith('/all_messages')) {
            await handleAllMessages(env, msg);
          } else if (text === '/show_admins' || text.startsWith('/show_admins')) {
            await handleShowAdmins(env, msg);
          } else if (text === '/activity' || text.startsWith('/activity')) {
            await handleActivity(env, msg);
          } else if (text === '/set_admin' || text.startsWith('/set_admin')) {
            await handleSetAdmin(env, msg);
          } else if (text === '/remove_admin' || text.startsWith('/remove_admin')) {
            await handleRemoveAdmin(env, msg);
          } else if (text === '/broadcast' || text.startsWith('/broadcast')) {
            await handleBroadcast(env, msg);
          } else if (text === '/section_stats' || text.startsWith('/section_stats')) {
            await handleSectionStats(env, msg);
          } else if (text === '/debug' || text.startsWith('/debug')) {
            await handleDebug(env, msg);
          } else if (text === '/fix' || text.startsWith('/fix')) {
            await handleFix(env, msg);
          } else {
            // پیام معمولی
            if (!text.startsWith('/')) {
              const chatId = msg.chat.id;
              if (userSectionCache.has(chatId)) {
                await handleUserMessage(env, msg);
              } else {
                await sendMessage(chatId, '⚠️ لطفاً ابتدا بخش مورد نظر را انتخاب کنید.\nاز /start استفاده کنید.');
              }
            }
          }
        }
        
        // پردازش Callback Query
        if (update.callback_query) {
          await handleCallbackQuery(env, update.callback_query);
        }
        
        // پردازش پیام‌های عادی (بدون دستور) که در مرحله قبل مدیریت نشدند
        if (update.message && !update.message.text?.startsWith('/')) {
          // قبلاً در بخش بالا مدیریت شد
        }
        
        return new Response('OK', { status: 200 });
        
      } catch (error) {
        console.error('Error:', error);
        return new Response('Error: ' + error.message, { status: 500 });
      }
    }
    
    // برای درخواست‌های GET (تست)
    if (request.method === 'GET') {
      return new Response('🤖 Telegram Bot is running on Cloudflare Workers!\n\n✅ Webhook is active.\n📝 Use /start in Telegram to begin.', { 
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    return new Response('Method Not Allowed', { status: 405 });
  }
};



