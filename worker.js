// ============================================
// ربات تست - فقط برای بررسی Webhook
// ============================================

const BOT_TOKEN = '8420190071:AAEoe5GhcjK0_nwdknQAFqB_0e2jlMYwy8w';

export default {
  async fetch(request, env) {
    // فقط درخواست‌های POST رو پردازش کن
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        console.log('📩 دریافت پیام:', update);
        
        // اگه پیام داشت
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          const firstName = update.message.from.first_name || 'کاربر';
          
          // ارسال پاسخ ساده
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👋 سلام ${firstName}!\n\nپیام شما دریافت شد: "${text}"\n\n✅ ربات تست فعال است!`,
              parse_mode: 'HTML'
            })
          });
        }
        
        // اگه کالبک بود
        if (update.callback_query) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: update.callback_query.id,
              text: '✅ دریافت شد!'
            })
          });
        }
        
        return new Response('OK', { status: 200 });
        
      } catch (error) {
        console.error('❌ خطا:', error);
        return new Response('Error: ' + error.message, { status: 500 });
      }
    }
    
    // برای درخواست‌های GET (چک کردن وضعیت)
    return new Response('🤖 ربات تست فعال است!\nبرای تست به ربات پیام بدهید.', { 
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};