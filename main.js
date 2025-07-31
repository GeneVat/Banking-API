const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const app = express();
const port = 3000;
app.use(express.static("public"));

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
  const sampleUsers = ["u1", "u2", "u3"];
  const sampleCounts = [10, 25, 42];
  sampleUsers.forEach((id, i) => {
    db.run(`INSERT OR IGNORE INTO users (id, count) VALUES (?, ?)`, [
      id,
      sampleCounts[i],
    ]);
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
  const sendId = req.query.send;
  const revId = req.query.rev;
  if (!sendId && !revId)
    return res.status(400).json({ error: "Send ID & Rev ID are required" });
  if (!sendId) return res.status(400).json({ error: "Send ID is required" });
  if (!revId) return res.status(400).json({ error: "Rev ID is required" });

  const amount = parseInt(req.query.amount, 10);

  if (!sendId || isNaN(amount) || !revId) {
    return res
      .status(400)
      .json({ error: "User ID, Rev ID, and valid amount are required" });
  }

  db.get(`SELECT count FROM users WHERE id = ?`, [revId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(404).json({ error: "User ID not found" });

    const newCountgive = row.count + amount;
    const newCounttake = row.count - amount;
    db.run(
      `UPDATE users SET count = ? WHERE id = ?`,
      [newCountgive, revId],
      function (err) {
        if (err) {
          return res
            .status(500)
            .json({ error: "Failed to update receiver count" });
        }

        // Second update after the first succeeds
        db.get(
          `SELECT count FROM users WHERE id = ?`,
          [sendId],
          (err, senderRow) => {
            if (err || !senderRow) {
              return res.status(404).json({ error: "Sender not found" });
            }

            db.get(
              `SELECT count FROM users WHERE id = ?`,
              [revId],
              (err, receiverRow) => {
                if (err || !receiverRow) {
                  return res.status(404).json({ error: "Receiver not found" });
                }

                const senderCount = senderRow.count;
                const receiverCount = receiverRow.count;

                if (senderCount < amount) {
                  return res
                    .status(400)
                    .json({ error: "Insufficient balance" });
                }

                const newSenderCount = senderCount - amount;
                const newReceiverCount = receiverCount + amount;

                db.serialize(() => {
                  db.run("BEGIN TRANSACTION");

                  db.run(
                    `UPDATE users SET count = ? WHERE id = ?`,
                    [newSenderCount, sendId],
                    function (err) {
                      if (err) {
                        db.run("ROLLBACK");
                        return res
                          .status(500)
                          .json({ error: "Failed to update sender count" });
                      }

                      db.run(
                        `UPDATE users SET count = ? WHERE id = ?`,
                        [newReceiverCount, revId],
                        function (err) {
                          if (err) {
                            db.run("ROLLBACK");
                            return res
                              .status(500)
                              .json({
                                error: "Failed to update receiver count",
                              });
                          }

                          db.run("COMMIT", (err) => {
                            if (err) {
                              return res
                                .status(500)
                                .json({
                                  error: "Failed to commit transaction",
                                });
                            }

                            res.json({
                              senderId: sendId,
                              senderNewCount: newSenderCount,
                              receiverId: revId,
                              receiverNewCount: newReceiverCount,
                            });
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          }
        );
      }
    );
  });
});

// Start the server
app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
