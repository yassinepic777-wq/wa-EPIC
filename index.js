const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

// قراءة الإعدادات من متغيرات السيرفر
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// حماية: إذا لم توجد المتغيرات، لا يبدأ البوت
if (!TG_TOKEN || !TG_CHAT_ID) {
    console.error("❌ ERROR: Missing TG_TOKEN or TG_CHAT_ID in Environment Variables!");
    process.exit(1);
}

const messageLog = new Map();

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }), // حفظ الجلسة في ملف
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

client.on('qr', async (qr) => {
    try {
        const imagePath = './whatsapp-qr.png';
        await QRCode.toFile(imagePath, qr, { width: 300 });
        const form = new FormData();
        form.append('chat_id', TG_CHAT_ID);
        form.append('photo', fs.createReadStream(imagePath));
        form.append('caption', '📸 *WhatsApp Radar system requested login!*');

        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
        console.log('🚀 QR sent to Telegram.');
    } catch (err) {
        console.error('QR Error:', err.message);
    }
});

client.on('ready', () => {
    console.log('🛡️ WhatsApp Radar is active!');
});

client.on('message', async (msg) => {
    let mediaData = null;

    // لو الرسالة فيها ميديا، حملها فوراً
    if (msg.hasMedia) {
        try {
            mediaData = await msg.downloadMedia();
        } catch (err) {
            console.error("❌ Failed to download media:", err.message);
        }
    }

    const contact = await msg.getContact();
    
    // حفظ الرسالة (سواء نص أو ميديا) في الذاكرة
    messageLog.set(msg.id.id, {
        body: msg.body || (mediaData ? '[مرفق ميديا بدون نص]' : ''),
        media: mediaData,
        sender: contact.pushname || contact.name || "Unknown",
        time: new Date().toLocaleTimeString()
    });

    // تقليل حجم الذاكرة (إبقاء آخر 200 رسالة فقط)
    if (messageLog.size > 200) {
        const firstKey = messageLog.keys().next().value;
        messageLog.delete(firstKey);
    }
});

client.on('message_revoke_everyone', async (after, before) => {
    // استخدام after.id.id لضمان الوصول للـ ID الصحيح للرسالة المحذوفة
    const deletedMsgId = after.id.id;

    if (messageLog.has(deletedMsgId)) {
        const originalMsg = messageLog.get(deletedMsgId);
        const captionText = `🚨 *Deleted Message Detected!*\n👤 *Sender:* ${originalMsg.sender}\n📩 *Text:* ${originalMsg.body}\n🕒 *Time:* ${originalMsg.time}`;

        try {
            if (originalMsg.media) {
                // إذا كانت الرسالة المحذوفة تحتوي على ميديا
                const buffer = Buffer.from(originalMsg.media.data, 'base64');
                const form = new FormData();
                form.append('chat_id', TG_CHAT_ID);
                form.append('caption', captionText);
                form.append('parse_mode', 'Markdown');
                
                // تحديد اسم وامتداد الملف
                const ext = originalMsg.media.mimetype.split('/')[1].split(';')[0];
                const filename = originalMsg.media.filename || `deleted_media.${ext}`;
                
                form.append('document', buffer, { filename: filename });

                await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
                console.log('📤 Deleted Media forwarded to Telegram.');
            } else {
                // إذا كانت الرسالة نصية فقط
                await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    chat_id: TG_CHAT_ID,
                    text: captionText,
                    parse_mode: 'Markdown'
                });
                console.log('📤 Deleted Text forwarded to Telegram.');
            }
        } catch (e) {
            console.error("Telegram API Error:", e.message);
        }

        // مسح الرسالة من الذاكرة بعد إرسالها لتفريغ المساحة
        messageLog.delete(deletedMsgId);
    }
});

process.on('unhandledRejection', (reason) => console.error('⚠️ Unhandled Rejection:', reason));

client.initialize();
