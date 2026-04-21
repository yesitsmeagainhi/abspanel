// server/whatsapp.js
// WhatsApp Web session manager using whatsapp-web.js
// Displays QR code in terminal on first run, then persists the session.

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

let client = null;
let isReady = false;

/*──────── Rate limiting ──────────────────────────────────────*/
const MSG_QUEUE = [];           // pending { chatId, message, resolve, reject }
let queueRunning = false;
const MIN_GAP_MS = 4000;        // minimum 4 seconds between sends
const DAILY_CAP = 200;          // max messages per calendar day
let dailySent = 0;
let dailyResetDate = new Date().toDateString();

function resetDailyCountIfNeeded() {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailySent = 0;
    dailyResetDate = today;
  }
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (MSG_QUEUE.length > 0) {
    resetDailyCountIfNeeded();

    if (dailySent >= DAILY_CAP) {
      console.warn(`[RateLimit] Daily cap of ${DAILY_CAP} messages reached, discarding ${MSG_QUEUE.length} queued`);
      MSG_QUEUE.splice(0).forEach(item => item.resolve(false));
      break;
    }

    const item = MSG_QUEUE.shift();
    try {
      await client.sendMessage(item.chatId, item.message);
      dailySent++;
      console.log(`📩 WhatsApp sent to ${item.chatId.replace('@c.us', '')} (${dailySent}/${DAILY_CAP} today)`);
      item.resolve(true);
    } catch (err) {
      console.error(`WhatsApp send failed for ${item.chatId}:`, err.message);
      item.resolve(false);
    }

    // Wait before sending next message
    if (MSG_QUEUE.length > 0) {
      await new Promise(r => setTimeout(r, MIN_GAP_MS));
    }
  }

  queueRunning = false;
}

/**
 * Initialize WhatsApp Web client.
 * Shows QR code in terminal for first-time linking.
 * Session is persisted in .wwebjs_auth/ so re-scans are rare.
 */
function initWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: require('path').resolve(__dirname, '../.wwebjs_auth'),
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', async (qr) => {
    // 1. Show in terminal
    console.log('\n📱 Scan this QR code with WhatsApp to link:\n');
    qrTerminal.generate(qr, { small: true });

    // 2. Also save as image file (in case terminal QR is distorted)
    const qrImagePath = path.resolve(__dirname, '../whatsapp-qr.png');
    try {
      await QRCode.toFile(qrImagePath, qr, { width: 300, margin: 2 });
      console.log(`\n📄 QR also saved as image: ${qrImagePath}`);
      console.log('   Open this file and scan it if the terminal QR does not work.\n');
    } catch (err) {
      console.error('Could not save QR image:', err.message);
    }
  });

  client.on('ready', () => {
    isReady = true;
    console.log('✅ WhatsApp Web connected and ready!');
  });

  client.on('authenticated', () => {
    console.log('🔑 WhatsApp session authenticated.');
  });

  client.on('auth_failure', (msg) => {
    isReady = false;
    console.error('❌ WhatsApp auth failed:', msg);
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    console.warn('⚠️  WhatsApp disconnected:', reason);
    // Auto-reconnect after 10 seconds
    setTimeout(() => {
      console.log('🔄 Attempting WhatsApp reconnect...');
      client.initialize().catch(err => console.error('Reconnect failed:', err));
    }, 10000);
  });

  client.initialize().catch(err => {
    console.error('WhatsApp init error:', err.message);
  });

  return client;
}

/**
 * Send a WhatsApp message to an Indian phone number.
 * Messages are queued and sent with a minimum gap to avoid spam detection.
 * @param {string} phoneNumber - 10-digit Indian number (e.g., "9876543210")
 * @param {string} message - Text message to send
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
async function sendWhatsApp(phoneNumber, message) {
  if (!isReady || !client) {
    console.warn('WhatsApp not ready, skipping message to', phoneNumber);
    return false;
  }

  resetDailyCountIfNeeded();
  if (dailySent >= DAILY_CAP) {
    console.warn(`[RateLimit] Daily cap reached, skipping message to ${phoneNumber}`);
    return false;
  }

  const chatId = `91${phoneNumber}@c.us`;

  return new Promise((resolve) => {
    MSG_QUEUE.push({ chatId, message, resolve });
    processQueue();
  });
}

/**
 * Check if WhatsApp client is connected and ready.
 */
function isWhatsAppReady() {
  return isReady;
}

module.exports = { initWhatsApp, sendWhatsApp, isWhatsAppReady };
