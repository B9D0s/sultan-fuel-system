const fs = require('fs');
const path = require('path');

// تحديد البيئة
const isProduction = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

let db = null;
let dbType = null; // 'turso' or 'local'

// تهيئة قاعدة البيانات
const initDatabase = async () => {
  if (isProduction) {
    // استخدام Turso في البيئة الأونلاين
    await initTursoDatabase();
  } else {
    // استخدام SQLite محلياً
    await initLocalDatabase();
  }

  // إنشاء الجداول
  await createTables();

  // إنشاء حساب الأدمن الافتراضي
  await createDefaultAdmin();

  console.log(`✅ قاعدة البيانات جاهزة (${dbType})`);
};

// تهيئة Turso للبيئة الأونلاين
const initTursoDatabase = async () => {
  const { createClient } = require('@libsql/client');

  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  dbType = 'turso';
  console.log('🌐 متصل بقاعدة بيانات Turso السحابية');
};

// تهيئة SQLite للبيئة المحلية
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

  // تفعيل الـ Foreign Keys
  db.run('PRAGMA foreign_keys = ON');

  dbType = 'local';
  console.log('💾 متصل بقاعدة بيانات SQLite المحلية');
};

// إنشاء الجداول
const createTables = async () => {
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
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  ];

  for (const sql of tables) {
    await run(sql, false);
  }
};

// إنشاء حساب الأدمن الافتراضي
const createDefaultAdmin = async () => {
  const adminCheck = await queryOne("SELECT id FROM users WHERE role = 'admin'");

  if (!adminCheck) {
    await run(`
      INSERT INTO users (name, username, password, role)
      VALUES ('مدير النظام', 'admin', 'admin123', 'admin')
    `);
    console.log('✅ تم إنشاء حساب الأدمن الافتراضي: admin / admin123');
  }
};

// حفظ قاعدة البيانات للملف (للمحلي فقط)
const saveDatabase = () => {
  if (dbType === 'local') {
    const DB_PATH = path.join(__dirname, 'sultan_fuel.db');
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
  // Turso يحفظ تلقائياً
};

// دالة حساب رقم الأسبوع
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

// دالة توليد رمز عشوائي من 4 أرقام
const generateCode = async () => {
  let code;
  let exists = true;

  while (exists) {
    code = Math.floor(1000 + Math.random() * 9000).toString();
    const result = await queryOne(`SELECT id FROM users WHERE code = '${code}'`);
    exists = !!result;
  }

  return code;
};

// تحويل النقاط إلى نوع الوقود
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

// Helper functions للاستعلامات (متوافقة مع البيئتين)
const queryAll = async (sql) => {
  if (dbType === 'turso') {
    const result = await db.execute(sql);
    return result.rows;
  } else {
    // Local SQLite
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
};

const queryOne = async (sql) => {
  const results = await queryAll(sql);
  return results.length > 0 ? results[0] : null;
};

const run = async (sql, save = true) => {
  if (dbType === 'turso') {
    await db.execute(sql);
  } else {
    db.run(sql);
    if (save) saveDatabase();
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

module.exports = {
  initDatabase,
  getWeekNumber,
  generateCode,
  pointsToFuel,
  queryAll,
  queryOne,
  run,
  getLastInsertId,
  saveDatabase
};
