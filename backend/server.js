const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { initDatabase, getWeekNumber, generateCode, pointsToFuel, queryAll, queryOne, run, getLastInsertId } = require('./database');
const PDFDocument = require('pdfkit');
const { version: APP_VERSION } = require('./package.json');
const {
  notifyRequestApproved,
  notifyRequestRejected,
  notifyNewRequest,
  notifyPointsAdded,
  notifyPointsSubtracted,
  notifyPointsVisibilityChanged,
  notifyNewStudent,
  notifyGroupChanged,
  notifyWeeklyLimitReached,
  notifyNewStudentToSupervisors
} = require('./notifications');

// مسار الخط العربي
const ARABIC_FONT_PATH = path.join(__dirname, 'fonts', 'Amiri-Regular.ttf');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// تحويل إجمالي النقاط إلى خزانات (5→ethanol, 4→98, 3→95, 2→91, 1→diesel)
function pointsToFuelTanks(totalPoints) {
  const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
  let remaining = Math.max(0, Math.floor(Number(totalPoints) || 0));
  while (remaining > 0) {
    if (remaining >= 5) { fuel.ethanol++; remaining -= 5; }
    else if (remaining >= 4) { fuel.fuel98++; remaining -= 4; }
    else if (remaining >= 3) { fuel.fuel95++; remaining -= 3; }
    else if (remaining >= 2) { fuel.fuel91++; remaining -= 2; }
    else { fuel.diesel++; remaining -= 1; }
  }
  return fuel;
}

async function getSetting(key, defaultValue = null) {
  try {
    const row = await queryOne(`SELECT value FROM app_settings WHERE key = '${String(key).replace(/'/g, "''")}'`);
    if (!row || row.value == null) return defaultValue;
    return row.value;
  } catch (e) {
    return defaultValue;
  }
}

async function getSettingBool(key, defaultValue = false) {
  const val = await getSetting(key, defaultValue ? '1' : '0');
  if (val === true || val === 1) return true;
  if (val === false || val === 0) return false;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function setSetting(key, value) {
  const k = String(key).replace(/'/g, "''");
  const v = value == null ? null : String(value).replace(/'/g, "''");
  await run(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('${k}', ${v == null ? 'NULL' : `'${v}'`}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `, false);
}

// Service Worker header
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '../frontend/sw.js'));
});

app.use(express.static(path.join(__dirname, '../frontend')));

// ==================== Settings Routes ====================
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await queryAll(`SELECT key, value FROM app_settings`);
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json({ success: true, settings });
  } catch (e) {
    res.status(400).json({ success: false, message: 'تعذر تحميل الإعدادات' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ success: false, message: 'key مطلوب' });
    await setSetting(key, value);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: 'تعذر حفظ الإعداد' });
  }
});

app.get('/api/points-log', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit || '200', 10) || 200));
    const rows = await queryAll(`
      SELECT pl.*, u.name as performed_by_name
      FROM points_log pl
      LEFT JOIN users u ON pl.performed_by = u.id
      ORDER BY pl.id DESC
      LIMIT ${limit}
    `);
    res.json({ success: true, rows });
  } catch (e) {
    res.status(400).json({ success: false, message: 'تعذر تحميل سجل العمليات' });
  }
});

// ==================== Ops / Public Config ====================
app.get('/healthz', async (req, res) => {
  const mode = (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) ? 'turso' : 'local';
  const onesignalConfigured = !!process.env.ONESIGNAL_APP_ID;
  let dbOk = true;
  try {
    await queryOne('SELECT 1 as ok');
  } catch (e) {
    dbOk = false;
  }
  res.json({
    ok: true,
    dbOk,
    mode,
    env: process.env.NODE_ENV || 'development',
    version: APP_VERSION,
    onesignalConfigured,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.get('/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || null
  });
});

app.get('/api/public-config', (req, res) => {
  res.json({
    onesignalAppId: process.env.ONESIGNAL_APP_ID || null
  });
});

// ==================== Auth Routes ====================

// تسجيل دخول الأدمن
app.post('/api/auth/admin', async (req, res) => {
  const { username, password } = req.body;
  const user = await queryOne(`
    SELECT id, name, role FROM users
    WHERE username = '${username}' AND password = '${password}' AND role = 'admin'
  `);

  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
  }
});

// تسجيل دخول بالرمز (مشرف أو طالب)
app.post('/api/auth/code', async (req, res) => {
  const { code } = req.body;
  const user = await queryOne(`
    SELECT u.id, u.name, u.role, u.group_id, g.name as group_name, COALESCE(u.points_hidden, 0) as points_hidden
    FROM users u
    LEFT JOIN groups g ON u.group_id = g.id
    WHERE u.code = '${code}'
  `);

  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, message: 'الرمز غير صحيح' });
  }
});

// ==================== Groups Routes ====================

// جلب كل الأسر
app.get('/api/groups', async (req, res) => {
  const groups = await queryAll(`
    SELECT g.id, g.name, g.created_at,
    COUNT(DISTINCT u.id) as student_count
    FROM groups g
    LEFT JOIN users u ON g.id = u.group_id AND u.role = 'student'
    GROUP BY g.id
  `);

  for (let group of groups) {
    const membersPoints = await queryOne(`
      SELECT COALESCE(SUM(
        COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u.id AND status = 'approved'), 0) +
        COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u.id), 0)
      ), 0) as total
      FROM users u WHERE u.group_id = ${group.id} AND u.role = 'student'
    `);
    const groupDirectPoints = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM group_points_adjustments
      WHERE group_id = ${group.id}
    `);
    group.members_points = membersPoints?.total || 0;
    group.direct_points = groupDirectPoints?.total || 0;
    group.total_points = group.members_points + group.direct_points;
  }

  res.json(groups);
});

// إنشاء أسرة جديدة
app.post('/api/groups', async (req, res) => {
  const { name } = req.body;
  try {
    await run(`INSERT INTO groups (name) VALUES ('${name}')`);
    const id = await getLastInsertId();
    res.json({ success: true, id });
  } catch (error) {
    res.status(400).json({ success: false, message: 'اسم الأسرة موجود مسبقاً' });
  }
});

// تعديل أسرة
app.put('/api/groups/:id', async (req, res) => {
  const { name } = req.body;
  try {
    await run(`UPDATE groups SET name = '${name}' WHERE id = ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في التعديل' });
  }
});

// حذف أسرة
app.delete('/api/groups/:id', async (req, res) => {
  try {
    await run(`UPDATE users SET group_id = NULL WHERE group_id = ${req.params.id}`);
    await run(`DELETE FROM groups WHERE id = ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الحذف' });
  }
});

// جلب تفاصيل أسرة مع الخزانات
app.get('/api/groups/:id/details', async (req, res) => {
  try {
    const group = await queryOne(`SELECT * FROM groups WHERE id = ${req.params.id}`);
    if (!group) {
      return res.status(404).json({ success: false, message: 'الأسرة غير موجودة' });
    }

    const members = await queryAll(`
      SELECT u.id, u.name,
        (COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u.id AND status = 'approved'), 0) +
         COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u.id), 0)) as total_points
      FROM users u WHERE u.group_id = ${req.params.id} AND u.role = 'student'
    `);

    const membersRequestsSum = await queryOne(`
      SELECT COALESCE(SUM(r.points), 0) as total
      FROM requests r
      JOIN users u ON r.student_id = u.id
      WHERE u.group_id = ${req.params.id} AND r.status = 'approved'
    `);
    const membersAdjustmentsSum = await queryOne(`
      SELECT COALESCE(SUM(pa.points), 0) as total
      FROM points_adjustments pa
      JOIN users u ON pa.student_id = u.id
      WHERE u.group_id = ${req.params.id}
    `);
    const directAdjustmentsSum = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM group_points_adjustments
      WHERE group_id = ${req.params.id}
    `);

    const membersPointsTotal = (membersRequestsSum?.total || 0) + (membersAdjustmentsSum?.total || 0);
    const directTotal = directAdjustmentsSum?.total || 0;
    const grandTotal = membersPointsTotal + directTotal;

    const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
    if (grandTotal > 0) {
      let remaining = grandTotal;
      while (remaining > 0) {
        if (remaining >= 5) { fuel.ethanol++; remaining -= 5; }
        else if (remaining >= 4) { fuel.fuel98++; remaining -= 4; }
        else if (remaining >= 3) { fuel.fuel95++; remaining -= 3; }
        else if (remaining >= 2) { fuel.fuel91++; remaining -= 2; }
        else { fuel.diesel++; remaining -= 1; }
      }
    }

    res.json({
      ...group,
      members,
      fuel,
      members_points: membersPointsTotal,
      direct_points: directTotal,
      total_points: membersPointsTotal + directTotal
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// إضافة/خصم نقاط للأسرة
app.post('/api/groups/:id/points', async (req, res) => {
  try {
    const { points, action, reason, apply_to_members, reviewer_id } = req.body || {};
    const groupId = req.params.id;

    if (!points || points < 1) {
      return res.status(400).json({ success: false, message: 'يجب تحديد عدد النقاط' });
    }

    const group = await queryOne(`SELECT * FROM groups WHERE id = ${groupId}`);
    if (!group) {
      return res.status(404).json({ success: false, message: 'الأسرة غير موجودة' });
    }

    const actualPoints = action === 'subtract' ? -points : points;
    const safeReason = (reason || (action === 'add' ? 'إضافة نقاط للأسرة' : 'خصم نقاط من الأسرة')).replace(/'/g, "''");
    const adjBy = (reviewer_id != null && reviewer_id !== '') ? reviewer_id : 'NULL';

    if (apply_to_members) {
      const members = await queryAll(`
        SELECT u.id, u.name,
          (COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u.id AND status = 'approved'), 0) +
           COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u.id), 0)) as total_points
        FROM users u WHERE u.group_id = ${groupId} AND u.role = 'student'
      `);
      if (members.length === 0) {
        return res.status(400).json({ success: false, message: 'لا يوجد أعضاء في هذه الأسرة' });
      }
      const pointsPerMember = Math.floor(points / members.length);
      const remainder = points % members.length;

      if (action === 'add') {
        // إضافة مع "تطبيق على الأفراد أيضاً": نضيف للأسرة مباشرة + نوزع نفس النقاط على الأفراد أيضاً
        await run(`
          INSERT INTO group_points_adjustments (group_id, points, apply_to_members, reason, adjusted_by)
          VALUES (${groupId}, ${points}, 1, '${safeReason} (إضافة الأسرة)', ${adjBy})
        `);

        for (let i = 0; i < members.length; i++) {
          const member = members[i];
          const add = pointsPerMember + (i < remainder ? 1 : 0);
          if (add >= 1) {
            await run(`
              INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
              VALUES (${member.id}, ${add}, '${safeReason} (إضافة للأفراد)', ${adjBy})
            `);
          }
        }
      } else {
        // خصم مع "تطبيق على الأفراد": نخصم من نقاط الأسرة المباشرة (نفس العملية) + نخصم من الطلاب أيضاً
        const groupDirect = await queryOne(`
          SELECT COALESCE(SUM(points), 0) as total
          FROM group_points_adjustments
          WHERE group_id = ${groupId}
        `);
        const directTotal = Number(groupDirect?.total ?? 0);
        if (points > directTotal) {
          return res.status(400).json({
            success: false,
            message: `نقاط الأسرة المباشرة (${directTotal}) أقل من المطلوب خصمه (${points}).`
          });
        }
        // خصم الأسرة (مباشر) دائماً عند apply_to_members
        await run(`
          INSERT INTO group_points_adjustments (group_id, points, apply_to_members, reason, adjusted_by)
          VALUES (${groupId}, ${-points}, 1, '${safeReason} (خصم الأسرة)', ${adjBy})
        `);

        // خصم الطلاب: توزيع عادل + إعادة توزيع العجز على من يملك نقاطاً
        const intendedById = new Map();
        const deductedById = new Map();
        for (let i = 0; i < members.length; i++) {
          const intended = pointsPerMember + (i < remainder ? 1 : 0);
          intendedById.set(members[i].id, intended);
          deductedById.set(members[i].id, 0);
        }

        // pass 1: طبق الحصص الأساسية بحد أقصى نقاط الطالب
        let shortfall = 0;
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          const memberPoints = Math.max(0, Number.parseInt(m.total_points, 10) || 0);
          const intended = intendedById.get(m.id) || 0;
          const deduct = Math.min(intended, memberPoints);
          if (deduct >= 1) {
            await run(`
              INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
              VALUES (${m.id}, ${-deduct}, '${safeReason} (خصم الأفراد)', ${adjBy})
            `);
            deductedById.set(m.id, deduct);
          }
          shortfall += (intended - deduct);
        }

        // pass 2: إعادة توزيع العجز على الطلاب القادرين (حتى نصل لنفس إجمالي الخصم إن أمكن)
        if (shortfall > 0) {
          for (let i = 0; i < members.length && shortfall > 0; i++) {
            const m = members[i];
            const memberPoints = Math.max(0, Number.parseInt(m.total_points, 10) || 0);
            const already = deductedById.get(m.id) || 0;
            const remainingCapacity = Math.max(0, memberPoints - already);
            const extra = Math.min(remainingCapacity, shortfall);
            if (extra >= 1) {
              await run(`
                INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
                VALUES (${m.id}, ${-extra}, '${safeReason} (إكمال خصم الأفراد)', ${adjBy})
              `);
              deductedById.set(m.id, already + extra);
              shortfall -= extra;
            }
          }
        }
      }
    } else {
      if (action === 'subtract') {
        const groupDirect = await queryOne(`SELECT COALESCE(SUM(points), 0) as total FROM group_points_adjustments WHERE group_id = ${groupId}`);
        const directTotal = groupDirect?.total || 0;
        if (points > directTotal) {
          return res.status(400).json({ success: false, message: `نقاط الأسرة المباشرة (${directTotal}) أقل من المطلوب خصمه (${points}). استخدم "خصم من الأفراد أيضاً" لخصم من نقاط الطلاب.` });
        }
      }
      await run(`
        INSERT INTO group_points_adjustments (group_id, points, apply_to_members, reason, adjusted_by)
        VALUES (${groupId}, ${actualPoints}, 0, '${safeReason}', ${adjBy})
      `);
    }

    try {
      await run(`
        INSERT INTO points_log (operation_type, target_type, target_id, group_id, points, reason, performed_by)
        VALUES ('${action}', 'group', ${groupId}, ${groupId}, ${points}, '${safeReason}', ${adjBy})
      `);
    } catch (e) { /* points_log اختياري */ }

    // إشعارات داخل التطبيق لأعضاء الأسرة
    const members = await queryAll(`
      SELECT id FROM users WHERE group_id = ${groupId} AND role = 'student'
    `);
    const notifTitle = action === 'add' ? 'تم إضافة نقاط للأسرة 🎉' : 'تم خصم نقاط من الأسرة ⚠️';
    const notifMessage = action === 'add'
      ? `حصلت أسرتك "${(group.name || '').replace(/'/g, "''")}" على ${points} نقاط${apply_to_members ? ' (موزعة على الأفراد)' : ''}`
      : `تم خصم ${points} نقاط من أسرتك "${(group.name || '').replace(/'/g, "''")}"${apply_to_members ? ' (من الأفراد)' : ''}`;
    for (const m of members) {
      try {
        await run(`
          INSERT INTO notifications (user_id, title, message)
          VALUES (${m.id}, '${notifTitle}', '${notifMessage}')
        `);
      } catch (e) { /* تجاهل */ }
    }

    return res.json({ success: true, message: `تم ${action === 'add' ? 'إضافة' : 'خصم'} ${points} نقاط ${apply_to_members ? '(موزعة على الأفراد)' : '(للأسرة مباشرة)'}` });
  } catch (error) {
    console.error('groups/:id/points error:', error);
    return res.status(400).json({ success: false, message: error.message || 'حدث خطأ أثناء تنفيذ العملية' });
  }
});

// زيادة أو خصم مئوي للأسرة
app.post('/api/groups/:id/percentage', async (req, res) => {
  const { percentage, apply_to_members, reason, reviewer_id, action } = req.body;

  if (!percentage || percentage <= 0) {
    return res.status(400).json({ success: false, message: 'يجب تحديد نسبة صحيحة' });
  }

  const isSubtract = action === 'subtract';

  try {
    const group = await queryOne(`SELECT * FROM groups WHERE id = ${req.params.id}`);
    if (!group) {
      return res.status(404).json({ success: false, message: 'الأسرة غير موجودة' });
    }

    const safeReason = (reason || `${isSubtract ? 'خصم' : 'زيادة'} ${percentage}%`).replace(/'/g, "''");

    const members = await queryAll(`
      SELECT u.id, u.name,
        (COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u.id AND status = 'approved'), 0) +
         COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u.id), 0)) as total_points
      FROM users u WHERE u.group_id = ${req.params.id} AND u.role = 'student'
    `);
    const membersTotal = members.reduce((sum, m) => sum + (Number(m.total_points) || 0), 0);
    const directPoints = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM group_points_adjustments
      WHERE group_id = ${req.params.id}
    `);
    const directTotal = Number(directPoints?.total ?? 0);
    // النسبة تُحسب للأسرة من نقاطها المباشرة فقط، وللطلاب من نقاط كل طالب
    const directDelta = Math.floor((directTotal * percentage) / 100);

    if (isSubtract) {
      if (apply_to_members) {
        // خصم من نقاط الأسرة المباشرة أيضاً (بالإضافة لخصم كل طالب من نقاطه)
        const pointsToDeduct = Math.min(directDelta, directTotal);
        if (pointsToDeduct >= 1) {
          await run(`
            INSERT INTO group_points_adjustments (group_id, points, percentage, is_percentage, apply_to_members, reason, adjusted_by)
            VALUES (${req.params.id}, ${-pointsToDeduct}, ${percentage}, 1, 1, '${safeReason} (خصم الأسرة)', ${reviewer_id || 'NULL'})
          `);
        }

        for (const member of members) {
          const change = Math.floor((member.total_points * percentage) / 100);
          if (change >= 1 && member.total_points >= change) {
            await run(`
              INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
              VALUES (${member.id}, ${-change}, '${safeReason}', ${reviewer_id || 'NULL'})
            `);
          }
        }
      } else {
        // خصم بدون تطبيق على الأفراد = النسبة من نقاط الأسرة المباشرة فقط (لا نستخدم groupTotal هنا)
        const pointsToDeduct = Math.min(directDelta, directTotal);
        if (pointsToDeduct >= 1) {
          await run(`
            INSERT INTO group_points_adjustments (group_id, points, percentage, is_percentage, apply_to_members, reason, adjusted_by)
            VALUES (${req.params.id}, ${-pointsToDeduct}, ${percentage}, 1, 0, '${safeReason}', ${reviewer_id || 'NULL'})
          `);
        }
      }
    } else {
      // زيادة: نضيف النسبة على نقاط الأسرة المباشرة، وإذا apply_to_members نضيف أيضاً على نقاط كل طالب
      if (directDelta >= 1) {
        await run(`
          INSERT INTO group_points_adjustments (group_id, points, percentage, is_percentage, apply_to_members, reason, adjusted_by)
          VALUES (${req.params.id}, ${directDelta}, ${percentage}, 1, ${apply_to_members ? 1 : 0}, '${safeReason}', ${reviewer_id || 'NULL'})
        `);
      }
      if (apply_to_members) {
        for (const member of members) {
          const change = Math.floor((member.total_points * percentage) / 100);
          if (change >= 1) {
            await run(`
              INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
              VALUES (${member.id}, ${change}, '${safeReason}', ${reviewer_id || 'NULL'})
            `);
          }
        }
      }
    }

    try {
      await run(`
        INSERT INTO points_log (operation_type, target_type, target_id, group_id, percentage, reason, performed_by)
        VALUES ('percentage_${action}', 'group', ${req.params.id}, ${req.params.id}, ${percentage}, '${safeReason}', ${reviewer_id || 'NULL'})
      `);
    } catch (e) { /* ignore */ }

    res.json({ success: true, message: action === 'subtract' ? 'تم تطبيق الخصم المئوي بنجاح' : 'تم تطبيق الزيادة المئوية بنجاح' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ==================== Users Routes ====================

// جلب كل المشرفين
app.get('/api/supervisors', async (req, res) => {
  const supervisors = await queryAll(`
    SELECT id, name, code, created_at FROM users WHERE role = 'supervisor'
  `);
  res.json(supervisors);
});

// إنشاء مشرف جديد
app.post('/api/supervisors', async (req, res) => {
  const { name } = req.body;
  const code = await generateCode();
  try {
    await run(`INSERT INTO users (name, code, role) VALUES ('${name}', '${code}', 'supervisor')`);
    const id = await getLastInsertId();
    res.json({ success: true, id, code });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الإنشاء' });
  }
});

// حذف مشرف
app.delete('/api/supervisors/:id', async (req, res) => {
  try {
    await run(`DELETE FROM users WHERE id = ${req.params.id} AND role = 'supervisor'`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الحذف' });
  }
});

// جلب كل الطلاب
app.get('/api/students', async (req, res) => {
  const students = await queryAll(`
    SELECT u.id, u.name, u.code, u.group_id, g.name as group_name, u.created_at,
    COALESCE(u.points_hidden, 0) as points_hidden,
    (COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u.id AND status = 'approved'), 0) +
     COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u.id), 0)) as total_points
    FROM users u
    LEFT JOIN groups g ON u.group_id = g.id
    WHERE u.role = 'student'
  `);
  res.json(students);
});

// إنشاء طالب جديد
app.post('/api/students', async (req, res) => {
  const { name, group_id } = req.body;
  const code = await generateCode();
  try {
    const groupVal = group_id ? group_id : 'NULL';
    await run(`INSERT INTO users (name, code, role, group_id) VALUES ('${name}', '${code}', 'student', ${groupVal})`);
    const id = await getLastInsertId();

    // جلب اسم الأسرة إذا وجدت
    let groupName = null;
    if (group_id) {
      const group = await queryOne(`SELECT name FROM groups WHERE id = ${group_id}`);
      groupName = group ? group.name : null;
    }

    // إرسال إشعار للطالب الجديد
    await notifyNewStudent(id, name, code);

    // إنشاء إشعار ترحيبي في قاعدة البيانات
    await run(`
      INSERT INTO notifications (user_id, title, message)
      VALUES (${id}, 'مرحباً بك في نظام سلطان! 🎉', 'أهلاً ${name}! رمز دخولك هو: ${code}')
    `);

    // إشعار المشرفين والأدمن
    const supervisors = await queryAll(`SELECT id FROM users WHERE role = 'supervisor'`);
    const admins = await queryAll(`SELECT id FROM users WHERE role = 'admin'`);
    await notifyNewStudentToSupervisors(name, groupName, supervisors.map(s => s.id), admins.map(a => a.id));

    res.json({ success: true, id, code });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الإنشاء' });
  }
});

// تعديل طالب
app.put('/api/students/:id', async (req, res) => {
  const { name, group_id } = req.body;
  try {
    // جلب بيانات الطالب الحالية
    const currentStudent = await queryOne(`
      SELECT u.group_id, g.name as group_name
      FROM users u
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE u.id = ${req.params.id}
    `);

    const groupVal = group_id ? group_id : 'NULL';
    await run(`UPDATE users SET name = '${name}', group_id = ${groupVal} WHERE id = ${req.params.id}`);

    // إذا تغيرت الأسرة، أرسل إشعار
    if (currentStudent && String(currentStudent.group_id) !== String(group_id)) {
      let newGroupName = null;
      if (group_id) {
        const newGroup = await queryOne(`SELECT name FROM groups WHERE id = ${group_id}`);
        newGroupName = newGroup ? newGroup.name : null;
      }

      if (newGroupName) {
        await notifyGroupChanged(req.params.id, newGroupName, currentStudent.group_name);

        // إنشاء إشعار في قاعدة البيانات
        const message = currentStudent.group_name
          ? `تم نقلك من أسرة "${currentStudent.group_name}" إلى أسرة "${newGroupName}"`
          : `تم إضافتك إلى أسرة "${newGroupName}"`;

        await run(`
          INSERT INTO notifications (user_id, title, message)
          VALUES (${req.params.id}, 'تغيير الأسرة 👥', '${message.replace(/'/g, "''")}')
        `);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في التعديل' });
  }
});

// حذف طالب
app.delete('/api/students/:id', async (req, res) => {
  try {
    await run(`DELETE FROM users WHERE id = ${req.params.id} AND role = 'student'`);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الحذف' });
  }
});

// تعديل نقاط طالب (إضافة أو خصم)
app.post('/api/students/:id/points', async (req, res) => {
  const { points, action, reason, reviewer_id } = req.body;
  // action: 'add' للإضافة أو 'subtract' للخصم

  if (!points || points < 1) {
    return res.status(400).json({ success: false, message: 'يجب تحديد عدد النقاط' });
  }

  try {
    // التأكد من وجود جدول التعديلات اليدوية
    await run(`
      CREATE TABLE IF NOT EXISTS points_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        points INTEGER NOT NULL,
        reason TEXT,
        adjusted_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, false);

    // جلب النقاط الحالية (من الطلبات + التعديلات اليدوية)
    const requestsPoints = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM requests
      WHERE student_id = ${req.params.id} AND status = 'approved'
    `);

    let adjustmentsTotal = 0;
    try {
      const adjustmentsPoints = await queryOne(`
        SELECT COALESCE(SUM(points), 0) as total
        FROM points_adjustments
        WHERE student_id = ${req.params.id}
      `);
      adjustmentsTotal = adjustmentsPoints?.total || 0;
    } catch (e) {
      // الجدول قد لا يكون موجوداً بعد
      adjustmentsTotal = 0;
    }

    const currentPoints = (requestsPoints?.total || 0) + adjustmentsTotal;

    // التحقق من إمكانية الخصم
    if (action === 'subtract' && currentPoints < points) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن خصم ${points} نقاط. الطالب لديه ${currentPoints} نقاط فقط`
      });
    }

    const actualPoints = action === 'subtract' ? -points : points;
    const safeReason = (reason || (action === 'add' ? 'إضافة نقاط يدوية' : 'خصم نقاط يدوي')).replace(/'/g, "''");

    // إنشاء سجل تعديل النقاط في الجدول الجديد
    await run(`
      INSERT INTO points_adjustments (student_id, points, reason, adjusted_by)
      VALUES (${req.params.id}, ${actualPoints}, '${safeReason}', ${reviewer_id})
    `);

    // إعدادات: صب التعديلات اليدوية/الإضافة التلقائية للأسرة
    try {
      const student = await queryOne(`SELECT group_id FROM users WHERE id = ${req.params.id}`);
      const groupId = student?.group_id;
      if (groupId) {
        const pourManual = await getSettingBool('pour_manual_adjustments_to_group', false);
        const pourAddOnly = await getSettingBool('auto_pour_add_points_to_group', false);
        const shouldPour =
          pourManual
            ? true
            : (pourAddOnly && action === 'add');

        if (shouldPour) {
          await run(`
            INSERT INTO group_points_adjustments (group_id, points, apply_to_members, reason, adjusted_by)
            VALUES (${groupId}, ${actualPoints}, 0, '${safeReason} (صب تلقائي للأسرة)', ${reviewer_id})
          `);
        }
      }
    } catch (e) { /* ignore */ }

    // حساب النقاط الجديدة
    const newPoints = currentPoints + actualPoints;

    // تحديد نوع الوقود بناءً على النقاط (الحد الأقصى 5)
    const fuelLevel = Math.min(Math.max(newPoints, 0), 5);
    const fuelType = fuelLevel > 0 ? pointsToFuel(fuelLevel) : { name: 'لا يوجد', emoji: '⚫' };

    // إرسال إشعار للطالب
    if (action === 'add') {
      await notifyPointsAdded(req.params.id, points, newPoints, fuelType.name, fuelType.emoji, reason);
    } else {
      await notifyPointsSubtracted(req.params.id, points, newPoints, fuelType.name, fuelType.emoji, reason);
    }

    // إنشاء إشعار في قاعدة البيانات أيضاً
    const notifTitle = action === 'add' ? 'تم إضافة نقاط ➕' : 'تم خصم نقاط ➖';
    const notifMessage = action === 'add'
      ? `حصلت على ${points} نقاط! وقودك الآن: ${fuelType.emoji} ${fuelType.name}`
      : `تم خصم ${points} نقاط. وقودك الآن: ${fuelType.emoji} ${fuelType.name}`;

    await run(`
      INSERT INTO notifications (user_id, title, message)
      VALUES (${req.params.id}, '${notifTitle}', '${notifMessage.replace(/'/g, "''")}')
    `);

    res.json({
      success: true,
      total_points: newPoints,
      fuel_type: fuelType.name,
      fuel_emoji: fuelType.emoji
    });
  } catch (error) {
    console.error('خطأ في تعديل النقاط:', error.message, error.stack);
    res.status(400).json({ success: false, message: 'حدث خطأ في تعديل النقاط: ' + error.message });
  }
});

// تبديل حالة إخفاء النقاط للطالب
app.post('/api/students/:id/toggle-points-visibility', async (req, res) => {
  const { hidden, reason } = req.body;

  try {
    // تحديث حالة إخفاء النقاط
    await run(`UPDATE users SET points_hidden = ${hidden ? 1 : 0} WHERE id = ${req.params.id}`);

    // جلب اسم الطالب
    const student = await queryOne(`SELECT name FROM users WHERE id = ${req.params.id}`);

    // إرسال إشعار للطالب
    await notifyPointsVisibilityChanged(req.params.id, hidden, reason);

    // إنشاء إشعار في قاعدة البيانات
    const notifTitle = hidden ? 'تم إخفاء نقاطك 🚫' : 'تم إظهار نقاطك ✅';
    const notifMessage = hidden
      ? `تم منعك من رؤية نقاطك مؤقتاً${reason ? '. السبب: ' + reason : ''}`
      : 'يمكنك الآن رؤية نقاطك مرة أخرى';

    await run(`
      INSERT INTO notifications (user_id, title, message)
      VALUES (${req.params.id}, '${notifTitle}', '${notifMessage.replace(/'/g, "''")}')
    `);

    res.json({ success: true, points_hidden: hidden });
  } catch (error) {
    console.error('خطأ في تغيير حالة إخفاء النقاط:', error);
    res.status(400).json({ success: false, message: 'حدث خطأ' });
  }
});

// ==================== Requests Routes ====================

// جلب طلبات طالب معين
app.get('/api/requests/student/:studentId', async (req, res) => {
  const requests = await queryAll(`
    SELECT r.*, u.name as reviewer_name
    FROM requests r
    LEFT JOIN users u ON r.reviewed_by = u.id
    WHERE r.student_id = ${req.params.studentId}
    ORDER BY r.created_at DESC
  `);
  res.json(requests);
});

// جلب كل الطلبات (للمشرف)
app.get('/api/requests', async (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT r.*, u.name as student_name, g.name as group_name, rev.name as reviewer_name
    FROM requests r
    JOIN users u ON r.student_id = u.id
    LEFT JOIN groups g ON u.group_id = g.id
    LEFT JOIN users rev ON r.reviewed_by = rev.id
  `;

  if (status) {
    query += ` WHERE r.status = '${status}'`;
  }
  query += ' ORDER BY r.created_at DESC';

  const requests = await queryAll(query);
  res.json(requests);
});

// إنشاء طلب جديد
app.post('/api/requests', async (req, res) => {
  const { student_id, committee, description, points } = req.body;

  // التحقق من الحد الأسبوعي
  const weekNumber = getWeekNumber();
  const currentWeekRequests = await queryOne(`
    SELECT COUNT(*) as count FROM requests
    WHERE student_id = ${student_id} AND week_number = ${weekNumber}
  `);

  if (currentWeekRequests && currentWeekRequests.count >= 20) {
    return res.status(400).json({
      success: false,
      message: 'وصلت للحد الأقصى من الطلبات هذا الأسبوع (20 طلب)'
    });
  }

  try {
    const safeDesc = description.replace(/'/g, "''");
    await run(`
      INSERT INTO requests (student_id, committee, description, points, week_number)
      VALUES (${student_id}, '${committee}', '${safeDesc}', ${points}, ${weekNumber})
    `);
    const id = await getLastInsertId();

    // إرسال إشعار للمشرفين والأدمن بوجود طلب جديد
    const student = await queryOne(`SELECT name FROM users WHERE id = ${student_id}`);

    // جلب معرفات المشرفين والأدمن
    const supervisors = await queryAll(`SELECT id FROM users WHERE role = 'supervisor'`);
    const admins = await queryAll(`SELECT id FROM users WHERE role = 'admin'`);
    const supervisorIds = supervisors.map(s => s.id);
    const adminIds = admins.map(a => a.id);

    await notifyNewRequest(student ? student.name : 'طالب', supervisorIds, adminIds);

    // التحقق إذا وصل للحد الأسبوعي بعد هذا الطلب
    const newCount = (currentWeekRequests?.count || 0) + 1;
    if (newCount >= 20) {
      await notifyWeeklyLimitReached(student_id);
      await run(`
        INSERT INTO notifications (user_id, title, message)
        VALUES (${student_id}, 'وصلت للحد الأسبوعي ⚠️', 'لقد وصلت للحد الأقصى من الطلبات هذا الأسبوع (20 طلب). انتظر الأسبوع القادم!')
      `);
    }

    res.json({ success: true, id });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في إنشاء الطلب' });
  }
});

// قبول طلب
app.post('/api/requests/:id/approve', async (req, res) => {
  const { reviewer_id } = req.body;
  try {
    await run(`
      UPDATE requests
      SET status = 'approved', reviewed_by = ${reviewer_id}, reviewed_at = datetime('now')
      WHERE id = ${req.params.id}
    `);

    // إنشاء إشعار للطالب
    const request = await queryOne(`SELECT student_id, points FROM requests WHERE id = ${req.params.id}`);
    const fuel = pointsToFuel(request.points);
    await run(`
      INSERT INTO notifications (user_id, title, message)
      VALUES (${request.student_id}, 'تم قبول طلبك ✅', 'حصلت على 1 لتر ${fuel.name} ${fuel.emoji}')
    `);

    // إعدادات: صب الطلبات المقبولة لنقاط الأسرة المباشرة
    try {
      const pourApproved = await getSettingBool('pour_approved_requests_to_group', false);
      if (pourApproved) {
        const st = await queryOne(`SELECT group_id FROM users WHERE id = ${request.student_id}`);
        if (st?.group_id) {
          await run(`
            INSERT INTO group_points_adjustments (group_id, points, apply_to_members, reason, adjusted_by)
            VALUES (${st.group_id}, ${request.points}, 0, 'صب طلب مقبول (تلقائي)', ${reviewer_id})
          `);
        }
      }
    } catch (e) { /* ignore */ }

    // إرسال Push Notification
    await notifyRequestApproved(request.student_id, fuel.name, fuel.emoji);

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ' });
  }
});

// رفض طلب
app.post('/api/requests/:id/reject', async (req, res) => {
  const { reviewer_id, rejection_reason } = req.body;
  try {
    const reason = rejection_reason ? `'${rejection_reason.replace(/'/g, "''")}'` : 'NULL';
    await run(`
      UPDATE requests
      SET status = 'rejected', reviewed_by = ${reviewer_id}, reviewed_at = datetime('now'), rejection_reason = ${reason}
      WHERE id = ${req.params.id}
    `);

    // إنشاء إشعار للطالب
    const request = await queryOne(`SELECT student_id FROM requests WHERE id = ${req.params.id}`);
    const message = rejection_reason ? `السبب: ${rejection_reason}` : 'لم يتم تحديد سبب';
    await run(`
      INSERT INTO notifications (user_id, title, message)
      VALUES (${request.student_id}, 'تم رفض طلبك ❌', '${message.replace(/'/g, "''")}')
    `);

    // إرسال Push Notification
    await notifyRequestRejected(request.student_id, rejection_reason);

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ' });
  }
});

// ==================== Stats Routes ====================

// إحصائيات طالب
app.get('/api/stats/student/:studentId', async (req, res) => {
  const approvedSum = await queryOne(`
    SELECT COALESCE(SUM(points), 0) as total
    FROM requests
    WHERE student_id = ${req.params.studentId} AND status = 'approved'
  `);
  const adjustmentsSum = await queryOne(`
    SELECT COALESCE(SUM(points), 0) as total
    FROM points_adjustments
    WHERE student_id = ${req.params.studentId}
  `);
  const totalPoints = Number(approvedSum?.total ?? 0) + Number(adjustmentsSum?.total ?? 0);
  const fuel = pointsToFuelTanks(totalPoints);

  const weekNumber = getWeekNumber();
  const weeklyRequests = await queryOne(`
    SELECT COUNT(*) as count FROM requests
    WHERE student_id = ${req.params.studentId} AND week_number = ${weekNumber}
  `);

  res.json({
    fuel,
    totalLiters: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol,
    total_points: totalPoints,
    weeklyRequestsCount: weeklyRequests ? weeklyRequests.count : 0,
    weeklyRequestsLimit: 20
  });
});

// إحصائيات أسرة
app.get('/api/stats/group/:groupId', async (req, res) => {
  const membersRequestsSum = await queryOne(`
    SELECT COALESCE(SUM(r.points), 0) as total
    FROM requests r
    JOIN users u ON r.student_id = u.id
    WHERE u.group_id = ${req.params.groupId} AND r.status = 'approved'
  `);
  const membersAdjustmentsSum = await queryOne(`
    SELECT COALESCE(SUM(pa.points), 0) as total
    FROM points_adjustments pa
    JOIN users u ON pa.student_id = u.id
    WHERE u.group_id = ${req.params.groupId}
  `);
  const directAdjustmentsSum = await queryOne(`
    SELECT COALESCE(SUM(points), 0) as total
    FROM group_points_adjustments
    WHERE group_id = ${req.params.groupId}
  `);
  const totalPoints =
    Number(membersRequestsSum?.total ?? 0) +
    Number(membersAdjustmentsSum?.total ?? 0) +
    Number(directAdjustmentsSum?.total ?? 0);

  const fuel = pointsToFuelTanks(totalPoints);
  res.json({
    fuel,
    totalLiters: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol,
    total_points: totalPoints
  });
});

// إحصائيات عامة
app.get('/api/stats/overview', async (req, res) => {
  const totalStudents = await queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'student'");
  const totalGroups = await queryOne("SELECT COUNT(*) as count FROM groups");
  const totalRequests = await queryOne("SELECT COUNT(*) as count FROM requests");
  const pendingRequests = await queryOne("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");
  const approvedRequests = await queryOne("SELECT COUNT(*) as count FROM requests WHERE status = 'approved'");
  const rejectedRequests = await queryOne("SELECT COUNT(*) as count FROM requests WHERE status = 'rejected'");

  res.json({
    totalStudents: totalStudents ? totalStudents.count : 0,
    totalGroups: totalGroups ? totalGroups.count : 0,
    totalRequests: totalRequests ? totalRequests.count : 0,
    pendingRequests: pendingRequests ? pendingRequests.count : 0,
    approvedRequests: approvedRequests ? approvedRequests.count : 0,
    rejectedRequests: rejectedRequests ? rejectedRequests.count : 0
  });
});

// ==================== Notifications Routes ====================

// جلب إشعارات مستخدم (آخر 100)
app.get('/api/notifications/:userId', async (req, res) => {
  const notifications = await queryAll(`
    SELECT * FROM notifications WHERE user_id = ${req.params.userId} ORDER BY created_at DESC LIMIT 100
  `);
  res.json(notifications);
});

// تحديد الإشعارات كمقروءة
app.post('/api/notifications/:userId/read', async (req, res) => {
  await run(`UPDATE notifications SET is_read = 1 WHERE user_id = ${req.params.userId}`);
  res.json({ success: true });
});

// عدد الإشعارات غير المقروءة
app.get('/api/notifications/:userId/unread-count', async (req, res) => {
  const count = await queryOne(`
    SELECT COUNT(*) as count FROM notifications WHERE user_id = ${req.params.userId} AND is_read = 0
  `);
  res.json({ count: count ? count.count : 0 });
});

// ==================== Reports Routes ====================

// تقرير أسبوعي
app.get('/api/reports/weekly', async (req, res) => {
  const { week } = req.query;
  const weekNumber = week || getWeekNumber();

  const report = await queryAll(`
    SELECT
      u.name as student_name,
      g.name as group_name,
      r.committee,
      r.points,
      r.status,
      r.created_at
    FROM requests r
    JOIN users u ON r.student_id = u.id
    LEFT JOIN groups g ON u.group_id = g.id
    WHERE r.week_number = ${weekNumber}
    ORDER BY r.created_at DESC
  `);

  res.json({ weekNumber, data: report });
});

// ==================== PDF Export ====================

// دالة رسم خزان الوقود في PDF (أسماء عربية + لترات)
function drawFuelTank(doc, x, y, liters, name, color) {
  const tankWidth = 60;
  const tankHeight = 120;
  const cycleSize = 20;
  const stars = Math.floor(liters / cycleSize);
  const currentFill = liters % cycleSize;
  const fillPercent = currentFill / cycleSize;
  const fillHeight = tankHeight * fillPercent;

  // رسم إطار الخزان
  doc.rect(x, y, tankWidth, tankHeight)
     .lineWidth(2)
     .stroke('#cccccc');

  // رسم مستوى الوقود
  if (fillHeight > 0) {
    doc.rect(x + 2, y + tankHeight - fillHeight + 2, tankWidth - 4, fillHeight - 4)
       .fill(color);
  }

  // رسم الرقم داخل الخزان
  doc.fillColor('#333333')
     .fontSize(16)
     .text(currentFill.toString(), x, y + tankHeight/2 - 8, { width: tankWidth, align: 'center' });

  // اسم الوقود
  try { doc.font('Arabic'); } catch (e) { /* إذا لم يُسجل الخط */ }
  doc.fillColor(color)
     .fontSize(12)
     .text(name, x, y + tankHeight + 10, { width: tankWidth, align: 'center', features: ['rtla'] });

  // عدد اللترات الإجمالي
  doc.fillColor('#666666')
     .fontSize(10)
     .text(`${liters} لتر`, x, y + tankHeight + 25, { width: tankWidth, align: 'center', features: ['rtla'] });

  // النجوم
  if (stars > 0) {
    const starsText = stars <= 5 ? '★'.repeat(stars) : `★x${stars}`;
    doc.fillColor('#f59e0b')
       .fontSize(10)
       .text(starsText, x, y + tankHeight + 40, { width: tankWidth, align: 'center' });
  }

  doc.fillColor('#000000'); // إعادة اللون الافتراضي
}

// هيدر عربي موحّد لكل التقارير
function setupArabicHeader(doc, title) {
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    try { doc.font('Arabic'); } catch (e) { /* تجاهل */ }
  }
  doc.fontSize(28)
     .fillColor('#09637E')
     .text('طاقات السلطان', { align: 'center', features: ['rtla'] });

  doc.moveDown(0.3);
  doc.fontSize(14)
     .fillColor('#0f172a')
     .text('النظام التحفيزي للطلاب', { align: 'center', features: ['rtla'] });

  doc.moveDown(1.0);
  doc.fontSize(18)
     .fillColor('#1e293b')
     .text(title, { align: 'center', features: ['rtla'] });

  doc.moveDown(1.2);
}

// تصدير PDF لطالب معين
app.get('/api/export/student/:studentId', async (req, res) => {
  const student = await queryOne(`
    SELECT u.*, g.name as group_name FROM users u
    LEFT JOIN groups g ON u.group_id = g.id
    WHERE u.id = ${req.params.studentId}
  `);

  if (!student) {
    return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
  }

  const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
  const approvedRequests = await queryAll(`
    SELECT points FROM requests WHERE student_id = ${req.params.studentId} AND status = 'approved'
  `);

  approvedRequests.forEach(r => {
    switch(r.points) {
      case 1: fuel.diesel++; break;
      case 2: fuel.fuel91++; break;
      case 3: fuel.fuel95++; break;
      case 4: fuel.fuel98++; break;
      case 5: fuel.ethanol++; break;
    }
  });

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  // افتراضياً: عرض داخل المتصفح. لإجبار التحميل: ?download=1
  const studentFilename = `student_${student.id}_report.pdf`;
  const studentDisposition = (req.query.download === '1' || req.query.download === 'true')
    ? `attachment; filename=${studentFilename}`
    : `inline; filename=${studentFilename}`;
  res.setHeader('Content-Disposition', studentDisposition);
  res.setHeader('Cache-Control', 'no-store');

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // العنوان
  setupArabicHeader(doc, 'تقرير الطالب');

  // بطاقة ملخص الطالب
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.font('Arabic');
  }
  const pageWidth = doc.page.width;
  const cardMarginX = 50;
  const cardWidth = pageWidth - cardMarginX * 2;
  const cardStartY = doc.y;
  const cardHeight = 70;

  doc.roundedRect(cardMarginX, cardStartY, cardWidth, cardHeight, 10)
     .lineWidth(1)
     .stroke('#e2e8f0');

  doc.fontSize(18).fillColor('#0f172a')
     .text(student.name, cardMarginX + 12, cardStartY + 10, {
       width: cardWidth - 24,
       align: 'right',
       features: ['rtla']
     });

  let summaryLine = '';
  if (student.group_name) {
    summaryLine = `أسرة: ${student.group_name}`;
  }
  const totalLiters = fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol;
  if (summaryLine) {
    summaryLine += `   •   إجمالي اللترات: ${totalLiters} لتر`;
  } else {
    summaryLine = `إجمالي اللترات: ${totalLiters} لتر`;
  }

  doc.fontSize(12).fillColor('#64748b')
     .text(summaryLine, cardMarginX + 12, cardStartY + 40, {
       width: cardWidth - 24,
       align: 'right',
       features: ['rtla']
     });

  // تحريك المؤشر أسفل البطاقة
  doc.y = cardStartY + cardHeight + 25;

  // رسم الخزانات
  const startX = 80;
  const tankY = doc.y;
  const tankSpacing = 90;

  drawFuelTank(doc, startX, tankY, fuel.diesel, 'ديزل', '#8B7355');
  drawFuelTank(doc, startX + tankSpacing, tankY, fuel.fuel91, '٩١', '#22c55e');
  drawFuelTank(doc, startX + tankSpacing * 2, tankY, fuel.fuel95, '٩٥', '#ef4444');
  drawFuelTank(doc, startX + tankSpacing * 3, tankY, fuel.fuel98, '٩٨', '#888888');
  drawFuelTank(doc, startX + tankSpacing * 4, tankY, fuel.ethanol, 'إيثانول', '#3b82f6');

  // المجموع
  const total = totalLiters;
  doc.moveDown(9);
  doc.font('Arabic').fontSize(16).fillColor('#09637E').text(`المجموع: ${total} لتر`, { align: 'center', features: ['rtla'] });

  // التاريخ
  doc.moveDown(2);
  const dateStr = new Date().toLocaleDateString('ar-SA');
  doc.font('Arabic').fontSize(10).fillColor('#999999').text(`تاريخ الإصدار: ${dateStr}`, { align: 'center', features: ['rtla'] });

  doc.end();
});

// تصدير PDF لأسرة معينة
app.get('/api/export/group/:groupId', async (req, res) => {
  const group = await queryOne(`SELECT * FROM groups WHERE id = ${req.params.groupId}`);

  if (!group) {
    return res.status(404).json({ success: false, message: 'الأسرة غير موجودة' });
  }

  const students = await queryAll(`
    SELECT u.id, u.name FROM users u WHERE u.group_id = ${req.params.groupId} AND u.role = 'student'
  `);

  const studentsWithFuel = [];
  for (const student of students) {
    const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
    const approvedRequests = await queryAll(`
      SELECT points FROM requests WHERE student_id = ${student.id} AND status = 'approved'
    `);

    approvedRequests.forEach(r => {
      switch(r.points) {
        case 1: fuel.diesel++; break;
        case 2: fuel.fuel91++; break;
        case 3: fuel.fuel95++; break;
        case 4: fuel.fuel98++; break;
        case 5: fuel.ethanol++; break;
      }
    });

    studentsWithFuel.push({ ...student, fuel, total: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol });
  }

  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  // افتراضياً: عرض داخل المتصفح. لإجبار التحميل: ?download=1
  const groupFilename = `group_${group.id}_report.pdf`;
  const groupDisposition = (req.query.download === '1' || req.query.download === 'true')
    ? `attachment; filename=${groupFilename}`
    : `inline; filename=${groupFilename}`;
  res.setHeader('Content-Disposition', groupDisposition);
  res.setHeader('Cache-Control', 'no-store');

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // العنوان
  setupArabicHeader(doc, `تقرير أسرة: ${group.name}`);

  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.font('Arabic');
  }

  // حساب ملخص الأسرة (لترات إجمالية)
  const groupFuelTotals = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
  studentsWithFuel.forEach(s => {
    groupFuelTotals.diesel += s.fuel.diesel;
    groupFuelTotals.fuel91 += s.fuel.fuel91;
    groupFuelTotals.fuel95 += s.fuel.fuel95;
    groupFuelTotals.fuel98 += s.fuel.fuel98;
    groupFuelTotals.ethanol += s.fuel.ethanol;
  });
  const totalLitersGroup =
    groupFuelTotals.diesel +
    groupFuelTotals.fuel91 +
    groupFuelTotals.fuel95 +
    groupFuelTotals.fuel98 +
    groupFuelTotals.ethanol;

  // بطاقة ملخص الأسرة
  const pageWidthG = doc.page.width;
  const cardMarginXG = 45;
  const cardWidthG = pageWidthG - cardMarginXG * 2;
  const cardStartYG = doc.y;
  const cardHeightG = 80;

  doc.roundedRect(cardMarginXG, cardStartYG, cardWidthG, cardHeightG, 10)
     .lineWidth(1)
     .stroke('#e2e8f0');

  doc.fontSize(16).fillColor('#0f172a')
     .text(group.name, cardMarginXG + 12, cardStartYG + 10, {
       width: cardWidthG - 24,
       align: 'right',
       features: ['rtla']
     });

  doc.fontSize(12).fillColor('#64748b')
     .text(`عدد الطلاب: ${students.length}`, cardMarginXG + 12, cardStartYG + 36, {
       width: cardWidthG - 24,
       align: 'right',
       features: ['rtla']
     });
  doc.text(`إجمالي اللترات: ${totalLitersGroup} لتر`, cardMarginXG + 12, cardStartYG + 54, {
    width: cardWidthG - 24,
    align: 'right',
    features: ['rtla']
  });

  doc.y = cardStartYG + cardHeightG + 25;

  // خزانات الأسرة المجمّعة
  const groupStartX = 70;
  const groupTankY = doc.y;
  const groupTankSpacing = 80;

  drawFuelTank(doc, groupStartX, groupTankY, groupFuelTotals.diesel, 'ديزل', '#8B7355');
  drawFuelTank(doc, groupStartX + groupTankSpacing, groupTankY, groupFuelTotals.fuel91, '٩١', '#22c55e');
  drawFuelTank(doc, groupStartX + groupTankSpacing * 2, groupTankY, groupFuelTotals.fuel95, '٩٥', '#ef4444');
  drawFuelTank(doc, groupStartX + groupTankSpacing * 3, groupTankY, groupFuelTotals.fuel98, '٩٨', '#888888');
  drawFuelTank(doc, groupStartX + groupTankSpacing * 4, groupTankY, groupFuelTotals.ethanol, 'إيثانول', '#3b82f6');

  // الانتقال أسفل الخزانات
  doc.y = groupTankY + 170;
  doc.moveDown(0.5);

  // جدول الطلاب (رقم - اسم - لترات)
  const tableTop = doc.y;
  const pageHeight = doc.page.height - 60;
  const rowHeight = 20;

  function drawGroupTableHeader(y) {
    doc.font('Arabic').fontSize(12).fillColor('#0f172a');
    doc.text('#', 50, y, { width: 30, align: 'center' });
    doc.text('اسم الطالب', 90, y, { width: 260, align: 'right', features: ['rtla'] });
    doc.text('اللترات', 370, y, { width: 120, align: 'center' });
    doc.moveTo(45, y + rowHeight - 4).lineTo(pageWidthG - 45, y + rowHeight - 4).stroke('#e2e8f0');
  }

  let currentY = tableTop;
  drawGroupTableHeader(currentY);
  currentY += rowHeight;

  studentsWithFuel.forEach((s, index) => {
    if (currentY > pageHeight) {
      doc.addPage();
      if (fs.existsSync(ARABIC_FONT_PATH)) {
        doc.font('Arabic');
      }
      currentY = 50;
      drawGroupTableHeader(currentY);
      currentY += rowHeight;
    }

    doc.font('Arabic').fontSize(11).fillColor('#111827');
    doc.text(String(index + 1), 50, currentY, { width: 30, align: 'center' });
    doc.text(s.name, 90, currentY, { width: 260, align: 'right', features: ['rtla'] });
    doc.text(`${s.total} لتر`, 370, currentY, { width: 120, align: 'center', features: ['rtla'] });

    currentY += rowHeight;
  });

  // التاريخ أسفل آخر صفحة
  const dateStrGroup = new Date().toLocaleDateString('ar-SA');
  doc.font('Arabic').fontSize(10).fillColor('#999999')
     .text(`تاريخ الإصدار: ${dateStrGroup}`, 50, doc.page.height - 50, { features: ['rtla'] });

  doc.end();
});

// تصدير PDF لكل الطلاب
app.get('/api/export/all', async (req, res) => {
  const students = await queryAll(`
    SELECT u.id, u.name, g.name as group_name FROM users u
    LEFT JOIN groups g ON u.group_id = g.id
    WHERE u.role = 'student'
  `);

  const studentsWithFuel = [];
  for (const student of students) {
    const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
    const approvedRequests = await queryAll(`
      SELECT points FROM requests WHERE student_id = ${student.id} AND status = 'approved'
    `);

    approvedRequests.forEach(r => {
      switch(r.points) {
        case 1: fuel.diesel++; break;
        case 2: fuel.fuel91++; break;
        case 3: fuel.fuel95++; break;
        case 4: fuel.fuel98++; break;
        case 5: fuel.ethanol++; break;
      }
    });

    studentsWithFuel.push({ ...student, fuel, total: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol });
  }

  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  // افتراضياً: عرض داخل المتصفح. لإجبار التحميل: ?download=1
  const allFilename = 'all_students_report.pdf';
  const allDisposition = (req.query.download === '1' || req.query.download === 'true')
    ? `attachment; filename=${allFilename}`
    : `inline; filename=${allFilename}`;
  res.setHeader('Content-Disposition', allDisposition);
  res.setHeader('Cache-Control', 'no-store');

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // حساب الإحصائيات العامة
  const totalStudents = studentsWithFuel.length;
  const uniqueGroups = new Set(studentsWithFuel.map(s => s.group_name).filter(Boolean));
  const totalFuelTotals = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
  studentsWithFuel.forEach(s => {
    totalFuelTotals.diesel += s.fuel.diesel;
    totalFuelTotals.fuel91 += s.fuel.fuel91;
    totalFuelTotals.fuel95 += s.fuel.fuel95;
    totalFuelTotals.fuel98 += s.fuel.fuel98;
    totalFuelTotals.ethanol += s.fuel.ethanol;
  });
  const totalLitersAll =
    totalFuelTotals.diesel +
    totalFuelTotals.fuel91 +
    totalFuelTotals.fuel95 +
    totalFuelTotals.fuel98 +
    totalFuelTotals.ethanol;

  // العنوان
  setupArabicHeader(doc, 'تقرير جميع الطلاب');

  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.font('Arabic');
  }

  const pageWidthAll = doc.page.width;

  // بطاقة إحصائيات عامة
  const cardX = 45;
  const cardWidth = pageWidthAll - 90;
  const cardY = doc.y;
  const cardHeight = 80;
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 10)
     .lineWidth(1)
     .stroke('#e2e8f0');

  doc.fontSize(14).fillColor('#0f172a')
     .text(`عدد الطلاب: ${totalStudents}`, cardX + 12, cardY + 10, {
       width: cardWidth - 24,
       align: 'right',
       features: ['rtla']
     });
  doc.fontSize(12).fillColor('#64748b')
     .text(`عدد الأسر: ${uniqueGroups.size}`, cardX + 12, cardY + 32, {
       width: cardWidth - 24,
       align: 'right',
       features: ['rtla']
     });
  doc.text(`إجمالي اللترات: ${totalLitersAll} لتر`, cardX + 12, cardY + 50, {
    width: cardWidth - 24,
    align: 'right',
    features: ['rtla']
  });

  doc.y = cardY + cardHeight + 25;

  // خزانات عامة للنظام
  const tanksX = 70;
  const tanksY = doc.y;
  const tanksSpacing = 80;
  drawFuelTank(doc, tanksX, tanksY, totalFuelTotals.diesel, 'ديزل', '#8B7355');
  drawFuelTank(doc, tanksX + tanksSpacing, tanksY, totalFuelTotals.fuel91, '٩١', '#22c55e');
  drawFuelTank(doc, tanksX + tanksSpacing * 2, tanksY, totalFuelTotals.fuel95, '٩٥', '#ef4444');
  drawFuelTank(doc, tanksX + tanksSpacing * 3, tanksY, totalFuelTotals.fuel98, '٩٨', '#888888');
  drawFuelTank(doc, tanksX + tanksSpacing * 4, tanksY, totalFuelTotals.ethanol, 'إيثانول', '#3b82f6');

  // الانتقال أسفل الخزانات للجداول
  doc.y = tanksY + 170;
  doc.moveDown(0.5);

  // جدول الطلاب (يتوزع على عدّة صفحات)
  const tableTopAll = doc.y;
  const pageHeightAll = doc.page.height - 60;
  const rowHeightAll = 20;

  function drawAllTableHeader(y) {
    doc.font('Arabic').fontSize(12).fillColor('#0f172a');
    doc.text('#', 40, y, { width: 25, align: 'center' });
    doc.text('اسم الطالب', 75, y, { width: 200, align: 'right', features: ['rtla'] });
    doc.text('الأسرة', 285, y, { width: 140, align: 'right', features: ['rtla'] });
    doc.text('اللترات', 435, y, { width: 100, align: 'center', features: ['rtla'] });
    doc.moveTo(35, y + rowHeightAll - 4).lineTo(pageWidthAll - 35, y + rowHeightAll - 4).stroke('#e2e8f0');
  }

  let currentYAll = tableTopAll;
  drawAllTableHeader(currentYAll);
  currentYAll += rowHeightAll;

  studentsWithFuel.forEach((s, index) => {
    if (currentYAll > pageHeightAll) {
      doc.addPage();
      if (fs.existsSync(ARABIC_FONT_PATH)) {
        doc.font('Arabic');
      }
      currentYAll = 50;
      drawAllTableHeader(currentYAll);
      currentYAll += rowHeightAll;
    }

    doc.font('Arabic').fontSize(11).fillColor('#111827');
    doc.text(String(index + 1), 40, currentYAll, { width: 25, align: 'center' });
    doc.text(s.name, 75, currentYAll, { width: 200, align: 'right', features: ['rtla'] });
    doc.text(s.group_name || 'بدون أسرة', 285, currentYAll, { width: 140, align: 'right', features: ['rtla'] });
    doc.text(`${s.total} لتر`, 435, currentYAll, { width: 100, align: 'center', features: ['rtla'] });

    currentYAll += rowHeightAll;
  });

  // التاريخ أسفل آخر صفحة
  const allDateStr = new Date().toLocaleDateString('ar-SA');
  doc.font('Arabic').fontSize(10).fillColor('#999999')
     .text(`تاريخ الإصدار: ${allDateStr}`, 50, doc.page.height - 50, { features: ['rtla'] });

  doc.end();
});

// ==================== أي طلب لم يُطابق أي route (404 للـ API كـ JSON) ====================

app.all('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'مسار API غير موجود' });
  }
  next();
});

// معالج أخطاء عام (دائماً JSON)
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: err.message || 'خطأ في الخادم' });
  }
});

// ==================== Serve Frontend ====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// الحصول على عنوان IP المحلي للشبكة (لفتح الموقع من الجوال)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// تشغيل السيرفر
const startServer = async () => {
  await initDatabase();

  // تحذيرات تشغيل (Render / Production)
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    if (!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)) {
      console.warn('⚠️ تحذير: متغيرات TURSO غير مضبوطة. سيتم استخدام SQLite داخل الحاوية وقد تفقد البيانات بعد إعادة النشر.');
    }
    if (!process.env.ONESIGNAL_APP_ID) {
      console.warn('⚠️ تحذير: ONESIGNAL_APP_ID غير مضبوط. Push Notifications لن تعمل (لوحة الإشعارات داخل التطبيق ستبقى تعمل).');
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
    if (ip !== 'localhost') {
      console.log(`📱 للجوال على نفس الشبكة: http://${ip}:${PORT}`);
    }
    console.log('📊 نظام طاقات السلطان جاهز!');
  });
};

startServer();
