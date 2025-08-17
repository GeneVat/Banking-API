const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const app = express();
const port = 4000;

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup sessions
app.use(
  session({
    secret: "replace_this_with_a_strong_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }, // 1 hour
  })
);

// Initialize DB
const db = new Database("bank.db");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    isAdmin INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    balance INTEGER DEFAULT 0,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_account TEXT,
    receiver_account TEXT,
    amount INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Prepopulate admin
(async () => {
  const adminExists = db.prepare("SELECT * FROM users WHERE id='admin'").get();
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    db.prepare("INSERT INTO users (id, password, isAdmin) VALUES (?,?,1)").run(
      "admin",
      hashedPassword
    );
    console.log("✅ Admin account created: user 'admin' / password 'admin123'");
  }
})();

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in." });
  next();
}

// Middleware to require admin
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in." });
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  if (!user || user.isAdmin !== 1) return res.status(403).json({ error: "Admin only." });
  next();
}

// LOGIN
app.post("/api/login", async (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: "ID and password required" });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  req.session.userId = user.id;
  res.json({ success: true, isAdmin: user.isAdmin === 1 });
});

// LOGOUT
app.get("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ success: true });
  });
});

// USER INFO
app.get("/api/me", requireLogin, (req, res) => {
  const user = db.prepare("SELECT id, isAdmin FROM users WHERE id=?").get(req.session.userId);
  res.json(user);
});

// GET ACCOUNTS (all if admin, own if user)
app.get("/api/accounts", requireLogin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  let accounts;
  if (user.isAdmin === 1) {
    accounts = db.prepare("SELECT * FROM accounts").all();
  } else {
    accounts = db.prepare("SELECT * FROM accounts WHERE owner_id=?").all(user.id);
  }
  res.json(accounts);
});

// CREATE USER (ADMIN ONLY)
app.post("/api/users", requireAdmin, async (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: "ID and password required" });

  const exists = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (exists) return res.status(400).json({ error: "User exists" });

  const hashedPassword = await bcrypt.hash(password, 10);

  db.prepare("INSERT INTO users (id, password, isAdmin) VALUES (?,?,0)").run(id, hashedPassword);
  res.json({ success: true });
});

// DELETE USER (ADMIN ONLY)
app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const accounts = db.prepare("SELECT * FROM accounts WHERE owner_id=?").all(id);
  if (accounts.length > 0) return res.status(400).json({ error: "User has accounts" });

  db.prepare("DELETE FROM users WHERE id=?").run(id);
  res.json({ success: true });
});

// CREATE ACCOUNT (ADMIN ONLY)
app.post("/api/accounts", requireAdmin, (req, res) => {
  const { id, owner_id } = req.body;
  if (!id || !owner_id) return res.status(400).json({ error: "ID and owner required" });

  const exists = db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (exists) return res.status(400).json({ error: "Account exists" });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(owner_id);
  if (!user) return res.status(404).json({ error: "Owner not found" });

  db.prepare("INSERT INTO accounts (id, owner_id, balance) VALUES (?,?,?)").run(
    id,
    owner_id,
    0
  );
  res.json({ success: true });
});

// DELETE ACCOUNT (ADMIN ONLY)
app.delete("/api/accounts/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const acc = db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (!acc) return res.status(404).json({ error: "Account not found" });
  if (acc.balance !== 0) return res.status(400).json({ error: "Account must have 0 balance" });

  db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  res.json({ success: true });
});

// TRANSFER MONEY
app.post("/api/transfer", requireLogin, (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || !amount) return res.status(400).json({ error: "Missing data" });

  const sender = db.prepare("SELECT * FROM accounts WHERE id=?").get(from);
  const receiver = db.prepare("SELECT * FROM accounts WHERE id=?").get(to);

  if (!sender) return res.status(404).json({ error: "Sender account not found" });
  if (!receiver) return res.status(404).json({ error: "Receiver account not found" });

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive integer" });
  }

  if (sender.owner_id !== req.session.userId)
    return res.status(403).json({ error: "Cannot transfer from this account" });

  if (from === to) return res.status(400).json({ error: "Cannot transfer to the same account" });

  if (sender.balance < amount) return res.status(400).json({ error: "Insufficient funds" });

  const txn = db.transaction(() => {
    db.prepare("UPDATE accounts SET balance=? WHERE id=?").run(sender.balance - amount, from);
    db.prepare("UPDATE accounts SET balance=? WHERE id=?").run(receiver.balance + amount, to);
    const t = db.prepare(
      "INSERT INTO transactions (sender_account, receiver_account, amount) VALUES (?,?,?)"
    ).run(from, to, amount);
    return t.lastInsertRowid;
  });

  const txnId = txn();
  res.json({ success: true, transactionId: txnId });
});

// GET TRANSACTIONS
app.get("/api/transactions", requireLogin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  let transactions;
  if (user.isAdmin === 1) {
    transactions = db.prepare("SELECT * FROM transactions ORDER BY timestamp DESC").all();
  } else {
    const accounts = db.prepare("SELECT id FROM accounts WHERE owner_id=?").all(user.id);
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return res.json([]);
    transactions = db
      .prepare(
        `SELECT * FROM transactions WHERE sender_account IN (${ids.map(() => "?").join(",")}) 
        OR receiver_account IN (${ids.map(() => "?").join(",")}) ORDER BY timestamp DESC`
      )
      .all(...ids, ...ids);
  }
  res.json(transactions);
});

// Start server
app.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));
