const fs = require('fs');
const path = require('path');

const isProduction = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

let db = null;
let dbType = null; // 'turso' or 'local'

const initDatabase = async () => {
  if (isProduction) {
    await initTursoDatabase();
  } else {
    await initLocalDatabase();
  }

  await createTables();
  await createIndexes();
  await createDefaultAdmin();

  console.log(`✅ قاعدة البيانات جاهزة (${dbType})`);
};

const initTursoDatabase = async () => {
  const { createClient } = require('@libsql/client');

  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  dbType = 'turso';
  console.log('🌐 متصل بقاعدة بيانات Turso السحابية');
};

const initLocalDatabase = async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const DB_PATH = path.join(__dirname, 'sultan_fuel.db');

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  dbType = 'local';
  console.log('💾 متصل بقاعدة بيانات SQLite المحلية');
};

const createTables = async () => {
  try {
    await run(`ALTER TABLE users ADD COLUMN points_hidden INTEGER DEFAULT 0`, false);
    console.log('✅ تم إضافة عمود points_hidden');
  } catch (e) {
    // العمود موجود بالفعل
  }

  const extraTables = [
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS group_points_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      percentage REAL,
      is_percentage INTEGER DEFAULT 0,
      apply_to_members INTEGER DEFAULT 0,
      reason TEXT,
      adjusted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (adjusted_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      group_id INTEGER,
      points INTEGER,
      percentage REAL,
      reason TEXT,
      performed_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  for (const sql of extraTables) {
    try {
      await run(sql, false);
    } catch (e) { /* تجاهل */ }
  }

  const tables = [
    `CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'student')),
      group_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )`,
    `CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      committee TEXT NOT NULL CHECK(committee IN ('علمي', 'اجتماعي', 'ثقافي', 'إعلامي', 'رياضي', 'متابعة', 'عامة')),
      description TEXT NOT NULL,
      points INTEGER NOT NULL CHECK(points >= 1 AND points <= 5),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      rejection_reason TEXT,
      reviewed_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      week_number INTEGER,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS points_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT,
      adjusted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (adjusted_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS group_points_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      percentage REAL,
      is_percentage INTEGER DEFAULT 0,
      apply_to_members INTEGER DEFAULT 0,
      reason TEXT,
      adjusted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (adjusted_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      group_id INTEGER,
      points INTEGER,
      percentage REAL,
      reason TEXT,
      performed_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of tables) {
    await run(sql, false);
  }
};

const createIndexes = async () => {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_requests_student_id ON requests(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_requests_week_student ON requests(student_id, week_number)',
    'CREATE INDEX IF NOT EXISTS idx_users_group_id ON users(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)',
    'CREATE INDEX IF NOT EXISTS idx_points_adj_student ON points_adjustments(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_group_points_adj_group ON group_points_adjustments(group_id)',
  ];

  for (const sql of indexes) {
    try {
      await run(sql, false);
    } catch (e) { /* تجاهل */ }
  }
  console.log('📇 تم إنشاء الفهارس');
};

const createDefaultAdmin = async () => {
  const adminCheck = await queryOne("SELECT id FROM users WHERE role = 'admin'");

  if (!adminCheck) {
    await run(
      `INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)`,
      ['مدير النظام', 'admin', 'admin123', 'admin']
    );
    console.log('✅ تم إنشاء حساب الأدمن الافتراضي: admin / admin123');
  }
};

const saveDatabase = () => {
  if (dbType === 'local') {
    const DB_PATH = path.join(__dirname, 'sultan_fuel.db');
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
};

const getWeekNumber = (date = new Date()) => {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfWeek = startOfYear.getDay();
  const daysToSaturday = (6 - dayOfWeek + 7) % 7;
  const firstSaturday = new Date(startOfYear);
  firstSaturday.setDate(startOfYear.getDate() + daysToSaturday);

  if (date < firstSaturday) return 1;

  const diffTime = date - firstSaturday;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
};

const generateCode = async () => {
  let code;
  let exists = true;

  while (exists) {
    code = Math.floor(1000 + Math.random() * 9000).toString();
    const result = await queryOne('SELECT id FROM users WHERE code = ?', [code]);
    exists = !!result;
  }

  return code;
};

const pointsToFuel = (points) => {
  const fuelTypes = {
    1: { name: 'ديزل', color: '#8B7355', emoji: '🟫' },
    2: { name: '91', color: '#22C55E', emoji: '🟩' },
    3: { name: '95', color: '#EF4444', emoji: '🟥' },
    4: { name: '98', color: '#F5F5F5', emoji: '⚪' },
    5: { name: 'إيثانول', color: '#3B82F6', emoji: '🟦' }
  };
  return fuelTypes[points] || null;
};

// Supports both queryAll(sql) and queryAll(sql, params)
const queryAll = async (sql, params = []) => {
  if (dbType === 'turso') {
    const result = (params && params.length > 0)
      ? await db.execute({ sql, args: params })
      : await db.execute(sql);
    return result.rows;
  } else {
    if (params && params.length > 0) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } else {
      const result = db.exec(sql);
      if (result.length === 0) return [];

      const columns = result[0].columns;
      return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
    }
  }
};

const queryOne = async (sql, params = []) => {
  const results = await queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
};

// Backward-compatible: run(sql), run(sql, false), run(sql, params), run(sql, params, false)
const run = async (sql, paramsOrSave = [], save = true) => {
  let params = [];
  let shouldSave = save;

  if (typeof paramsOrSave === 'boolean') {
    shouldSave = paramsOrSave;
  } else if (Array.isArray(paramsOrSave)) {
    params = paramsOrSave;
  }

  if (dbType === 'turso') {
    if (params.length > 0) {
      await db.execute({ sql, args: params });
    } else {
      await db.execute(sql);
    }
  } else {
    if (params.length > 0) {
      db.run(sql, params);
    } else {
      db.run(sql);
    }
    if (shouldSave) saveDatabase();
  }
};

const getLastInsertId = async () => {
  if (dbType === 'turso') {
    const result = await db.execute('SELECT last_insert_rowid() as id');
    return result.rows[0].id;
  } else {
    const result = db.exec('SELECT last_insert_rowid() as id');
    return result[0].values[0][0];
  }
};

// Races a query against a timeout to prevent hanging
const queryWithTimeout = async (sql, params = [], timeoutMs = 8000) => {
  return Promise.race([
    queryAll(sql, params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DATABASE_TIMEOUT')), timeoutMs)
    )
  ]);
};

const queryOneWithTimeout = async (sql, params = [], timeoutMs = 8000) => {
  const results = await queryWithTimeout(sql, params, timeoutMs);
  return results.length > 0 ? results[0] : null;
};

module.exports = {
  initDatabase,
  getWeekNumber,
  generateCode,
  pointsToFuel,
  queryAll,
  queryOne,
  run,
  getLastInsertId,
  saveDatabase,
  queryWithTimeout,
  queryOneWithTimeout
};
