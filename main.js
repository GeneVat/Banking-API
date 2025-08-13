const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const app = express();
const port = 3000;

app.use(express.static("public"));

// Setup sessions
app.use(
  session({
    secret: "replace_this_with_a_strong_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }, // 1 hour
  })
);

const Key = "Soup123";

// Initialize DB
const db = new Database("userTransactions.db");

// Create tables (same as before)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    amount INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    key INTEGER NOT NULL
  );
`);

// Seed data (same as before)
const starterUsers = [
  { id: "u1", count: 10 },
  { id: "u2", count: 25 },
  { id: "u3", count: 42 },
];

const starterKeys = [
  { id: "u1", key: 111 },
  { id: "u2", key: 112 },
  { id: "u3", key: 113 },
];

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (id, count) VALUES (?, ?)`
);

const deleteUser = db.prepare(`DELETE FROM users WHERE id = ?`);
const deleteKey = db.prepare(`DELETE FROM keys WHERE id = ?`);
const insertKey = db.prepare(
  `INSERT OR IGNORE INTO keys (id, key) VALUES (?, ?)`
);

starterUsers.forEach((user) => insertUser.run(user.id, user.count));
starterKeys.forEach((key) => insertKey.run(key.id, key.key));

// Middleware to check session
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in." });
  }
  next();
}

// Login endpoint - set session if key matches
app.get("/api/login", (req, res) => {
  const userInputId = req.query.user;
  const userInputKey = req.query.key;

  if (!userInputId || !userInputKey) {
    return res.status(400).json({ error: "User ID and key are required." });
  }

  try {
    const storedKeyRow = db.prepare("SELECT key FROM keys WHERE id = ?").get(userInputId);
    if (!storedKeyRow || Number(storedKeyRow.key) !== Number(userInputKey)) {
      return res.status(401).json({ error: "Invalid key." });
    }

    const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userInputId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    // Save session
    req.session.userId = userInputId;

    const transactions = db
      .prepare("SELECT * FROM transactions WHERE sender_id = ? OR receiver_id = ? ORDER BY timestamp DESC")
      .all(userInputId, userInputId);

    res.json({
      user: userRow,
      transactions,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Logout endpoint - clear session
app.get("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed." });
    }
    res.json({ success: true, message: "Logged out successfully." });
  });
});

// Change transfer endpoint - require session and no longer key param
app.get("/api/change", requireLogin, (req, res) => {
  const senderId = req.session.userId;
  const receiverId = req.query.rev;
  const amountInt = parseInt(req.query.amount, 10);

  if (!receiverId || isNaN(amountInt)) {
    return res.status(400).json({
      error: "Receiver ID and valid amount are required.",
    });
  }

  if (senderId === receiverId) {
    return res.status(400).json({ error: "Cannot transfer to yourself." });
  }

  const sender = db.prepare("SELECT count FROM users WHERE id = ?").get(senderId);
  const receiver = db.prepare("SELECT count FROM users WHERE id = ?").get(receiverId);

  if (!sender) return res.status(404).json({ error: "Sender not found." });
  if (!receiver) return res.status(404).json({ error: "Receiver not found." });

  if (sender.count < amountInt) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  try {
    const performTransfer = db.transaction(() => {
      db.prepare("UPDATE users SET count = ? WHERE id = ?").run(
        sender.count - amountInt,
        senderId
      );
      db.prepare("UPDATE users SET count = ? WHERE id = ?").run(
        receiver.count + amountInt,
        receiverId
      );

      const result = db
        .prepare(
          `INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)`
        )
        .run(senderId, receiverId, amountInt);

      return result.lastInsertRowid;
    });

    const transactionId = performTransfer();

    res.json({
      transactionId,
      senderId,
      receiverId,
      senderNewCount: sender.count - amountInt,
      receiverNewCount: receiver.count + amountInt,
    });
  } catch (err) {
    console.error("Transaction error:", err);
    res.status(500).json({ error: "Transaction failed. Please try again." });
  }
});

// Get user count - protected
app.get("/api/count", requireLogin, (req, res) => {
  const userId = req.session.userId;

  const user = db.prepare(`SELECT count FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  res.json({ user: userId, count: user.count });
});

// Get all transactions - keep original API key check or protect as needed
app.get("/api/transactions", (req, res) => {
  const apiInputKey = req.query.apiKey;

  if (Key !== apiInputKey) {
    return res.status(400).json({ error: "Requires the valid API Key" });
  }

  const transactions = db
    .prepare(`SELECT * FROM transactions ORDER BY timestamp DESC`)
    .all();
  res.json(transactions);
});

// User add/del - keep original API key protection
app.get("/api/add", (req, res) => {
  const userInputId = req.query.user;
  const userInputKey = req.query.key;
  const apiInputKey = req.query.apiKey;

  if (Key !== apiInputKey) {
    return res.status(400).json({ error: "Requires the valid API Key" });
  }
  if (!userInputId || !userInputKey) {
    return res.status(400).json({ error: "User ID and User Key are required." });
  }

  try {
    const selectUser = db.prepare(`SELECT id FROM users WHERE id = ?`);
    const existingUser = selectUser.get(userInputId);

    if (existingUser) {
      return res.json({ success: true, message: "User already exists." });
    }

    insertUser.run(userInputId, 0);
    insertKey.run(userInputId, userInputKey);

    res.json({ success: true, message: "User added." });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/del", (req, res) => {
  const userInputId = req.query.user;
  const apiInputKey = req.query.apiKey;

  if (Key !== apiInputKey) {
    return res.status(400).json({ error: "Requires the valid API Key" });
  }

  if (!userInputId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  try {
    const selectUser = db.prepare(`SELECT id FROM users WHERE id = ?`);
    const existingUser = selectUser.get(userInputId);

    if (!existingUser) {
      return res.json({ success: true, message: "User does not exist." });
    }

    const user = db
      .prepare(`SELECT count FROM users WHERE id = ?`)
      .get(userInputId);
    if (user.count != 0) {
      return res.status(400).json({ error: "User must have 0 balance to delete" });
    }

    deleteUser.run(userInputId);
    deleteKey.run(userInputId);

    res.json({ success: true, message: "User deleted." });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
