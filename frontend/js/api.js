// ==================== API Configuration ====================
const API_URL = window.location.origin + '/api';

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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'حدث خطأ في الاتصال');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
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
