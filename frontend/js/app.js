// ==================== Global State ====================
let currentUser = null;
let currentPage = 'dashboard';

// ==================== DOM Elements ====================
const loginPage = document.getElementById('login-page');
const dashboard = document.getElementById('dashboard');
const mainContent = document.getElementById('main-content');
const sidebarNav = document.getElementById('sidebar-nav');
const userName = document.getElementById('user-name');

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
  initLoginTabs();
  initLoginForms();
  checkStoredSession();
});

// ==================== Login Tabs ====================
function initLoginTabs() {
  const tabs = document.querySelectorAll('.login-tab');
  const forms = document.querySelectorAll('.login-form');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    });
  });
}

// ==================== Login Forms ====================
function initLoginForms() {
  // تسجيل دخول بالرمز
  document.getElementById('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('login-code').value;
    const errorEl = document.getElementById('code-error');

    if (code.length !== 4) {
      showError(errorEl, 'الرجاء إدخال رمز من 4 أرقام');
      return;
    }

    try {
      const data = await AuthAPI.loginWithCode(code);
      handleLoginSuccess(data.user);
    } catch (error) {
      showError(errorEl, error.message);
    }
  });

  // تسجيل دخول الأدمن
  document.getElementById('admin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    const errorEl = document.getElementById('admin-error');

    if (!username || !password) {
      showError(errorEl, 'الرجاء إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    try {
      const data = await AuthAPI.loginAdmin(username, password);
      handleLoginSuccess(data.user);
    } catch (error) {
      showError(errorEl, error.message);
    }
  });

  // Auto-focus on code input
  document.getElementById('login-code').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9]/g, '');
  });
}

function showError(element, message) {
  element.textContent = message;
  element.style.display = 'block';
  setTimeout(() => {
    element.style.display = 'none';
  }, 3000);
}

// ==================== Session Management ====================
function handleLoginSuccess(user) {
  currentUser = user;
  localStorage.setItem('user', JSON.stringify(user));

  // ربط المستخدم بـ OneSignal للإشعارات
  registerOneSignalUser(user.id);

  showDashboard();
}

// ربط المستخدم بـ OneSignal
function registerOneSignalUser(userId) {
  if (typeof OneSignal !== 'undefined') {
    OneSignalDeferred.push(async function(OneSignal) {
      await OneSignal.login(String(userId));
      console.log('✅ تم ربط المستخدم بـ OneSignal:', userId);
    });
  }
}

function checkStoredSession() {
  const stored = localStorage.getItem('user');
  if (stored) {
    currentUser = JSON.parse(stored);
    showDashboard();
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('user');
  loginPage.style.display = 'flex';
  dashboard.style.display = 'none';
  document.getElementById('login-code').value = '';
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-password').value = '';
}

// ==================== Dashboard ====================
function showDashboard() {
  loginPage.style.display = 'none';
  dashboard.style.display = 'flex';
  userName.textContent = `مرحباً، ${currentUser.name}`;
  buildSidebar();
  buildMobileNav();
  navigateTo('dashboard');
}

function buildSidebar() {
  let navItems = '';

  if (currentUser.role === 'admin') {
    navItems = `
      <a class="nav-item active" data-page="dashboard">
        <i class="fas fa-home"></i> الرئيسية
      </a>
      <a class="nav-item" data-page="groups">
        <i class="fas fa-users"></i> الأسر
      </a>
      <a class="nav-item" data-page="supervisors">
        <i class="fas fa-user-tie"></i> المشرفين
      </a>
      <a class="nav-item" data-page="students">
        <i class="fas fa-user-graduate"></i> الطلاب
      </a>
      <a class="nav-item" data-page="requests">
        <i class="fas fa-clipboard-list"></i> الطلبات
      </a>
      <a class="nav-item" data-page="reports">
        <i class="fas fa-chart-bar"></i> التقارير
      </a>
      <a class="nav-item" data-page="settings">
        <i class="fas fa-cog"></i> الإعدادات
      </a>
    `;
  } else if (currentUser.role === 'supervisor') {
    navItems = `
      <a class="nav-item active" data-page="dashboard">
        <i class="fas fa-home"></i> الرئيسية
      </a>
      <a class="nav-item" data-page="students">
        <i class="fas fa-user-graduate"></i> الطلاب
      </a>
      <a class="nav-item" data-page="groups">
        <i class="fas fa-users"></i> الأسر
      </a>
      <a class="nav-item" data-page="requests">
        <i class="fas fa-clipboard-list"></i> الطلبات
      </a>
      <a class="nav-item" data-page="reports">
        <i class="fas fa-chart-bar"></i> التقارير
      </a>
    `;
  } else {
    navItems = `
      <a class="nav-item active" data-page="dashboard">
        <i class="fas fa-gas-pump"></i> رصيدي
      </a>
      ${currentUser.group_id ? `
        <a class="nav-item" data-page="my-group">
          <i class="fas fa-users"></i> أسرتي
        </a>
      ` : ''}
      <a class="nav-item" data-page="new-request">
        <i class="fas fa-plus-circle"></i> طلب جديد
      </a>
      <a class="nav-item" data-page="my-requests">
        <i class="fas fa-history"></i> طلباتي
      </a>
    `;
  }

  sidebarNav.innerHTML = navItems;

  // Add click events
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      navigateTo(item.dataset.page);
      // Update mobile nav too
      updateMobileNavActive(item.dataset.page);
    });
  });
}

// ==================== Mobile Navigation ====================
function buildMobileNav() {
  const mobileNavItems = document.getElementById('mobile-nav-items');
  let navItems = '';

  if (currentUser.role === 'admin') {
    navItems = `
      <button class="mobile-nav-item active" data-page="dashboard">
        <i class="fas fa-home"></i>
        <span>الرئيسية</span>
      </button>
      <button class="mobile-nav-item" data-page="groups">
        <i class="fas fa-users"></i>
        <span>الأسر</span>
      </button>
      <button class="mobile-nav-item" data-page="students">
        <i class="fas fa-user-graduate"></i>
        <span>الطلاب</span>
      </button>
      <button class="mobile-nav-item" data-page="requests">
        <i class="fas fa-clipboard-list"></i>
        <span>الطلبات</span>
      </button>
      <button class="mobile-nav-item" onclick="logout()">
        <i class="fas fa-sign-out-alt"></i>
        <span>خروج</span>
      </button>
    `;
  } else if (currentUser.role === 'supervisor') {
    navItems = `
      <button class="mobile-nav-item active" data-page="dashboard">
        <i class="fas fa-home"></i>
        <span>الرئيسية</span>
      </button>
      <button class="mobile-nav-item" data-page="students">
        <i class="fas fa-user-graduate"></i>
        <span>الطلاب</span>
      </button>
      <button class="mobile-nav-item" data-page="requests">
        <i class="fas fa-clipboard-list"></i>
        <span>الطلبات</span>
      </button>
      <button class="mobile-nav-item" onclick="logout()">
        <i class="fas fa-sign-out-alt"></i>
        <span>خروج</span>
      </button>
    `;
  } else {
    // Student
    navItems = `
      <button class="mobile-nav-item active" data-page="dashboard">
        <i class="fas fa-gas-pump"></i>
        <span>رصيدي</span>
      </button>
      ${currentUser.group_id ? `
        <button class="mobile-nav-item" data-page="my-group">
          <i class="fas fa-users"></i>
          <span>أسرتي</span>
        </button>
      ` : ''}
      <button class="mobile-nav-item" data-page="new-request">
        <i class="fas fa-plus-circle"></i>
        <span>طلب جديد</span>
      </button>
      <button class="mobile-nav-item" data-page="my-requests">
        <i class="fas fa-history"></i>
        <span>طلباتي</span>
      </button>
      <button class="mobile-nav-item" onclick="logout()">
        <i class="fas fa-sign-out-alt"></i>
        <span>خروج</span>
      </button>
    `;
  }

  mobileNavItems.innerHTML = navItems;

  // Add click events for mobile nav
  document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      navigateTo(item.dataset.page);
      // Update sidebar nav too
      updateSidebarActive(item.dataset.page);
    });
  });
}

function updateMobileNavActive(page) {
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) {
      item.classList.add('active');
    }
  });
}

function updateSidebarActive(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) {
      item.classList.add('active');
    }
  });
}

// ==================== Navigation ====================
function navigateTo(page) {
  currentPage = page;

  switch(page) {
    case 'dashboard':
      if (currentUser.role === 'student') {
        renderStudentDashboard();
      } else {
        renderAdminDashboard();
      }
      break;
    case 'groups':
      renderGroupsPage();
      break;
    case 'supervisors':
      renderSupervisorsPage();
      break;
    case 'students':
      renderStudentsPage();
      break;
    case 'requests':
      renderRequestsPage();
      break;
    case 'reports':
      renderReportsPage();
      break;
    case 'new-request':
      renderNewRequestPage();
      break;
    case 'my-requests':
      renderMyRequestsPage();
      break;
    case 'settings':
      renderSettingsPage();
      break;
    case 'group-details':
      renderGroupDetailsPage(currentGroupId);
      break;
    case 'my-group':
      renderMyGroupPage();
      break;
  }
}

let currentGroupId = null;

// ==================== Student Dashboard ====================
async function renderStudentDashboard() {
  try {
    const stats = await StatsAPI.getStudentStats(currentUser.id);
    const settings = await SettingsAPI.getAll();
    const hidePoints = settings.hide_points_from_all === 'true';

    // جلب معلومات الأسرة إذا كان الطالب ينتمي لأسرة
    let groupInfo = null;
    if (currentUser.group_id) {
      try {
        groupInfo = await GroupsAPI.getDetails(currentUser.group_id);
      } catch (e) {
        console.log('لا يمكن جلب معلومات الأسرة');
      }
    }

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-gas-pump"></i> رصيدي من الوقود</h1>
        <div class="header-actions">
          <button class="notification-btn" onclick="toggleNotifications()">
            <i class="fas fa-bell"></i>
            <span class="notification-badge" id="notif-badge" style="display: none;">0</span>
          </button>
        </div>
      </div>

      <div class="weekly-progress">
        <h3>الطلبات هذا الأسبوع</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${(stats.weeklyRequestsCount / stats.weeklyRequestsLimit) * 100}%"></div>
        </div>
        <div class="progress-text">
          <span>${stats.weeklyRequestsCount} من ${stats.weeklyRequestsLimit}</span>
          <span>متبقي: ${stats.weeklyRequestsLimit - stats.weeklyRequestsCount} طلب</span>
        </div>
      </div>

      ${hidePoints ? `
        <div class="card hidden-points-notice">
          <div class="card-body">
            <div class="empty-state">
              <i class="fas fa-eye-slash"></i>
              <h3>النقاط مخفية حالياً</h3>
              <p>سيتم الكشف عن النقاط قريباً. ترقبوا الإعلان!</p>
            </div>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="card-header">
            <h2>خزانات الوقود الخاصة بي</h2>
            <span>المجموع: ${stats.totalLiters} لتر (${stats.totalPoints || 0} نقطة)</span>
          </div>
          <div class="card-body">
            <div class="fuel-tanks-container">
              ${renderFuelTank('ديزل', stats.fuel.diesel, 'diesel', '#8B7355')}
              ${renderFuelTank('91', stats.fuel.fuel91, 'fuel91', '#22c55e')}
              ${renderFuelTank('95', stats.fuel.fuel95, 'fuel95', '#ef4444')}
              ${renderFuelTank('98', stats.fuel.fuel98, 'fuel98', '#e5e5e5')}
              ${renderFuelTank('إيثانول', stats.fuel.ethanol, 'ethanol', '#3b82f6')}
            </div>
          </div>
        </div>

        ${groupInfo ? `
          <div class="card" style="margin-top: 20px;">
            <div class="card-header">
              <h2><i class="fas fa-users"></i> خزانات أسرتي - ${groupInfo.name}</h2>
              <span>المجموع: ${groupInfo.fuel.diesel + groupInfo.fuel.fuel91 + groupInfo.fuel.fuel95 + groupInfo.fuel.fuel98 + groupInfo.fuel.ethanol} لتر (${(groupInfo.fuel.diesel * 1) + (groupInfo.fuel.fuel91 * 2) + (groupInfo.fuel.fuel95 * 3) + (groupInfo.fuel.fuel98 * 4) + (groupInfo.fuel.ethanol * 5)} نقطة)</span>
            </div>
            <div class="card-body">
              <div class="fuel-tanks-container">
                ${renderFuelTank('ديزل', groupInfo.fuel.diesel, 'diesel', '#8B7355')}
                ${renderFuelTank('91', groupInfo.fuel.fuel91, 'fuel91', '#22c55e')}
                ${renderFuelTank('95', groupInfo.fuel.fuel95, 'fuel95', '#ef4444')}
                ${renderFuelTank('98', groupInfo.fuel.fuel98, 'fuel98', '#e5e5e5')}
                ${renderFuelTank('إيثانول', groupInfo.fuel.ethanol, 'ethanol', '#3b82f6')}
              </div>
            </div>
          </div>
        ` : ''}
      `}
    `;

    updateNotificationBadge();
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

function renderFuelTank(name, liters, type, color) {
  const cycleSize = 20; // كل 20 لتر = دورة كاملة + نجمة
  const stars = Math.floor(liters / cycleSize); // عدد النجوم (الدورات المكتملة)
  const currentFill = liters % cycleSize; // اللترات في الدورة الحالية
  const fillPercent = (currentFill / cycleSize) * 100;

  // إنشاء النجوم
  const starsHTML = stars > 0 ? `<div class="tank-stars">${'⭐'.repeat(Math.min(stars, 10))}${stars > 10 ? `<span class="stars-count">+${stars - 10}</span>` : ''}</div>` : '';

  return `
    <div class="fuel-tank">
      <div class="tank-wrapper">
        <div class="tank-fill ${type}" style="height: ${fillPercent}%"></div>
        <div class="tank-level">${currentFill}</div>
      </div>
      <div class="tank-label">
        <div class="name" style="color: ${type === 'fuel98' ? '#666' : color}">${name}</div>
        <div class="liters">${liters} لتر</div>
        ${starsHTML}
      </div>
    </div>
  `;
}

// ==================== Admin Dashboard ====================
async function renderAdminDashboard() {
  try {
    const stats = await StatsAPI.getOverview();

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-home"></i> لوحة التحكم</h1>
        <div class="header-actions">
          <button class="notification-btn" onclick="toggleNotifications()">
            <i class="fas fa-bell"></i>
            <span class="notification-badge" id="notif-badge" style="display: none;">0</span>
          </button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="icon primary"><i class="fas fa-user-graduate"></i></div>
          <h3>الطلاب</h3>
          <div class="value">${stats.totalStudents}</div>
        </div>
        <div class="stat-card">
          <div class="icon success"><i class="fas fa-users"></i></div>
          <h3>الأسر</h3>
          <div class="value">${stats.totalGroups}</div>
        </div>
        <div class="stat-card">
          <div class="icon warning"><i class="fas fa-clock"></i></div>
          <h3>طلبات معلقة</h3>
          <div class="value">${stats.pendingRequests}</div>
        </div>
        <div class="stat-card">
          <div class="icon primary"><i class="fas fa-clipboard-list"></i></div>
          <h3>إجمالي الطلبات</h3>
          <div class="value">${stats.totalRequests}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="icon success"><i class="fas fa-check-circle"></i></div>
          <h3>طلبات مقبولة</h3>
          <div class="value">${stats.approvedRequests}</div>
        </div>
        <div class="stat-card">
          <div class="icon danger"><i class="fas fa-times-circle"></i></div>
          <h3>طلبات مرفوضة</h3>
          <div class="value">${stats.rejectedRequests}</div>
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

// ==================== Groups Page ====================
async function renderGroupsPage() {
  try {
    const groups = await GroupsAPI.getAll();

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-users"></i> إدارة الأسر</h1>
        ${currentUser.role === 'admin' ? `
          <button class="btn btn-primary btn-small" onclick="showAddGroupModal()">
            <i class="fas fa-plus"></i> إضافة أسرة
          </button>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-body">
          ${groups.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>اسم الأسرة</th>
                    <th>عدد الطلاب</th>
                    <th>نقاط الأفراد</th>
                    <th>نقاط الأسرة</th>
                    <th>الإجمالي</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${groups.map((g, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>
                        <a href="#" onclick="viewGroupDetails(${g.id})" class="group-link">${g.name}</a>
                      </td>
                      <td>${g.student_count}</td>
                      <td>${g.members_points || 0}</td>
                      <td>${g.direct_points || 0}</td>
                      <td>
                        <span class="fuel-indicator">${getFuelEmoji(g.total_points || 0)}</span>
                        <span class="points-badge">${g.total_points || 0}</span>
                      </td>
                      <td>
                        <div class="action-btns">
                          <button class="action-btn view" onclick="viewGroupDetails(${g.id})" title="عرض التفاصيل">
                            <i class="fas fa-eye"></i>
                          </button>
                          <button class="action-btn add-points" onclick="showAddGroupPointsModal(${g.id}, '${g.name}', ${g.total_points || 0})" title="إضافة نقاط">
                            <i class="fas fa-plus"></i>
                          </button>
                          <button class="action-btn subtract-points" onclick="showSubtractGroupPointsModal(${g.id}, '${g.name}', ${g.total_points || 0})" title="خصم نقاط">
                            <i class="fas fa-minus"></i>
                          </button>
                          <button class="action-btn percentage" onclick="showGroupPercentageModal(${g.id}, '${g.name}', 'add')" title="زيادة مئوية">
                            <i class="fas fa-plus-circle"></i>%
                          </button>
                          <button class="action-btn percentage-subtract" onclick="showGroupPercentageModal(${g.id}, '${g.name}', 'subtract')" title="خصم مئوي">
                            <i class="fas fa-minus-circle"></i>%
                          </button>
                          ${currentUser.role === 'admin' ? `
                            <button class="action-btn edit" onclick="showEditGroupModal(${g.id}, '${g.name}')" title="تعديل">
                              <i class="fas fa-edit"></i>
                            </button>
                            <button class="action-btn delete" onclick="deleteGroup(${g.id})" title="حذف">
                              <i class="fas fa-trash"></i>
                            </button>
                          ` : ''}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <i class="fas fa-users"></i>
              <h3>لا توجد أسر</h3>
              <p>ابدأ بإضافة أسرة جديدة</p>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

// عرض تفاصيل الأسرة مع الخزانات
async function viewGroupDetails(groupId) {
  currentGroupId = groupId;
  navigateTo('group-details');
}

async function renderGroupDetailsPage(groupId) {
  try {
    const group = await GroupsAPI.getDetails(groupId);

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-users"></i> ${group.name}</h1>
        <button class="btn btn-secondary btn-small" onclick="navigateTo('groups')">
          <i class="fas fa-arrow-right"></i> رجوع
        </button>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>خزانات الوقود</h2>
          <span>المجموع: ${group.total_points} نقطة (أفراد: ${group.members_points} + أسرة: ${group.direct_points})</span>
        </div>
        <div class="card-body">
          <div class="fuel-tanks-container">
            ${renderFuelTank('ديزل', group.fuel.diesel, 'diesel', '#8B7355')}
            ${renderFuelTank('91', group.fuel.fuel91, 'fuel91', '#22c55e')}
            ${renderFuelTank('95', group.fuel.fuel95, 'fuel95', '#ef4444')}
            ${renderFuelTank('98', group.fuel.fuel98, 'fuel98', '#e5e5e5')}
            ${renderFuelTank('إيثانول', group.fuel.ethanol, 'ethanol', '#3b82f6')}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h2>إجراءات الأسرة</h2>
        </div>
        <div class="card-body">
          <div class="group-actions-grid">
            <button class="btn btn-primary" onclick="showAddGroupPointsModal(${group.id}, '${group.name}', ${group.total_points})">
              <i class="fas fa-plus"></i> إضافة نقاط
            </button>
            <button class="btn btn-danger" onclick="showSubtractGroupPointsModal(${group.id}, '${group.name}', ${group.total_points})">
              <i class="fas fa-minus"></i> خصم نقاط
            </button>
            <button class="btn btn-success" onclick="showGroupPercentageModal(${group.id}, '${group.name}', 'add')">
              <i class="fas fa-plus-circle"></i> زيادة مئوية
            </button>
            <button class="btn btn-warning" onclick="showGroupPercentageModal(${group.id}, '${group.name}', 'subtract')">
              <i class="fas fa-minus-circle"></i> خصم مئوي
            </button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h2>أعضاء الأسرة (${group.members.length})</h2>
        </div>
        <div class="card-body">
          ${group.members.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>النقاط</th>
                    <th>الوقود</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.members.map((m, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${m.name}</td>
                      <td>${m.total_points || 0}</td>
                      <td>${getFuelEmoji(m.total_points || 0)} ${getFuelName(m.total_points || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p>لا يوجد أعضاء في هذه الأسرة</p>'}
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

// ==================== Group Points Modals ====================
function showAddGroupPointsModal(groupId, groupName, currentPoints) {
  openModal(`إضافة نقاط للأسرة - ${groupName}`, `
    <div class="current-fuel-status">
      <span>النقاط الحالية: ${getFuelEmoji(currentPoints)} ${currentPoints} نقاط</span>
    </div>
    <div class="form-group">
      <label>عدد النقاط للإضافة</label>
      <input type="number" id="group-points-amount" min="1" value="1" class="points-input">
    </div>
    <div class="form-group">
      <label>السبب (اختياري)</label>
      <input type="text" id="group-points-reason" placeholder="سبب إضافة النقاط">
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="apply-to-members">
        توزيع النقاط على الأفراد أيضاً
      </label>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="addGroupPoints(${groupId})">إضافة</button>
  `);
}

function showSubtractGroupPointsModal(groupId, groupName, currentPoints) {
  if (currentPoints <= 0) {
    alert('لا يمكن خصم نقاط - الأسرة ليس لديها نقاط');
    return;
  }

  openModal(`خصم نقاط من الأسرة - ${groupName}`, `
    <div class="current-fuel-status">
      <span>النقاط الحالية: ${getFuelEmoji(currentPoints)} ${currentPoints} نقاط</span>
    </div>
    <div class="form-group">
      <label>عدد النقاط للخصم</label>
      <input type="number" id="group-points-amount" min="1" max="${currentPoints}" value="1" class="points-input">
    </div>
    <div class="form-group">
      <label>السبب (اختياري)</label>
      <input type="text" id="group-points-reason" placeholder="سبب خصم النقاط">
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="apply-to-members">
        خصم من الأفراد أيضاً
      </label>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-danger btn-small" onclick="subtractGroupPoints(${groupId})">خصم</button>
  `);
}

function showGroupPercentageModal(groupId, groupName, action = 'add') {
  const isSubtract = action === 'subtract';
  const title = isSubtract ? `خصم مئوي من الأسرة - ${groupName}` : `زيادة مئوية للأسرة - ${groupName}`;
  const labelText = isSubtract ? 'نسبة الخصم (%)' : 'نسبة الزيادة (%)';
  const placeholderText = isSubtract ? 'سبب الخصم المئوي' : 'سبب الزيادة المئوية';
  const checkboxText = isSubtract
    ? 'تطبيق الخصم على الأفراد أيضاً (كل فرد يُخصم منه النسبة من نقاطه)'
    : 'تطبيق الزيادة على الأفراد أيضاً (كل فرد يحصل على النسبة من نقاطه)';
  const btnClass = isSubtract ? 'btn-warning' : 'btn-success';
  const btnText = isSubtract ? 'خصم' : 'تطبيق';

  openModal(title, `
    <div class="form-group">
      <label>${labelText}</label>
      <input type="number" id="group-percentage" min="1" max="100" value="10" class="points-input">
    </div>
    <div class="form-group">
      <label>السبب (اختياري)</label>
      <input type="text" id="group-percentage-reason" placeholder="${placeholderText}">
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="apply-percentage-to-members" checked>
        ${checkboxText}
      </label>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn ${btnClass} btn-small" onclick="applyGroupPercentage(${groupId}, '${action}')">${btnText}</button>
  `);
}

async function addGroupPoints(groupId) {
  const points = parseInt(document.getElementById('group-points-amount').value);
  const reason = document.getElementById('group-points-reason').value;
  const applyToMembers = document.getElementById('apply-to-members').checked;

  try {
    const result = await GroupsAPI.addPoints(groupId, points, 'add', reason, applyToMembers, currentUser.id);
    closeModal();
    alert(result.message || 'تم إضافة النقاط بنجاح');
    if (currentPage === 'group-details') {
      renderGroupDetailsPage(groupId);
    } else {
      renderGroupsPage();
    }
  } catch (error) {
    alert(error.message);
  }
}

async function subtractGroupPoints(groupId) {
  const points = parseInt(document.getElementById('group-points-amount').value);
  const reason = document.getElementById('group-points-reason').value;
  const applyToMembers = document.getElementById('apply-to-members').checked;

  try {
    const result = await GroupsAPI.addPoints(groupId, points, 'subtract', reason, applyToMembers, currentUser.id);
    closeModal();
    alert(result.message || 'تم خصم النقاط بنجاح');
    if (currentPage === 'group-details') {
      renderGroupDetailsPage(groupId);
    } else {
      renderGroupsPage();
    }
  } catch (error) {
    alert(error.message);
  }
}

async function applyGroupPercentage(groupId, action = 'add') {
  const percentage = parseInt(document.getElementById('group-percentage').value);
  const reason = document.getElementById('group-percentage-reason').value;
  const applyToMembers = document.getElementById('apply-percentage-to-members').checked;

  try {
    const result = await GroupsAPI.addPercentage(groupId, percentage, applyToMembers, reason, currentUser.id, action);
    closeModal();
    alert(result.message || (action === 'subtract' ? 'تم تطبيق الخصم المئوي بنجاح' : 'تم تطبيق الزيادة المئوية بنجاح'));
    if (currentPage === 'group-details') {
      renderGroupDetailsPage(groupId);
    } else {
      renderGroupsPage();
    }
  } catch (error) {
    alert(error.message);
  }
}

// للتوافق مع الكود القديم
async function addGroupPercentage(groupId) {
  await applyGroupPercentage(groupId, 'add');
}

function showAddGroupModal() {
  openModal('إضافة أسرة جديدة', `
    <div class="form-group">
      <label>اسم الأسرة</label>
      <input type="text" id="group-name" placeholder="أدخل اسم الأسرة">
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="addGroup()">إضافة</button>
  `);
}

function showEditGroupModal(id, name) {
  openModal('تعديل الأسرة', `
    <div class="form-group">
      <label>اسم الأسرة</label>
      <input type="text" id="group-name" value="${name}">
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="updateGroup(${id})">حفظ</button>
  `);
}

async function addGroup() {
  const name = document.getElementById('group-name').value;
  if (!name) return alert('الرجاء إدخال اسم الأسرة');

  try {
    await GroupsAPI.create(name);
    closeModal();
    renderGroupsPage();
  } catch (error) {
    alert(error.message);
  }
}

async function updateGroup(id) {
  const name = document.getElementById('group-name').value;
  if (!name) return alert('الرجاء إدخال اسم الأسرة');

  try {
    await GroupsAPI.update(id, name);
    closeModal();
    renderGroupsPage();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteGroup(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الأسرة؟')) return;

  try {
    await GroupsAPI.delete(id);
    renderGroupsPage();
  } catch (error) {
    alert(error.message);
  }
}

// ==================== Supervisors Page ====================
async function renderSupervisorsPage() {
  try {
    const supervisors = await SupervisorsAPI.getAll();

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-user-tie"></i> إدارة المشرفين</h1>
        <button class="btn btn-primary btn-small" onclick="showAddSupervisorModal()">
          <i class="fas fa-plus"></i> إضافة مشرف
        </button>
      </div>

      <div class="card">
        <div class="card-body">
          ${supervisors.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>الرمز</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${supervisors.map((s, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${s.name}</td>
                      <td><code>${s.code}</code></td>
                      <td>
                        <div class="action-btns">
                          <button class="action-btn delete" onclick="deleteSupervisor(${s.id})">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <i class="fas fa-user-tie"></i>
              <h3>لا يوجد مشرفين</h3>
              <p>ابدأ بإضافة مشرف جديد</p>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

function showAddSupervisorModal() {
  openModal('إضافة مشرف جديد', `
    <div class="form-group">
      <label>اسم المشرف</label>
      <input type="text" id="supervisor-name" placeholder="أدخل اسم المشرف">
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="addSupervisor()">إضافة</button>
  `);
}

async function addSupervisor() {
  const name = document.getElementById('supervisor-name').value;
  if (!name) return alert('الرجاء إدخال اسم المشرف');

  try {
    const result = await SupervisorsAPI.create(name);
    closeModal();
    alert(`تم إنشاء المشرف بنجاح!\nالرمز: ${result.code}`);
    renderSupervisorsPage();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSupervisor(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المشرف؟')) return;

  try {
    await SupervisorsAPI.delete(id);
    renderSupervisorsPage();
  } catch (error) {
    alert(error.message);
  }
}

// ==================== Students Page ====================
async function renderStudentsPage() {
  try {
    const [students, groups] = await Promise.all([
      StudentsAPI.getAll(),
      GroupsAPI.getAll()
    ]);

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-user-graduate"></i> إدارة الطلاب</h1>
        ${currentUser.role === 'admin' ? `
          <button class="btn btn-primary btn-small" onclick="showAddStudentModal()">
            <i class="fas fa-plus"></i> إضافة طالب
          </button>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-body">
          ${students.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>الرمز</th>
                    <th>الأسرة</th>
                    <th>النقاط</th>
                    ${currentUser.role === 'admin' || currentUser.role === 'supervisor' ? '<th>الإجراءات</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${students.map((s, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${s.name}</td>
                      <td><code>${s.code}</code></td>
                      <td>${s.group_name || 'غير محدد'}</td>
                      <td>
                        <div class="points-cell">
                          <span class="fuel-indicator" id="fuel-${s.id}">${getFuelEmoji(s.total_points || 0)}</span>
                          <span class="points-badge" id="points-${s.id}">${s.total_points || 0}</span>
                          ${currentUser.role === 'admin' || currentUser.role === 'supervisor' ? `
                            <div class="points-actions">
                              <button class="points-btn add" onclick="showAddPointsModal(${s.id}, '${s.name}', ${s.total_points || 0}, ${s.group_id || 'null'})" title="إضافة نقاط">
                                <i class="fas fa-plus"></i>
                              </button>
                              <button class="points-btn subtract" onclick="showSubtractPointsModal(${s.id}, '${s.name}', ${s.total_points || 0}, ${s.group_id || 'null'})" title="خصم نقاط">
                                <i class="fas fa-minus"></i>
                              </button>
                            </div>
                          ` : ''}
                        </div>
                      </td>
                      ${currentUser.role === 'admin' || currentUser.role === 'supervisor' ? `
                        <td>
                          <div class="action-btns">
                            ${currentUser.role === 'admin' ? `
                              <button class="action-btn edit" onclick='showEditStudentModal(${JSON.stringify(s)})'>
                                <i class="fas fa-edit"></i>
                              </button>
                              <button class="action-btn delete" onclick="deleteStudent(${s.id})">
                                <i class="fas fa-trash"></i>
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      ` : ''}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <i class="fas fa-user-graduate"></i>
              <h3>لا يوجد طلاب</h3>
              <p>ابدأ بإضافة طالب جديد</p>
            </div>
          `}
        </div>
      </div>
    `;

    // Store groups for modal
    window.groupsList = groups;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

function showAddStudentModal() {
  const groupsOptions = window.groupsList?.map(g =>
    `<option value="${g.id}">${g.name}</option>`
  ).join('') || '';

  openModal('إضافة طالب جديد', `
    <div class="form-group">
      <label>اسم الطالب</label>
      <input type="text" id="student-name" placeholder="أدخل اسم الطالب">
    </div>
    <div class="form-group">
      <label>الأسرة</label>
      <select id="student-group">
        <option value="">بدون أسرة</option>
        ${groupsOptions}
      </select>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="addStudent()">إضافة</button>
  `);
}

function showEditStudentModal(student) {
  const groupsOptions = window.groupsList?.map(g =>
    `<option value="${g.id}" ${g.id === student.group_id ? 'selected' : ''}>${g.name}</option>`
  ).join('') || '';

  openModal('تعديل الطالب', `
    <div class="form-group">
      <label>اسم الطالب</label>
      <input type="text" id="student-name" value="${student.name}">
    </div>
    <div class="form-group">
      <label>الأسرة</label>
      <select id="student-group">
        <option value="">بدون أسرة</option>
        ${groupsOptions}
      </select>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="updateStudent(${student.id})">حفظ</button>
  `);
}

async function addStudent() {
  const name = document.getElementById('student-name').value;
  const group_id = document.getElementById('student-group').value;

  if (!name) return alert('الرجاء إدخال اسم الطالب');

  try {
    const result = await StudentsAPI.create(name, group_id || null);
    closeModal();
    alert(`تم إنشاء الطالب بنجاح!\nالرمز: ${result.code}`);
    renderStudentsPage();
  } catch (error) {
    alert(error.message);
  }
}

async function updateStudent(id) {
  const name = document.getElementById('student-name').value;
  const group_id = document.getElementById('student-group').value;

  if (!name) return alert('الرجاء إدخال اسم الطالب');

  try {
    await StudentsAPI.update(id, name, group_id || null);
    closeModal();
    renderStudentsPage();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteStudent(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الطالب؟')) return;

  try {
    await StudentsAPI.delete(id);
    renderStudentsPage();
  } catch (error) {
    alert(error.message);
  }
}

// ==================== Points Management ====================

// دالة تحويل النقاط إلى إيموجي الوقود
function getFuelEmoji(points) {
  if (points <= 0) return '⚫';
  if (points >= 5) return '🟦'; // إيثانول
  if (points >= 4) return '⚪'; // 98
  if (points >= 3) return '🟥'; // 95
  if (points >= 2) return '🟩'; // 91
  return '🟫'; // ديزل
}

function getFuelName(points) {
  if (points <= 0) return 'لا يوجد';
  if (points >= 5) return 'إيثانول';
  if (points >= 4) return '98';
  if (points >= 3) return '95';
  if (points >= 2) return '91';
  return 'ديزل';
}

function showAddPointsModal(studentId, studentName, currentPoints = 0, groupId = null) {
  openModal(`إضافة نقاط - ${studentName}`, `
    <div class="current-fuel-status">
      <span>الوقود الحالي: ${getFuelEmoji(currentPoints)} ${getFuelName(currentPoints)} (${currentPoints} نقاط)</span>
    </div>
    <div class="form-group">
      <label>عدد النقاط للإضافة</label>
      <input type="number" id="points-amount" min="1" value="1" class="points-input">
    </div>
    <div class="form-group">
      <label>السبب (اختياري)</label>
      <input type="text" id="points-reason" placeholder="سبب إضافة النقاط">
    </div>
    ${groupId ? `
    <div class="form-group checkbox-group">
      <label>
        <input type="checkbox" id="apply-to-group">
        تطبيق على الأسرة أيضاً
      </label>
    </div>
    ` : ''}
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-primary btn-small" onclick="addPoints(${studentId}, ${groupId || 'null'})">إضافة</button>
  `);
}

function showSubtractPointsModal(studentId, studentName, currentPoints = 0, groupId = null) {
  if (currentPoints <= 0) {
    alert('لا يمكن خصم نقاط - الطالب ليس لديه نقاط');
    return;
  }

  openModal(`خصم نقاط - ${studentName}`, `
    <div class="current-fuel-status">
      <span>الوقود الحالي: ${getFuelEmoji(currentPoints)} ${getFuelName(currentPoints)} (${currentPoints} نقاط)</span>
    </div>
    <div class="form-group">
      <label>عدد النقاط للخصم (الحد الأقصى: ${currentPoints})</label>
      <input type="number" id="points-amount" min="1" max="${currentPoints}" value="1" class="points-input">
    </div>
    <div class="form-group">
      <label>السبب (اختياري)</label>
      <input type="text" id="points-reason" placeholder="سبب خصم النقاط">
    </div>
    ${groupId ? `
    <div class="form-group checkbox-group">
      <label>
        <input type="checkbox" id="apply-to-group">
        تطبيق على الأسرة أيضاً
      </label>
    </div>
    ` : ''}
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-danger btn-small" onclick="subtractPoints(${studentId}, ${groupId || 'null'})">خصم</button>
  `);
}

async function addPoints(studentId, groupId = null) {
  const points = parseInt(document.getElementById('points-amount').value);
  const reason = document.getElementById('points-reason').value;
  const applyToGroupCheckbox = document.getElementById('apply-to-group');
  const applyToGroup = applyToGroupCheckbox ? applyToGroupCheckbox.checked : false;

  try {
    const response = await fetch(`${API_URL}/students/${studentId}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        action: 'add',
        reason: reason || 'إضافة نقاط يدوية',
        reviewer_id: currentUser.id,
        apply_to_group: applyToGroup,
        group_id: groupId
      })
    });

    const data = await response.json();
    if (data.success) {
      closeModal();
      // تحديث النقاط والوقود في الصفحة بدون إعادة تحميل
      updateStudentPoints(studentId, data.total_points);
      const groupMsg = applyToGroup ? ' (+ الأسرة)' : '';
      alert(`تم إضافة النقاط بنجاح${groupMsg}! الوقود الجديد: ${data.fuel_emoji} ${data.fuel_type}`);
    } else {
      alert(data.message || 'حدث خطأ');
    }
  } catch (error) {
    alert('حدث خطأ في الاتصال');
  }
}

async function subtractPoints(studentId, groupId = null) {
  const points = parseInt(document.getElementById('points-amount').value);
  const reason = document.getElementById('points-reason').value;
  const applyToGroupCheckbox = document.getElementById('apply-to-group');
  const applyToGroup = applyToGroupCheckbox ? applyToGroupCheckbox.checked : false;

  try {
    const response = await fetch(`${API_URL}/students/${studentId}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        action: 'subtract',
        reason: reason || 'خصم نقاط يدوي',
        reviewer_id: currentUser.id,
        apply_to_group: applyToGroup,
        group_id: groupId
      })
    });

    const data = await response.json();
    if (data.success) {
      closeModal();
      // تحديث النقاط والوقود في الصفحة بدون إعادة تحميل
      updateStudentPoints(studentId, data.total_points);
      alert(`تم خصم النقاط بنجاح! الوقود الجديد: ${data.fuel_emoji} ${data.fuel_type}`);
    } else {
      alert(data.message || 'حدث خطأ');
    }
  } catch (error) {
    alert('حدث خطأ في الاتصال');
  }
}

// تحديث عرض النقاط والوقود
function updateStudentPoints(studentId, newPoints) {
  const pointsEl = document.getElementById(`points-${studentId}`);
  const fuelEl = document.getElementById(`fuel-${studentId}`);

  if (pointsEl) pointsEl.textContent = newPoints;
  if (fuelEl) fuelEl.textContent = getFuelEmoji(newPoints);
}

// ==================== Requests Page ====================
async function renderRequestsPage() {
  try {
    const requests = await RequestsAPI.getAll();

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-clipboard-list"></i> إدارة الطلبات</h1>
        <div class="header-actions">
          <select id="filter-status" onchange="filterRequests()">
            <option value="">جميع الطلبات</option>
            <option value="pending">قيد المراجعة</option>
            <option value="approved">مقبول</option>
            <option value="rejected">مرفوض</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          ${requests.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الطالب</th>
                    <th>الأسرة</th>
                    <th>اللجنة</th>
                    <th>الوصف</th>
                    <th>النقاط</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody id="requests-table">
                  ${renderRequestsRows(requests)}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <i class="fas fa-clipboard-list"></i>
              <h3>لا توجد طلبات</h3>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

function renderRequestsRows(requests) {
  const fuelNames = { 1: 'ديزل', 2: '91', 3: '95', 4: '98', 5: 'إيثانول' };

  return requests.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.student_name}</td>
      <td>${r.group_name || '-'}</td>
      <td>${r.committee}</td>
      <td>${r.description.substring(0, 30)}${r.description.length > 30 ? '...' : ''}</td>
      <td>${r.points} (${fuelNames[r.points]})</td>
      <td>
        <span class="status-badge status-${r.status}">
          ${r.status === 'pending' ? 'قيد المراجعة' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}
        </span>
      </td>
      <td>
        ${r.status === 'pending' ? `
          <div class="action-btns">
            <button class="action-btn approve" onclick="approveRequest(${r.id})">
              <i class="fas fa-check"></i>
            </button>
            <button class="action-btn reject" onclick="showRejectModal(${r.id})">
              <i class="fas fa-times"></i>
            </button>
          </div>
        ` : '-'}
      </td>
    </tr>
  `).join('');
}

async function filterRequests() {
  const status = document.getElementById('filter-status').value;
  try {
    const requests = await RequestsAPI.getAll(status);
    document.getElementById('requests-table').innerHTML = renderRequestsRows(requests);
  } catch (error) {
    alert(error.message);
  }
}

async function approveRequest(id) {
  try {
    await RequestsAPI.approve(id, currentUser.id);
    renderRequestsPage();
  } catch (error) {
    alert(error.message);
  }
}

function showRejectModal(id) {
  openModal('رفض الطلب', `
    <div class="form-group">
      <label>سبب الرفض (اختياري)</label>
      <textarea id="rejection-reason" rows="3" placeholder="أدخل سبب الرفض..."></textarea>
    </div>
  `, `
    <button class="btn btn-secondary btn-small" onclick="closeModal()">إلغاء</button>
    <button class="btn btn-danger btn-small" onclick="rejectRequest(${id})">رفض</button>
  `);
}

async function rejectRequest(id) {
  const reason = document.getElementById('rejection-reason').value;
  try {
    await RequestsAPI.reject(id, currentUser.id, reason);
    closeModal();
    renderRequestsPage();
  } catch (error) {
    alert(error.message);
  }
}

// ==================== New Request Page (Student) ====================
function renderNewRequestPage() {
  const committees = ['علمي', 'اجتماعي', 'ثقافي', 'إعلامي', 'رياضي', 'متابعة', 'عامة'];
  const fuelInfo = {
    1: { name: 'ديزل', color: '#8B7355', emoji: '🟫' },
    2: { name: '91', color: '#22c55e', emoji: '🟩' },
    3: { name: '95', color: '#ef4444', emoji: '🟥' },
    4: { name: '98', color: '#e5e5e5', emoji: '⚪' },
    5: { name: 'إيثانول', color: '#3b82f6', emoji: '🟦' }
  };

  mainContent.innerHTML = `
    <div class="page-header">
      <h1><i class="fas fa-plus-circle"></i> طلب جديد</h1>
    </div>

    <div class="card">
      <div class="card-body">
        <form id="new-request-form">
          <div class="form-group">
            <label>اللجنة</label>
            <select id="request-committee" required>
              <option value="">اختر اللجنة</option>
              ${committees.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>وصف المهمة</label>
            <textarea id="request-description" rows="4" placeholder="اكتب وصف المهمة التي أنجزتها..." required></textarea>
          </div>

          <div class="form-group">
            <label>عدد النقاط (نوع الوقود)</label>
            <select id="request-points" required onchange="updateFuelPreview()">
              <option value="">اختر عدد النقاط</option>
              ${Object.entries(fuelInfo).map(([points, info]) =>
                `<option value="${points}">${points} نقطة - ${info.emoji} ${info.name}</option>`
              ).join('')}
            </select>
          </div>

          <div id="fuel-preview" style="display: none; margin-bottom: 20px; padding: 15px; border-radius: 10px; text-align: center;">
            <p>سيتم إضافة: <strong id="preview-text"></strong></p>
          </div>

          <button type="submit" class="btn btn-primary">
            <i class="fas fa-paper-plane"></i> إرسال الطلب
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('new-request-form').addEventListener('submit', submitNewRequest);
}

function updateFuelPreview() {
  const points = document.getElementById('request-points').value;
  const preview = document.getElementById('fuel-preview');
  const previewText = document.getElementById('preview-text');

  if (!points) {
    preview.style.display = 'none';
    return;
  }

  const fuelInfo = {
    1: { name: 'ديزل', color: '#8B7355', emoji: '🟫' },
    2: { name: '91', color: '#22c55e', emoji: '🟩' },
    3: { name: '95', color: '#ef4444', emoji: '🟥' },
    4: { name: '98', color: '#d4d4d4', emoji: '⚪' },
    5: { name: 'إيثانول', color: '#3b82f6', emoji: '🟦' }
  };

  const info = fuelInfo[points];
  preview.style.display = 'block';
  preview.style.background = `${info.color}20`;
  preview.style.border = `2px solid ${info.color}`;
  previewText.innerHTML = `1 لتر ${info.name} ${info.emoji}`;
}

async function submitNewRequest(e) {
  e.preventDefault();

  const committee = document.getElementById('request-committee').value;
  const description = document.getElementById('request-description').value;
  const points = parseInt(document.getElementById('request-points').value);

  if (!committee || !description || !points) {
    return alert('الرجاء ملء جميع الحقول');
  }

  try {
    await RequestsAPI.create(currentUser.id, committee, description, points);
    alert('تم إرسال الطلب بنجاح!');
    navigateTo('my-requests');
  } catch (error) {
    alert(error.message);
  }
}

// ==================== My Group Page (Student) ====================
async function renderMyGroupPage() {
  try {
    const settings = await SettingsAPI.getAll();
    const hidePoints = settings.hide_points_from_all === 'true';

    if (!currentUser.group_id) {
      mainContent.innerHTML = `
        <div class="page-header">
          <h1><i class="fas fa-users"></i> أسرتي</h1>
        </div>
        <div class="card">
          <div class="card-body">
            <div class="empty-state">
              <i class="fas fa-user-friends"></i>
              <h3>لست منضماً لأي أسرة</h3>
              <p>تواصل مع المشرف لإضافتك إلى أسرة</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const group = await GroupsAPI.getDetails(currentUser.group_id);

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-users"></i> أسرتي - ${group.name}</h1>
      </div>

      ${hidePoints ? `
        <div class="card hidden-points-notice">
          <div class="card-body">
            <div class="empty-state">
              <i class="fas fa-eye-slash"></i>
              <h3>النقاط مخفية حالياً</h3>
              <p>سيتم الكشف عن النقاط قريباً. ترقبوا الإعلان!</p>
            </div>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="card-header">
            <h2>خزانات الأسرة</h2>
            <span>المجموع: ${group.total_points} نقطة</span>
          </div>
          <div class="card-body">
            <div class="group-points-summary">
              <div class="points-summary-item">
                <span class="label">نقاط الأفراد:</span>
                <span class="value">${group.members_points}</span>
              </div>
              <div class="points-summary-item">
                <span class="label">نقاط الأسرة المباشرة:</span>
                <span class="value">${group.direct_points}</span>
              </div>
              <div class="points-summary-item total">
                <span class="label">الإجمالي:</span>
                <span class="value">${group.total_points}</span>
              </div>
            </div>
            <div class="fuel-tanks-container">
              ${renderFuelTank('ديزل', group.fuel.diesel, 'diesel', '#8B7355')}
              ${renderFuelTank('91', group.fuel.fuel91, 'fuel91', '#22c55e')}
              ${renderFuelTank('95', group.fuel.fuel95, 'fuel95', '#ef4444')}
              ${renderFuelTank('98', group.fuel.fuel98, 'fuel98', '#e5e5e5')}
              ${renderFuelTank('إيثانول', group.fuel.ethanol, 'ethanol', '#3b82f6')}
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <div class="card-header">
            <h2>أعضاء الأسرة (${group.members.length})</h2>
          </div>
          <div class="card-body">
            ${group.members.length > 0 ? `
              <div class="members-list">
                ${group.members.map((m, i) => `
                  <div class="member-item ${m.id === currentUser.id ? 'current-user' : ''}">
                    <div class="member-rank">${i + 1}</div>
                    <div class="member-info">
                      <span class="member-name">${m.name} ${m.id === currentUser.id ? '(أنت)' : ''}</span>
                      <span class="member-points">${m.total_points || 0} نقطة</span>
                    </div>
                    <div class="member-fuel">${getFuelEmoji(m.total_points || 0)}</div>
                  </div>
                `).join('')}
              </div>
            ` : '<p>لا يوجد أعضاء في هذه الأسرة</p>'}
          </div>
        </div>
      `}
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

// ==================== My Requests Page (Student) ====================
async function renderMyRequestsPage() {
  try {
    const requests = await RequestsAPI.getByStudent(currentUser.id);
    const fuelNames = { 1: 'ديزل', 2: '91', 3: '95', 4: '98', 5: 'إيثانول' };

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-history"></i> طلباتي</h1>
      </div>

      <div class="card">
        <div class="card-body">
          ${requests.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>اللجنة</th>
                    <th>الوصف</th>
                    <th>النقاط</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  ${requests.map((r, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${r.committee}</td>
                      <td>${r.description.substring(0, 40)}${r.description.length > 40 ? '...' : ''}</td>
                      <td>${r.points} (${fuelNames[r.points]})</td>
                      <td>
                        <span class="status-badge status-${r.status}">
                          ${r.status === 'pending' ? 'قيد المراجعة' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}
                        </span>
                        ${r.status === 'rejected' && r.rejection_reason ? `<br><small>${r.rejection_reason}</small>` : ''}
                      </td>
                      <td>${new Date(r.created_at).toLocaleDateString('ar-SA')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <i class="fas fa-clipboard-list"></i>
              <h3>لا توجد طلبات</h3>
              <p>لم ترسل أي طلبات بعد</p>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

// ==================== Reports Page ====================
async function renderReportsPage() {
  try {
    const [groups, students] = await Promise.all([
      GroupsAPI.getAll(),
      StudentsAPI.getAll()
    ]);

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-chart-bar"></i> التقارير والتصدير</h1>
      </div>

      <div class="stats-grid">
        <div class="card">
          <div class="card-header">
            <h2><i class="fas fa-file-pdf"></i> تصدير PDF</h2>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label>تصدير حسب</label>
              <select id="export-type" onchange="updateExportOptions()">
                <option value="all">جميع الطلاب</option>
                <option value="group">أسرة معينة</option>
                <option value="student">طالب معين</option>
              </select>
            </div>

            <div id="export-group-select" class="form-group" style="display: none;">
              <label>اختر الأسرة</label>
              <select id="export-group">
                ${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
              </select>
            </div>

            <div id="export-student-select" class="form-group" style="display: none;">
              <label>اختر الطالب</label>
              <select id="export-student">
                ${students.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
              </select>
            </div>

            <button class="btn btn-primary" onclick="exportPDF()">
              <i class="fas fa-download"></i> تحميل التقرير
            </button>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

function updateExportOptions() {
  const type = document.getElementById('export-type').value;
  document.getElementById('export-group-select').style.display = type === 'group' ? 'block' : 'none';
  document.getElementById('export-student-select').style.display = type === 'student' ? 'block' : 'none';
}

function exportPDF() {
  const type = document.getElementById('export-type').value;
  let url;

  switch(type) {
    case 'all':
      url = ExportAPI.allPDF();
      break;
    case 'group':
      const groupId = document.getElementById('export-group').value;
      url = ExportAPI.groupPDF(groupId);
      break;
    case 'student':
      const studentId = document.getElementById('export-student').value;
      url = ExportAPI.studentPDF(studentId);
      break;
  }

  window.open(url, '_blank');
}

// ==================== Notifications ====================
function toggleNotifications() {
  const panel = document.getElementById('notifications-panel');
  panel.classList.toggle('active');

  if (panel.classList.contains('active')) {
    loadNotifications();
  }
}

async function loadNotifications() {
  try {
    const notifications = await NotificationsAPI.getAll(currentUser.id);
    const list = document.getElementById('notifications-list');

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-bell-slash"></i>
          <p>لا توجد إشعارات</p>
        </div>
      `;
      return;
    }

    list.innerHTML = notifications.map(n => `
      <div class="notification-item ${n.is_read ? '' : 'unread'}">
        <h4>${n.title}</h4>
        <p>${n.message}</p>
        <span class="time">${new Date(n.created_at).toLocaleDateString('ar-SA')}</span>
      </div>
    `).join('');

    // Mark as read
    await NotificationsAPI.markAsRead(currentUser.id);
    updateNotificationBadge();
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

async function updateNotificationBadge() {
  try {
    const { count } = await NotificationsAPI.getUnreadCount(currentUser.id);
    const badge = document.getElementById('notif-badge');

    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}

// ==================== Settings Page ====================
async function renderSettingsPage() {
  try {
    const settings = await SettingsAPI.getAll();

    mainContent.innerHTML = `
      <div class="page-header">
        <h1><i class="fas fa-cog"></i> الإعدادات</h1>
      </div>

      <div class="card">
        <div class="card-header">
          <h2><i class="fas fa-eye-slash"></i> إعدادات العرض</h2>
        </div>
        <div class="card-body">
          <div class="settings-list">
            <div class="setting-item ${settings.hide_points_from_all === 'true' ? 'setting-danger' : ''}">
              <div class="setting-info">
                <h3>🔒 إخفاء النقاط عن الجميع</h3>
                <p>إخفاء جميع النقاط والخزانات عن الطلاب والأسر (للإعلان عن الفائز)</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-hide-points" ${settings.hide_points_from_all === 'true' ? 'checked' : ''} onchange="toggleHidePoints(this.checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h2>إعدادات النقاط</h2>
        </div>
        <div class="card-body">
          <div class="settings-list">
            <div class="setting-item">
              <div class="setting-info">
                <h3>الصب التلقائي للأسرة</h3>
                <p>عند إضافة نقاط للفرد، تُضاف تلقائياً لأسرته</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-auto-sync" ${settings.auto_sync_to_group === 'true' ? 'checked' : ''} onchange="updateSetting('auto_sync_to_group', this.checked)">
                <span class="slider"></span>
              </label>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <h3>صب الطلبات المقبولة</h3>
                <p>عند قبول طلب الطالب، تُضاف النقاط لأسرته</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-sync-requests" ${settings.sync_approved_requests === 'true' ? 'checked' : ''} onchange="updateSetting('sync_approved_requests', this.checked)">
                <span class="slider"></span>
              </label>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <h3>صب التعديلات اليدوية</h3>
                <p>عند تعديل نقاط الطالب يدوياً، تتأثر نقاط أسرته</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-sync-manual" ${settings.sync_manual_adjustments === 'true' ? 'checked' : ''} onchange="updateSetting('sync_manual_adjustments', this.checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h2>سجل العمليات</h2>
        </div>
        <div class="card-body">
          <button class="btn btn-primary" onclick="showPointsLog()">
            <i class="fas fa-history"></i> عرض سجل العمليات
          </button>
        </div>
      </div>
    `;
  } catch (error) {
    mainContent.innerHTML = `<div class="error-message">${error.message}</div>`;
  }
}

async function toggleHidePoints(hide) {
  if (hide) {
    if (!confirm('⚠️ هل أنت متأكد من إخفاء النقاط عن جميع الطلاب والأسر؟\n\nلن يتمكن أحد من رؤية النقاط حتى تقوم بإلغاء هذا الإعداد.')) {
      document.getElementById('setting-hide-points').checked = false;
      return;
    }
  }
  await updateSetting('hide_points_from_all', hide);
  renderSettingsPage();
}

async function updateSetting(key, value) {
  try {
    await SettingsAPI.update(key, value.toString());
  } catch (error) {
    alert('حدث خطأ في حفظ الإعداد');
  }
}

async function showPointsLog() {
  try {
    const logs = await PointsLogAPI.getAll();

    openModal('سجل العمليات', `
      <div class="table-container" style="max-height: 400px; overflow-y: auto;">
        ${logs.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>النوع</th>
                <th>الهدف</th>
                <th>النقاط</th>
                <th>السبب</th>
                <th>المنفذ</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(log => `
                <tr>
                  <td>${log.operation_type === 'add' ? 'إضافة' : log.operation_type === 'subtract' ? 'خصم' : 'نسبة'}</td>
                  <td>${log.target_type === 'group' ? 'أسرة' : 'فرد'} #${log.target_id}</td>
                  <td>${log.percentage ? log.percentage + '%' : log.points}</td>
                  <td>${log.reason || '-'}</td>
                  <td>${log.performer_name || '-'}</td>
                  <td>${new Date(log.created_at).toLocaleDateString('ar-SA')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p>لا توجد عمليات مسجلة</p>'}
      </div>
    `, `
      <button class="btn btn-secondary btn-small" onclick="closeModal()">إغلاق</button>
    `);
  } catch (error) {
    alert(error.message);
  }
}

// ==================== Modal ====================
function openModal(title, body, footer) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') {
    closeModal();
  }
});
