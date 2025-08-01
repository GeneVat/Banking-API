// server.js
const express = require("express");
const Database = require("better-sqlite3");
const app = express();
const port = 3000;

app.use(express.static("public"));

const Key = "Soup123";

// Initialize DB
const db = new Database("userTransactions.db");

// Create tables
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

// Seed data
const sampleUsers = [
  { id: "u1", count: 10 },
  { id: "u2", count: 25 },
  { id: "u3", count: 42 },
];

const sampleKeys = [
  { id: "u1", key: 111 },
  { id: "u2", key: 112 },
  { id: "u3", key: 113 },
];

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (id, count) VALUES (?, ?)`
);
sampleUsers.forEach((user) => insertUser.run(user.id, user.count));

const insertKey = db.prepare(
  `INSERT OR IGNORE INTO keys (id, key) VALUES (?, ?)`
);
sampleKeys.forEach((key) => insertKey.run(key.id, key.key));

app.get("/api/add", (req, res) => {
  const userId = req.query.user;
  const userKey = req.query.key;
  const apiKey = req.query.apikey;

  if (Key !== apiKey) {
    // API KEY CHECK
    return res.status(400).json({ error: "Requires the valid API Key" }); // API KEY CHECK
  } // API KEY CHECK
  if (!userId || !userKey) {
    return res
      .status(400)
      .json({ error: "User ID and User Key are required." });
  }

  try {
    const selectUser = db.prepare(`SELECT id FROM users WHERE id = ?`);
    const existingUser = selectUser.get(userId);

    if (existingUser) {
      return res.json({ success: true, message: "User already exists." });
    }

    const insertUser = db.prepare(`
      INSERT INTO users (id, count) VALUES (?, ?)
    `);
    insertUser.run(userId, 0);

    const insertKey = db.prepare(`
      INSERT INTO Keys (id, key) VALUES (?, ?)
    `);
    insertKey.run(userId, userKey);

    res.json({ success: true, message: "User added." });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/del", (req, res) => {
  const userId = req.query.user;
  const apiKey = req.query.apikey;

  if (Key !== apiKey) {
    // API KEY
    return res.status(400).json({ error: "Requires the valid API Key" }); // API KEY
  } // API KEY

  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  try {
    const selectUser = db.prepare(`SELECT id FROM users WHERE id = ?`);
    const existingUser = selectUser.get(userId);

    if (!existingUser) {
      return res.json({ success: true, message: "User does not exist." });
    }
    const user = db.prepare(`SELECT count FROM users WHERE id = ?`).get(userId);
    if (user.count != 0) {
      return res
        .status(400)
        .json({ error: "User must have 0 balance to delete" });
    }
    const deleteUser = db.prepare(`DELETE FROM users WHERE id = ?`);
    const deleteKey = db.prepare(`DELETE FROM Keys WHERE id = ?`);

    deleteUser.run(userId);
    deleteKey.run(userId);

    res.json({ success: true, message: "User deleted." });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Get user count
app.get("/api/count", (req, res) => {
  const userId = req.query.user;
  const apiKey = req.query.apikey;

  if (Key !== apiKey) {
    // API KEY CHECK
    return res.status(400).json({ error: "Requires the valid API Key" }); // API KEY CHECK
  } // API KEY CHECK
  if (!userId) return res.status(400).json({ error: "User ID is required." });

  const user = db.prepare(`SELECT count FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  res.json({ user: userId, count: user.count });
});

// Transfer amount from sender to receiver
app.get("/api/change", (req, res) => {
  const { send: senderId, rev: receiverId, key: keyPassed, amount } = req.query;
  const amountInt = parseInt(amount, 10);

  if (!senderId || !receiverId || isNaN(amountInt)) {
    return res.status(400).json({
      error: "Sender ID, Receiver ID, and valid amount are required.",
    });
  }

  const sender = db
    .prepare("SELECT count FROM users WHERE id = ?")
    .get(senderId);
  const receiver = db
    .prepare("SELECT count FROM users WHERE id = ?")
    .get(receiverId);
  const storedKey = db
    .prepare("SELECT key FROM keys WHERE id = ?")
    .get(senderId);

  if (!sender) return res.status(404).json({ error: "Sender not found." });
  if (!receiver) return res.status(404).json({ error: "Receiver not found." });
  if (!storedKey || storedKey.key.toString() !== keyPassed.toString()) {
    return res.status(401).json({ error: "Invalid key provided." });
  }
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
          `
        INSERT INTO transactions (sender_id, receiver_id, amount)
        VALUES (?, ?, ?)
      `
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

// Get all transactions
app.get("/api/transactions", (req, res) => {
  const apiKey = req.query.apikey;

  if (Key !== apiKey) {
    // API KEY CHECK
    return res.status(400).json({ error: "Requires the valid API Key" }); // API KEY CHECK
  } // API KEY CHECK
  const transactions = db
    .prepare(`SELECT * FROM transactions ORDER BY timestamp DESC`)
    .all();
  res.json(transactions);
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
