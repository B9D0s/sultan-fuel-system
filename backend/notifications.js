// ==================== OneSignal Push Notifications ====================

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

/**
 * إرسال إشعار Push عبر OneSignal
 * @param {string} title - عنوان الإشعار
 * @param {string} message - نص الإشعار
 * @param {string} userId - معرف المستخدم (external_user_id)
 * @param {object} data - بيانات إضافية (اختياري)
 */
async function sendPushNotification(title, message, userId = null, data = {}) {
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

    // إذا حددنا مستخدم معين
    if (userId) {
      notification.include_external_user_ids = [String(userId)];
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
 * إشعار قبول الطلب
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
 * إشعار رفض الطلب
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
 * إشعار للمشرفين بوجود طلب جديد
 */
async function notifyNewRequest(studentName) {
  return sendPushNotification(
    'طلب جديد 📝',
    `${studentName} أرسل طلب وقود جديد`,
    null, // للجميع (المشرفين)
    { type: 'new_request' }
  );
}

module.exports = {
  sendPushNotification,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyNewRequest,
};
