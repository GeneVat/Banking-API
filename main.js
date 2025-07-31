const express = require("express");
const Database = require("better-sqlite3");
const app = express();
const port = 3000;

app.use(express.static("public"));

// Single database connection
const db = new Database("userTransactions.db");

// Setup database schema
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

// Seed sample users
const sampleUsers = [
  { id: "u1", count: 10 },
  { id: "u2", count: 25 },
  { id: "u3", count: 42 },
];
const keyTable = [
  { id: "u1", key: 111 },
  { id: "u2", key: 112 },
  { id: "u3", key: 113 },
];

const insertUser = db.prepare(`INSERT OR IGNORE INTO users (id, count) VALUES (?, ?)`);
for (const user of sampleUsers) {
  insertUser.run(user.id, user.count);
}
const insertKey = db.prepare(`INSERT OR IGNORE INTO keys (id, key) VALUES (?, ?)`);
for (const key of keyTable) {
  insertKey.run(key.id, key.key);
}
// GET user count
app.get("/api/count", (req, res) => {
  const userId = req.query.user;
  if (!userId) return res.status(400).json({ error: "User ID is required" });

  const user = db.prepare(`SELECT count FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ user: userId, count: user.count });
});

// CHANGE user count (transfer)
app.get("/api/change", (req, res) => {
  const senderId = req.query.send;
  const receiverId = req.query.rev;
  const amount = parseInt(req.query.amount, 10);

  if (!senderId || !receiverId || isNaN(amount)) {
    return res
      .status(400)
      .json({ error: "Send ID, Rev ID, and valid amount are required" });
  }

  const sender = db.prepare(`SELECT count FROM users WHERE id = ?`).get(senderId);
  const receiver = db.prepare(`SELECT count FROM users WHERE id = ?`).get(receiverId);

  if (!sender) return res.status(404).json({ error: "Sender not found" });
  if (!receiver) return res.status(404).json({ error: "Receiver not found" });
  if (sender.count < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  // Start transaction
  const transaction = db.transaction(() => {
    const updateCount = db.prepare(`UPDATE users SET count = ? WHERE id = ?`);

    updateCount.run(sender.count - amount, senderId);
    updateCount.run(receiver.count + amount, receiverId);

    const logTransaction = db.prepare(`
      INSERT INTO transactions (sender_id, receiver_id, amount)
      VALUES (?, ?, ?)
    `);
    const result = logTransaction.run(senderId, receiverId, amount);
    return result.lastInsertRowid;
  });

  try {
    const transactionId = transaction();
    res.json({
      transactionId,
      senderId,
      senderNewCount: sender.count - amount,
      receiverId,
      receiverNewCount: receiver.count + amount,
    });
  } catch (error) {
    res.status(500).json({ error: "Transaction failed" });
  }
});

// GET all transactions
app.get("/api/transactions", (req, res) => {
  const transactions = db
    .prepare(`SELECT * FROM transactions ORDER BY timestamp DESC`)
    .all();

  res.json(transactions);
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
