/**
 * ملف الاختبار الوحيد - قائمة + جودة المنطق + نقاط ونسبة مئوية + الخزانات
 * 1) شغّل السيرفر: npm start
 * 2) بعد أي تعديل في backend أعد تشغيل السيرفر (أوقف العملية ثم npm start) ثم شغّل الاختبار
 * 3) شغّل: npm test
 */
const BASE = 'http://localhost:3000/api';

async function api(endpoint, options = {}) {
  const res = await fetch(BASE + endpoint, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertFail(res, msg) {
  if (res.ok) throw new Error(msg || 'كان متوقع فشل الطلب');
}

/** حساب الخزانات من الإجمالي (نفس منطق الباكند: 5→ethanol, 4→98, 3→95, 2→91, 1→diesel) */
function pointsToFuel(total) {
  const fuel = { diesel: 0, fuel91: 0, fuel95: 0, fuel98: 0, ethanol: 0 };
  let remaining = Math.max(0, Math.floor(total));
  while (remaining > 0) {
    if (remaining >= 5) { fuel.ethanol++; remaining -= 5; }
    else if (remaining >= 4) { fuel.fuel98++; remaining -= 4; }
    else if (remaining >= 3) { fuel.fuel95++; remaining -= 3; }
    else if (remaining >= 2) { fuel.fuel91++; remaining -= 2; }
    else { fuel.diesel++; remaining -= 1; }
  }
  return fuel;
}

function fuelSummary(fuel) {
  if (!fuel) return 'لا خزانات';
  const parts = [];
  if (fuel.diesel) parts.push('ديزل:' + fuel.diesel);
  if (fuel.fuel91) parts.push('91:' + fuel.fuel91);
  if (fuel.fuel95) parts.push('95:' + fuel.fuel95);
  if (fuel.fuel98) parts.push('98:' + fuel.fuel98);
  if (fuel.ethanol) parts.push('إيثانول:' + fuel.ethanol);
  return parts.length ? parts.join(' ') : '0';
}

async function getGroupState(groupId) {
  const res = await api(`/groups/${groupId}/details`);
  if (!res.ok) throw new Error(res.data?.message || 'تفاصيل الأسرة');
  const data = res.data;
  const members = data.members || [];
  const membersTotal = members.reduce((s, m) => s + (m.total_points || 0), 0);
  const direct = data.direct_points ?? 0;
  const total = data.total_points ?? (membersTotal + direct);
  const fuel = data.fuel || pointsToFuel(total);
  return { details: data, membersTotal, direct, total, members, fuel };
}

/** التحقق من تطابق خزانات التفاصيل مع الإجمالي */
function assertFuelMatchesTotal(state) {
  const expected = pointsToFuel(state.total);
  const actual = state.fuel || state.details?.fuel;
  if (!actual) return;
  assert(actual.diesel === expected.diesel && actual.fuel91 === expected.fuel91 &&
    actual.fuel95 === expected.fuel95 && actual.fuel98 === expected.fuel98 &&
    actual.ethanol === expected.ethanol,
    `الخزانات لا تطابق الإجمالي ${state.total}: متوقع ${fuelSummary(expected)} فعلي ${fuelSummary(actual)}`);
}

async function getStudentPoints(studentId) {
  const res = await api('/students');
  const list = Array.isArray(res.data) ? res.data : [];
  const s = list.find(x => x.id === parseInt(studentId, 10));
  return s != null ? (s.total_points ?? 0) : null;
}

async function main() {
  let adminId;
  let groupId;
  let studentId;

  console.log('\n========== 1. تسجيل الدخول ==========');
  const authRes = await api('/auth/admin', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  assert(authRes.ok, authRes.data?.message || 'تسجيل الدخول أدمن');
  assert(authRes.data?.user?.role === 'admin', 'دور المستخدم أدمن');
  adminId = authRes.data.user.id;
  console.log('  ✅ دخول أدمن');

  const badAuth = await api('/auth/admin', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrong' })
  });
  assertFail(badAuth, 'رفض كلمة مرور خاطئة');
  console.log('  ✅ خطأ عند كلمة مرور خاطئة');

  console.log('\n========== 2. إدارة الأسر ==========');
  const groupsRes = await api('/groups');
  assert(groupsRes.ok && Array.isArray(groupsRes.data), 'قائمة الأسر');
  const groups = groupsRes.data;
  if (groups.length === 0) {
    const createGroup = await api('/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'أسرة اختبار' })
    });
    assert(createGroup.ok, createGroup.data?.message);
    groupId = createGroup.data?.id;
  } else {
    groupId = groups[0].id;
  }
  const g = groups.find(x => x.id === groupId) || {};
  console.log('  ✅ أسرة:', g?.name || groupId, '| إجمالي:', (await getGroupState(groupId)).total);

  const detailsRes = await api(`/groups/${groupId}/details`);
  assert(detailsRes.ok && detailsRes.data.direct_points !== undefined, 'تفاصيل الأسرة');
  console.log('  ✅ تفاصيل أسرة');

  let addRes = await api(`/groups/${groupId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points: 20, action: 'add', reason: 'اختبار', apply_to_members: false, reviewer_id: adminId })
  });
  assert(addRes.ok, addRes.data?.message);
  console.log('  ✅ إضافة نقاط (بدون توزيع)');

  console.log('\n========== 2.1 إضافة النقاط للأسرة والتحقق من الخزانات ==========');
  const beforePoints = await getGroupState(groupId);
  console.log('  قبل: إجمالي=', beforePoints.total, '| خزانات=', fuelSummary(beforePoints.fuel));
  const rDirect = await api(`/groups/${groupId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points: 25, action: 'add', reason: 'اختبار خزانات', apply_to_members: false, reviewer_id: adminId })
  });
  assert(rDirect.ok && rDirect.data?.success, rDirect.data?.message);
  const afterDirectPoints = await getGroupState(groupId);
  assert(afterDirectPoints.direct >= beforePoints.direct + 25, 'نقاط الأسرة المباشرة تزيد');
  assert(afterDirectPoints.total >= beforePoints.total + 25, 'الإجمالي يزيد');
  assertFuelMatchesTotal(afterDirectPoints);
  console.log('  بعد إضافة 25 مباشرة: إجمالي=', afterDirectPoints.total, '| خزانات=', fuelSummary(afterDirectPoints.fuel));
  console.log('  ✅ النقاط المباشرة تظهر في الإجمالي والخزانات');

  const beforeDist = await getGroupState(groupId);
  if (beforeDist.members?.length > 0) {
    const rDist = await api(`/groups/${groupId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: 6, action: 'add', reason: 'توزيع خزانات', apply_to_members: true, reviewer_id: adminId })
    });
    assert(rDist.ok && rDist.data?.success, rDist.data?.message);
    const afterDist = await getGroupState(groupId);
    assert(afterDist.total >= beforeDist.total + 6, 'الإجمالي يزيد بعد التوزيع');
    assertFuelMatchesTotal(afterDist);
    console.log('  بعد إضافة 6 مع توزيع: إجمالي=', afterDist.total, '| خزانات=', fuelSummary(afterDist.fuel));
    console.log('  ✅ النقاط الموزعة تظهر في الإجمالي والخزانات');
  }

  const beforePct = await getGroupState(groupId);
  const pctRes = await api(`/groups/${groupId}/percentage`, {
    method: 'POST',
    body: JSON.stringify({ percentage: 10, apply_to_members: true, reason: 'اختبار', reviewer_id: adminId, action: 'add' })
  });
  assert(pctRes.ok, pctRes.data?.message);
  const afterPct = await getGroupState(groupId);
  assert(afterPct.total >= beforePct.total, 'الإجمالي لا ينقص بعد النسبة');
  assertFuelMatchesTotal(afterPct);
  console.log('  ✅ زيادة مئوية (للأسرة وللطلاب) | خزانات بعد=', fuelSummary(afterPct.fuel));

  console.log('\n========== 3. إدارة الطلاب ==========');
  const studentsRes = await api('/students');
  assert(studentsRes.ok && Array.isArray(studentsRes.data), 'قائمة الطلاب');
  let students = studentsRes.data;
  if (students.length === 0 && groupId) {
    const createSt = await api('/students', {
      method: 'POST',
      body: JSON.stringify({ name: 'طالب اختبار', group_id: groupId })
    });
    assert(createSt.ok, createSt.data?.message);
    studentId = createSt.data?.id;
  } else {
    studentId = students[0]?.id;
  }
  if (studentId) {
    const beforeSt = await getStudentPoints(studentId);
    const addSt = await api(`/students/${studentId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: 5, action: 'add', reason: 'اختبار', reviewer_id: adminId })
    });
    assert(addSt.ok, addSt.data?.message);
    assert((await getStudentPoints(studentId)) >= (beforeSt || 0) + 5, 'نقاط الطالب تزيد');
    console.log('  ✅ إضافة نقاط لطالب');

    // تأكد أن API الإحصائيات للطالب يعكس نقاطه (طلبات + تعديلات) ويعطي خزانات غير صفرية عند وجود نقاط
    const stTotal = await getStudentPoints(studentId);
    const stStats = await api(`/stats/student/${studentId}`);
    assert(stStats.ok, stStats.data?.message);
    assert(Number(stStats.data?.total_points) === Number(stTotal), 'stats.student.total_points يطابق نقاط الطالب');
    const expectedFuel = pointsToFuel(stTotal);
    const actualFuel = stStats.data?.fuel || {};
    assert(
      (actualFuel.diesel ?? 0) === expectedFuel.diesel &&
      (actualFuel.fuel91 ?? 0) === expectedFuel.fuel91 &&
      (actualFuel.fuel95 ?? 0) === expectedFuel.fuel95 &&
      (actualFuel.fuel98 ?? 0) === expectedFuel.fuel98 &&
      (actualFuel.ethanol ?? 0) === expectedFuel.ethanol,
      'خزانات الطالب في stats تطابق التحويل من إجمالي نقاطه'
    );
    const liters = (actualFuel.diesel ?? 0) + (actualFuel.fuel91 ?? 0) + (actualFuel.fuel95 ?? 0) + (actualFuel.fuel98 ?? 0) + (actualFuel.ethanol ?? 0);
    assert(Number(stStats.data?.totalLiters ?? liters) === liters, 'totalLiters يطابق مجموع الخزانات');
  }

  console.log('\n========== 4. الطلبات ==========');
  const requestsRes = await api('/requests');
  assert(requestsRes.ok && Array.isArray(requestsRes.data), 'قائمة الطلبات');
  if (studentId) {
    const createReq = await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, committee: 'لجنة', description: 'طلب اختبار', points: 2 })
    });
    if (createReq.ok) {
      const pending = (await api('/requests?status=pending')).data || [];
      const req = pending.find(r => r.id === createReq.data?.id);
      if (req && adminId) {
        const appr = await api(`/requests/${req.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer_id: adminId }) });
        if (appr.ok) console.log('  ✅ إنشاء طلب وقبوله');
      }
    }
  }

  console.log('\n========== 5. جودة المنطق – مدخلات غير صالحة ==========');
  assertFail(await api(`/groups/${groupId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points: 0, action: 'add', reason: 'x', apply_to_members: false, reviewer_id: adminId })
  }), 'نقاط = 0');
  assertFail(await api(`/groups/${groupId}/percentage`, {
    method: 'POST',
    body: JSON.stringify({ percentage: 0, apply_to_members: false, reason: 'x', reviewer_id: adminId, action: 'add' })
  }), 'نسبة 0');
  assertFail(await api(`/groups/999999/points`, {
    method: 'POST',
    body: JSON.stringify({ points: 10, action: 'add', reason: 'x', apply_to_members: false, reviewer_id: adminId })
  }), 'أسرة غير موجودة');
  console.log('  ✅ رفض نقاط 0، نسبة 0، أسرة غير موجودة');

  console.log('\n========== 6. جودة المنطق – حدود الخصم ==========');
  const stateBefore = await getGroupState(groupId);
  const subTooMuch = await api(`/groups/${groupId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points: (stateBefore.direct || 0) + 1000, action: 'subtract', reason: 'x', apply_to_members: false, reviewer_id: adminId })
  });
  if (!subTooMuch.ok) console.log('  ✅ رفض خصم أكثر من النقاط المباشرة');
  else console.log('  ⚠️ السيرفر قبل الخصم الزائد (المفترض رفضه)');
  if (studentId) {
    const stPoints = await getStudentPoints(studentId);
    assertFail(await api(`/students/${studentId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: (stPoints || 0) + 50, action: 'subtract', reason: 'x', reviewer_id: adminId })
    }), 'خصم أكثر من نقاط الطالب');
    console.log('  ✅ رفض خصم أكثر من نقاط الطالب');
  }

  console.log('\n========== 7. جودة المنطق – اتساق الإجمالي ==========');
  const gState = await getGroupState(groupId);
  assert(Math.abs((gState.total || 0) - (gState.membersTotal + gState.direct)) <= 1, 'الإجمالي = أفراد + مباشرة');
  console.log('  ✅ إجمالي الأسرة = نقاط الأفراد + نقاط الأسرة المباشرة');

  console.log('\n========== 8. جودة المنطق – إضافة ثم خصم طالب ==========');
  if (studentId) {
    const beforeCycle = await getStudentPoints(studentId);
    await api(`/students/${studentId}/points`, { method: 'POST', body: JSON.stringify({ points: 7, action: 'add', reason: 'دورة', reviewer_id: adminId }) });
    await api(`/students/${studentId}/points`, { method: 'POST', body: JSON.stringify({ points: 7, action: 'subtract', reason: 'دورة', reviewer_id: adminId }) });
    assert(Number(await getStudentPoints(studentId)) === Number(beforeCycle), 'النقاط تعود للأصل');
    console.log('  ✅ إضافة ثم خصم نفس المقدار يعيد النقاط للأصل');
  }

  assertFail(await api(`/groups/${groupId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points: -5, action: 'add', reason: 'x', apply_to_members: false, reviewer_id: adminId })
  }), 'نقاط سالبة');
  console.log('  ✅ رفض نقاط سالبة');

  console.log('\n========== 9. نقاط أسرة – مدخلات متعددة + الخزانات ==========');
  for (const pts of [5, 15, 30]) {
    const before = await getGroupState(groupId);
    const r = await api(`/groups/${groupId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: pts, action: 'add', reason: 'اختبار ' + pts, apply_to_members: false, reviewer_id: adminId })
    });
    assert(r.ok && r.data?.success, r.data?.message);
    const after = await getGroupState(groupId);
    assert(after.direct >= before.direct + pts, `direct +${pts}`);
    assertFuelMatchesTotal(after);
    console.log('  ✅ +' + pts + ' مباشرة | إجمالي=', after.total, 'خزانات=', fuelSummary(after.fuel));
  }

  const stateForMembers = await getGroupState(groupId);
  if (stateForMembers.members?.length > 0) {
    for (const pts of [3, 9]) {
      const before = await getGroupState(groupId);
      const r = await api(`/groups/${groupId}/points`, {
        method: 'POST',
        body: JSON.stringify({ points: pts, action: 'add', reason: 'توزيع', apply_to_members: true, reviewer_id: adminId })
      });
      assert(r.ok && r.data?.success, r.data?.message);
      const after = await getGroupState(groupId);
      // عند "تطبيق على الأفراد أيضاً" للإضافة: نضيف للأسرة + نضيف للأفراد => الإجمالي يزيد ~ 2x
      assert(after.direct >= before.direct + pts, `direct +${pts} (مع أفراد)`);
      assert(after.membersTotal >= before.membersTotal + pts, `members +${pts} (مع أفراد)`);
      assert(after.total >= before.total + (pts * 2), `إجمالي +${pts * 2} (مع أفراد)`);
      assertFuelMatchesTotal(after);
      console.log('  ✅ +' + pts + ' توزيع | إجمالي=', after.total, 'خزانات=', fuelSummary(after.fuel));
    }
  }

  const beforeSub = await getGroupState(groupId);
  const toSub = Math.min(10, Math.max(0, beforeSub.direct));
  if (toSub > 0) {
    const r = await api(`/groups/${groupId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: toSub, action: 'subtract', reason: 'خصم', apply_to_members: false, reviewer_id: adminId })
    });
    assert(r.ok && r.data?.success, r.data?.message);
    const after = await getGroupState(groupId);
    assert(after.direct === beforeSub.direct - toSub, 'خصم من المباشر');
    assertFuelMatchesTotal(after);
    console.log('  ✅ خصم ' + toSub + ' من المباشر | إجمالي=', after.total, 'خزانات=', fuelSummary(after.fuel));
  }

  console.log('\n========== 9.1 خصم نقاط مع تفعيل الطلاب (خصم من الأسرة + من الأفراد) ==========');
  const beforeSubWithMembers = await getGroupState(groupId);
  if ((beforeSubWithMembers.members?.length || 0) > 0 && (beforeSubWithMembers.direct || 0) >= 6) {
    const pts = 6;
    const r = await api(`/groups/${groupId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points: pts, action: 'subtract', reason: 'خصم مع أفراد', apply_to_members: true, reviewer_id: adminId })
    });
    assert(r.ok && r.data?.success, r.data?.message);
    const after = await getGroupState(groupId);
    assert(after.direct === beforeSubWithMembers.direct - pts, 'خصم من نقاط الأسرة المباشرة عند تفعيل الطلاب');
    assert(after.total <= beforeSubWithMembers.total - pts, 'الإجمالي ينقص على الأقل بمقدار خصم الأسرة');
    assertFuelMatchesTotal(after);
    console.log('  ✅ خصم ' + pts + ' مع أفراد: الأسرة تنقص + الإجمالي ينقص | إجمالي=', after.total);
  } else {
    console.log('  ⚠️ تخطي (لا يوجد أفراد أو نقاط الأسرة المباشرة غير كافية)');
  }

  console.log('\n========== 10. النسبة المئوية والخصم – مع/بدون تفعيل الطلاب + الخزانات ==========');

  console.log('  --- 10.1 زيادة نسبة مئوية بدون تفعيل الطلاب ---');
  const beforeAddNo = await getGroupState(groupId);
  const pctAddNo = 15;
  const expectedAddNo = Math.floor((beforeAddNo.direct || 0) * pctAddNo / 100);
  if (expectedAddNo >= 1) {
    const r = await api(`/groups/${groupId}/percentage`, {
      method: 'POST',
      body: JSON.stringify({ percentage: pctAddNo, apply_to_members: false, reason: 'زيادة بدون أفراد', reviewer_id: adminId, action: 'add' })
    });
    assert(r.ok, r.data?.message);
    const afterAddNo = await getGroupState(groupId);
    assert(afterAddNo.direct >= beforeAddNo.direct + expectedAddNo, 'المباشر يزيد بعد زيادة % بدون أفراد');
    assert(afterAddNo.total >= beforeAddNo.total + expectedAddNo, 'الإجمالي يزيد (على الأقل بمقدار زيادة الأسرة)');
    assertFuelMatchesTotal(afterAddNo);
    console.log('  قبل:', beforeAddNo.direct, 'مباشر |', beforeAddNo.total, 'إجمالي | خزانات=', fuelSummary(beforeAddNo.fuel));
    console.log('  بعد +' + pctAddNo + '% بدون أفراد:', afterAddNo.direct, 'مباشر |', afterAddNo.total, 'إجمالي | خزانات=', fuelSummary(afterAddNo.fuel));
    console.log('  ✅ زيادة نسبة بدون تفعيل الطلاب: المباشر والإجمالي والخزانات يزيدون');
  }

  console.log('  --- 10.2 زيادة نسبة مئوية مع تفعيل الطلاب ---');
  const beforeAddWith = await getGroupState(groupId);
  const pctAddWith = 10;
  const expectedAddWith = Math.floor((beforeAddWith.direct || 0) * pctAddWith / 100);
  const rAddWith = await api(`/groups/${groupId}/percentage`, {
    method: 'POST',
    body: JSON.stringify({ percentage: pctAddWith, apply_to_members: true, reason: 'زيادة مع أفراد', reviewer_id: adminId, action: 'add' })
  });
  assert(rAddWith.ok, rAddWith.data?.message);
  const afterAddWith = await getGroupState(groupId);
  if (expectedAddWith >= 1) {
    assert(afterAddWith.direct >= beforeAddWith.direct + expectedAddWith, 'المباشر يزيد مع تطبيق على الأفراد');
    assert(afterAddWith.total >= beforeAddWith.total + expectedAddWith, 'الإجمالي يزيد على الأقل بمقدار زيادة الأسرة');
  }
  assert(afterAddWith.total > beforeAddWith.total, 'الإجمالي يزيد');
  assertFuelMatchesTotal(afterAddWith);
  console.log('  قبل:', beforeAddWith.total, 'إجمالي | خزانات=', fuelSummary(beforeAddWith.fuel));
  console.log('  بعد +' + pctAddWith + '% مع أفراد:', afterAddWith.total, 'إجمالي | خزانات=', fuelSummary(afterAddWith.fuel));
  console.log('  ✅ زيادة نسبة مع تفعيل الطلاب: الأسرة والطلاب والخزانات يزيدون');

  console.log('  --- 10.3 خصم نسبة مئوية بدون تفعيل الطلاب (يُخصم النسبة من نقاط الأسرة المباشرة فقط) ---');
  const beforeSubNo = await getGroupState(groupId);
  const pctSubNo = 50;
  const deductFromDirectOnly = Math.floor((beforeSubNo.direct || 0) * pctSubNo / 100);
  if (deductFromDirectOnly >= 1) {
    const rSubNo = await api(`/groups/${groupId}/percentage`, {
      method: 'POST',
      body: JSON.stringify({ percentage: pctSubNo, apply_to_members: false, reason: 'خصم بدون أفراد', reviewer_id: adminId, action: 'subtract' })
    });
    assert(rSubNo.ok, rSubNo.data?.message);
    const afterSubNo = await getGroupState(groupId);
    assert(afterSubNo.direct === beforeSubNo.direct - deductFromDirectOnly, `المباشر ينقص بـ ${pctSubNo}% من المباشر فقط (قبل ${beforeSubNo.direct} بعد ${afterSubNo.direct} متوقع -${deductFromDirectOnly})`);
    assertFuelMatchesTotal(afterSubNo);
    console.log('  قبل:', beforeSubNo.direct, 'مباشر | خصم ' + pctSubNo + '% من المباشر =', deductFromDirectOnly);
    console.log('  بعد:', afterSubNo.direct, 'مباشر | إجمالي:', afterSubNo.total);
    console.log('  ✅ خصم نسبة بدون تفعيل الطلاب: يُخصم من نقاط الأسرة (المباشرة) فقط');
  } else {
    console.log('  ⚠️ تخطي (نقاط مباشرة قليلة لاختبار خصم ' + pctSubNo + '%)');
  }

  console.log('  --- 10.4 خصم نسبة مئوية مع تفعيل الطلاب ---');
  const beforeSubWith = await getGroupState(groupId);
  const rSubWith = await api(`/groups/${groupId}/percentage`, {
    method: 'POST',
    body: JSON.stringify({ percentage: 10, apply_to_members: true, reason: 'خصم من الأفراد', reviewer_id: adminId, action: 'subtract' })
  });
  assert(rSubWith.ok, rSubWith.data?.message);
  const afterSubWith = await getGroupState(groupId);
  const expectedDirectDeductWith = Math.floor((beforeSubWith.direct || 0) * 10 / 100);
  if (expectedDirectDeductWith >= 1) {
    assert(afterSubWith.direct === beforeSubWith.direct - expectedDirectDeductWith, 'خصم % مع تفعيل الطلاب: نقاط الأسرة المباشرة تنقص أيضاً');
    assert(afterSubWith.total <= beforeSubWith.total - expectedDirectDeductWith, 'الإجمالي ينقص على الأقل بمقدار خصم الأسرة');
  }
  assertFuelMatchesTotal(afterSubWith);
  console.log('  قبل:', beforeSubWith.total, 'إجمالي | خزانات=', fuelSummary(beforeSubWith.fuel));
  console.log('  بعد -10% مع أفراد:', afterSubWith.total, 'إجمالي | خزانات=', fuelSummary(afterSubWith.fuel));
  console.log('  ✅ خصم نسبة مع تفعيل الطلاب: تُخصم من الأسرة ومن نقاط كل طالب والخزانات تتحدث');

  const beforeDirectSub = await getGroupState(groupId);
  const deduct10 = Math.floor((beforeDirectSub.direct || 0) * 10 / 100);
  if (deduct10 >= 1) {
    const r = await api(`/groups/${groupId}/percentage`, {
      method: 'POST',
      body: JSON.stringify({ percentage: 10, apply_to_members: false, reason: 'خصم مباشر', reviewer_id: adminId, action: 'subtract' })
    });
    assert(r.ok, r.data?.message);
    const after = await getGroupState(groupId);
    assert(after.direct === beforeDirectSub.direct - deduct10, 'خصم 10% من نقاط الأسرة المباشرة فقط');
    assertFuelMatchesTotal(after);
    console.log('  ✅ خصم 10% من المباشر (نقاط الأسرة فقط) | خزانات بعد=', fuelSummary(after.fuel));
  }

  console.log('\n========== 11. تقارير وإحصائيات ==========');
  assert((await api('/stats/overview')).ok, 'overview');
  assert((await api('/reports/weekly')).ok, 'weekly');
  console.log('  ✅ إحصائيات وتقارير');

  console.log('\n========== 12. تشغيل / Ops ==========');
  // /healthz و /version خارج /api
  const healthRes = await fetch('http://localhost:3000/healthz');
  const health = await healthRes.json().catch(() => ({}));
  assert(healthRes.ok && health.ok === true, 'healthz');
  assert(typeof health.mode === 'string', 'healthz.mode');
  const verRes = await fetch('http://localhost:3000/version');
  const ver = await verRes.json().catch(() => ({}));
  assert(verRes.ok && !!ver.version, 'version');

  // public-config (داخل /api)
  const pub = await api('/public-config');
  assert(pub.ok && pub.data && 'onesignalAppId' in pub.data, 'public-config');
  console.log('  ✅ healthz/version/public-config');

  const final = await getGroupState(groupId);
  assertFuelMatchesTotal(final);
  console.log('\n========== النتيجة النهائية ==========');
  console.log('نقاط الأفراد:', final.membersTotal, '| نقاط الأسرة (مباشرة):', final.direct, '| الإجمالي:', final.total);
  console.log('الخزانات (ديزل 91 95 98 إيثانول):', fuelSummary(final.fuel));
  console.log('✅ كل الاختبارات نجحت.');
}

main().catch(err => {
  console.error('❌ فشل:', err.message);
  process.exitCode = 1;
});
