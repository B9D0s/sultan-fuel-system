// ==================== API Configuration ====================
const API_URL = window.location.origin + '/api';
window.API_URL = API_URL; // للاستخدام في app.js (إضافة/خصم نقاط طالب، إخفاء النقاط)

// ==================== Generic API Functions ====================
async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const contentType = response.headers.get('Content-Type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('API returned non-JSON:', text.substring(0, 200));
      throw new Error(response.ok
        ? 'استجابة غير متوقعة من الخادم'
        : 'خطأ في الخادم - تأكد من تشغيل السيرفر وإعادة تحميل الصفحة');
    }

    if (!response.ok) {
      throw new Error(data.message || 'حدث خطأ في الاتصال');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    if (error.name === 'TypeError' && (error.message === 'Failed to fetch' || error.message.includes('fetch'))) {
      throw new Error('تعذر الاتصال بالسيرفر. شغّل السيرفر من مجلد المشروع: npm start. إن ظهر "محظور" فجرّب تعطيل مانع الإعلانات لهذا الموقع.');
    }
    throw error;
  }
}

// ==================== Auth API ====================
const AuthAPI = {
  loginWithCode: (code) => apiCall('/auth/code', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),

  loginAdmin: (username, password) => apiCall('/auth/admin', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
};

// ==================== Groups API ====================
const GroupsAPI = {
  getAll: () => apiCall('/groups'),

  getDetails: (id) => apiCall(`/groups/${id}/details`),

  create: (name) => apiCall('/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  }),

  update: (id, name) => apiCall(`/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name })
  }),

  delete: (id) => apiCall(`/groups/${id}`, {
    method: 'DELETE'
  }),

  addPoints: (id, points, action, reason, apply_to_members, reviewer_id) => apiCall(`/groups/${id}/points`, {
    method: 'POST',
    body: JSON.stringify({ points, action, reason, apply_to_members, reviewer_id })
  }),

  addPercentage: (id, percentage, apply_to_members, reason, reviewer_id, action = 'add') => apiCall(`/groups/${id}/percentage`, {
    method: 'POST',
    body: JSON.stringify({ percentage, apply_to_members, reason, reviewer_id, action })
  })
};

// ==================== Supervisors API ====================
const SupervisorsAPI = {
  getAll: () => apiCall('/supervisors'),

  create: (name) => apiCall('/supervisors', {
    method: 'POST',
    body: JSON.stringify({ name })
  }),

  delete: (id) => apiCall(`/supervisors/${id}`, {
    method: 'DELETE'
  })
};

// ==================== Students API ====================
const StudentsAPI = {
  getAll: () => apiCall('/students'),

  create: (name, group_id) => apiCall('/students', {
    method: 'POST',
    body: JSON.stringify({ name, group_id })
  }),

  update: (id, name, group_id) => apiCall(`/students/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, group_id })
  }),

  delete: (id) => apiCall(`/students/${id}`, {
    method: 'DELETE'
  })
};

// ==================== Requests API ====================
const RequestsAPI = {
  getAll: (status = '') => apiCall(`/requests${status ? `?status=${status}` : ''}`),

  getByStudent: (studentId) => apiCall(`/requests/student/${studentId}`),

  create: (student_id, committee, description, points) => apiCall('/requests', {
    method: 'POST',
    body: JSON.stringify({ student_id, committee, description, points })
  }),

  approve: (id, reviewer_id) => apiCall(`/requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id })
  }),

  reject: (id, reviewer_id, rejection_reason = '') => apiCall(`/requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id, rejection_reason })
  })
};

// ==================== Stats API ====================
const StatsAPI = {
  getStudentStats: (studentId) => apiCall(`/stats/student/${studentId}`),

  getGroupStats: (groupId) => apiCall(`/stats/group/${groupId}`),

  getOverview: () => apiCall('/stats/overview')
};

// ==================== Settings API ====================
const SettingsAPI = {
  getAll: () => apiCall('/settings'),
  set: (key, value) => apiCall('/settings', {
    method: 'POST',
    body: JSON.stringify({ key, value })
  }),
  getPointsLog: (limit = 200) => apiCall(`/points-log?limit=${encodeURIComponent(limit)}`)
};

// ==================== Notifications API ====================
const NotificationsAPI = {
  getAll: (userId) => apiCall(`/notifications/${userId}`),

  markAsRead: (userId) => apiCall(`/notifications/${userId}/read`, {
    method: 'POST'
  }),

  getUnreadCount: (userId) => apiCall(`/notifications/${userId}/unread-count`)
};

// ==================== Reports API ====================
const ReportsAPI = {
  getWeekly: (week) => apiCall(`/reports/weekly${week ? `?week=${week}` : ''}`),

  getMonthly: (month, year) => apiCall(`/reports/monthly?month=${month}&year=${year}`)
};

// ==================== Export API ====================
const ExportAPI = {
  studentPDF: (studentId) => `${API_URL}/export/student/${studentId}`,

  groupPDF: (groupId) => `${API_URL}/export/group/${groupId}`,

  allPDF: () => `${API_URL}/export/all`
};
