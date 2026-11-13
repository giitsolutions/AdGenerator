// db/query.js
// Tiny promise wrapper so the new code works with whatever db/connection.js
// opens: the `sqlite` package (promise based - what this project uses now),
// better-sqlite3 / node:sqlite (synchronous) or plain sqlite3 (callbacks).
//
// Usage is unchanged:   await q().run(sql, params)   // -> { lastID, changes }
//                       await q().get(sql, params)   // -> one row or undefined
//                       await q().all(sql, params)   // -> array of rows

// connection.js may export getDb() (async, returns a PROMISE), a db, or { db }.
// `await` handles all of them.
async function resolveDb() {
  const c = require('./connection');
  if (typeof c.getDb === 'function') return await c.getDb();
  return c.db || c;
}

function wrap(db) {
  // `sqlite` package (promise based): db.run(sql, params) already returns a promise.
  // It has prepare() AND run(), so it must be recognised before the checks below,
  // and it must NOT be given a callback.
  if (typeof db.getDatabaseInstance === 'function') {
    return {
      run: async (sql, p = []) => {
        const r = await db.run(sql, p);
        return { lastID: r.lastID, changes: r.changes };
      },
      get: async (sql, p = []) => db.get(sql, p),
      all: async (sql, p = []) => db.all(sql, p)
    };
  }

  // better-sqlite3 / node:sqlite: synchronous, has prepare() but no run()
  const syncStyle = typeof db.prepare === 'function' && typeof db.run !== 'function';
  if (syncStyle) {
    return {
      run: async (sql, p = []) => {
        const r = db.prepare(sql).run(...p);
        return { lastID: Number(r.lastInsertRowid), changes: r.changes };
      },
      get: async (sql, p = []) => db.prepare(sql).get(...p),
      all: async (sql, p = []) => db.prepare(sql).all(...p)
    };
  }

  // sqlite3 (callback style)
  return {
    run: (sql, p = []) =>
      new Promise((res, rej) =>
        db.run(sql, p, function (e) {
          e ? rej(e) : res({ lastID: this.lastID, changes: this.changes });
        })
      ),
    get: (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r)))),
    all: (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))))
  };
}

// The database is opened once and shared. q() stays synchronous, so existing
// code like  q().run(...)  keeps working; each call waits for the database.
let ready = null;
function getWrapped() {
  if (!ready) {
    ready = resolveDb().then(wrap).catch(err => {
      ready = null; // try again on the next call
      throw err;
    });
  }
  return ready;
}

const q = () => ({
  run: async (sql, p) => (await getWrapped()).run(sql, p),
  get: async (sql, p) => (await getWrapped()).get(sql, p),
  all: async (sql, p) => (await getWrapped()).all(sql, p)
});

module.exports = { q, wrap, resolveDb };