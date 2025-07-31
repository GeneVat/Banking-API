const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const app = express();
const port = 3000;

// Connect to SQLite database (will create if not exists)
const db = new sqlite3.Database("./userCounts.db");

// Initialize the table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      count INTEGER
    )
  `);

  // Insert sample data if not present
  const sampleUsers = ['u1', 'u2', 'u3'];
  const sampleCounts = [10, 25, 42];
  sampleUsers.forEach((id, i) => {
    db.run(`INSERT OR IGNORE INTO users (id, count) VALUES (?, ?)`, [id, sampleCounts[i]]);
  });
});

// GET count for a user
app.get("/api/count", (req, res) => {
  const userId = req.query.user;
  if (!userId) return res.status(400).json({ error: "User ID is required" });

  db.get(`SELECT count FROM users WHERE id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(404).json({ error: "User ID not found" });
    res.json({ user: userId, count: row.count });
  });
});

// CHANGE count for a user
app.get("/api/change", (req, res) => {
  const userId = req.query.user;
  const amount = parseInt(req.query.amount, 10);

  if (!userId || isNaN(amount)) {
    return res.status(400).json({ error: "User ID and valid amount are required" });
  }

  db.get(`SELECT count FROM users WHERE id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(404).json({ error: "User ID not found" });

    const newCount = row.count + amount;
    db.run(`UPDATE users SET count = ? WHERE id = ?`, [newCount, userId], function (err) {
      if (err) return res.status(500).json({ error: "Failed to update count" });
      res.json({ user: userId, count: newCount });
    });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
