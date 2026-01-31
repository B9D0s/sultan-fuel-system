const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase, getWeekNumber, generateCode, pointsToFuel, queryAll, queryOne, run, getLastInsertId } = require('./database');
const PDFDocument = require('pdfkit');
const { notifyRequestApproved, notifyRequestRejected, notifyNewRequest, notifyPointsAdded, notifyPointsSubtracted } = require('./notifications');

// مسار الخط العربي
const ARABIC_FONT_PATH = path.join(__dirname, 'fonts', 'Amiri-Regular.ttf');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Service Worker header
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '../frontend/sw.js'));
});

app.use(express.static(path.join(__dirname, '../frontend')));

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
    SELECT u.id, u.name, u.role, u.group_id, g.name as group_name
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
    COUNT(u.id) as student_count,
    COALESCE(
      (SELECT SUM(
        COALESCE((SELECT SUM(points) FROM requests WHERE student_id = u2.id AND status = 'approved'), 0) +
        COALESCE((SELECT SUM(points) FROM points_adjustments WHERE student_id = u2.id), 0)
      ) FROM users u2 WHERE u2.group_id = g.id AND u2.role = 'student'), 0
    ) as total_points
    FROM groups g
    LEFT JOIN users u ON g.id = u.group_id AND u.role = 'student'
    GROUP BY g.id
  `);
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
    res.json({ success: true, id, code });
  } catch (error) {
    res.status(400).json({ success: false, message: 'حدث خطأ في الإنشاء' });
  }
});

// تعديل طالب
app.put('/api/students/:id', async (req, res) => {
  const { name, group_id } = req.body;
  try {
    const groupVal = group_id ? group_id : 'NULL';
    await run(`UPDATE users SET name = '${name}', group_id = ${groupVal} WHERE id = ${req.params.id}`);
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
    // جلب النقاط الحالية (من الطلبات + التعديلات اليدوية)
    const requestsPoints = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM requests
      WHERE student_id = ${req.params.id} AND status = 'approved'
    `);
    const adjustmentsPoints = await queryOne(`
      SELECT COALESCE(SUM(points), 0) as total
      FROM points_adjustments
      WHERE student_id = ${req.params.id}
    `);
    const currentPoints = (requestsPoints?.total || 0) + (adjustmentsPoints?.total || 0);

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
    console.error('خطأ في تعديل النقاط:', error);
    res.status(400).json({ success: false, message: 'حدث خطأ في تعديل النقاط' });
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
  const fuel = {
    diesel: 0,
    fuel91: 0,
    fuel95: 0,
    fuel98: 0,
    ethanol: 0
  };

  const approvedRequests = await queryAll(`
    SELECT points FROM requests
    WHERE student_id = ${req.params.studentId} AND status = 'approved'
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

  const weekNumber = getWeekNumber();
  const weeklyRequests = await queryOne(`
    SELECT COUNT(*) as count FROM requests
    WHERE student_id = ${req.params.studentId} AND week_number = ${weekNumber}
  `);

  res.json({
    fuel,
    totalLiters: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol,
    weeklyRequestsCount: weeklyRequests ? weeklyRequests.count : 0,
    weeklyRequestsLimit: 20
  });
});

// إحصائيات أسرة
app.get('/api/stats/group/:groupId', async (req, res) => {
  const fuel = {
    diesel: 0,
    fuel91: 0,
    fuel95: 0,
    fuel98: 0,
    ethanol: 0
  };

  const approvedRequests = await queryAll(`
    SELECT r.points FROM requests r
    JOIN users u ON r.student_id = u.id
    WHERE u.group_id = ${req.params.groupId} AND r.status = 'approved'
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

  res.json({
    fuel,
    totalLiters: fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol
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

// جلب إشعارات مستخدم
app.get('/api/notifications/:userId', async (req, res) => {
  const notifications = await queryAll(`
    SELECT * FROM notifications WHERE user_id = ${req.params.userId} ORDER BY created_at DESC
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

// دالة رسم خزان الوقود في PDF
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
  doc.fillColor(color)
     .fontSize(12)
     .text(name, x, y + tankHeight + 10, { width: tankWidth, align: 'center' });

  // عدد اللترات الإجمالي
  doc.fillColor('#666666')
     .fontSize(10)
     .text(`${liters} L`, x, y + tankHeight + 25, { width: tankWidth, align: 'center' });

  // النجوم
  if (stars > 0) {
    const starsText = stars <= 5 ? '★'.repeat(stars) : `★x${stars}`;
    doc.fillColor('#f59e0b')
       .fontSize(10)
       .text(starsText, x, y + tankHeight + 40, { width: tankWidth, align: 'center' });
  }

  doc.fillColor('#000000'); // إعادة اللون الافتراضي
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
  res.setHeader('Content-Disposition', `attachment; filename=student_${student.id}_report.pdf`);

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // العنوان
  doc.fontSize(28).fillColor('#09637E').text('Sultan Fuel System', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Arabic').fontSize(16).fillColor('#666666').text('تقرير الطالب', { align: 'center', features: ['rtla'] });
  doc.moveDown(2);

  // معلومات الطالب (بالعربي)
  doc.font('Arabic').fontSize(18).fillColor('#333333');
  doc.text(student.name, { align: 'center', features: ['rtla'] });
  if (student.group_name) {
    doc.font('Arabic').fontSize(14).fillColor('#666666').text(`أسرة: ${student.group_name}`, { align: 'center', features: ['rtla'] });
  }
  doc.moveDown(2);

  // رسم الخزانات
  const startX = 80;
  const tankY = 220;
  const tankSpacing = 90;

  drawFuelTank(doc, startX, tankY, fuel.diesel, 'Diesel', '#8B7355');
  drawFuelTank(doc, startX + tankSpacing, tankY, fuel.fuel91, '91', '#22c55e');
  drawFuelTank(doc, startX + tankSpacing * 2, tankY, fuel.fuel95, '95', '#ef4444');
  drawFuelTank(doc, startX + tankSpacing * 3, tankY, fuel.fuel98, '98', '#888888');
  drawFuelTank(doc, startX + tankSpacing * 4, tankY, fuel.ethanol, 'Ethanol', '#3b82f6');

  // المجموع
  const total = fuel.diesel + fuel.fuel91 + fuel.fuel95 + fuel.fuel98 + fuel.ethanol;
  doc.moveDown(12);
  doc.fontSize(18).fillColor('#09637E').text(`Total: ${total} Liters`, { align: 'center' });

  // التاريخ
  doc.moveDown(2);
  doc.fontSize(10).fillColor('#999999').text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });

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
  res.setHeader('Content-Disposition', `attachment; filename=group_${group.id}_report.pdf`);

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // العنوان
  doc.fontSize(28).fillColor('#09637E').text('Sultan Fuel System', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Arabic').fontSize(16).fillColor('#666666').text(`تقرير أسرة: ${group.name}`, { align: 'center', features: ['rtla'] });
  doc.moveDown(2);

  // رسم خزانات كل طالب
  let currentY = 150;
  const pageHeight = 750;

  studentsWithFuel.forEach((student, index) => {
    // صفحة جديدة إذا لزم الأمر
    if (currentY > pageHeight - 200) {
      doc.addPage();
      currentY = 50;
    }

    // اسم الطالب (بالعربي)
    doc.font('Arabic').fontSize(14).fillColor('#333333').text(student.name, 450, currentY, { align: 'right', width: 400 });
    currentY += 25;

    // رسم الخزانات المصغرة
    const startX = 50;
    const tankSpacing = 70;
    const smallTankHeight = 80;

    // رسم خزانات صغيرة
    const fuels = [
      { liters: student.fuel.diesel, name: 'Diesel', color: '#8B7355' },
      { liters: student.fuel.fuel91, name: '91', color: '#22c55e' },
      { liters: student.fuel.fuel95, name: '95', color: '#ef4444' },
      { liters: student.fuel.fuel98, name: '98', color: '#888888' },
      { liters: student.fuel.ethanol, name: 'Ethanol', color: '#3b82f6' }
    ];

    fuels.forEach((f, i) => {
      const x = startX + i * tankSpacing;
      const cycleSize = 20;
      const fillPercent = (f.liters % cycleSize) / cycleSize;
      const fillHeight = smallTankHeight * fillPercent;
      const stars = Math.floor(f.liters / cycleSize);

      // إطار الخزان
      doc.rect(x, currentY, 50, smallTankHeight).lineWidth(1).stroke('#cccccc');

      // مستوى الوقود
      if (fillHeight > 0) {
        doc.rect(x + 1, currentY + smallTankHeight - fillHeight + 1, 48, fillHeight - 2).fill(f.color);
      }

      // الرقم
      doc.fillColor('#333').fontSize(12).text((f.liters % cycleSize).toString(), x, currentY + smallTankHeight/2 - 6, { width: 50, align: 'center' });

      // اسم الوقود واللترات
      doc.fillColor('#666').fontSize(8).text(`${f.name}`, x, currentY + smallTankHeight + 5, { width: 50, align: 'center' });
      doc.text(`${f.liters}L`, x, currentY + smallTankHeight + 15, { width: 50, align: 'center' });

      // النجوم
      if (stars > 0) {
        doc.fillColor('#f59e0b').fontSize(8).text(stars <= 3 ? '★'.repeat(stars) : `★x${stars}`, x, currentY + smallTankHeight + 25, { width: 50, align: 'center' });
      }
    });

    // المجموع
    doc.fillColor('#09637E').fontSize(12).text(`Total: ${student.total}L`, 400, currentY + smallTankHeight/2);

    currentY += smallTankHeight + 60;
  });

  // التاريخ
  doc.fontSize(10).fillColor('#999999').text(`Generated: ${new Date().toLocaleDateString()}`, 50, doc.page.height - 50);

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
  res.setHeader('Content-Disposition', 'attachment; filename=all_students_report.pdf');

  doc.pipe(res);

  // تسجيل الخط العربي
  if (fs.existsSync(ARABIC_FONT_PATH)) {
    doc.registerFont('Arabic', ARABIC_FONT_PATH);
  }

  // العنوان
  doc.fontSize(28).fillColor('#09637E').text('Sultan Fuel System', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Arabic').fontSize(16).fillColor('#666666').text('تقرير جميع الطلاب', { align: 'center', features: ['rtla'] });
  doc.moveDown(2);

  // رسم خزانات كل طالب
  let currentY = 150;
  const pageHeight = 750;

  studentsWithFuel.forEach((student, index) => {
    // صفحة جديدة إذا لزم الأمر
    if (currentY > pageHeight - 200) {
      doc.addPage();
      currentY = 50;
    }

    // اسم الطالب والأسرة (بالعربي)
    doc.font('Arabic').fontSize(14).fillColor('#333333').text(student.name, 450, currentY, { align: 'right', width: 400 });
    if (student.group_name) {
      doc.font('Arabic').fontSize(10).fillColor('#888888').text(`(${student.group_name})`, 450, currentY + 18, { align: 'right', width: 400 });
    }
    currentY += 35;

    // رسم الخزانات المصغرة
    const startX = 50;
    const tankSpacing = 70;
    const smallTankHeight = 80;

    const fuels = [
      { liters: student.fuel.diesel, name: 'Diesel', color: '#8B7355' },
      { liters: student.fuel.fuel91, name: '91', color: '#22c55e' },
      { liters: student.fuel.fuel95, name: '95', color: '#ef4444' },
      { liters: student.fuel.fuel98, name: '98', color: '#888888' },
      { liters: student.fuel.ethanol, name: 'Ethanol', color: '#3b82f6' }
    ];

    fuels.forEach((f, i) => {
      const x = startX + i * tankSpacing;
      const cycleSize = 20;
      const fillPercent = (f.liters % cycleSize) / cycleSize;
      const fillHeight = smallTankHeight * fillPercent;
      const stars = Math.floor(f.liters / cycleSize);

      // إطار الخزان
      doc.rect(x, currentY, 50, smallTankHeight).lineWidth(1).stroke('#cccccc');

      // مستوى الوقود
      if (fillHeight > 0) {
        doc.rect(x + 1, currentY + smallTankHeight - fillHeight + 1, 48, fillHeight - 2).fill(f.color);
      }

      // الرقم
      doc.fillColor('#333').fontSize(12).text((f.liters % cycleSize).toString(), x, currentY + smallTankHeight/2 - 6, { width: 50, align: 'center' });

      // اسم الوقود واللترات
      doc.fillColor('#666').fontSize(8).text(`${f.name}`, x, currentY + smallTankHeight + 5, { width: 50, align: 'center' });
      doc.text(`${f.liters}L`, x, currentY + smallTankHeight + 15, { width: 50, align: 'center' });

      // النجوم
      if (stars > 0) {
        doc.fillColor('#f59e0b').fontSize(8).text(stars <= 3 ? '★'.repeat(stars) : `★x${stars}`, x, currentY + smallTankHeight + 25, { width: 50, align: 'center' });
      }
    });

    // المجموع
    doc.fillColor('#09637E').fontSize(12).text(`Total: ${student.total}L`, 400, currentY + smallTankHeight/2);

    currentY += smallTankHeight + 60;
  });

  // التاريخ
  doc.fontSize(10).fillColor('#999999').text(`Generated: ${new Date().toLocaleDateString()}`, 50, doc.page.height - 50);

  doc.end();
});

// ==================== Serve Frontend ====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// تشغيل السيرفر
const startServer = async () => {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log('📊 نظام طاقات السلطان جاهز!');
  });
};

startServer();
