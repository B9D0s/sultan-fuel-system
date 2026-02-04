// ==================== OneSignal Push Notifications ====================

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

/**
 * إرسال إشعار Push عبر OneSignal
 * @param {string} title - عنوان الإشعار
 * @param {string} message - نص الإشعار
 * @param {string|array} userId - معرف المستخدم أو مصفوفة من المعرفات
 * @param {object} data - بيانات إضافية (اختياري)
 * @param {string} segment - شريحة المستخدمين (اختياري)
 */
async function sendPushNotification(title, message, userId = null, data = {}, segment = null) {
  // تحقق من وجود المفاتيح
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.log('⚠️ OneSignal غير مفعّل - المفاتيح غير موجودة');
    return { success: false, error: 'OneSignal not configured' };
  }

  try {
    const notification = {
      app_id: ONESIGNAL_APP_ID,
      headings: { ar: title, en: title },
      contents: { ar: message, en: message },
      data: data,
    };

    // إذا حددنا مستخدم معين أو مصفوفة مستخدمين
    if (userId) {
      const userIds = Array.isArray(userId) ? userId.map(String) : [String(userId)];
      notification.include_aliases = { external_id: userIds };
      notification.target_channel = "push";
    } else if (segment) {
      // إرسال لشريحة معينة
      notification.included_segments = [segment];
    } else {
      // إرسال للجميع
      notification.included_segments = ['All'];
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(notification),
    });

    const result = await response.json();

    if (result.id) {
      console.log(`✅ تم إرسال الإشعار: ${title}`);
      return { success: true, id: result.id };
    } else {
      console.log('⚠️ خطأ في إرسال الإشعار:', result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('❌ خطأ في إرسال الإشعار:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * إشعار قبول الطلب - للطالب
 */
async function notifyRequestApproved(studentId, fuelName, fuelEmoji) {
  return sendPushNotification(
    'تم قبول طلبك ✅',
    `حصلت على 1 لتر ${fuelName} ${fuelEmoji}`,
    studentId,
    { type: 'request_approved' }
  );
}

/**
 * إشعار رفض الطلب - للطالب
 */
async function notifyRequestRejected(studentId, reason = null) {
  const message = reason ? `السبب: ${reason}` : 'لم يتم تحديد سبب';
  return sendPushNotification(
    'تم رفض طلبك ❌',
    message,
    studentId,
    { type: 'request_rejected' }
  );
}

/**
 * إشعار للمشرفين والأدمن بوجود طلب جديد
 * يرسل فقط للمشرفين والأدمن (بناءً على Tags)
 */
async function notifyNewRequest(studentName, supervisorIds = [], adminIds = []) {
  // جمع كل المعرفات (مشرفين + أدمن)
  const targetIds = [...supervisorIds, ...adminIds];

  if (targetIds.length === 0) {
    console.log('⚠️ لا يوجد مشرفين أو أدمن لإرسال الإشعار لهم');
    return { success: false, error: 'No supervisors or admins found' };
  }

  return sendPushNotification(
    'طلب جديد 📝',
    `${studentName} أرسل طلب وقود جديد`,
    targetIds,
    { type: 'new_request' }
  );
}

/**
 * إشعار مخصص لمستخدمين معينين
 */
async function notifyUsers(userIds, title, message, data = {}) {
  return sendPushNotification(title, message, userIds, data);
}

/**
 * إشعار إضافة نقاط للطالب
 */
async function notifyPointsAdded(studentId, points, newTotal, fuelName, fuelEmoji, reason = '') {
  const reasonText = reason ? `\nالسبب: ${reason}` : '';
  return sendPushNotification(
    'تم إضافة نقاط ➕',
    `حصلت على ${points} نقاط! وقودك الآن: ${fuelEmoji} ${fuelName} (${newTotal} نقاط)${reasonText}`,
    studentId,
    { type: 'points_added' }
  );
}

/**
 * إشعار خصم نقاط من الطالب
 */
async function notifyPointsSubtracted(studentId, points, newTotal, fuelName, fuelEmoji, reason = '') {
  const reasonText = reason ? `\nالسبب: ${reason}` : '';
  return sendPushNotification(
    'تم خصم نقاط ➖',
    `تم خصم ${points} نقاط. وقودك الآن: ${fuelEmoji} ${fuelName} (${newTotal} نقاط)${reasonText}`,
    studentId,
    { type: 'points_subtracted' }
  );
}

/**
 * إشعار منع/إلغاء منع رؤية النقاط
 */
async function notifyPointsVisibilityChanged(studentId, isHidden, reason = '') {
  const title = isHidden ? 'تم إخفاء نقاطك 🚫' : 'تم إظهار نقاطك ✅';
  const message = isHidden
    ? `تم منعك من رؤية نقاطك مؤقتاً${reason ? '\nالسبب: ' + reason : ''}`
    : 'يمكنك الآن رؤية نقاطك مرة أخرى';

  return sendPushNotification(title, message, studentId, { type: 'points_visibility_changed' });
}

/**
 * إشعار إضافة طالب جديد
 */
async function notifyNewStudent(studentId, studentName, code) {
  return sendPushNotification(
    'مرحباً بك في نظام سلطان! 🎉',
    `أهلاً ${studentName}! رمز دخولك هو: ${code}`,
    studentId,
    { type: 'new_student' }
  );
}

/**
 * إشعار تغيير أسرة الطالب
 */
async function notifyGroupChanged(studentId, newGroupName, oldGroupName = null) {
  const message = oldGroupName
    ? `تم نقلك من أسرة "${oldGroupName}" إلى أسرة "${newGroupName}"`
    : `تم إضافتك إلى أسرة "${newGroupName}"`;

  return sendPushNotification(
    'تغيير الأسرة 👥',
    message,
    studentId,
    { type: 'group_changed' }
  );
}

/**
 * إشعار الوصول للحد الأسبوعي
 */
async function notifyWeeklyLimitReached(studentId) {
  return sendPushNotification(
    'وصلت للحد الأسبوعي ⚠️',
    'لقد وصلت للحد الأقصى من الطلبات هذا الأسبوع (20 طلب). انتظر الأسبوع القادم!',
    studentId,
    { type: 'weekly_limit_reached' }
  );
}

/**
 * إشعار للمشرفين بإضافة طالب جديد
 */
async function notifyNewStudentToSupervisors(studentName, groupName, supervisorIds = [], adminIds = []) {
  const targetIds = [...supervisorIds, ...adminIds];
  if (targetIds.length === 0) return { success: false };

  const groupText = groupName ? ` في أسرة "${groupName}"` : '';
  return sendPushNotification(
    'طالب جديد 🆕',
    `تم إضافة الطالب "${studentName}"${groupText}`,
    targetIds,
    { type: 'new_student_admin' }
  );
}

module.exports = {
  sendPushNotification,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyNewRequest,
  notifyUsers,
  notifyPointsAdded,
  notifyPointsSubtracted,
  notifyPointsVisibilityChanged,
  notifyNewStudent,
  notifyGroupChanged,
  notifyWeeklyLimitReached,
  notifyNewStudentToSupervisors,
};
