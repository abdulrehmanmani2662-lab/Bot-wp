const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

/*
========================================
CONFIG
========================================
*/

const PORT = process.env.PORT || 3000;

const REPORT_DAYS = 7;

const TARGET_GROUP_NAMES = [
  "مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن",
  "test"
];

/*
========================================
SUPABASE
========================================
*/

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || "";

const supabase =
  SUPABASE_URL &&
  SUPABASE_SECRET_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SECRET_KEY
      )
    : null;

/*
========================================
LOCAL FILES
========================================
*/

const BASE = __dirname;

const AUTH_DIR =
  path.join(BASE, "auth");

const DATA_DIR =
  path.join(BASE, "data");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, {
    recursive: true
  });
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

/*
========================================
LOCAL JSON HELPERS
========================================
*/

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
  } catch (error) {
    console.log(
      "JSON LOAD ERROR:",
      error.message
    );
  }

  return fallback;
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      "JSON SAVE ERROR:",
      error.message
    );
  }
}

/*
========================================
LOCAL DATA
========================================
*/

const STATE_FILE =
  path.join(
    DATA_DIR,
    "botState.json"
  );

const GROUP_FILE =
  path.join(
    DATA_DIR,
    "groups.json"
  );

const ALL_GROUP_FILE =
  path.join(
    DATA_DIR,
    "allGroups.json"
  );

const LID_MAP_FILE =
  path.join(
    DATA_DIR,
    "lidMap.json"
  );

const WARNING_FILE =
  path.join(
    DATA_DIR,
    "warnings.json"
  );

let botState =
  loadJSON(
    STATE_FILE,
    {
      cycleStart:
        Date.now()
    }
  );

let savedGroups =
  loadJSON(
    GROUP_FILE,
    []
  );

let allGroups =
  loadJSON(
    ALL_GROUP_FILE,
    []
  );

let lidMap =
  loadJSON(
    LID_MAP_FILE,
    {}
  );

/*
========================================
WARNING DATA
========================================

Structure:

warnings[groupJid][memberJid] = {
  warnedAt: timestamp
}

If member sends a message during the
next cycle, warning is removed.

If still 0 at next report:
member will be removed.
========================================
*/

let warnings =
  loadJSON(
    WARNING_FILE,
    {}
  );

/*
========================================
MESSAGE LOG
========================================
*/

let messageLog = {};

/*
========================================
SUPABASE STORAGE
========================================
*/

async function loadCloudData() {

  if (!supabase) {

    console.log(
      "⚠️ Supabase variables not configured yet."
    );

    return;
  }

  try {

    const { data, error } =
      await supabase
        .from("bot_storage")
        .select(
          "key,value"
        );

    if (error) {
      throw error;
    }

    for (
      const row of data || []
    ) {

      if (
        row.key ===
        "messageLog"
      ) {

        messageLog =
          row.value || {};

      }

      if (
        row.key ===
        "botState"
      ) {

        botState =
          row.value || botState;

      }

      if (
        row.key ===
        "savedGroups"
      ) {

        savedGroups =
          row.value || [];

      }

      if (
        row.key ===
        "allGroups"
      ) {

        allGroups =
          row.value || [];

      }

      if (
        row.key ===
        "lidMap"
      ) {

        lidMap =
          row.value || {};

      }

      if (
        row.key ===
        "warnings"
      ) {

        warnings =
          row.value || {};

      }

    }

    console.log(
      "☁️ Supabase data loaded"
    );

  } catch (error) {

    console.log(
      "❌ Supabase load error:",
      error.message
    );

  }

}

async function saveCloud(
  key,
  value
) {

  if (!supabase) {
    return;
  }

  try {

    const { error } =
      await supabase
        .from("bot_storage")
        .upsert(
          {
            key,
            value,
            updated_at:
              new Date().toISOString()
          },
          {
            onConflict:
              "key"
          }
        );

    if (error) {
      throw error;
    }

  } catch (error) {

    console.log(
      `❌ Cloud save error (${key}):`,
      error.message
    );

  }

}

async function saveAllCloud() {

  await saveCloud(
    "messageLog",
    messageLog
  );

  await saveCloud(
    "botState",
    botState
  );

  await saveCloud(
    "savedGroups",
    savedGroups
  );

  await saveCloud(
    "allGroups",
    allGroups
  );

  await saveCloud(
    "lidMap",
    lidMap
  );

  await saveCloud(
    "warnings",
    warnings
  );

}

/*
========================================
SAVE ALL
========================================
*/

async function saveData() {

  saveJSON(
    STATE_FILE,
    botState
  );

  saveJSON(
    GROUP_FILE,
    savedGroups
  );

  saveJSON(
    ALL_GROUP_FILE,
    allGroups
  );

  saveJSON(
    LID_MAP_FILE,
    lidMap
  );

  saveJSON(
    WARNING_FILE,
    warnings
  );

  await saveCloud(
    "messageLog",
    messageLog
  );

  await saveCloud(
    "botState",
    botState
  );

  await saveCloud(
    "savedGroups",
    savedGroups
  );

  await saveCloud(
    "allGroups",
    allGroups
  );

  await saveCloud(
    "lidMap",
    lidMap
  );

  await saveCloud(
    "warnings",
    warnings
  );

}

/*
========================================
JID HELPERS
========================================
*/

function normalizeJid(jid) {

  return String(jid || "")
    .trim()
    .split(":")[0]
    .toLowerCase();

}

function isLid(jid) {

  return normalizeJid(jid)
    .endsWith("@lid");

}

function isPhoneJid(jid) {

  return normalizeJid(jid)
    .endsWith(
      "@s.whatsapp.net"
    );

}

function phoneNumberFromJid(jid) {

  const n =
    normalizeJid(jid);

  if (
    n.endsWith(
      "@s.whatsapp.net"
    )
  ) {

    return n.replace(
      "@s.whatsapp.net",
      ""
    );

  }

  return null;

}

function formatNumber(jid) {

  const n =
    normalizeJid(jid);

  if (
    n.endsWith(
      "@s.whatsapp.net"
    )
  ) {

    return n.replace(
      "@s.whatsapp.net",
      ""
    );

  }

  if (
    n.endsWith("@c.us")
  ) {

    return n.replace(
      "@c.us",
      ""
    );

  }

  if (
    n.endsWith("@lid")
  ) {

    return n.replace(
      "@lid",
      ""
    );

  }

  return n.split("@")[0];

}

/*
========================================
LID ↔ PHONE
========================================
*/

function rememberIdentity(
  lid,
  phone
) {

  const l =
    normalizeJid(lid);

  const p =
    normalizeJid(phone);

  if (!l || !p) {
    return false;
  }

  if (!isLid(l)) {
    return false;
  }

  if (!isPhoneJid(p)) {
    return false;
  }

  if (
    lidMap[l] !== p
  ) {

    lidMap[l] = p;

    return true;

  }

  return false;

}

function getPhoneFromAnyId(id) {

  const n =
    normalizeJid(id);

  if (!n) {
    return null;
  }

  if (isPhoneJid(n)) {

    return phoneNumberFromJid(
      n
    );

  }

  if (
    isLid(n) &&
    lidMap[n]
  ) {

    return phoneNumberFromJid(
      lidMap[n]
    );

  }

  return null;

}

function getMemberNumber(
  participant
) {

  const candidates = [
    participant?.phoneNumber,
    participant?.id,
    participant?.lid
  ];

  for (
    const id of candidates
  ) {

    if (isPhoneJid(id)) {

      return `+${formatNumber(id)}`;

    }

  }

  for (
    const id of candidates
  ) {

    const phone =
      getPhoneFromAnyId(id);

    if (phone) {

      return `+${phone}`;

    }

  }

  return formatNumber(
    participant?.id ||
    participant?.lid ||
    ""
  );

}

/*
========================================
PRIVATE JID
========================================

Warning personal chat mein bhejne
ke liye phone JID chahiye.
========================================
*/

function getPrivateJid(
  participant
) {

  const candidates = [
    participant?.phoneNumber,
    participant?.id,
    participant?.lid
  ];

  for (
    const id of candidates
  ) {

    const n =
      normalizeJid(id);

    if (
      isPhoneJid(n)
    ) {

      return n;

    }

  }

  for (
    const id of candidates
  ) {

    const phone =
      getPhoneFromAnyId(id);

    if (phone) {

      return `${phone}@s.whatsapp.net`;

    }

  }

  return null;

}

/*
========================================
GROUP MATCH
========================================
*/

function normalizeGroupName(
  name
) {

  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}

function groupMatches(
  actualName,
  targetName
) {

  const actual =
    normalizeGroupName(
      actualName
    );

  const target =
    normalizeGroupName(
      targetName
    );

  if (!actual || !target) {
    return false;
  }

  if (actual === target) {
    return true;
  }

  if (
    actual.includes(target) ||
    target.includes(actual)
  ) {

    return true;

  }

  const a =
    actual.replace(
      /\s+/g,
      ""
    );

  const t =
    target.replace(
      /\s+/g,
      ""
    );

  return (
    a === t ||
    a.includes(t) ||
    t.includes(a)
  );

}

/*
========================================
HTML
========================================
*/

function escapeHTML(text) {

  return String(text || "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}

/*
========================================
BOT VARIABLES
========================================
*/

let sock = null;

let ownerJid = null;

let latestQR = null;

let qrGeneratedAt = 0;

let connectionStatus =
  "starting";

let lastError = "";

let reconnecting = false;

let connectedAt = null;

const QR_EXPIRE =
  50000;

/*
========================================
EXPRESS
========================================
*/

const app =
  express();

app.use(
  express.json()
);

/*
========================================
COUNT
========================================
*/

function getGroupMessageCount(
  groupJid
) {

  const data =
    messageLog[groupJid] ||
    {};

  let total = 0;

  for (
    const sender
    of Object.keys(data)
  ) {

    if (
      Array.isArray(
        data[sender]
      )
    ) {

      total +=
        data[sender].length;

    }

  }

  return total;

}

/*
========================================
TARGET
========================================
*/

function isTargetGroup(jid) {

  return savedGroups.some(
    group =>
      group.jid === jid
  );

}

/*
========================================
MEMBER MESSAGE COUNT
========================================
*/

function getMessagesForMember(
  groupData,
  participant
) {

  const candidates =
    new Set();

  const ids = [
    participant?.id,
    participant?.lid,
    participant?.phoneNumber
  ];

  for (
    const id of ids
  ) {

    const n =
      normalizeJid(id);

    if (!n) {
      continue;
    }

    candidates.add(n);

    if (
      isLid(n) &&
      lidMap[n]
    ) {

      candidates.add(
        normalizeJid(
          lidMap[n]
        )
      );

    }

  }

  for (
    const [lid, phone]
    of Object.entries(
      lidMap
    )
  ) {

    for (
      const id of ids
    ) {

      const n =
        normalizeJid(id);

      if (
        isPhoneJid(n) &&
        normalizeJid(
          phone
        ) === n
      ) {

        candidates.add(
          normalizeJid(lid)
        );

      }

    }

  }

  let result = [];

  for (
    const key
    of candidates
  ) {

    if (
      Array.isArray(
        groupData[key]
      )
    ) {

      result =
        result.concat(
          groupData[key]
        );

    }

  }

  return [
    ...new Set(result)
  ];

}

/*
========================================
WARNING MESSAGE
========================================
*/

async function sendPrivateWarning(
  groupJid,
  groupName,
  participant
) {

  try {

    const privateJid =
      getPrivateJid(
        participant
      );

    if (!privateJid) {

      console.log(
        "⚠️ WARNING SKIPPED - NO PHONE:",
        participant?.id ||
        participant?.lid
      );

      return false;

    }

    /*
    Do not warn bot/owner
    */

    if (
      ownerJid &&
      normalizeJid(
        privateJid
      ) ===
      normalizeJid(
        ownerJid
      )
    ) {

      return false;

    }

    const number =
      getMemberNumber(
        participant
      );

    const text =
`⚠️ *7-DAY ACTIVITY WARNING*

Assalam o Alaikum 👋

Aap ne group:

*${groupName}*

mein pichlay 7 din mein *koi message nahi kiya*.

📊 Aap ke messages: *0*

⚠️ Agar aglay 7 din ke period mein bhi aap ne group mein message nahi kiya to aapko group se *remove kar diya jayega*.

Please group mein kam az kam ek message kar dein taake aap active count ho jayen.

👤 Number: *${number}*

— WhatsApp Report Bot`;

    await sock.sendMessage(
      privateJid,
      {
        text
      }
    );

    console.log(
      "⚠️ PRIVATE WARNING SENT:",
      number,
      "FROM:",
      groupName
    );

    return true;

  } catch (error) {

    console.log(
      "❌ PRIVATE WARNING ERROR:",
      error.message
    );

    return false;

  }

}

/*
========================================
REMOVE MEMBER
========================================
*/

async function removeMember(
  groupJid,
  groupName,
  participant
) {

  try {

    const memberJid =
      normalizeJid(
        participant?.id ||
        ""
      );

    const phoneJid =
      getPrivateJid(
        participant
      );

    /*
    Prefer actual group participant ID.
    */

    const target =
      memberJid ||
      phoneJid;

    if (!target) {

      console.log(
        "❌ REMOVE SKIPPED - NO JID"
      );

      return false;

    }

    /*
    Never remove bot itself.
    */

    if (
      ownerJid &&
      normalizeJid(target) ===
      normalizeJid(ownerJid)
    ) {

      return false;

    }

    /*
    Never remove group creator/admin
    if role is known.
    */

    if (
      participant?.admin ===
      "admin" ||
      participant?.admin ===
      "superadmin"
    ) {

      console.log(
        "⚠️ REMOVE SKIPPED - ADMIN:",
        target
      );

      return false;

    }

    await sock.groupParticipantsUpdate(
      groupJid,
      [target],
      "remove"
    );

    console.log(
      "🚫 MEMBER REMOVED:",
      getMemberNumber(
        participant
      ),
      "FROM:",
      groupName
    );

    /*
    Send removal notice privately
    */

    const privateJid =
      getPrivateJid(
        participant
      );

    if (privateJid) {

      try {

        await sock.sendMessage(
          privateJid,
          {
            text:
`🚫 *GROUP REMOVAL NOTICE*

Aap ko *${groupName}* se remove kar diya gaya hai.

Reason:
Pichlay 2 consecutive 7-day periods mein aap ke messages *0* rahe.

Agar aapko lagta hai ke ye action ghalat hua hai to group admin se rabta karein.`
          }
        );

      } catch {}

    }

    return true;

  } catch (error) {

    console.log(
      "❌ REMOVE ERROR:",
      error.message
    );

    return false;

  }

}

/*
========================================
REPORT
========================================
*/

async function sendReport(
  groupJid
) {

  try {

    const meta =
      await sock.groupMetadata(
        groupJid
      );

    const groupData =
      messageLog[groupJid] ||
      {};

    const active = [];

    const inactive = [];

    let totalMessages = 0;

    for (
      const participant
      of meta.participants || []
    ) {

      if (
        participant.id &&
        participant.phoneNumber
      ) {

        rememberIdentity(
          participant.id,
          participant.phoneNumber
        );

      }

      if (
        participant.lid &&
        participant.phoneNumber
      ) {

        rememberIdentity(
          participant.lid,
          participant.phoneNumber
        );

      }

      const times =
        getMessagesForMember(
          groupData,
          participant
        );

      const count =
        times.length;

      const number =
        getMemberNumber(
          participant
        );

      if (count > 0) {

        active.push({
          number,
          count
        });

        totalMessages +=
          count;

      } else {

        inactive.push({
          number,
          count: 0
        });

      }

    }

    active.sort(
      (a, b) =>
        b.count - a.count
    );

    let text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n";

    text +=
      "   📊 *7 DIN KI REPORT*\n";

    text +=
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

    text +=
      `👥 *GROUP:* ${meta.subject}\n`;

    text +=
      `🗓 *START:* ${
        new Date(
          botState.cycleStart
        ).toLocaleDateString(
          "en-GB"
        )
      }\n`;

    text +=
      `💬 *TOTAL MESSAGES:* ${totalMessages}\n\n`;

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🟢 *ACTIVE MEMBERS*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (!active.length) {

      text +=
        "😅 Kisi ne message nahi kiya.\n\n";

    } else {

      let i = 1;

      for (
        const user
        of active
      ) {

        text +=
          `${i}. 📱 *${user.number}*\n`;

        text +=
          `   💬 *${user.count} messages*\n\n`;

        i++;

      }

    }

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🔴 *0 MESSAGES*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (!inactive.length) {

      text +=
        "🎉 Sab members active hain!\n";

    } else {

      let i = 1;

      for (
        const user
        of inactive
      ) {

        text +=
          `${i}. 📱 ${user.number} — *0 messages* 🚫\n`;

        i++;

      }

    }

    text +=
      "\n━━━━━━━━━━━━━━━━━━━━\n";

    text +=
      `📈 *ACTIVE:* ${active.length}\n`;

    text +=
      `📉 *INACTIVE:* ${inactive.length}\n`;

    text +=
      `💬 *TOTAL:* ${totalMessages}\n`;

    text +=
      "━━━━━━━━━━━━━━━━━━━━";

    /*
    ========================================
    GROUP REPORT ONLY
    ========================================
    */

    await sock.sendMessage(
      groupJid,
      {
        text
      }
    );

    /*
    ========================================
    PRIVATE WARNINGS / REMOVALS
    ========================================
    */

    if (!warnings[groupJid]) {
      warnings[groupJid] = {};
    }

    /*
    Active members:
    remove their previous warning because
    they became active.
    */

    for (
      const participant
      of meta.participants || []
    ) {

      const ids = [
        participant?.id,
        participant?.lid,
        participant?.phoneNumber
      ];

      let warningKey = null;

      for (
        const id of ids
      ) {

        const n =
          normalizeJid(id);

        if (
          n &&
          warnings[groupJid][n]
        ) {

          warningKey = n;
          break;

        }

      }

      const times =
        getMessagesForMember(
          groupData,
          participant
        );

      const count =
        times.length;

      if (count > 0) {

        /*
        User became active.
        Clear old warning.
        */

        if (warningKey) {

          delete warnings[groupJid][warningKey];

          console.log(
            "✅ WARNING CLEARED - MEMBER ACTIVE:",
            getMemberNumber(
              participant
            )
          );

        }

      }

    }

    /*
    ========================================
    PROCESS ZERO MEMBERS
    ========================================
    */

    for (
      const participant
      of meta.participants || []
    ) {

      const times =
        getMessagesForMember(
          groupData,
          participant
        );

      const count =
        times.length;

      if (count !== 0) {
        continue;
      }

      /*
      Skip bot/owner.
      */

      const privateJid =
        getPrivateJid(
          participant
        );

      if (
        ownerJid &&
        privateJid &&
        normalizeJid(
          privateJid
        ) ===
        normalizeJid(
          ownerJid
        )
      ) {

        continue;

      }

      /*
      Find existing warning.
      */

      let existingWarning =
        null;

      const possibleKeys = [
        participant?.id,
        participant?.lid,
        participant?.phoneNumber,
        privateJid
      ];

      for (
        const id
        of possibleKeys
      ) {

        const n =
          normalizeJid(id);

        if (
          n &&
          warnings[groupJid][n]
        ) {

          existingWarning =
            warnings[groupJid][n];

          break;

        }

      }

      /*
      ======================================
      FIRST ZERO PERIOD
      ======================================
      */

      if (!existingWarning) {

        const sent =
          await sendPrivateWarning(
            groupJid,
            meta.subject,
            participant
          );

        if (sent) {

          const key =
            normalizeJid(
              privateJid ||
              participant?.id ||
              participant?.lid
            );

          if (key) {

            warnings[groupJid][key] = {
              warnedAt:
                Date.now()
            };

          }

        }

      }

      /*
      ======================================
      SECOND CONSECUTIVE ZERO PERIOD
      ======================================

      User was already warned last cycle
      and again has 0 messages.
      */

      else {

        console.log(
          "🚫 SECOND ZERO PERIOD:",
          getMemberNumber(
            participant
          )
        );

        await removeMember(
          groupJid,
          meta.subject,
          participant
        );

        /*
        Remove warning record.
        */

        const possibleKeys2 = [
          participant?.id,
          participant?.lid,
          participant?.phoneNumber,
          privateJid
        ];

        for (
          const id
          of possibleKeys2
        ) {

          const n =
            normalizeJid(id);

          if (
            n &&
            warnings[groupJid][n]
          ) {

            delete warnings[groupJid][n];

          }

        }

      }

    }

    await saveCloud(
      "lidMap",
      lidMap
    );

    await saveCloud(
      "warnings",
      warnings
    );

    console.log(
      "✅ REPORT SENT:",
      meta.subject
    );

  } catch (error) {

    console.log(
      "❌ REPORT ERROR:",
      error.message
    );

  }

}

/*
========================================
GROUP SCAN
========================================
*/

async function findTargetGroups() {

  if (!sock) {
    return;
  }

  try {

    console.log(
      "🔍 Scanning groups..."
    );

    const groups =
      await sock.groupFetchAllParticipating();

    const foundAll = [];

    for (
      const jid
      of Object.keys(groups)
    ) {

      const group =
        groups[jid];

      if (!group) {
        continue;
      }

      const name =
        String(
          group.subject || ""
        ).trim();

      if (!name) {
        continue;
      }

      foundAll.push({
        jid,
        name
      });

    }

    allGroups =
      foundAll.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

    const detected = [];

    for (
      const targetName
      of TARGET_GROUP_NAMES
    ) {

      const match =
        foundAll.find(
          group =>
            groupMatches(
              group.name,
              targetName
            )
        );

      if (
        match &&
        !detected.some(
          g =>
            g.jid ===
            match.jid
        )
      ) {

        detected.push({
          jid:
            match.jid,
          name:
            match.name,
          target:
            targetName
        });

      }

    }

    savedGroups =
      detected.slice(0, 2);

    saveJSON(
      GROUP_FILE,
      savedGroups
    );

    saveJSON(
      ALL_GROUP_FILE,
      allGroups
    );

    await saveCloud(
      "savedGroups",
      savedGroups
    );

    await saveCloud(
      "allGroups",
      allGroups
    );

    console.log(
      "🎯 TARGET GROUPS:",
      savedGroups.length
    );

  } catch (error) {

    console.log(
      "❌ GROUP SCAN ERROR:",
      error.message
    );

    lastError =
      error.message;

  }

}

/*
========================================
GROUP LIST
========================================
*/

async function sendGroupsList(
  chat
) {

  let text =
    "╭━━━━━━━━━━━━━━━━━━━━╮\n";

  text +=
    "   📋 *WHATSAPP GROUPS*\n";

  text +=
    "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

  if (!allGroups.length) {

    text +=
      "❌ Groups abhi detect nahi hue.";

  } else {

    allGroups.forEach(
      (group, index) => {

        const target =
          savedGroups.some(
            g =>
              g.jid ===
              group.jid
          );

        text +=
          `${index + 1}. ${
            target
              ? "🎯"
              : "📁"
          } *${group.name}*\n`;

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

/*
========================================
DASHBOARD
========================================
*/

app.get(
  "/",
  async (req, res) => {

    let qrImage = "";

    if (latestQR) {

      try {

        qrImage =
          await QRCode.toDataURL(
            latestQR
          );

      } catch {}

    }

    const connected =
      !!ownerJid;

    const elapsed =
      Math.max(
        0,
        Date.now() -
        Number(
          botState.cycleStart ||
          Date.now()
        )
      );

    const totalTime =
      REPORT_DAYS *
      24 *
      60 *
      60 *
      1000;

    const progress =
      Math.min(
        100,
        Math.round(
          (
            elapsed /
            totalTime
          ) * 100
        )
      );

    const daysPassed =
      Math.floor(
        elapsed /
        (
          24 *
          60 *
          60 *
          1000
        )
      );

    const daysLeft =
      Math.max(
        0,
        REPORT_DAYS -
        daysPassed
      );

    let totalMessages = 0;

    for (
      const group
      of Object.values(
        messageLog
      )
    ) {

      for (
        const arr
        of Object.values(
          group || {}
        )
      ) {

        if (
          Array.isArray(arr)
        ) {

          totalMessages +=
            arr.length;

        }

      }

    }

    let statusText =
      "STARTING";

    let statusClass =
      "yellow";

    if (connected) {

      statusText =
        "CONNECTED";

      statusClass =
        "green";

    } else if (
      connectionStatus ===
      "qr"
    ) {

      statusText =
        "SCAN QR";

      statusClass =
        "blue";

    } else if (
      connectionStatus ===
      "disconnected"
    ) {

      statusText =
        "RECONNECTING";

      statusClass =
        "red";

    }

    const groupsHTML =
      savedGroups.length
        ? savedGroups.map(
            (group, index) => `
<div class="group-card">

  <div class="group-icon">
    ${index === 0 ? "🏢" : "🧪"}
  </div>

  <div class="group-info">

    <div class="group-name">
      ${escapeHTML(group.name)}
    </div>

    <div class="group-jid">
      ${escapeHTML(group.jid)}
    </div>

    <div class="group-count">
      💬 ${getGroupMessageCount(
        group.jid
      )} messages
    </div>

  </div>

  <div class="active-badge">
    ● DETECTED
  </div>

</div>
`
          ).join("")
        : `
<div class="empty-box">
  👥
  <b>No target groups detected</b>
  <small>Bot automatically scans groups.</small>
</div>
`;

    const allGroupsHTML =
      allGroups.length
        ? allGroups.map(
            group => {

              const target =
                savedGroups.some(
                  g =>
                    g.jid ===
                    group.jid
                );

              return `
<div class="all-group">

  <div>
    <div class="all-group-name">
      ${escapeHTML(group.name)}
    </div>

    <div class="all-group-jid">
      ${escapeHTML(group.jid)}
    </div>
  </div>

  ${
    target
      ? `<span class="target-tag">TARGET</span>`
      : `<span class="normal-tag">GROUP</span>`
  }

</div>
`;

            }
          ).join("")
        : `
<div class="empty-box">
  No groups loaded yet.
</div>
`;

    const qrHTML =
      qrImage
        ? `
<div class="qr-container">

  <div class="qr-title">
    📱 Scan QR with WhatsApp
  </div>

  <img
    src="${qrImage}"
    class="qr"
    alt="WhatsApp QR"
  >

  <div class="qr-refresh">
    🔄 QR automatically refreshes
  </div>

</div>
`
        : `
<div class="qr-wait">

  <div class="spinner"></div>

  <h3>
    ${
      connected
        ? "WhatsApp Connected"
        : "Waiting for QR..."
    }
  </h3>

  <p>
    ${
      connected
        ? "Bot successfully connected."
        : "QR generate hote hi yahan show hoga."
    }
  </p>

</div>
`;

    const uptime =
      connectedAt
        ? formatDuration(
            Date.now() -
            connectedAt
          )
        : "Offline";

    res.send(`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<meta
  http-equiv="refresh"
  content="10"
>

<title>
WhatsApp Bot • BAMB Dashboard
</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  font-family:
    Arial,
    sans-serif;

  color: white;

  min-height: 100vh;

  background:
    radial-gradient(
      circle at 10% 0%,
      rgba(0,255,180,.25),
      transparent 28%
    ),
    radial-gradient(
      circle at 90% 10%,
      rgba(255,0,180,.22),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 100%,
      rgba(0,150,255,.25),
      transparent 35%
    ),
    #050713;

}

.container {

  width: 94%;

  max-width: 1400px;

  margin: auto;

  padding:
    25px 0 50px;

}

.header {

  padding: 25px;

  margin-bottom: 20px;

  border-radius: 28px;

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 20px;

  background:
    linear-gradient(
      135deg,
      rgba(0,255,170,.13),
      rgba(255,0,180,.10),
      rgba(60,100,255,.13)
    );

  border:
    1px solid
    rgba(255,255,255,.14);

  box-shadow:
    0 20px 80px
    rgba(0,0,0,.45);

}

.brand {

  display: flex;

  align-items:
    center;

  gap: 15px;

}

.logo {

  width: 65px;

  height: 65px;

  border-radius: 20px;

  display: flex;

  align-items:
    center;

  justify-content:
    center;

  font-size: 32px;

  background:
    linear-gradient(
      135deg,
      #00ff9d,
      #00aaff,
      #a855f7,
      #ff3cac
    );

  box-shadow:
    0 0 45px
    rgba(0,255,180,.35);

}

h1 {

  margin: 0;

  font-size: 25px;

}

.brand p {

  margin: 7px 0 0;

  color: #9aa8bd;

  font-size: 11px;

}

.status {

  padding:
    12px 18px;

  border-radius: 50px;

  background:
    rgba(255,255,255,.07);

  border:
    1px solid
    rgba(255,255,255,.10);

  font-size: 11px;

  font-weight: 900;

}

.green {
  color: #00ff9d;
}

.blue {
  color: #38bdf8;
}

.red {
  color: #ff5277;
}

.yellow {
  color: #ffd54a;
}

.stats {

  display: grid;

  grid-template-columns:
    repeat(4,1fr);

  gap: 15px;

  margin-bottom: 20px;

}

.stat {

  padding: 21px;

  border-radius: 22px;

  background:
    rgba(255,255,255,.055);

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 15px 50px
    rgba(0,0,0,.25);

}

.stat-icon {

  font-size: 25px;

}

.stat-title {

  margin-top: 10px;

  color: #7f8da5;

  font-size: 9px;

  font-weight: 900;

  letter-spacing: 1px;

}

.stat-value {

  margin-top: 5px;

  font-size: 25px;

  font-weight: 900;

}

.grid {

  display: grid;

  grid-template-columns:
    1.15fr .85fr;

  gap: 20px;

}

.card {

  padding: 22px;

  margin-bottom: 20px;

  border-radius: 25px;

  background:
    rgba(255,255,255,.05);

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.25);

  backdrop-filter:
    blur(15px);

}

.card-title {

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  margin-bottom: 18px;

}

.card-title h2 {

  margin: 0;

  font-size: 16px;

}

.card-title span {

  color: #718096;

  font-size: 9px;

  font-weight: 900;

}

.device {

  padding: 17px;

  border-radius: 18px;

  background:
    rgba(0,0,0,.22);

}

.device-row {

  display: flex;

  justify-content:
    space-between;

  gap: 15px;

  padding: 12px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.07);

}

.device-row:last-child {

  border-bottom: 0;

}

.device-label {

  color: #78859c;

  font-size: 11px;

}

.device-value {

  font-size: 12px;

  font-weight: 800;

  text-align: right;

  word-break: break-word;

}

.online {

  color: #00ff9d;

}

.notice {

  margin-top: 15px;

  padding: 13px;

  border-radius: 15px;

  color: #8fd8ff;

  font-size: 10px;

  line-height: 1.7;

  background:
    rgba(0,150,255,.08);

  border:
    1px solid
    rgba(0,150,255,.16);

}

.qr-container {

  text-align: center;

}

.qr {

  width: 250px;

  max-width: 100%;

  padding: 10px;

  background: white;

  border-radius: 20px;

}

.qr-title {

  margin-bottom: 15px;

  color: #c9d3e2;

  font-size: 12px;

  font-weight: 800;

}

.qr-refresh {

  margin-top: 12px;

  color: #65748a;

  font-size: 10px;

}

.qr-wait {

  text-align: center;

  padding: 35px 10px;

}

.spinner {

  width: 45px;

  height: 45px;

  margin: auto;

  border: 4px solid
    rgba(255,255,255,.08);

  border-top-color:
    #00ff9d;

  border-right-color:
    #a855f7;

  border-radius: 50%;

  animation:
    spin 1s linear infinite;

}

@keyframes spin {

  to {
    transform: rotate(360deg);
  }

}

.group-card {

  display: flex;

  align-items:
    center;

  gap: 13px;

  padding: 14px;

  margin-bottom: 10px;

  border-radius: 18px;

  background:
    linear-gradient(
      135deg,
      rgba(0,255,160,.06),
      rgba(168,85,247,.05)
    );

  border:
    1px solid
    rgba(255,255,255,.07);

}

.group-icon {

  width: 46px;

  height: 46px;

  flex-shrink: 0;

  display: flex;

  align-items:
    center;

  justify-content:
    center;

  border-radius: 14px;

  background:
    linear-gradient(
      135deg,
      #00ff9d,
      #7c3aed,
      #ec4899
    );

}

.group-info {

  flex: 1;

  min-width: 0;

}

.group-name {

  font-size: 13px;

  font-weight: 900;

  line-height: 1.4;

}

.group-jid {

  margin-top: 5px;

  color: #5e6b82;

  font-size: 8px;

  word-break: break-all;

}

.group-count {

  margin-top: 6px;

  color: #00ff9d;

  font-size: 10px;

  font-weight: 800;

}

.active-badge {

  color: #00ff9d;

  font-size: 8px;

  font-weight: 900;

}

.all-group {

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 10px;

  padding: 12px;

  margin-bottom: 8px;

  border-radius: 15px;

  background:
    rgba(0,0,0,.16);

  border:
    1px solid
    rgba(255,255,255,.05);

}

.all-group-name {

  font-size: 11px;

  font-weight: 800;

}

.all-group-jid {

  margin-top: 4px;

  color: #56647b;

  font-size: 8px;

  word-break: break-all;

}

.target-tag,
.normal-tag {

  padding:
    5px 8px;

  border-radius: 8px;

  font-size: 7px;

  font-weight: 900;

}

.target-tag {

  color: #00ff9d;

  background:
    rgba(0,255,157,.10);

}

.normal-tag {

  color: #7b879b;

  background:
    rgba(255,255,255,.04);

}

.progress-wrap {

  margin-top: 10px;

}

.progress-info {

  display: flex;

  justify-content:
    space-between;

  margin-bottom: 9px;

  color: #8b98ad;

  font-size: 10px;

}

.progress {

  height: 9px;

  overflow: hidden;

  border-radius: 20px;

  background:
    rgba(255,255,255,.07);

}

.progress-bar {

  width: ${progress}%;

  height: 100%;

  background:
    linear-gradient(
      90deg,
      #00ff9d,
      #00aaff,
      #a855f7,
      #ff3cac
    );

}

.empty-box {

  padding: 30px;

  text-align: center;

  color: #8793a7;

}

.empty-box b {

  display: block;

  margin-top: 8px;

  color: white;

  font-size: 13px;

}

.empty-box small {

  display: block;

  margin-top: 7px;

  font-size: 10px;

}

.footer {

  text-align: center;

  color: #56647a;

  font-size: 9px;

}

@media(max-width:900px) {

  .stats {

    grid-template-columns:
      repeat(2,1fr);

  }

  .grid {

    grid-template-columns:
      1fr;

  }

}

@media(max-width:500px) {

  .header {

    flex-direction:
      column;

    align-items:
      flex-start;

  }

  .stats {

    grid-template-columns:
      repeat(2,1fr);

  }

  .stat {

    padding: 15px;

  }

  .stat-value {

    font-size: 19px;

  }

}

</style>

</head>

<body>

<div class="container">

<div class="header">

  <div class="brand">

    <div class="logo">
      💬
    </div>

    <div>

      <h1>
        WhatsApp Report Bot
      </h1>

      <p>
        BAMB • Cloud Saved • 7-Day Monitoring
      </p>

    </div>

  </div>

  <div class="status ${statusClass}">
    ● ${statusText}
  </div>

</div>

<div class="stats">

  <div class="stat">
    <div class="stat-icon">📱</div>
    <div class="stat-title">WHATSAPP</div>
    <div class="stat-value">
      ${
        connected
          ? "Online"
          : "Offline"
      }
    </div>
  </div>

  <div class="stat">
    <div class="stat-icon">🎯</div>
    <div class="stat-title">TARGET GROUPS</div>
    <div class="stat-value">
      ${savedGroups.length}/2
    </div>
  </div>

  <div class="stat">
    <div class="stat-icon">💬</div>
    <div class="stat-title">MESSAGES</div>
    <div class="stat-value">
      ${totalMessages}
    </div>
  </div>

  <div class="stat">
    <div class="stat-icon">☁️</div>
    <div class="stat-title">STORAGE</div>
    <div class="stat-value">
      ${
        supabase
          ? "Cloud"
          : "Local"
      }
    </div>
  </div>

</div>

<div class="grid">

<div>

<div class="card">

  <div class="card-title">

    <h2>
      📱 Linked WhatsApp
    </h2>

    <span>
      LIVE
    </span>

  </div>

  <div class="device">

    <div class="device-row">
      <span class="device-label">
        Status
      </span>

      <span class="device-value online">
        ${
          connected
            ? "● Connected"
            : statusText
        }
      </span>
    </div>

    <div class="device-row">
      <span class="device-label">
        Number
      </span>

      <span class="device-value">
        ${
          ownerJid
            ? escapeHTML(
                formatNumber(
                  ownerJid
                )
              )
            : "Not linked"
        }
      </span>
    </div>

    <div class="device-row">
      <span class="device-label">
        Cloud Storage
      </span>

      <span class="device-value">
        ${
          supabase
            ? "🟢 Active"
            : "🟡 Waiting"
        }
      </span>
    </div>

  </div>

  <div class="notice">
    ☁️ Message counting data Supabase mein
    save hoga, isliye Render restart/sleep ke
    baad cycle zero se start nahi hogi.
    <br><br>
    ⚠️ 0 messages walay members ko private
    warning milegi. Do consecutive 7-day
    periods mein 0 rehne par removal attempt
    hoga.
  </div>

</div>

<div class="card">

  <div class="card-title">

    <h2>
      🎯 Target Groups
    </h2>

    <span>
      ${savedGroups.length}/2
    </span>

  </div>

  ${groupsHTML}

</div>

</div>

<div>

<div class="card">

  <div class="card-title">

    <h2>
      🔐 WhatsApp QR
    </h2>

    <span>
      AUTO
    </span>

  </div>

  ${qrHTML}

</div>

<div class="card">

  <div class="card-title">

    <h2>
      📋 All Groups
    </h2>

    <span>
      ${allGroups.length}
    </span>

  </div>

  ${allGroupsHTML}

</div>

<div class="card">

  <div class="card-title">

    <h2>
      📊 7-Day Cycle
    </h2>

    <span>
      ${daysLeft} DAYS LEFT
    </span>

  </div>

  <div class="progress-wrap">

    <div class="progress-info">

      <span>
        ${progress}% completed
      </span>

      <span>
        ${daysLeft} days left
      </span>

    </div>

    <div class="progress">

      <div class="progress-bar"></div>

    </div>

  </div>

</div>

</div>

</div>

<div class="footer">

  WhatsApp Report Bot
  • BAMB Dashboard
  • !rana
  • !stats
  • !groups
  • Private Warnings
  • Auto Removal

</div>

</div>

</body>

</html>
`);

  }
);

/*
========================================
DURATION
========================================
*/

function formatDuration(
  ms
) {

  const totalSeconds =
    Math.floor(
      ms / 1000
    );

  const days =
    Math.floor(
      totalSeconds /
      86400
    );

  const hours =
    Math.floor(
      (
        totalSeconds %
        86400
      ) / 3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) / 60
    );

  return `${days}d ${hours}h ${minutes}m`;

}

/*
========================================
HEALTH
========================================
*/

app.get(
  "/health",
  (req, res) => {

    res.json({

      status: "ok",

      whatsapp:
        ownerJid
          ? "connected"
          : connectionStatus,

      owner:
        ownerJid || null,

      targetGroups:
        savedGroups,

      allGroups:
        allGroups.length,

      cloud:
        !!supabase,

      messages:
        Object.values(
          messageLog
        ).reduce(
          (
            total,
            group
          ) =>
            total +
            Object.values(
              group || {}
            ).reduce(
              (
                sum,
                arr
              ) =>
                sum +
                (
                  Array.isArray(
                    arr
                  )
                    ? arr.length
                    : 0
                ),
              0
            ),
          0
        ),

      lidMappings:
        Object.keys(
          lidMap
        ).length,

      warnings:
        Object.values(
          warnings
        ).reduce(
          (
            total,
            group
          ) =>
            total +
            Object.keys(
              group || {}
            ).length,
          0
        ),

      lastError:
        lastError || null

    });

  }
);

/*
========================================
START BOT
========================================
*/

async function startBot() {

  if (reconnecting) {
    return;
  }

  reconnecting =
    true;

  try {

    connectionStatus =
      "connecting";

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
          10000,

        generateHighQualityLinkPreview:
          false

      });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    /*
    ========================================
    CONNECTION
    ========================================
    */

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          qr,
          lastDisconnect
        } = update;

        if (qr) {

          latestQR =
            qr;

          qrGeneratedAt =
            Date.now();

          connectionStatus =
            "qr";

          console.log(
            "📱 NEW QR GENERATED"
          );

        }

        if (
          connection ===
          "open"
        ) {

          latestQR =
            null;

          qrGeneratedAt =
            0;

          ownerJid =
            sock.user?.id ||
            null;

          connectionStatus =
            "connected";

          connectedAt =
            Date.now();

          lastError =
            "";

          reconnecting =
            false;

          console.log(
            "================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED"
          );

          console.log(
            "👑 OWNER:",
            ownerJid
          );

          console.log(
            "☁️ CLOUD:",
            !!supabase
          );

          console.log(
            "⚠️ PRIVATE WARNINGS: ON"
          );

          console.log(
            "🚫 AUTO REMOVAL: ON"
          );

          console.log(
            "================================"
          );

          await findTargetGroups();

        }

        if (
          connection ===
          "close"
        ) {

          ownerJid =
            null;

          connectedAt =
            null;

          latestQR =
            null;

          connectionStatus =
            "disconnected";

          let statusCode =
            null;

          try {

            statusCode =
              lastDisconnect
                ?.error
                ?.output
                ?.statusCode;

          } catch {}

          console.log(
            "❌ WhatsApp disconnected:",
            statusCode
          );

          reconnecting =
            false;

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "⚠️ WhatsApp logged out."
            );

            return;

          }

          setTimeout(
            startBot,
            5000
          );

        }

      }
    );

    /*
    ========================================
    MESSAGE LISTENER
    ========================================
    */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type
      }) => {

        try {

          if (
            !messages?.length ||
            type !==
              "notify"
          ) {

            return;

          }

          let changed =
            false;

          for (
            const msg
            of messages
          ) {

            if (
              !msg ||
              !msg.message
            ) {
              continue;
            }

            const chat =
              msg.key.remoteJid;

            if (
              !chat ||
              !chat.endsWith(
                "@g.us"
              )
            ) {

              continue;

            }

            const senderLid =
              msg.key.participant ||
              null;

            const senderPhone =
              msg.key.participantAlt ||
              msg.key.senderPn ||
              null;

            if (
              rememberIdentity(
                senderLid,
                senderPhone
              )
            ) {

              changed =
                true;

            }

            /*
            =================================
            TEXT
            =================================
            */

            const text =
              msg.message
                .conversation ||
              msg.message
                .extendedTextMessage
                ?.text ||
              msg.message
                .imageMessage
                ?.caption ||
              msg.message
                .videoMessage
                ?.caption ||
              "";

            const command =
              String(text)
                .trim()
                .toLowerCase();

            /*
            =================================
            OWNER
            =================================
            */

            const ownerNormalized =
              ownerJid
                ? normalizeJid(
                    ownerJid
                  )
                : null;

            const phoneNormalized =
              senderPhone
                ? normalizeJid(
                    senderPhone
                  )
                : null;

            const isOwner =
              msg.key.fromMe === true ||
              (
                ownerNormalized &&
                phoneNormalized &&
                ownerNormalized ===
                  phoneNormalized
              );

            /*
            =================================
            !RANA
            =================================
            */

            if (
              command ===
              "!rana"
            ) {

              if (
                isOwner &&
                isTargetGroup(
                  chat
                )
              ) {

                await sendReport(
                  chat
                );

              }

              continue;

            }

            /*
            =================================
            !STATS
            =================================
            */

            if (
              command ===
              "!stats"
            ) {

              if (
                isOwner &&
                isTargetGroup(
                  chat
                )
              ) {

                await sendReport(
                  chat
                );

              }

              continue;

            }

            /*
            =================================
            !GROUPS
            =================================
            */

            if (
              command ===
              "!groups"
            ) {

              if (isOwner) {

                await sendGroupsList(
                  chat
                );

              }

              continue;

            }

            /*
            =================================
            IGNORE OWN NORMAL MESSAGE
            =================================
            */

            if (
              msg.key.fromMe
            ) {

              continue;

            }

            /*
            =================================
            TARGET ONLY
            =================================
            */

            if (
              !isTargetGroup(
                chat
              )
            ) {

              continue;

            }

            const sender =
              isPhoneJid(
                senderPhone
              )
                ? normalizeJid(
                    senderPhone
                  )
                : normalizeJid(
                    senderLid
                  );

            if (!sender) {
              continue;
            }

            /*
            =================================
            MESSAGE STORAGE
            =================================
            */

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

            const timestamp =
              Number(
                msg.messageTimestamp ||
                0
              ) * 1000;

            messageLog[chat][sender]
              .push(
                timestamp ||
                Date.now()
              );

            /*
            =================================
            IMPORTANT:
            If user was previously warned,
            clear warning immediately when
            they send a message.
            =================================
            */

            if (
              warnings[chat]
            ) {

              const possibleKeys = [
                sender,
                normalizeJid(
                  senderLid
                ),
                normalizeJid(
                  senderPhone
                )
              ];

              let warningCleared =
                false;

              for (
                const key
                of possibleKeys
              ) {

                if (
                  key &&
                  warnings[chat][key]
                ) {

                  delete warnings[chat][key];

                  warningCleared =
                    true;

                }

              }

              /*
              Also check phone mapping.
              */

              const phone =
                getPhoneFromAnyId(
                  sender
                );

              if (phone) {

                const phoneKey =
                  `${phone}@s.whatsapp.net`;

                if (
                  warnings[chat][phoneKey]
                ) {

                  delete warnings[chat][phoneKey];

                  warningCleared =
                    true;

                }

              }

              if (
                warningCleared
              ) {

                console.log(
                  "✅ MEMBER BECAME ACTIVE - WARNING CLEARED:",
                  sender
                );

                changed =
                  true;

              }

            }

            changed =
              true;

            console.log(
              `💬 MESSAGE SAVED: ${chat}`
            );

          }

          /*
          =================================
          SAVE
          =================================
          */

          if (changed) {

            await saveData();

          }

        } catch (error) {

          console.log(
            "❌ MESSAGE ERROR:",
            error.message
          );

        }

      }
    );

  } catch (error) {

    console.log(
      "❌ START ERROR:",
      error.message
    );

    lastError =
      error.message;

    connectionStatus =
      "error";

    reconnecting =
      false;

    setTimeout(
      startBot,
      5000
    );

  }

}

/*
========================================
QR REFRESH
========================================
*/

setInterval(
  () => {

    if (
      latestQR &&
      Date.now() -
        qrGeneratedAt >
        QR_EXPIRE
    ) {

      console.log(
        "♻️ QR EXPIRED"
      );

      latestQR =
        null;

      qrGeneratedAt =
        0;

    }

  },
  10000
);

/*
========================================
GROUP RESCAN
========================================
*/

setInterval(
  async () => {

    if (
      sock &&
      ownerJid &&
      connectionStatus ===
        "connected"
    ) {

      await findTargetGroups();

    }

  },
  30000
);

/*
========================================
7 DAY REPORT
========================================
*/

setInterval(
  async () => {

    try {

      const end =
        Number(
          botState.cycleStart
        ) +
        REPORT_DAYS *
          24 *
          60 *
          60 *
          1000;

      if (
        Date.now() >=
        end
      ) {

        if (
          sock &&
          ownerJid
        ) {

          console.log(
            "⏰ 7 DAYS COMPLETE"
          );

          /*
          Send report to every target group.
          This also sends private warnings and
          handles second-cycle removals.
          */

          for (
            const group
            of savedGroups
          ) {

            await sendReport(
              group.jid
            );

          }

          /*
          ======================================
          NEW 7-DAY CYCLE
          ======================================
          */

          botState.cycleStart =
            Date.now();

          messageLog = {};

          await saveData();

          console.log(
            "🔄 NEW 7-DAY CYCLE"
          );

        }

      }

    } catch (error) {

      console.log(
        "❌ AUTO REPORT ERROR:",
        error.message
      );

    }

  },
  60000
);

/*
========================================
SERVER
========================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🤖 WHATSAPP REPORT BOT"
    );

    console.log(
      "🌈 BAMB DASHBOARD: ON"
    );

    console.log(
      "☁️ SUPABASE STORAGE:",
      !!supabase
    );

    console.log(
      "📊 MESSAGE PERSISTENCE: ON"
    );

    console.log(
      "⚡ !RANA: ON"
    );

    console.log(
      "📈 !STATS: ON"
    );

    console.log(
      "⏰ 7-DAY REPORT: ON"
    );

    console.log(
      "⚠️ PRIVATE WARNING: ON"
    );

    console.log(
      "🚫 AUTO REMOVAL: ON"
    );

    console.log(
      "🌐 PORT:",
      PORT
    );

    console.log(
      "================================"
    );

  }
);

/*
========================================
BOOT
========================================
*/

(async () => {

  console.log(
    "🚀 Starting WhatsApp Bot..."
  );

  await loadCloudData();

  startBot();

})();
