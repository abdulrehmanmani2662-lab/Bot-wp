const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");

// ==================================================
// CONFIG
// ==================================================

const PORT = process.env.PORT || 3000;

const REPORT_DAYS = 7;

const TARGET_GROUP_NAMES = [
  "مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن",
  "test"
];

// ==================================================
// FREE RENDER STORAGE
// ==================================================

const BASE = __dirname;

const AUTH_DIR = path.join(BASE, "auth");
const DATA_DIR = path.join(BASE, "data");

const LOG_FILE =
  path.join(DATA_DIR, "messageLog.json");

const STATE_FILE =
  path.join(DATA_DIR, "botState.json");

const GROUP_FILE =
  path.join(DATA_DIR, "groups.json");

// ==================================================
// CREATE FOLDERS
// ==================================================

for (const dir of [
  AUTH_DIR,
  DATA_DIR
]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
}

// ==================================================
// JSON LOAD
// ==================================================

function loadJSON(file, fallback) {

  try {

    if (fs.existsSync(file)) {

      return JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    }

  } catch (e) {

    console.log(
      "JSON load error:",
      e.message
    );

  }

  return fallback;
}

// ==================================================
// LOAD SAVED DATA
// ==================================================

let messageLog =
  loadJSON(
    LOG_FILE,
    {}
  );

let botState =
  loadJSON(
    STATE_FILE,
    {
      cycleStart: Date.now()
    }
  );

let savedGroups =
  loadJSON(
    GROUP_FILE,
    []
  );

// ==================================================
// SAVE DATA
// ==================================================

function saveData() {

  try {

    fs.writeFileSync(
      LOG_FILE,
      JSON.stringify(
        messageLog,
        null,
        2
      )
    );

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        botState,
        null,
        2
      )
    );

    fs.writeFileSync(
      GROUP_FILE,
      JSON.stringify(
        savedGroups,
        null,
        2
      )
    );

  } catch (e) {

    console.log(
      "Save error:",
      e.message
    );

  }

}

// ==================================================
// HELPERS
// ==================================================

function normalizeJid(jid) {

  return (jid || "")
    .split(":")[0]
    .toLowerCase();

}

function formatNumber(jid) {

  let n =
    (jid || "")
      .split("@")[0]
      .split(":")[0];

  if (n.startsWith("92")) {
    n =
      "0" +
      n.slice(2);
  }

  return n;

}

function normalizeGroupName(name) {

  return (name || "")
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );

}

// ==================================================
// BOT VARIABLES
// ==================================================

let sock = null;

let ownerJid = null;

let latestQR = null;

// QR generation time
let qrGeneratedAt = 0;

// QR lifetime
const QR_REFRESH_TIME =
  45000;

// ==================================================
// WEB SERVER
// ==================================================

const app = express();

app.get("/", (req, res) => {

  res.send(`
<!DOCTYPE html>
<html>

<head>
<title>WhatsApp Report Bot</title>
<meta name="viewport" content="width=device-width">
</head>

<body style="
background:#111;
color:white;
text-align:center;
font-family:Arial;
padding:40px;
">

<h1>🤖 WhatsApp Report Bot</h1>

<p>
${
  ownerJid
    ? "🟢 WhatsApp Connected"
    : "🟡 Waiting for WhatsApp"
}
</p>

<p>
Groups:
${savedGroups.length}/2
</p>

<a href="/qr"
style="
background:#25D366;
color:white;
padding:15px 25px;
border-radius:10px;
text-decoration:none;
display:inline-block;
">
📱 Open QR
</a>

</body>
</html>
`);

});

// ==================================================
// QR PAGE
// ==================================================

app.get("/qr", async (req, res) => {

  if (!latestQR) {

    return res.send(`
<!DOCTYPE html>
<html>

<head>
<meta http-equiv="refresh" content="5">
<meta name="viewport" content="width=device-width">
</head>

<body style="
background:#111;
color:white;
text-align:center;
font-family:Arial;
padding:40px;
">

<h2>⏳ QR Waiting...</h2>

<p>
Bot QR generate kar raha hai.
</p>

<p>
Page automatically refresh hoga.
</p>

</body>
</html>
`);

  }

  try {

    const image =
      await QRCode.toDataURL(
        latestQR
      );

    res.send(`
<!DOCTYPE html>
<html>

<head>

<meta http-equiv="refresh"
content="5">

<meta
name="viewport"
content="width=device-width">

<title>WhatsApp QR</title>

</head>

<body style="
background:#111;
color:white;
text-align:center;
font-family:Arial;
padding:30px;
">

<h2>📱 WhatsApp QR</h2>

<p>
WhatsApp → Linked Devices
→ Link a Device
</p>

<img
src="${image}"
style="
width:300px;
max-width:90%;
background:white;
padding:10px;
border-radius:10px;
">

<p>
⏳ QR expire hone par
naya QR automatically ayega.
</p>

<p>
🔄 Page 5 seconds mein refresh hoga.
</p>

</body>

</html>
`);

  } catch (e) {

    res.send(
      "QR error: " +
      e.message
    );

  }

});

// ==================================================
// HEALTH
// ==================================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      status: "ok",

      whatsapp:
        ownerJid
          ? "connected"
          : "waiting",

      groups:
        savedGroups.length,

      qr:
        latestQR
          ? "available"
          : "waiting"

    });

  }
);

// ==================================================
// START SERVER
// ==================================================

app.listen(
  PORT,
  () => {

    console.log(
      "🌐 Server running on port " +
      PORT
    );

  }
);

// ==================================================
// FIND TARGET GROUPS
// ==================================================

async function findTargetGroups() {

  try {

    const groups =
      await sock.groupFetchAllParticipating();

    const found = [];

    for (
      const jid
      of Object.keys(groups)
    ) {

      const group =
        groups[jid];

      const groupName =
        group.subject || "";

      const normalized =
        normalizeGroupName(
          groupName
        );

      for (
        const targetName
        of TARGET_GROUP_NAMES
      ) {

        if (
          normalized ===
          normalizeGroupName(
            targetName
          )
        ) {

          if (
            !found.some(
              g => g.jid === jid
            )
          ) {

            found.push({

              jid,

              name:
                groupName

            });

          }

        }

      }

    }

    savedGroups =
      found.slice(0, 2);

    saveData();

    console.log("");

    console.log(
      "========== GROUPS =========="
    );

    if (
      !savedGroups.length
    ) {

      console.log(
        "❌ Target groups nahi mile."
      );

    } else {

      savedGroups.forEach(
        (g, i) => {

          console.log(
            `GROUP ${i + 1}: ${g.name}`
          );

          console.log(
            `JID: ${g.jid}`
          );

        }
      );

    }

    console.log(
      "============================"
    );

    console.log("");

  } catch (e) {

    console.log(
      "Group search error:",
      e.message
    );

  }

}

// ==================================================
// TARGET GROUP CHECK
// ==================================================

function isTargetGroup(jid) {

  return savedGroups.some(
    g =>
      g.jid === jid
  );

}

// ==================================================
// GROUP COMMAND
// ==================================================

async function sendGroupsList(chat) {

  let text =
    "📋 *BOT KE GROUPS*\n\n";

  if (
    !savedGroups.length
  ) {

    text +=
      "❌ Abhi groups detect nahi hue.";

  } else {

    savedGroups.forEach(
      (g, i) => {

        text +=
          `${i + 1}. ${g.name}\n`;

      }
    );

  }

  await sock.sendMessage(
    chat,
    {
      text
    }
  );

}

// ==================================================
// SEND REPORT
// ==================================================

async function sendReport(
  groupJid
) {

  try {

    const meta =
      await sock.groupMetadata(
        groupJid
      );

    const members =
      meta.participants.map(
        p => p.id
      );

    const groupData =
      messageLog[groupJid] || {};

    const start =
      botState.cycleStart;

    let text =
      `📊 *${REPORT_DAYS} DIN KI REPORT*\n\n`;

    text +=
      `👥 *GROUP:* ${meta.subject}\n`;

    text +=
      `🗓 *Start:* ${
        new Date(start)
          .toLocaleDateString(
            "en-GB"
          )
      }\n\n`;

    const active = [];

    const inactive = [];

    // ==================================================
    // COUNT MEMBERS
    // ==================================================

    for (
      const member
      of members
    ) {

      const count =
        (
          groupData[member] ||
          []
        ).filter(
          t =>
            t >= start
        ).length;

      if (
        count > 0
      ) {

        active.push([
          member,
          count
        ]);

      } else {

        inactive.push(
          member
        );

      }

    }

    active.sort(
      (a, b) =>
        b[1] - a[1]
    );

    // ==================================================
    // ACTIVE
    // ==================================================

    text +=
      "✅ *ACTIVE MEMBERS:*\n\n";

    if (
      !active.length
    ) {

      text +=
        "Kisi ne message nahi kiya 😅\n";

    } else {

      for (
        const [
          member,
          count
        ]
        of active
      ) {

        text +=
          `📱 ${formatNumber(member)} — *${count}* messages\n`;

      }

    }

    // ==================================================
    // INACTIVE
    // ==================================================

    text +=
      `\n❌ *${REPORT_DAYS} DIN ME 0 MESSAGES:*\n\n`;

    if (
      !inactive.length
    ) {

      text +=
        "Koi nahi — sab active ✅\n";

    } else {

      for (
        const member
        of inactive
      ) {

        text +=
          `📱 ${formatNumber(member)} — *0* messages 🚫\n`;

      }

    }

    await sock.sendMessage(
      groupJid,
      {
        text
      }
    );

    console.log(
      "✅ Report sent:",
      meta.subject
    );

  } catch (e) {

    console.log(
      "Report error:",
      e.message
    );

  }

}

// ==================================================
// START WHATSAPP
// ==================================================

async function startBot() {

  try {

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    const {
      version
    } =
      await fetchLatestBaileysVersion();

    sock =
      makeWASocket({

        version,

        logger:
          pino({
            level:
              "silent"
          }),

        auth: {

          creds:
            state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,

              pino({
                level:
                  "silent"
              })
            )

        },

        printQRInTerminal:
          false,

        connectTimeoutMs:
          60000,

        defaultQueryTimeoutMs:
          0,

        keepAliveIntervalMs:
          10000

      });

    // ==================================================
    // SAVE WHATSAPP AUTH
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    // ==================================================
    // CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          qr,
          lastDisconnect
        } = update;

        // ==================================================
        // NEW QR
        // ==================================================

        if (qr) {

          latestQR =
            qr;

          qrGeneratedAt =
            Date.now();

          console.log(
            "📱 NEW QR GENERATED"
          );

          console.log(
            "🌐 Open /qr"
          );

        }

        // ==================================================
        // CONNECTED
        // ==================================================

        if (
          connection === "open"
        ) {

          latestQR =
            null;

          qrGeneratedAt =
            0;

          ownerJid =
            sock.user?.id ||
            null;

          console.log(
            "================================"
          );

          console.log(
            "✅ WhatsApp Connected"
          );

          console.log(
            "👑 Owner:",
            ownerJid
          );

          console.log(
            "💾 Saved message data:",
            Object.keys(
              messageLog
            ).length
          );

          console.log(
            "🗓 Cycle started:",
            new Date(
              botState.cycleStart
            ).toISOString()
          );

          console.log(
            "================================"
          );

          // Find groups
          await findTargetGroups();

        }

        // ==================================================
        // DISCONNECTED
        // ==================================================

        if (
          connection === "close"
        ) {

          ownerJid =
            null;

          console.log(
            "❌ WhatsApp disconnected"
          );

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(
            startBot,
            5000
          );

        }

      }
    );

    // ==================================================
    // MESSAGE HANDLER
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        try {

          const msg =
            messages[0];

          if (
            !msg ||
            !msg.message
          ) return;

          // Don't count own messages
          if (
            msg.key.fromMe
          ) return;

          const chat =
            msg.key.remoteJid;

          if (!chat) return;

          // Only groups
          if (
            !chat.endsWith(
              "@g.us"
            )
          ) return;

          const sender =
            msg.key.participant ||
            msg.key.remoteJid;

          if (!sender) return;

          const text =
            msg.message
              .conversation ||
            msg.message
              .extendedTextMessage
              ?.text ||
            "";

          const command =
            text
              .trim()
              .toLowerCase();

          // ==================================================
          // OWNER COMMAND
          // ==================================================

          if (
            ownerJid &&
            normalizeJid(
              sender
            ) ===
            normalizeJid(
              ownerJid
            )
          ) {

            if (
              command ===
              "!groups"
            ) {

              await sendGroupsList(
                chat
              );

              return;

            }

          }

          // ==================================================
          // ONLY TARGET GROUPS
          // ==================================================

          if (
            !isTargetGroup(
              chat
            )
          ) {

            return;

          }

          // ==================================================
          // CREATE GROUP DATA
          // ==================================================

          if (
            !messageLog[chat]
          ) {

            messageLog[chat] =
              {};

          }

          if (
            !messageLog[chat][sender]
          ) {

            messageLog[chat][sender] =
              [];

          }

          // ==================================================
          // MESSAGE TIME
          // ==================================================

          const timestamp =
            Number(
              msg.messageTimestamp ||
              0
            ) * 1000;

          if (
            timestamp
          ) {

            messageLog[chat][sender]
              .push(timestamp);

          } else {

            // Fallback if timestamp unavailable
            messageLog[chat][sender]
              .push(Date.now());

          }

          // ==================================================
          // SAVE IMMEDIATELY
          // ==================================================

          saveData();

          // ==================================================
          // STATS COMMAND
          // ==================================================

          if (
            command !==
            "!stats"
          ) {

            return;

          }

          // Owner only
          if (
            !ownerJid ||
            normalizeJid(
              sender
            ) !==
            normalizeJid(
              ownerJid
            )
          ) {

            console.log(
              "⛔ Unauthorized !stats:",
              sender
            );

            return;

          }

          await sendReport(
            chat
          );

        } catch (e) {

          console.log(
            "Message error:",
            e.message
          );

        }

      }
    );

    // ==================================================
    // QR WATCHDOG
    // ==================================================

    setInterval(
      () => {

        if (
          latestQR &&
          Date.now() -
            qrGeneratedAt >
            QR_REFRESH_TIME
        ) {

          console.log(
            "♻️ QR expired. Waiting for new QR..."
          );

          latestQR =
            null;

          qrGeneratedAt =
            0;

          // Closing the socket forces
          // Baileys to generate a fresh QR
          try {

            if (
              sock
            ) {

              sock.ws?.close();

            }

          } catch (e) {

            console.log(
              "QR refresh error:",
              e.message
            );

          }

        }

      },
      10000
    );

    // ==================================================
    // 7 DAY AUTO REPORT
    // ==================================================

    setInterval(
      async () => {

        try {

          const end =
            botState.cycleStart +
            REPORT_DAYS *
            24 *
            60 *
            60 *
            1000;

          if (
            Date.now() >= end
          ) {

            if (
              sock &&
              ownerJid
            ) {

              console.log(
                "⏰ 7 DAYS COMPLETE"
              );

              // Send both reports
              for (
                const group
                of savedGroups
              ) {

                await sendReport(
                  group.jid
                );

              }

              // Start new cycle
              botState.cycleStart =
                Date.now();

              messageLog =
                {};

              saveData();

              console.log(
                "🔄 NEW 7-DAY CYCLE STARTED"
              );

            }

          }

        } catch (e) {

          console.log(
            "Auto report error:",
            e.message
          );

        }

      },
      60000
    );

  } catch (e) {

    console.log(
      "Start error:",
      e.message
    );

    setTimeout(
      startBot,
      5000
    );

  }

}

// ==================================================
// START
// ==================================================

console.log(
  "================================"
);

console.log(
  "🤖 WhatsApp 7-Day Report Bot"
);

console.log(
  "👥 Target Groups: 2"
);

console.log(
  "1. مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن"
);

console.log(
  "2. test"
);

console.log(
  "💾 Saved Count: ENABLED"
);

console.log(
  "📱 Auto QR: ENABLED"
);

console.log(
  "================================"
);

startBot();
