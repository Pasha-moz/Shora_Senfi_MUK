/**
 * ربات شورای صنفی - نسخه ساده و کاربردی
 * فقط: استارت، ارسال پیام، اینباکس و پاسخ
 */

const BOT_TOKEN = '8420190071:AAEoe5GhcjK0_nwdknQAFqB_0e2jlMYwy8w';
const SUPER_ADMIN_IDS = [5291812280];

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

// ============================================
// دیتابیس (Cloudflare D1)
// ============================================

async function initDB(env) {
  const db = env.DB;
  
  // جدول کاربران
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      join_date TEXT,
      is_blocked INTEGER DEFAULT 0,
      role TEXT DEFAULT 'user'
    )
  `);
  
  // جدول پیام‌ها
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      msg_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      content TEXT,
      date TEXT,
      status TEXT DEFAULT 'pending',
      is_answered INTEGER DEFAULT 0,
      answer_content TEXT,
      admin_id INTEGER
    )
  `);
  
  // ثبت سوپر ادمین
  for (const id of SUPER_ADMIN_IDS) {
    await db.exec(`
      INSERT OR REPLACE INTO users (user_id, username, first_name, join_date, role)
      VALUES (${id}, 'super_admin', 'سوپر ادمین', '${getCurrentTime()}', 'super_admin')
    `);
  }
  
  return true;
}

async function upsertUser(env, user) {
  const db = env.DB;
  const now = getCurrentTime();
  const role = isSuperAdmin(user.id) ? 'super_admin' : 'user';
  
  await db.exec(`
    INSERT OR REPLACE INTO users (user_id, username, first_name, join_date, role)
    VALUES (${user.id}, '${user.username || ''}', '${user.first_name || ''}', '${now}', '${role}')
  `);
}

async function saveMessage(env, userId, content) {
  const db = env.DB;
  const now = getCurrentTime();
  
  const result = await db.exec(`
    INSERT INTO messages (user_id, content, date)
    VALUES (${userId}, '${content.replace(/'/g, "''")}', '${now}')
    RETURNING msg_id
  `);
  
  return result.results[0].msg_id;
}

async function getInboxMessages(env, limit = 20) {
  const db = env.DB;
  const result = await db.exec(`
    SELECT m.*, u.username, u.first_name
    FROM messages m
    JOIN users u ON m.user_id = u.user_id
    WHERE m.status != 'blocked'
    ORDER BY m.date DESC
    LIMIT ${limit}
  `);
  return result.results || [];
}

async function getMessageById(env, msgId) {
  const db = env.DB;
  const result = await db.exec(`
    SELECT m.*, u.username, u.first_name
    FROM messages m
    JOIN users u ON m.user_id = u.user_id
    WHERE m.msg_id = ${msgId}
  `);
  return result.results[0] || null;
}

async function updateMessageStatus(env, msgId, status, adminId = null, answerContent = null) {
  const db = env.DB;
  let query = `UPDATE messages SET status = '${status}'`;
  if (adminId) query += `, admin_id = ${adminId}, is_answered = 1`;
  if (answerContent) query += `, answer_content = '${answerContent.replace(/'/g, "''")}'`;
  query += ` WHERE msg_id = ${msgId}`;
  await db.exec(query);
}

async function blockUser(env, userId) {
  await env.DB.exec(`UPDATE users SET is_blocked = 1 WHERE user_id = ${userId}`);
}

async function unblockUser(env, userId) {
  await env.DB.exec(`UPDATE users SET is_blocked = 0 WHERE user_id = ${userId}`);
}

// ============================================
// ارسال پیام به تلگرام
// ============================================

async function sendMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
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

async function answerCallback(callbackId, text = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  const payload = { callback_query_id: callbackId };
  if (text) payload.text = text;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('answerCallback error:', e);
  }
}

// ============================================
// منوها
// ============================================

function createUserMenu() {
  return {
    keyboard: [['📨 ارسال پیام']],
    resize_keyboard: true
  };
}

function createAdminMenu() {
  return {
    keyboard: [
      ['📬 صندوق پیام‌ها'],
      ['❓ راهنما']
    ],
    resize_keyboard: true
  };
}

// ============================================
// هندلر start
// ============================================

async function handleStart(env, message) {
  const chatId = message.chat.id;
  const user = message.from;
  
  try {
    await upsertUser(env, user);
    
    // بررسی مسدود بودن
    const db = env.DB;
    const result = await db.exec(`SELECT is_blocked FROM users WHERE user_id = ${user.id}`);
    if (result.results && result.results[0]?.is_blocked === 1) {
      await sendMessage(chatId, '🚫 شما توسط ادمین مسدود شده‌اید.');
      return;
    }
    
    if (isSuperAdmin(user.id)) {
      // منوی ادمین
      const text = '👑 <b>پنل مدیریت</b>\n\n📬 از دکمه زیر برای مشاهده پیام‌ها استفاده کنید.\n💡 روی پیام کلیک کنید و پاسخ دهید.';
      await sendMessage(chatId, text, 'HTML', createAdminMenu());
    } else {
      // منوی کاربر عادی
      const text = '🎓 <b>به ربات شورای صنفی خوش آمدید!</b>\n\n📨 پیام خود را ارسال کنید.\n\n⏱️ در اسرع وقت پاسخ داده می‌شود.';
      await sendMessage(chatId, text, 'HTML', createUserMenu());
    }
    
  } catch (error) {
    console.error('handleStart error:', error);
    await sendMessage(chatId, '⚠️ خطایی رخ داد! لطفاً دوباره تلاش کنید.');
  }
}

// ============================================
// دریافت پیام از کاربر
// ============================================

async function handleUserMessage(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  // اگر روی دکمه‌ها کلیک شده
  if (text === '📨 ارسال پیام' || text === '📬 صندوق پیام‌ها' || text === '❓ راهنما') {
    return;
  }
  
  // بررسی مسدود بودن
  const db = env.DB;
  const result = await db.exec(`SELECT is_blocked, role FROM users WHERE user_id = ${userId}`);
  if (result.results && result.results[0]?.is_blocked === 1) {
    await sendMessage(chatId, '🚫 شما مسدود شده‌اید.');
    return;
  }
  
  // ذخیره پیام
  const msgId = await saveMessage(env, userId, text);
  
  // پیام تایید به کاربر
  await sendMessage(chatId, `✅ پیام شما دریافت شد.\nشماره: ${msgId}\n\n⏱️ در اسرع وقت پاسخ داده می‌شود.`);
  
  // اطلاع به ادمین
  for (const adminId of SUPER_ADMIN_IDS) {
    try {
      const userInfo = result.results[0];
      const name = userInfo?.first_name || message.from.first_name || 'کاربر';
      await sendMessage(
        adminId,
        `📨 <b>پیام جدید</b>\n━━━━━━━━━━━━━━━\n👤 کاربر: ${name}\n🆔 <code>${userId}</code>\n📝 ${text}\n━━━━━━━━━━━━━━━\n💡 از /start برای پاسخ استفاده کنید.`,
        'HTML'
      );
    } catch (e) {
      console.error('Notify admin error:', e);
    }
  }
}

// ============================================
// اینباکس (صندوق پیام‌ها)
// ============================================

async function handleInbox(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (!isSuperAdmin(userId)) {
    await sendMessage(chatId, '❌ فقط ادمین دسترسی دارد.');
    return;
  }
  
  // دریافت پیام‌ها
  const messages = await getInboxMessages(env, 20);
  
  if (messages.length === 0) {
    await sendMessage(chatId, '📭 صندوق پیام‌ها خالی است.');
    return;
  }
  
  let text = '📬 <b>صندوق پیام‌ها</b>\n━━━━━━━━━━━━━━━\n';
  text += `📊 ${messages.length} پیام\n━━━━━━━━━━━━━━━\n\n`;
  
  // نمایش ۵ پیام اول
  for (const msg of messages.slice(0, 5)) {
    const name = msg.first_name || 'کاربر';
    const status = msg.status === 'answered' ? '✅' : '⏳';
    const content = msg.content?.substring(0, 40) + (msg.content?.length > 40 ? '...' : '') || 'فایل';
    text += `${status} #${msg.msg_id} | ${name}\n📝 ${content}\n🕐 ${formatDate(msg.date)}\n━━━━━━━━━━━━━━━\n`;
  }
  
  // دکمه‌های اینباکس
  const markup = {
    inline_keyboard: []
  };
  for (const msg of messages.slice(0, 5)) {
    const status = msg.status === 'answered' ? '✅' : '⏳';
    markup.inline_keyboard.push([{ text: `${status} #${msg.msg_id}`, callback_data: `view_${msg.msg_id}` }]);
  }
  markup.inline_keyboard.push([{ text: '🔄 بازخوانی', callback_data: 'refresh_inbox' }]);
  
  await sendMessage(chatId, text, 'HTML', markup);
}

// ============================================
// مشاهده جزئیات پیام و پاسخ
// ============================================

async function handleViewMessage(env, callback) {
  const msgId = parseInt(callback.data.replace('view_', ''));
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  const msg = await getMessageById(env, msgId);
  if (!msg) {
    await sendMessage(chatId, '❌ پیام یافت نشد.');
    await answerCallback(callbackId);
    return;
  }
  
  const name = msg.first_name || 'کاربر';
  const status = msg.status === 'answered' ? '✅ پاسخ داده شده' : '⏳ در انتظار پاسخ';
  
  let text = `📨 <b>پیام #${msgId}</b>\n━━━━━━━━━━━━━━━\n👤 کاربر: ${name}\n🆔 <code>${msg.user_id}</code>\n📊 وضعیت: ${status}\n📝 ${msg.content}\n🕐 ${formatDate(msg.date)}\n`;
  
  if (msg.answer_content) {
    text += `\n💬 پاسخ شما:\n${msg.answer_content}`;
  }
  
  text += `\n━━━━━━━━━━━━━━━`;
  
  // دکمه‌ها
  const markup = {
    inline_keyboard: [
      [{ text: '📝 پاسخ', callback_data: `reply_${msgId}` }],
      [{ text: '🚫 بلاک کاربر', callback_data: `block_${msg.user_id}` }],
      [{ text: '🔙 برگشت', callback_data: 'refresh_inbox' }]
    ]
  };
  
  await sendMessage(chatId, text, 'HTML', markup);
  await answerCallback(callbackId);
}

// ============================================
// پاسخ به پیام
// ============================================

const pendingReplies = new Map();

async function handleReply(env, callback) {
  const msgId = parseInt(callback.data.replace('reply_', ''));
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
  
  if (!isSuperAdmin(userId)) return;
  
  const msgId = pendingReplies.get(chatId);
  if (!msgId) return;
  pendingReplies.delete(chatId);
  
  const msg = await getMessageById(env, msgId);
  if (!msg) {
    await sendMessage(chatId, '❌ پیام یافت نشد.');
    return;
  }
  
  // ارسال پاسخ به کاربر
  try {
    await sendMessage(msg.user_id, `📩 <b>پاسخ پشتیبانی:</b>\n\n${text}`, 'HTML');
    
    // به‌روزرسانی وضعیت پیام
    await updateMessageStatus(env, msgId, 'answered', userId, text);
    
    await sendMessage(chatId, `✅ پاسخ به پیام #${msgId} ارسال شد.`);
    
    // پیام تایید به کاربر
    await sendMessage(msg.user_id, '✅ پاسخ شما ارسال شد.');
    
  } catch (e) {
    console.error('Reply error:', e);
    await sendMessage(chatId, `❌ خطا: ${e.message}`);
  }
}

// ============================================
// بلاک کاربر
// ============================================

async function handleBlock(env, callback) {
  const userId = parseInt(callback.data.replace('block_', ''));
  const chatId = callback.message.chat.id;
  const callbackId = callback.id;
  
  await blockUser(env, userId);
  await sendMessage(chatId, `✅ کاربر ${userId} مسدود شد.`);
  await sendMessage(userId, '🚫 شما توسط ادمین مسدود شدید.');
  await answerCallback(callbackId);
}

// ============================================
// بازخوانی اینباکس
// ============================================

async function handleRefreshInbox(env, callback) {
  const chatId = callback.message.chat.id;
  await handleInbox(env, { chat: { id: chatId }, from: { id: callback.from.id } });
  await answerCallback(callback.id);
}

// ============================================
// راهنما
// ============================================

async function handleHelp(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  if (isSuperAdmin(userId)) {
    const text = `📚 <b>راهنمای ادمین</b>\n━━━━━━━━━━━━━━━\n/start - شروع مجدد\n/inbox - صندوق پیام‌ها\n\n💡 برای پاسخ به پیام:\n1. /inbox رو بزن\n2. روی پیام کلیک کن\n3. دکمه 'پاسخ' رو بزن\n4. پیام خود را وارد کن`;
    await sendMessage(chatId, text, 'HTML');
  } else {
    const text = `📚 <b>راهنمای کاربران</b>\n━━━━━━━━━━━━━━━\n/start - شروع مجدد\n\n📨 پیام خود را ارسال کنید.\n⏱️ در اسرع وقت پاسخ داده می‌شود.`;
    await sendMessage(chatId, text, 'HTML');
  }
}

// ============================================
// مدیریت دکمه‌های کیبورد
// ============================================

async function handleKeyboard(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;
  
  if (text === '📨 ارسال پیام') {
    await sendMessage(chatId, '📨 پیام خود را ارسال کنید:');
    return;
  }
  
  if (text === '📬 صندوق پیام‌ها') {
    await handleInbox(env, message);
    return;
  }
  
  if (text === '❓ راهنما') {
    await handleHelp(env, message);
    return;
  }
}

// ============================================
// مدیریت Callback
// ============================================

async function handleCallback(env, callback) {
  const data = callback.data;
  
  if (data.startsWith('view_')) {
    await handleViewMessage(env, callback);
    return;
  }
  
  if (data.startsWith('reply_')) {
    await handleReply(env, callback);
    return;
  }
  
  if (data.startsWith('block_')) {
    await handleBlock(env, callback);
    return;
  }
  
  if (data === 'refresh_inbox') {
    await handleRefreshInbox(env, callback);
    return;
  }
}

// ============================================
// ورودی اصلی
// ============================================

export default {
  async fetch(request, env) {
    // فقط درخواست‌های POST
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        
        // پردازش پیام
        if (update.message) {
          const msg = update.message;
          const text = msg.text || '';
          const chatId = msg.chat.id;
          const userId = msg.from.id;
          
          // دستورات
          if (text === '/start' || text.startsWith('/start')) {
            await handleStart(env, msg);
          } else if (text === '/help' || text.startsWith('/help')) {
            await handleHelp(env, msg);
          } else if (text === '/inbox' || text.startsWith('/inbox')) {
            await handleInbox(env, msg);
          } else if (text.startsWith('/')) {
            await sendMessage(chatId, '⚠️ دستور نامعتبر! از /start استفاده کنید.');
          } else if (text === '📨 ارسال پیام' || text === '📬 صندوق پیام‌ها' || text === '❓ راهنما') {
            await handleKeyboard(env, msg);
          } else {
            // پیام معمولی (فقط برای کاربران عادی)
            if (isSuperAdmin(userId)) {
              // ادمین پیام معمولی نده
              await sendMessage(chatId, '⚠️ برای مدیریت از دکمه‌های منو استفاده کنید.');
            } else {
              await handleUserMessage(env, msg);
            }
          }
        }
        
        // پردازش Callback
        if (update.callback_query) {
          await handleCallback(env, update.callback_query);
          await answerCallback(update.callback_query.id);
        }
        
        return new Response('OK', { status: 200 });
        
      } catch (error) {
        console.error('Error:', error);
        return new Response('Error: ' + error.message, { status: 500 });
      }
    }
    
    // درخواست GET
    if (request.method === 'GET') {
      return new Response('🤖 ربات فعال است!', { status: 200 });
    }
    
    return new Response('Method Not Allowed', { status: 405 });
  }
};