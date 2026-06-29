const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// ================= إعدادات الحسابات (عدلها هنا) =================
const TELEGRAM_TOKEN = 'ضع_توكن_البوت_هنا';
const TELEGRAM_CHAT_ID = 'ضع_أيدي_حسابك_هنا';
// ==========================================================

const app = express();
const messageCache = new Map();

// خادم الويب للحفاظ على تشغيل السيرفر 24/7
app.get('/', (req, res) => {
    res.send('البوت يعمل بنجاح وبانتظار الرسائل المحذوفة!');
});

app.listen(3000, () => {
    console.log('🌐 خادم الحفاظ على التشغيل جاهز على المنفذ 3000');
});

// إعداد متصفح الوهمي متوافق مع بيئة Replit
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// عند توليد كود الـ QR، يتم تحويله لصورة وإرساله لتيليجرام
client.on('qr', async (qr) => {
    console.log('🔄 تم توليد كود QR جديد، جاري إرساله إلى تيليجرام...');
    try {
        const qrBuffer = await QRCode.toBuffer(qr, { scale: 8 });
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
        
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('caption', '📱 امسح هذا الكود خلال 20 ثانية لربط حساب واتساب بالبوت!');
        form.append('photo', qrBuffer, { filename: 'whatsapp-qr.png' });

        await axios.post(url, form, { headers: form.getHeaders() });
        console.log('✅ تم إرسال الكود لتيليجرام بنجاح.');
    } catch (err) {
        console.error('❌ فشل في إرسال كود QR لتيليجرام:', err.message);
    }
});

client.on('ready', () => {
    console.log('🚀 تم الاتصال بنجاح! البوت الآن يراقب الرسائل المحذوفة.');
    sendTextToTelegram('🚀 تم تشغيل البوت بنجاح وهو الآن يراقب الرسايل المحذوفة في الخلفية!');
});

// التقاط الرسايل وتخزينها مؤقتاً
client.on('message', async msg => {
    let mediaData = null;
    if (msg.hasMedia) {
        try {
            mediaData = await msg.downloadMedia();
        } catch (err) {
            console.error("❌ خطأ في تحميل الميديا الفوري:", err.message);
        }
    }
    
    messageCache.set(msg.id.id, {
        text: msg.body || '',
        media: mediaData,
        sender: msg.from,
        timestamp: Date.now()
    });
});

// لقط حدث الحذف من الجميع
client.on('message_revoke_everyone', async (after, before) => {
    const deletedMsgId = after.id.id;
    
    if (messageCache.has(deletedMsgId)) {
        const cachedMsg = messageCache.get(deletedMsgId);
        const fromInfo = after.author ? `${after.author} (في جروب)` : after.from;
        const caption = `⚠️ *رسالة ممسوحة!*\n👤 من: ${fromInfo}\n📝 النص الأصلي: ${cachedMsg.text}`;

        if (cachedMsg.media) {
            await sendMediaToTelegram(cachedMsg.media, caption);
        } else {
            await sendTextToTelegram(caption);
        }
        messageCache.delete(deletedMsgId);
    }
});

// دالة إرسال النصوص لتيليجرام
async function sendTextToTelegram(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ خطأ إرسال نص لتيليجرام:', error.message);
    }
}

// دالة إرسال الميديا لتيليجرام
async function sendMediaToTelegram(media, caption) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    try {
        const buffer = Buffer.from(media.data, 'base64');
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('caption', caption);
        
        const ext = media.mimetype.split('/')[1].split(';')[0]; 
        const filename = media.filename || `deleted_file.${ext}`;
        form.append('document', buffer, { filename: filename });

        await axios.post(url, form, { headers: form.getHeaders() });
    } catch (error) {
        console.error('❌ خطأ إرسال ميديا لتيليجرام:', error.message);
    }
}

client.initialize();

// تنظيف الذاكرة المؤقتة كل نصف ساعة منعاً لامتلاء الرام
setInterval(() => {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    for (let [id, msg] of messageCache.entries()) {
        if (now - msg.timestamp > ONE_HOUR) {
            messageCache.delete(id);
        }
    }
}, 30 * 60 * 1000);
