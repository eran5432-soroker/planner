// Setup dayjs with timezone
dayjs.extend(dayjs_plugin_utc); 
dayjs.extend(dayjs_plugin_timezone); 
dayjs.extend(dayjs_plugin_customParseFormat);
dayjs.extend(dayjs_plugin_isSameOrBefore);
dayjs.extend(dayjs_plugin_minMax);
const TZ = 'Asia/Jerusalem';

// In-memory store
/** @type {Array<{id:string,title:string,factory:string,workers:string[],factoryManager:string,maintenanceManager:string,priority:string,equipmentNumber:string,serviceCall:string,department:string,start:string,end:string,notes:string,dependsOn:string,finished:boolean}>} */
let JOBS = [];
let nextId = 1;

// Undo history
let UNDO_HISTORY = [];
const MAX_UNDO_HISTORY = 20;

// Store for factories, workers, managers, and departments
let FACTORIES = new Set();
let WORKERS = new Set();
let FACTORY_MANAGERS = new Set();
let MAINTENANCE_MANAGERS = new Set();
let DEPARTMENTS = new Set();

// Column visibility settings
let COLUMN_VISIBILITY = {
  title: true,
  factory: true,
  worker: true,
  factoryManager: true,
  maintenanceManager: true,
  priority: true,
  equipmentNumber: true,
  serviceCall: true,
  department: true,
  start: true,
  end: true,
  duration: true,
  notes: true,
  flags: true,
  actions: true
};

// DOM helpers
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function uid(){ return String(nextId++); }

function toLocal(dt){ return dayjs.tz(dt, TZ); }

function fmt(dt){ 
  if(!dt) return '';
  const date = dayjs(dt);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '';
}

function durationStr(a, b){
  if(!a || !b) return '';
  const startDate = dayjs(a);
  const endDate = dayjs(b);
  if(!startDate.isValid() || !endDate.isValid()) return '';
  const mins = endDate.diff(startDate, 'minute');
  const h = Math.floor(mins/60), m = mins%60; 
  return `${h}h ${m}m`;
}

function roundTo15(dateStr){
  if(!dateStr) return dateStr;
  const d = dayjs(dateStr);
  const m = d.minute();
  const rounded = Math.round(m/15)*15; // to nearest 15
  return d.minute(rounded).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
}

function isOverlap(aStart, aEnd, bStart, bEnd){
  return (dayjs(aStart).isBefore(dayjs(bEnd)) && dayjs(bStart).isBefore(dayjs(aEnd)));
}

function isShabbat(dt){
  const d = dayjs(dt);
  const wd = d.day(); // 0=Sun ... 5=Fri 6=Sat
  if(wd === 6) return true; // Saturday
  if(wd === 5 && d.hour()>=18) return true; // Friday 18:00+
  return false;
}

function jobTouchesShabbat(job){
  if(!job.start || !job.end) return false;
  const startDate = dayjs(job.start);
  const endDate = dayjs(job.end);
  if(!startDate.isValid() || !endDate.isValid()) return false;
  return isShabbat(job.start) || isShabbat(job.end) || (startDate.day()===5 && endDate.day()===6);
}

function recomputeConflicts(){
  // For each worker, check overlapping intervals
  const byWorker = new Map();
  JOBS.forEach(j=>{
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    workers.forEach(worker => {
      if(!byWorker.has(worker)) byWorker.set(worker, []);
      byWorker.get(worker).push(j);
    });
  });
  const conflicted = new Set();
  for(const [w, arr] of byWorker){
    arr.sort((a,b)=> dayjs(a.start).valueOf()-dayjs(b.start).valueOf());
    // Check all pairs, not just consecutive ones
    for(let i=0; i<arr.length; i++){
      for(let j=i+1; j<arr.length; j++){
        if(isOverlap(arr[i].start, arr[i].end, arr[j].start, arr[j].end)){
          conflicted.add(arr[i].id);
          conflicted.add(arr[j].id);
        }
      }
    }
  }
  return conflicted;
}

function recomputeDependencyIssues(){
  // Check if jobs that depend on others start before their dependencies end
  const issues = new Set();
  JOBS.forEach(job => {
    if(job.dependsOn && job.start && job.end){
      const dependency = JOBS.find(j => j.id === job.dependsOn);
      if(dependency && dependency.start && dependency.end){
        const jobStart = dayjs(job.start);
        const depEnd = dayjs(dependency.end);
        if(jobStart.isValid() && depEnd.isValid() && jobStart.isBefore(depEnd)){
          issues.add(job.id);
          issues.add(dependency.id);
        }
      }
    }
  });
  return issues;
}

function unique(list){ return Array.from(new Set(list.filter(Boolean))).sort(); }

function updateColumnVisibility(){
  // Update table headers
  $$('thead th[data-column]').forEach(th => {
    const column = th.dataset.column;
    th.style.display = COLUMN_VISIBILITY[column] ? '' : 'none';
  });
  
  // Update table body cells
  $$('tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    cells.forEach((cell, index) => {
      if(index === 0) return; // Skip row number
      const header = $$('thead th')[index];
      if(header && header.dataset.column) {
        const column = header.dataset.column;
        cell.style.display = COLUMN_VISIBILITY[column] ? '' : 'none';
      }
    });
  });
  
  // Update checkboxes
  $$('.column-controls input[type="checkbox"]').forEach(checkbox => {
    const column = checkbox.dataset.column;
    checkbox.checked = COLUMN_VISIBILITY[column];
  });
}

function saveColumnVisibility(){
  localStorage.setItem('columnVisibility', JSON.stringify(COLUMN_VISIBILITY));
}

function loadColumnVisibility(){
  const saved = localStorage.getItem('columnVisibility');
  if(saved) {
    COLUMN_VISIBILITY = { ...COLUMN_VISIBILITY, ...JSON.parse(saved) };
  }
}

function updateFormDropdowns(){
  // Update factory dropdown
  const fSel = $('#f-factory');
  const currentFactory = fSel.value;
  const factories = Array.from(FACTORIES).sort();
  fSel.innerHTML = '<option value="">בחר מפעל...</option>' + 
    factories.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מפעל חדש</option>';
  if(currentFactory && FACTORIES.has(currentFactory)) {
    fSel.value = currentFactory;
  }

  // Update worker multi-select checkboxes
  const wOptions = $('#f-worker-options');
  const currentWorkers = getSelectedWorkers();
  const workers = Array.from(WORKERS).sort();
  wOptions.innerHTML = workers.map(v=>`
    <div class="multi-select-option">
      <input type="checkbox" id="worker-${escapeHtml(v)}" value="${escapeHtml(v)}" ${currentWorkers.includes(v) ? 'checked' : ''}>
      <label for="worker-${escapeHtml(v)}">${escapeHtml(v)}</label>
    </div>
  `).join('');
  
  // Update selected workers display
  updateWorkerDisplay();

  // Update factory manager dropdown
  const fmSel = $('#f-factoryManager');
  const currentFactoryManager = fmSel.value;
  const factoryManagers = Array.from(FACTORY_MANAGERS).sort();
  fmSel.innerHTML = '<option value="">בחר מפקח עבודה...</option>' + 
    factoryManagers.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מפקח עבודה חדש</option>';
  if(currentFactoryManager && FACTORY_MANAGERS.has(currentFactoryManager)) {
    fmSel.value = currentFactoryManager;
  }

  // Update maintenance manager dropdown
  const mmSel = $('#f-maintenanceManager');
  const currentMaintenanceManager = mmSel.value;
  const maintenanceManagers = Array.from(MAINTENANCE_MANAGERS).sort();
  mmSel.innerHTML = '<option value="">בחר מנהל עבודה...</option>' + 
    maintenanceManagers.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מנהל עבודה חדש</option>';
  if(currentMaintenanceManager && MAINTENANCE_MANAGERS.has(currentMaintenanceManager)) {
    mmSel.value = currentMaintenanceManager;
  }

  // Update department dropdown
  const deptSel = $('#f-department');
  const currentDepartment = deptSel.value;
  const departments = Array.from(DEPARTMENTS).sort();
  deptSel.innerHTML = '<option value="">בחר מחלקה...</option>' + 
    departments.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מחלקה חדשה</option>';
  if(currentDepartment && DEPARTMENTS.has(currentDepartment)) {
    deptSel.value = currentDepartment;
  }

  // Update depends on dropdown
  const dSel = $('#f-dependsOn');
  const currentDep = dSel.value;
  dSel.innerHTML = '<option value="">ללא תלות</option>' + 
    JOBS.map(j=>{
      const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
      const workersStr = workers.length > 0 ? workers.join(', ') : 'ללא עובד מבצע';
      return `<option value="${j.id}">${escapeHtml(j.title||'ללא כותרת')} (${escapeHtml(workersStr)})</option>`;
    }).join('');
  if(currentDep) {
    dSel.value = currentDep;
  }
}

function refreshFilters(){
  const factories = unique(JOBS.map(j=>j.factory));
  // Collect all workers from all jobs (flattening the arrays)
  const workersSet = new Set();
  JOBS.forEach(j => {
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    workers.forEach(w => { if(w) workersSet.add(w); });
  });
  const workers = Array.from(workersSet).filter(Boolean).sort();
  const factoryManagers = unique(JOBS.map(j=>j.factoryManager));
  const maintenanceManagers = unique(JOBS.map(j=>j.maintenanceManager));
  const priorities = unique(JOBS.map(j=>j.priority));
  const departments = unique(JOBS.map(j=>j.department));
  
  const fSel = $('#fltFactory'), wSel = $('#fltWorker');
  const fmSel = $('#fltFactoryManager'), mmSel = $('#fltMaintenanceManager');
  const pSel = $('#fltPriority'), dSel = $('#fltDepartment');
  
  fSel.innerHTML = '<option value="">הכל</option>' + factories.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  wSel.innerHTML = '<option value="">הכל</option>' + workers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  fmSel.innerHTML = '<option value="">הכל</option>' + factoryManagers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  mmSel.innerHTML = '<option value="">הכל</option>' + maintenanceManagers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  pSel.innerHTML = '<option value="">הכל</option>' + priorities.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  dSel.innerHTML = '<option value="">הכל</option>' + departments.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  
  // Update form dropdowns
  updateFormDropdowns();
}

function passFilters(j){
  const ff = $('#fltFactory').value.trim();
  const fw = $('#fltWorker').value.trim();
  const ffm = $('#fltFactoryManager').value.trim();
  const fmm = $('#fltMaintenanceManager').value.trim();
  const fp = $('#fltPriority').value.trim();
  const fe = $('#fltEquipmentNumber').value.trim();
  const fs = $('#fltServiceCall').value.trim();
  const fd = $('#fltDepartment').value.trim();
  const fstatus = $('#fltStatus').value.trim();
  const q = $('#fltSearch').value.toLowerCase().trim();
  const from = $('#fltFrom').value; const to = $('#fltTo').value;
  const onlyConf = $('#fltConflictsOnly').checked;
  const onlyDepIssues = $('#fltDependencyIssuesOnly').checked;
  const showBoth = $('#fltShowBoth').checked;
  
  const conflicted = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();
  
  if(ff && j.factory!==ff) return false;
  // Check if any of the workers match the filter
  if(fw) {
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    if(!workers.includes(fw)) return false;
  }
  if(ffm && j.factoryManager!==ffm) return false;
  if(fmm && j.maintenanceManager!==fmm) return false;
  if(fp && j.priority!==fp) return false;
  if(fe && !(j.equipmentNumber||'').toLowerCase().includes(fe.toLowerCase())) return false;
  if(fs && !(j.serviceCall||'').toLowerCase().includes(fs.toLowerCase())) return false;
  if(fd && j.department!==fd) return false;
  if(fstatus === 'finished' && !j.finished) return false;
  if(fstatus === 'unfinished' && j.finished) return false;
  if(from && j.end){ 
    const endDate = dayjs(j.end);
    if(endDate.isValid() && endDate.isBefore(dayjs(from))) return false; 
  }
  if(to && j.start){ 
    const startDate = dayjs(j.start);
    if(startDate.isValid() && startDate.isAfter(dayjs(to).endOf('day'))) return false; 
  }
  if(q){ const blob = `${j.title} ${j.notes||''} ${j.priority||''} ${j.equipmentNumber||''} ${j.serviceCall||''} ${j.department||''}`.toLowerCase(); if(!blob.includes(q)) return false; }
  
  // Handle issue filters
  if(showBoth){
    if(!conflicted.has(j.id) && !depIssues.has(j.id)) return false;
  } else {
    if(onlyConf && !conflicted.has(j.id)) return false;
    if(onlyDepIssues && !depIssues.has(j.id)) return false;
  }
  
  return true;
}

function renderTable(){
  const tb = $('#tbody'); tb.innerHTML='';
  const conflicts = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();
  const rows = JOBS.filter(passFilters);
  $('#emptyTable').style.display = rows.length? 'none':'block';
  
  // Setup scroll sync after a short delay to ensure table is rendered
  setTimeout(() => {
    setupTableScrollSync();
  }, 100);
  
  // Sort rows based on current sort state
  rows.sort((a,b)=> {
    let valA, valB;
    switch(sortState.column) {
      case 'title':
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'factory':
        valA = (a.factory || '').toLowerCase();
        valB = (b.factory || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'worker':
        valA = (a.worker || '').toLowerCase();
        valB = (b.worker || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'factoryManager':
        valA = (a.factoryManager || '').toLowerCase();
        valB = (b.factoryManager || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'maintenanceManager':
        valA = (a.maintenanceManager || '').toLowerCase();
        valB = (b.maintenanceManager || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'priority':
        valA = (a.priority || '').toLowerCase();
        valB = (b.priority || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'equipmentNumber':
        valA = (a.equipmentNumber || '').toLowerCase();
        valB = (b.equipmentNumber || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'serviceCall':
        valA = (a.serviceCall || '').toLowerCase();
        valB = (b.serviceCall || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'department':
        valA = (a.department || '').toLowerCase();
        valB = (b.department || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'start':
        valA = dayjs(a.start).valueOf();
        valB = dayjs(b.start).valueOf();
        return sortState.ascending ? valA - valB : valB - valA;
      case 'end':
        valA = dayjs(a.end).valueOf();
        valB = dayjs(b.end).valueOf();
        return sortState.ascending ? valA - valB : valB - valA;
      case 'duration':
        valA = dayjs(a.end).diff(dayjs(a.start), 'minute');
        valB = dayjs(b.end).diff(dayjs(b.start), 'minute');
        return sortState.ascending ? valA - valB : valB - valA;
      case 'notes':
        valA = (a.notes || '').toLowerCase();
        valB = (b.notes || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      default:
        return 0;
    }
  });
  
  // Update header sort indicators
  $$('thead th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if(th.dataset.sort === sortState.column) {
      th.classList.add(sortState.ascending ? 'sort-asc' : 'sort-desc');
    }
  });
  
  rows.forEach((j, idx)=>{
    const isBad = conflicts.has(j.id);
    const isDepIssue = depIssues.has(j.id);
    const isShab = jobTouchesShabbat(j);
    const isFinished = j.finished;
    const tr = document.createElement('tr');
    if(isBad) tr.classList.add('row-bad');
    if(isDepIssue) tr.classList.add('row-dep-issue');
    if(isShab) tr.classList.add('row-shabbat');
    if(isFinished) tr.classList.add('row-finished');
    const dur = durationStr(j.start, j.end);
    
    const depInfo = j.dependsOn ? JOBS.find(dj=>dj.id===j.dependsOn) : null;
    const depBadge = depInfo ? `<span class="badge dep" title="תלוי ב: ${escapeHtml(depInfo.title||'ללא כותרת')}">🔗 ${escapeHtml(depInfo.title||'תל')}</span>` : '';
    
    const flags = [ 
      isFinished?'<span class="badge good">✓ הושלם</span>':'',
      isBad?'<span class="badge bad">קונפליקט</span>':'' , 
      isDepIssue?'<span class="badge bad">בעיית תלות</span>':'',
      isShab?'<span class="badge warn">ליל שישי/שבת</span>':'',
      depBadge
    ].filter(Boolean).join(' ');
    
    const finishIcon = isFinished ? '↶' : '✓';
    const finishTitle = isFinished ? 'סמן כלא הושלם' : 'סמן כהושלם';
    const finishClass = isFinished ? 'btn-icon' : 'btn-icon btn-icon-success';
    
    // Format workers - handle both old string format and new array format
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    const workersDisplay = workers.length > 0 ? workers.join(', ') : '';
    
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td data-column="title" class="editable-text" data-job-id="${j.id}" data-field="title" title="לחץ לעריכה">${isFinished ? '<s>'+escapeHtml(j.title||'')+'</s>' : escapeHtml(j.title||'')}</td>
      <td data-column="factory" class="editable-dropdown" data-job-id="${j.id}" data-field="factory" data-type="factory" title="לחץ לעריכה">${escapeHtml(j.factory||'')}</td>
      <td data-column="worker" class="editable-worker" data-job-id="${j.id}" title="לחץ לעריכה">${escapeHtml(workersDisplay)}</td>
      <td data-column="factoryManager" class="editable-dropdown" data-job-id="${j.id}" data-field="factoryManager" data-type="factoryManager" title="לחץ לעריכה">${escapeHtml(j.factoryManager||'')}</td>
      <td data-column="maintenanceManager" class="editable-dropdown" data-job-id="${j.id}" data-field="maintenanceManager" data-type="maintenanceManager" title="לחץ לעריכה">${escapeHtml(j.maintenanceManager||'')}</td>
      <td data-column="priority" class="editable-dropdown" data-job-id="${j.id}" data-field="priority" data-type="priority" title="לחץ לעריכה">${escapeHtml(j.priority||'')}</td>
      <td data-column="equipmentNumber" class="editable-text" data-job-id="${j.id}" data-field="equipmentNumber" title="לחץ לעריכה">${escapeHtml(j.equipmentNumber||'')}</td>
      <td data-column="serviceCall" class="editable-text" data-job-id="${j.id}" data-field="serviceCall" title="לחץ לעריכה">${escapeHtml(j.serviceCall||'')}</td>
      <td data-column="department" class="editable-dropdown" data-job-id="${j.id}" data-field="department" data-type="department" title="לחץ לעריכה">${escapeHtml(j.department||'')}</td>
      <td data-column="start" class="editable-date" data-job-id="${j.id}" data-field="start" title="לחץ לעריכה">${escapeHtml(fmt(j.start))}</td>
      <td data-column="end" class="editable-date" data-job-id="${j.id}" data-field="end" title="לחץ לעריכה">${escapeHtml(fmt(j.end))}</td>
      <td data-column="duration">${escapeHtml(dur)}</td>
      <td data-column="notes" class="editable-text" data-job-id="${j.id}" data-field="notes" title="לחץ לעריכה">${escapeHtml(j.notes||'')}</td>
      <td data-column="flags">${flags}</td>
      <td class="actions" data-column="actions">
        <button class="${finishClass}" data-act="finish" data-id="${j.id}" title="${finishTitle}">${finishIcon}</button>
        <button class="btn-icon" data-act="clone" data-id="${j.id}" title="שכפל משימה">📋</button>
        <button class="btn-icon" data-act="edit" data-id="${j.id}" title="ערוך משימה">✎</button>
        <button class="btn-icon btn-icon-danger" data-act="del" data-id="${j.id}" title="מחק משימה">✕</button>
      </td>`;
    tb.appendChild(tr);
  });
}

// Global drag state
let dragState = {
  isDragging: false,
  job: null,
  startX: 0,
  startLeft: 0,
  originalWorker: null,
  currentWorker: null,
  offsetX: 0
};

// Sort state
let sortState = {
  column: 'start', // default sort by start time
  ascending: true
};

function renderTimeline(){
  const startDateValue = $('#tl-start-date').value || dayjs().format('YYYY-MM-DD');
  const endDateValue = $('#tl-end-date').value || dayjs(startDateValue).add(3, 'days').format('YYYY-MM-DD');
  const startDay = dayjs(startDateValue).startOf('day');
  const endDay = dayjs(endDateValue).endOf('day');
  
  // Get all jobs in the date range
  let jobs = JOBS.filter(j=> {
    // Skip jobs with invalid or empty dates
    if(!j.start || !j.end) return false;
    const startDate = dayjs(j.start);
    const endDate = dayjs(j.end);
    if(!startDate.isValid() || !endDate.isValid()) return false;
    return endDate.isAfter(startDay) && startDate.isBefore(endDay);
  });
  
  // Check if we're filtering by conflicts or dependency issues
  const onlyConf = $('#fltConflictsOnly').checked;
  const onlyDepIssues = $('#fltDependencyIssuesOnly').checked;
  const showBoth = $('#fltShowBoth').checked;
  
  if(onlyConf || onlyDepIssues || showBoth) {
    // Find workers with issues
    const conflicted = recomputeConflicts();
    const depIssues = recomputeDependencyIssues();
    const workersWithIssues = new Set();
    
    // Collect workers who have conflicts or dependency issues
    JOBS.forEach(job => {
      if(conflicted.has(job.id) || depIssues.has(job.id)) {
        const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
        workers.forEach(w => workersWithIssues.add(w));
      }
    });
    
    // Filter to show ALL tasks for workers with issues
    jobs = jobs.filter(job => {
      const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
      return workers.some(w => workersWithIssues.has(w));
    });
    
    // Apply other filters (factory, worker, etc.) but skip the conflict/dependency filters
    // since we already handled them above
    const ff = $('#fltFactory').value.trim();
    const fw = $('#fltWorker').value.trim();
    const ffm = $('#fltFactoryManager').value.trim();
    const fmm = $('#fltMaintenanceManager').value.trim();
    const fp = $('#fltPriority').value.trim();
    const fe = $('#fltEquipmentNumber').value.trim();
    const fs = $('#fltServiceCall').value.trim();
    const fd = $('#fltDepartment').value.trim();
    const fstatus = $('#fltStatus').value.trim();
    const q = $('#fltSearch').value.toLowerCase().trim();
    const from = $('#fltFrom').value; 
    const to = $('#fltTo').value;
    
    jobs = jobs.filter(j => {
      if(ff && j.factory!==ff) return false;
      if(fw && j.worker!==fw) return false;
      if(ffm && j.factoryManager!==ffm) return false;
      if(fmm && j.maintenanceManager!==fmm) return false;
      if(fp && j.priority!==fp) return false;
      if(fe && !(j.equipmentNumber||'').toLowerCase().includes(fe.toLowerCase())) return false;
      if(fs && !(j.serviceCall||'').toLowerCase().includes(fs.toLowerCase())) return false;
      if(fd && j.department!==fd) return false;
      if(fstatus === 'finished' && !j.finished) return false;
      if(fstatus === 'unfinished' && j.finished) return false;
      if(from && j.end){ 
        const endDate = dayjs(j.end);
        if(endDate.isValid() && endDate.isBefore(dayjs(from))) return false; 
      }
      if(to && j.start){ 
        const startDate = dayjs(j.start);
        if(startDate.isValid() && startDate.isAfter(dayjs(to).endOf('day'))) return false; 
      }
      if(q){ const blob = `${j.title} ${j.notes||''} ${j.priority||''} ${j.equipmentNumber||''} ${j.serviceCall||''} ${j.department||''}`.toLowerCase(); if(!blob.includes(q)) return false; }
      return true;
    });
  } else {
    // Apply normal filters for other cases
    jobs = jobs.filter(passFilters);
  }
  
  const host = $('#timeline'); host.innerHTML='';
  $('#emptyTimeline').style.display = jobs.length? 'none':'block';

  // Group jobs by worker - handle multiple workers per job
  const byWorker = new Map();
  jobs.forEach(j=>{
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    if(workers.length === 0) {
      // If no workers, add to a special "(ללא עובד מבצע)" lane
      if(!byWorker.has('')) byWorker.set('', []);
      byWorker.get('').push(j);
    } else {
      // Add job to each worker's lane
      workers.forEach(worker => {
        if(!byWorker.has(worker)) byWorker.set(worker, []);
        byWorker.get(worker).push(j);
      });
    }
  });
  const conflicts = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();

  // Calculate number of days in range
  const numDays = endDay.diff(startDay, 'day') + 1;
  const totalHours = numDays * 24;
  const totalWidth = totalHours * 40; // 40px per hour
  
  // time ticks (every hour) - 40px per hour, RTL positioning (right to left)
  function xPos(dt){ 
    const mins = dayjs(dt).diff(startDay, 'minute'); 
    return (mins/60)*40; // For right positioning in RTL, earlier times have smaller right values
  }
  
  // Convert position to time (RTL aware - px is the 'right' value)
  function posToTime(px){ 
    const hours = px / 40;
    return startDay.add(hours, 'hour');
  }
  
  // Create two-row header: dates + hours
  const headerLane = document.createElement('div'); 
  headerLane.className='lane hour-header';
  headerLane.style.height = '88px'; // Double height for two rows
  
  // Date row with all days
  const dateRow = document.createElement('div');
  dateRow.className = 'timeline-date-row';
  dateRow.style.cssText = `
    position: relative;
    height: 44px;
    display: flex;
    background: var(--pico-card-sectioning-background-color);
    border-bottom: 2px solid var(--pico-muted-border-color);
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    width: ${totalWidth}px;
  `;
  
  // Add each day header
  let currentDay = startDay.clone();
  for(let d = 0; d < numDays; d++) {
    const dayLabel = currentDay.format('ddd DD/MM');
    const dayDiv = document.createElement('div');
    dayDiv.style.cssText = `
      width: 960px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--pico-color);
      border-left: ${d > 0 ? '2px solid var(--pico-muted-border-color)' : 'none'};
    `;
    dayDiv.textContent = dayLabel;
    dateRow.appendChild(dayDiv);
    currentDay = currentDay.add(1, 'day');
  }
  
  // Hours row
  const hoursRow = document.createElement('div');
  hoursRow.className = 'timeline-hours-row';
  hoursRow.style.cssText = `
    position: relative;
    height: 44px;
    background: var(--pico-card-background-color);
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    width: ${totalWidth}px;
  `;
  
  const hourLabels = document.createElement('div'); 
  hourLabels.className='hour-labels';
  hourLabels.style.position = 'relative';
  hourLabels.style.width = `${totalWidth}px`;
  hourLabels.style.height = '100%';
  hourLabels.style.margin = '0';
  hourLabels.style.padding = '0';
  
  // Add hour labels for all days (RTL positioned)
  for(let h=0; h < totalHours; h++){
    const label = document.createElement('div'); 
    label.className='hour-label'; 
    label.style.right = `${h*40}px`; // RTL positioning
    label.textContent = `${h % 24}`;
    hourLabels.appendChild(label);
  }
  
  hoursRow.appendChild(hourLabels);
  
  headerLane.innerHTML = `<div class="label" style="height: 88px; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0.75rem;">זמן →</div><div class="grid" style="height: 88px; margin: 0; padding: 0; width: ${totalWidth}px;"></div>`;
  const headerGrid = headerLane.querySelector('.grid');
  headerGrid.style.display = 'flex';
  headerGrid.style.flexDirection = 'column';
  headerGrid.style.margin = '0';
  headerGrid.style.padding = '0';
  headerGrid.style.gap = '0';
  headerGrid.appendChild(dateRow);
  headerGrid.appendChild(hoursRow);
  
  host.appendChild(headerLane);

  // Color palette for normal jobs (solid colors)
  const jobColors = [
    { bg: '#6295e8', border: '#5080d0' }, // Blue
    { bg: '#6295e8', border: '#5080d0' }, // Blue
    { bg: '#6295e8', border: '#5080d0' }, // Blue
    { bg: '#6295e8', border: '#5080d0' }, // Blue
    { bg: '#6295e8', border: '#5080d0' }, // Blue
  ];

  for(const [worker, arr] of Array.from(byWorker.entries()).sort((a,b)=> a[0].localeCompare(b[0]))){
    const lane = document.createElement('div'); lane.className='lane';
    lane.innerHTML = `<div class="label">${escapeHtml(worker||'(ללא עובד מבצע)')}</div><div class="grid" style="width: ${totalWidth}px;"></div>`;
    const grid = lane.querySelector('.grid');

    // ticks for each hour across all days (RTL positioned)
    const tickbar = document.createElement('div'); tickbar.className='tickbar';
    for(let h=0; h<=totalHours; h++){
      const t = document.createElement('div'); t.className='tick'; 
      t.style.right = `${h*40}px`; // RTL positioning
      tickbar.appendChild(t);
    }
    grid.appendChild(tickbar);

    arr.sort((a,b)=> dayjs(a.start)-dayjs(b.start));
    
    // Detect overlaps within this worker's jobs and assign colors
    const jobsWithOverlaps = arr.map((j, idx) => {
      let overlapGroup = 0;
      for(let i=0; i<idx; i++){
        if(isOverlap(arr[i].start, arr[i].end, j.start, j.end)){
          overlapGroup = (overlapGroup + 1) % jobColors.length;
        }
      }
      return { job: j, colorIdx: overlapGroup };
    });

    jobsWithOverlaps.forEach(({job: j, colorIdx})=>{
      const s = dayjs.max(dayjs(j.start), startDay);
      const e = dayjs.min(dayjs(j.end), endDay);
      const left = xPos(s);
      const width = Math.max(6, xPos(e)-xPos(s));
      const div = document.createElement('div');
      div.className = 'jobbar';
      
      const isConflict = conflicts.has(j.id);
      const isDepIssue = depIssues.has(j.id);
      const isFinished = j.finished;
      
      if(isFinished) {
        div.classList.add('finished');
        // Use solid green for finished jobs
        const finishedColors = [
          { bg: '#28a745', border: '#218838' }, // Green
          { bg: '#28a745', border: '#218838' }, // Green
          { bg: '#28a745', border: '#218838' }, // Green
          { bg: '#28a745', border: '#218838' }, // Green
          { bg: '#28a745', border: '#218838' }, // Green
        ];
        const color = finishedColors[colorIdx % finishedColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else if(isDepIssue) {
        div.classList.add('dep-issue');
        // Use solid yellow for dependency issues
        const depIssueColors = [
          { bg: '#ffc107', border: '#e0a800' }, // Yellow
          { bg: '#ffc107', border: '#e0a800' }, // Yellow
          { bg: '#ffc107', border: '#e0a800' }, // Yellow
          { bg: '#ffc107', border: '#e0a800' }, // Yellow
          { bg: '#ffc107', border: '#e0a800' }, // Yellow
        ];
        const color = depIssueColors[colorIdx % depIssueColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else if(isConflict) {
        div.classList.add('conflict');
        // Use solid red for conflicts
        const conflictColors = [
          { bg: '#dc3545', border: '#c82333' }, // Red
          { bg: '#dc3545', border: '#c82333' }, // Red
          { bg: '#dc3545', border: '#c82333' }, // Red
          { bg: '#dc3545', border: '#c82333' }, // Red
          { bg: '#dc3545', border: '#c82333' }, // Red
        ];
        const color = conflictColors[colorIdx % conflictColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else {
        // Use different colors for non-conflicting overlaps (different workers or same worker non-overlap)
        const color = jobColors[colorIdx];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      }
      
      if(jobTouchesShabbat(j)) div.classList.add('shabbat');
      div.style.right = left+'px'; // RTL positioning
      div.style.width = width+'px';
      
      const depInfo = j.dependsOn ? JOBS.find(dj=>dj.id===j.dependsOn) : null;
      const depText = depInfo ? ` → ${depInfo.title||'תל'}` : '';
      // No title attribute - using custom hover panel instead
      
      // Add resize handles and label
      div.innerHTML = `
        <div class="timeline-resize-handle timeline-resize-left" data-edge="start"></div>
        <span class="jobbar-label">${escapeHtml(j.title || '(ללא כותרת)')}</span>
        <div class="timeline-resize-handle timeline-resize-right" data-edge="end"></div>
      `;
      
      // Make draggable
      div.draggable = true;
      div.style.cursor = 'grab';
      div.dataset.jobId = j.id;
      div.dataset.worker = worker;
      
      let dragStartTime = 0;
      let dragMoved = false;
      
      div.addEventListener('mousedown', (e) => {
        // Don't start drag if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          e.stopPropagation();
          div.draggable = false;
          return;
        }
        dragStartTime = Date.now();
        dragMoved = false;
        div.draggable = true;
      });
      
      div.addEventListener('mousemove', (e) => {
        if (dragStartTime > 0) {
          dragMoved = true;
        }
      });
      
      div.addEventListener('click', (e) => {
        // Don't open modal if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          return;
        }
        const clickDuration = Date.now() - dragStartTime;
        // If it was a quick click (not a drag), open edit modal
        if (clickDuration < 300 && !dragMoved) {
          e.preventDefault();
          e.stopPropagation();
          openJobModal(j);
        }
      });
      
      div.addEventListener('dragstart', (e) => {
        // Prevent drag if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          e.preventDefault();
          return;
        }
        dragMoved = true; // Mark as drag
        div.style.cursor = 'grabbing';
        div.style.opacity = '0.5';
        const rect = div.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        dragState.isDragging = true;
        dragState.job = j;
        dragState.originalWorker = worker;
        dragState.currentWorker = worker;
        dragState.offsetX = rect.right - e.clientX; // RTL: offset from right edge
        dragState.startLeft = rect.left - gridRect.left;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', div.innerHTML);
      });
      
      div.addEventListener('dragend', (e) => {
        div.style.cursor = 'grab';
        div.style.opacity = '1';
        dragState.isDragging = false;
        dragStartTime = 0;
        dragMoved = false;
      });
      
      // Add resize functionality (RTL: right=start, left=end)
      const leftHandle = div.querySelector('.timeline-resize-left');
      const rightHandle = div.querySelector('.timeline-resize-right');
      
      if (leftHandle) {
        leftHandle.addEventListener('mousedown', (e) => startTimelineResize(e, div, j, 'end', grid));
      }
      
      if (rightHandle) {
        rightHandle.addEventListener('mousedown', (e) => startTimelineResize(e, div, j, 'start', grid));
      }
      
      grid.appendChild(div);
    });
    
    // Make grid a drop zone
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.classList.add('drag-over');
    });
    
    grid.addEventListener('dragleave', (e) => {
      grid.classList.remove('drag-over');
    });
    
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      grid.classList.remove('drag-over');
      
      if(!dragState.job) return;
      
      const gridRect = grid.getBoundingClientRect();
      const dropX = gridRect.right - e.clientX - dragState.offsetX; // RTL: calculate from right edge
      
      // Calculate new time based on drop position
      const newStartTime = posToTime(Math.max(0, dropX));
      const duration = dayjs(dragState.job.end).diff(dayjs(dragState.job.start), 'minute');
      const newEndTime = newStartTime.add(duration, 'minute');
      
      // Round to 15 minutes
      const roundedStart = roundTo15(newStartTime.format('YYYY-MM-DDTHH:mm'));
      const roundedEnd = roundTo15(newEndTime.format('YYYY-MM-DDTHH:mm'));
      
      // Update job in JOBS array
      const jobIndex = JOBS.findIndex(job => job.id === dragState.job.id);
      if(jobIndex >= 0) {
        JOBS[jobIndex].start = roundedStart;
        JOBS[jobIndex].end = roundedEnd;
        JOBS[jobIndex].worker = worker;
        refreshAll();
      }
      
      dragState.job = null;
    });

    host.appendChild(lane);
  }

  if(byWorker.size===0){ host.innerHTML=''; }
  
  // Setup scroll sync after a short delay to ensure timeline is rendered
  setTimeout(() => {
    setupTimelineScrollSync();
  }, 100);
}

// Timeline resize functionality
let timelineResizeState = {
  isResizing: false,
  jobId: null,
  edge: null,
  startX: 0,
  originalStart: null,
  originalEnd: null,
  grid: null,
  bar: null
};

function startTimelineResize(e, bar, job, edge, grid) {
  e.preventDefault();
  e.stopPropagation();
  
  // Ensure drag is disabled
  bar.draggable = false;
  
  timelineResizeState = {
    isResizing: true,
    jobId: job.id,
    edge: edge,
    startX: e.clientX,
    originalStart: dayjs(job.start),
    originalEnd: dayjs(job.end),
    grid: grid,
    bar: bar
  };
  
  bar.classList.add('resizing');
  document.body.style.cursor = 'ew-resize';
  
  // Add global mouse move and mouse up listeners
  document.addEventListener('mousemove', handleTimelineResize);
  document.addEventListener('mouseup', stopTimelineResize);
}

function handleTimelineResize(e) {
  if (!timelineResizeState.isResizing) return;
  
  const job = JOBS.find(j => j.id === timelineResizeState.jobId);
  if (!job) return;
  
  // Calculate pixel difference (inverted for RTL)
  const dx = timelineResizeState.startX - e.clientX;
  
  // Convert pixels to minutes (40px per hour)
  const minutesPerPixel = 60 / 40; // 40px = 1 hour
  const minutesDiff = Math.round(dx * minutesPerPixel / 15) * 15; // Round to 15 minutes
  
  if (timelineResizeState.edge === 'start') {
    // Resize from the left (change start time)
    const newStart = timelineResizeState.originalStart.clone().add(minutesDiff, 'minutes');
    // Ensure start doesn't go past end (minimum 15 minutes duration)
    if (newStart.isBefore(timelineResizeState.originalEnd.clone().subtract(15, 'minutes'))) {
      job.start = newStart.format();
    }
  } else if (timelineResizeState.edge === 'end') {
    // Resize from the right (change end time)
    const newEnd = timelineResizeState.originalEnd.clone().add(minutesDiff, 'minutes');
    // Ensure end doesn't go before start (minimum 15 minutes duration)
    if (newEnd.isAfter(timelineResizeState.originalStart.clone().add(15, 'minutes'))) {
      job.end = newEnd.format();
    }
  }
  
  // Update the display
  renderTimeline();
}

function stopTimelineResize(e) {
  if (!timelineResizeState.isResizing) return;
  
  // Use the stored bar reference
  if (timelineResizeState.bar) {
    timelineResizeState.bar.classList.remove('resizing');
    // Re-enable drag after a short delay to prevent immediate drag
    setTimeout(() => {
      if (timelineResizeState.bar) {
        timelineResizeState.bar.draggable = true;
      }
    }, 100);
  }
  
  document.body.style.cursor = '';
  
  // Remove global listeners
  document.removeEventListener('mousemove', handleTimelineResize);
  document.removeEventListener('mouseup', stopTimelineResize);
  
  // Save changes and refresh all views
  if (timelineResizeState.isResizing) {
    refreshAll();
  }
  
  timelineResizeState = {
    isResizing: false,
    jobId: null,
    edge: null,
    startX: 0,
    originalStart: null,
    originalEnd: null,
    grid: null,
    bar: null
  };
}

function saveToLocalStorage(){
  const data = {
    jobs: JOBS,
    factories: Array.from(FACTORIES),
    workers: Array.from(WORKERS),
    factoryManagers: Array.from(FACTORY_MANAGERS),
    maintenanceManagers: Array.from(MAINTENANCE_MANAGERS),
    departments: Array.from(DEPARTMENTS)
  };
  localStorage.setItem('jobs.v1', JSON.stringify(data));
}

// Save state to undo history
function saveToUndoHistory(action = 'modify') {
  const state = {
    action,
    timestamp: Date.now(),
    jobs: JSON.parse(JSON.stringify(JOBS)),
    factories: Array.from(FACTORIES),
    workers: Array.from(WORKERS),
    factoryManagers: Array.from(FACTORY_MANAGERS),
    maintenanceManagers: Array.from(MAINTENANCE_MANAGERS),
    departments: Array.from(DEPARTMENTS)
  };
  
  UNDO_HISTORY.push(state);
  
  // Keep only last MAX_UNDO_HISTORY items
  if (UNDO_HISTORY.length > MAX_UNDO_HISTORY) {
    UNDO_HISTORY.shift();
  }
}

// Undo last action
function undoLastAction() {
  if (UNDO_HISTORY.length === 0) {
    alert('אין פעולה לביטול');
    return;
  }
  
  const previousState = UNDO_HISTORY.pop();
  
  // Restore state
  JOBS = JSON.parse(JSON.stringify(previousState.jobs));
  FACTORIES = new Set(previousState.factories);
  WORKERS = new Set(previousState.workers);
  FACTORY_MANAGERS = new Set(previousState.factoryManagers);
  MAINTENANCE_MANAGERS = new Set(previousState.maintenanceManagers);
  DEPARTMENTS = new Set(previousState.departments);
  
  // Update next ID
  nextId = 1 + Math.max(0, ...JOBS.map(j=>+j.id||0));
  
  refreshAll();
}

// Clone a job
function cloneJob(jobId) {
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  // Save current state for undo
  saveToUndoHistory('clone');
  
  // Create a clone with new ID and adjusted time
  const clone = {
    ...JSON.parse(JSON.stringify(job)),
    id: uid(),
    title: job.title + ' (עותק)',
    finished: false
  };
  
  // If job has dates, add 1 hour to both start and end
  if (clone.start && clone.end) {
    clone.start = dayjs(clone.start).add(1, 'hour').format();
    clone.end = dayjs(clone.end).add(1, 'hour').format();
  }
  
  JOBS.push(clone);
  refreshAll();
}

function refreshAll(){
  refreshFilters();
  renderTable();
  renderTimeline();
  updateColumnVisibility();
  // Update Gantt chart if it exists
  if (typeof updateGantt === 'function') {
    updateGantt();
  }
  saveToLocalStorage(); // Auto-save on every change
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// Helper functions for multi-select worker component
function getSelectedWorkers() {
  const options = $('#f-worker-options');
  if (!options) return [];
  const checkboxes = $$('#f-worker-options input[type="checkbox"]:checked');
  return checkboxes.map(cb => cb.value);
}

function updateWorkerDisplay() {
  const selected = getSelectedWorkers();
  const display = $('#f-worker-selected');
  if (!display) return;
  
  if (selected.length === 0) {
    display.innerHTML = '<span class="placeholder">בחר עובדים מבצעים...</span>';
  } else {
    display.innerHTML = selected.map(worker => 
      `<span class="worker-tag">${escapeHtml(worker)} <span class="remove" data-worker="${escapeHtml(worker)}">×</span></span>`
    ).join('');
  }
  
  // Add click handlers for remove buttons
  $$('#f-worker-selected .remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const worker = btn.dataset.worker;
      // Find checkbox by value instead of ID (safer with special characters)
      const checkboxes = $$('#f-worker-options input[type="checkbox"]');
      const checkbox = checkboxes.find(cb => cb.value === worker);
      if (checkbox) {
        checkbox.checked = false;
        updateWorkerDisplay();
      }
    });
  });
}

function toggleWorkerDropdown() {
  const dropdown = $('#f-worker-dropdown');
  const isVisible = dropdown.style.display !== 'none';
  dropdown.style.display = isVisible ? 'none' : 'block';
}

function closeWorkerDropdown() {
  $('#f-worker-dropdown').style.display = 'none';
}

// Add / Edit / Delete
function getForm(){
  const title = $('#f-title').value.trim();
  const factory = $('#f-factory').value;
  // Get selected workers from checkboxes
  const workers = getSelectedWorkers();
  const factoryManager = $('#f-factoryManager').value;
  const maintenanceManager = $('#f-maintenanceManager').value;
  const priority = $('#f-priority').value;
  const equipmentNumber = $('#f-equipmentNumber').value.trim();
  const serviceCall = $('#f-serviceCall').value.trim();
  const department = $('#f-department').value;
  const start = roundTo15($('#f-start').value);
  const end = roundTo15($('#f-end').value);
  const dependsOn = $('#f-dependsOn').value;
  const notes = $('#f-notes').value.trim();
  return { title, factory, workers, factoryManager, maintenanceManager, priority, equipmentNumber, serviceCall, department, start, end, dependsOn, notes };
}

function setForm(j){
  $('#f-title').value = j?.title||'';
  $('#f-factory').value = j?.factory||'';
  
  // Set selected workers in checkboxes
  const workers = j?.workers ? (Array.isArray(j.workers) ? j.workers : [j.workers]) : (j?.worker ? [j.worker] : []);
  // First uncheck all
  $$('#f-worker-options input[type="checkbox"]').forEach(cb => cb.checked = false);
  // Then check the selected ones
  workers.forEach(worker => {
    const checkbox = $(`#f-worker-options input[value="${worker}"]`);
    if (checkbox) checkbox.checked = true;
  });
  updateWorkerDisplay();
  
  $('#f-factoryManager').value = j?.factoryManager||'';
  $('#f-maintenanceManager').value = j?.maintenanceManager||'';
  $('#f-priority').value = j?.priority||'';
  $('#f-equipmentNumber').value = j?.equipmentNumber||'';
  $('#f-serviceCall').value = j?.serviceCall||'';
  $('#f-department').value = j?.department||'';
  $('#f-start').value = j?.start ? dayjs(j.start).format('YYYY-MM-DDTHH:mm') : '';
  $('#f-end').value = j?.end ? dayjs(j.end).format('YYYY-MM-DDTHH:mm') : '';
  $('#f-dependsOn').value = j?.dependsOn||'';
  $('#f-notes').value = j?.notes||'';
}

function validateRange(start, end){
  if(!start || !end) return {ok:false, msg:'התחלה וסיום הם שדות חובה'};
  if(dayjs(end).isSameOrBefore(dayjs(start))) return {ok:false, msg:'הסיום חייב להיות אחרי ההתחלה'};
  return {ok:true};
}

let editingId = null;

function openJobModal(job = null) {
  const modal = $('#jobModal');
  const modalTitle = $('#modalTitle');
  const deleteBtn = $('#btnDeleteModal');
  
  // Make sure dropdowns are populated
  updateFormDropdowns();
  
  if (job) {
    modalTitle.textContent = 'ערוך משימה';
    editingId = job.id;
    setForm(job);
    deleteBtn.style.display = 'block'; // Show delete button when editing
  } else {
    modalTitle.textContent = 'צור משימה';
    editingId = null;
    setForm({});
    deleteBtn.style.display = 'none'; // Hide delete button when creating
  }
  
  modal.showModal();
}

function closeJobModal() {
  const modal = $('#jobModal');
  modal.close();
  setForm({});
  editingId = null;
}

function setupTableScrollSync() {
  const topScroll = document.querySelector('.table-scroll-top');
  const bottomScroll = document.querySelector('.table-container');
  const topInner = document.querySelector('.table-scroll-top-inner');
  const table = document.querySelector('#main-table');
  
  if (!topScroll || !bottomScroll || !topInner || !table) return;
  
  // Set the width of the inner div to match the table width
  const syncWidth = () => {
    topInner.style.width = table.scrollWidth + 'px';
  };
  
  syncWidth();
  
  // Sync scroll positions
  let isScrolling = false;
  
  topScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      bottomScroll.scrollLeft = topScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  bottomScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      topScroll.scrollLeft = bottomScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  // Update width on window resize
  window.addEventListener('resize', syncWidth);
}

function setupTimelineScrollSync() {
  const topScroll = document.querySelector('.timeline-scroll-top');
  const bottomScroll = document.querySelector('.timeline');
  const topInner = document.querySelector('.timeline-scroll-top-inner');
  
  if (!topScroll || !bottomScroll || !topInner) return;
  
  // Set the width of the inner div to match the timeline width
  const syncWidth = () => {
    topInner.style.width = bottomScroll.scrollWidth + 'px';
  };
  
  syncWidth();
  
  // Sync scroll positions
  let isScrolling = false;
  
  topScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      bottomScroll.scrollLeft = topScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  bottomScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      topScroll.scrollLeft = bottomScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  // Update width on window resize
  window.addEventListener('resize', syncWidth);
}

// Inline date editing functionality
function makeEditableDate(cell) {
  const jobId = cell.dataset.jobId;
  const field = cell.dataset.field;
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  const currentValue = job[field];
  const formattedValue = currentValue ? dayjs(currentValue).format('YYYY-MM-DDTHH:mm') : '';
  
  // Save original content
  const originalContent = cell.innerHTML;
  
  // Create input element
  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.step = '900'; // 15 minute steps
  input.value = formattedValue;
  input.style.width = '100%';
  input.style.padding = '0.25rem';
  input.style.border = '2px solid var(--pico-primary)';
  input.style.borderRadius = '0.25rem';
  input.style.background = 'var(--pico-background)';
  input.style.color = 'var(--pico-color)';
  
  // Replace cell content with input
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  
  // Function to save changes
  const saveChanges = () => {
    const newValue = input.value;
    if (newValue && newValue !== formattedValue) {
      // Save to undo history
      saveToUndoHistory('edit-date');
      
      // Round to 15 minutes
      const rounded = roundTo15(newValue);
      
      // Update job
      const jobIndex = JOBS.findIndex(j => j.id === jobId);
      if (jobIndex >= 0) {
        JOBS[jobIndex][field] = rounded;
        
        // Validate range
        const start = JOBS[jobIndex].start;
        const end = JOBS[jobIndex].end;
        if (start && end && !dayjs(end).isAfter(dayjs(start))) {
          alert('הסיום חייב להיות אחרי ההתחלה');
          // Restore original value
          JOBS[jobIndex][field] = currentValue;
        }
        
        refreshAll();
      }
    } else {
      // Restore original content if no changes or cancelled
      cell.innerHTML = originalContent;
    }
  };
  
  // Save on blur (clicking away)
  input.addEventListener('blur', () => {
    setTimeout(saveChanges, 100);
  });
  
  // Save on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      cell.innerHTML = originalContent;
    }
  });
}

// Inline worker editing functionality
function makeEditableWorker(cell) {
  const jobId = cell.dataset.jobId;
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  const currentWorkers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
  const selectedWorkers = new Set(currentWorkers);
  
  // Save original content
  const originalContent = cell.innerHTML;
  
  // Create a dropdown container
  const container = document.createElement('div');
  container.className = 'inline-worker-editor';
  container.style.position = 'relative';
  container.style.width = '100%';
  
  // Create display element (shows selected workers)
  const display = document.createElement('div');
  display.className = 'inline-worker-display';
  display.style.padding = '0.5rem 0.75rem';
  display.style.border = '2px solid var(--pico-primary)';
  display.style.borderRadius = '0.25rem';
  display.style.background = 'var(--pico-background)';
  display.style.color = 'var(--pico-color)';
  display.style.minHeight = '42px';
  display.style.display = 'flex';
  display.style.alignItems = 'center';
  display.style.flexWrap = 'wrap';
  display.style.gap = '0.25rem';
  display.style.cursor = 'pointer';
  
  // Function to update display
  const updateDisplay = () => {
    if (selectedWorkers.size === 0) {
      display.innerHTML = '<span style="color: var(--pico-muted-color); font-style: italic;">בחר עובדים...</span>';
    } else {
      display.innerHTML = Array.from(selectedWorkers).map(worker => 
        `<span class="inline-worker-tag" style="display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: var(--pico-primary-background); color: var(--pico-primary-inverse); border-radius: 0.25rem; font-size: 0.875rem;">
          ${escapeHtml(worker)}
          <span class="inline-worker-remove" data-worker="${escapeHtml(worker)}" style="cursor: pointer; font-weight: bold; opacity: 0.8; padding: 0 0.25rem;">×</span>
        </span>`
      ).join('');
      
      // Add remove handlers
      display.querySelectorAll('.inline-worker-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const worker = btn.dataset.worker;
          selectedWorkers.delete(worker);
          updateDisplay();
        });
      });
    }
  };
  
  updateDisplay();
  
  // Create dropdown for worker checkboxes
  const dropdown = document.createElement('div');
  dropdown.className = 'inline-worker-dropdown';
  dropdown.style.position = 'absolute';
  dropdown.style.top = '100%';
  dropdown.style.left = '0';
  dropdown.style.right = '0';
  dropdown.style.marginTop = '0.25rem';
  dropdown.style.background = 'var(--pico-card-background-color)';
  dropdown.style.border = '1px solid var(--pico-muted-border-color)';
  dropdown.style.borderRadius = '0.25rem';
  dropdown.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  dropdown.style.maxHeight = '250px';
  dropdown.style.overflowY = 'auto';
  dropdown.style.zIndex = '1000';
  dropdown.style.display = 'none';
  
  // Create options container
  const optionsContainer = document.createElement('div');
  optionsContainer.style.padding = '0.5rem';
  
  // Populate dropdown with worker checkboxes
  const workers = Array.from(WORKERS).sort();
  workers.forEach(worker => {
    const option = document.createElement('div');
    option.className = 'inline-worker-option';
    option.style.display = 'flex';
    option.style.alignItems = 'center';
    option.style.gap = '0.5rem';
    option.style.padding = '0.5rem';
    option.style.borderRadius = '0.25rem';
    option.style.cursor = 'pointer';
    option.style.transition = 'background-color 0.2s';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `inline-worker-${worker}`;
    checkbox.checked = selectedWorkers.has(worker);
    checkbox.style.margin = '0';
    checkbox.style.cursor = 'pointer';
    
    const label = document.createElement('label');
    label.htmlFor = `inline-worker-${worker}`;
    label.textContent = worker;
    label.style.cursor = 'pointer';
    label.style.margin = '0';
    label.style.flex = '1';
    
    option.addEventListener('mouseenter', () => {
      option.style.background = 'var(--pico-card-sectioning-background-color)';
    });
    
    option.addEventListener('mouseleave', () => {
      option.style.background = '';
    });
    
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedWorkers.add(worker);
      } else {
        selectedWorkers.delete(worker);
      }
      updateDisplay();
    });
    
    option.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
    
    option.appendChild(checkbox);
    option.appendChild(label);
    optionsContainer.appendChild(option);
  });
  
  dropdown.appendChild(optionsContainer);
  
  // Add "Add new worker" button
  const addNewButton = document.createElement('button');
  addNewButton.textContent = '➕ הוסף עובד חדש';
  addNewButton.style.width = '100%';
  addNewButton.style.padding = '0.5rem';
  addNewButton.style.margin = '0.5rem 0 0 0';
  addNewButton.style.background = 'transparent';
  addNewButton.style.border = '1px dashed var(--pico-muted-border-color)';
  addNewButton.style.color = 'var(--pico-primary)';
  addNewButton.style.cursor = 'pointer';
  addNewButton.style.borderRadius = '0.25rem';
  addNewButton.style.fontSize = '0.875rem';
  
  addNewButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const newWorker = prompt('הזן שם עובד מבצע חדש:');
    if (newWorker && newWorker.trim()) {
      WORKERS.add(newWorker.trim());
      selectedWorkers.add(newWorker.trim());
      
      // Rebuild dropdown
      optionsContainer.innerHTML = '';
      const updatedWorkers = Array.from(WORKERS).sort();
      updatedWorkers.forEach(worker => {
        const option = document.createElement('div');
        option.className = 'inline-worker-option';
        option.style.display = 'flex';
        option.style.alignItems = 'center';
        option.style.gap = '0.5rem';
        option.style.padding = '0.5rem';
        option.style.borderRadius = '0.25rem';
        option.style.cursor = 'pointer';
        option.style.transition = 'background-color 0.2s';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `inline-worker-${worker}`;
        checkbox.checked = selectedWorkers.has(worker);
        checkbox.style.margin = '0';
        checkbox.style.cursor = 'pointer';
        
        const label = document.createElement('label');
        label.htmlFor = `inline-worker-${worker}`;
        label.textContent = worker;
        label.style.cursor = 'pointer';
        label.style.margin = '0';
        label.style.flex = '1';
        
        option.addEventListener('mouseenter', () => {
          option.style.background = 'var(--pico-card-sectioning-background-color)';
        });
        
        option.addEventListener('mouseleave', () => {
          option.style.background = '';
        });
        
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          if (checkbox.checked) {
            selectedWorkers.add(worker);
          } else {
            selectedWorkers.delete(worker);
          }
          updateDisplay();
        });
        
        option.addEventListener('click', (e) => {
          if (e.target !== checkbox) {
            e.stopPropagation();
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
          }
        });
        
        option.appendChild(checkbox);
        option.appendChild(label);
        optionsContainer.appendChild(option);
      });
      
      updateDisplay();
    }
  });
  
  dropdown.appendChild(addNewButton);
  
  container.appendChild(display);
  container.appendChild(dropdown);
  
  // Replace cell content with container
  cell.innerHTML = '';
  cell.appendChild(container);
  
  // Toggle dropdown on display click
  display.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });
  
  // Function to save changes
  const saveChanges = () => {
    const newWorkers = Array.from(selectedWorkers);
    const originalWorkers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
    
    // Check if there are changes
    const hasChanges = newWorkers.length !== originalWorkers.length || 
                       !newWorkers.every(w => originalWorkers.includes(w));
    
    if (hasChanges) {
      // Update job
      const jobIndex = JOBS.findIndex(j => j.id === jobId);
      if (jobIndex >= 0) {
        JOBS[jobIndex].workers = newWorkers;
        refreshAll();
      }
    } else {
      // Restore original content if no changes
      cell.innerHTML = originalContent;
    }
  };
  
  // Close dropdown when clicking outside
  const closeHandler = (e) => {
    if (!container.contains(e.target)) {
      dropdown.style.display = 'none';
      saveChanges();
      document.removeEventListener('click', closeHandler);
    }
  };
  
  // Add close handler after a short delay to avoid immediate closing
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 100);
  
  // Handle Escape key
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      cell.innerHTML = originalContent;
      document.removeEventListener('keydown', keyHandler);
      document.removeEventListener('click', closeHandler);
    }
  };
  
  document.addEventListener('keydown', keyHandler);
}

// Inline text editing functionality
function makeEditableText(cell) {
  const jobId = cell.dataset.jobId;
  const field = cell.dataset.field;
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  const currentValue = job[field] || '';
  
  // Save original content
  const originalContent = cell.innerHTML;
  
  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.style.width = '100%';
  input.style.padding = '0.25rem';
  input.style.border = '2px solid var(--pico-primary)';
  input.style.borderRadius = '0.25rem';
  input.style.background = 'var(--pico-background)';
  input.style.color = 'var(--pico-color)';
  input.style.fontSize = '0.875rem';
  
  // Replace cell content with input
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();
  
  // Function to save changes
  const saveChanges = () => {
    const newValue = input.value.trim();
    if (newValue !== currentValue) {
      // Update job
      const jobIndex = JOBS.findIndex(j => j.id === jobId);
      if (jobIndex >= 0) {
        JOBS[jobIndex][field] = newValue;
        refreshAll();
      }
    } else {
      // Restore original content if no changes
      cell.innerHTML = originalContent;
    }
  };
  
  // Save on blur (clicking away)
  input.addEventListener('blur', () => {
    setTimeout(saveChanges, 100);
  });
  
  // Save on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      cell.innerHTML = originalContent;
    }
  });
}

// Inline dropdown editing functionality
function makeEditableDropdown(cell) {
  const jobId = cell.dataset.jobId;
  const field = cell.dataset.field;
  const type = cell.dataset.type;
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  const currentValue = job[field] || '';
  
  // Save original content
  const originalContent = cell.innerHTML;
  
  // Get options based on type
  let options = [];
  let allowNew = false;
  
  switch(type) {
    case 'factory':
      options = Array.from(FACTORIES).sort();
      allowNew = true;
      break;
    case 'factoryManager':
      options = Array.from(FACTORY_MANAGERS).sort();
      allowNew = true;
      break;
    case 'maintenanceManager':
      options = Array.from(MAINTENANCE_MANAGERS).sort();
      allowNew = true;
      break;
    case 'department':
      options = Array.from(DEPARTMENTS).sort();
      allowNew = true;
      break;
    case 'priority':
      options = ['נמוכה', 'בינונית', 'גבוהה', 'דחופה'];
      allowNew = false;
      break;
  }
  
  // Create select element
  const select = document.createElement('select');
  select.style.width = '100%';
  select.style.padding = '0.25rem';
  select.style.border = '2px solid var(--pico-primary)';
  select.style.borderRadius = '0.25rem';
  select.style.background = 'var(--pico-background)';
  select.style.color = 'var(--pico-color)';
  select.style.fontSize = '0.875rem';
  
  // Add empty option
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'בחר...';
  select.appendChild(emptyOption);
  
  // Add options
  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === currentValue) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  
  // Add "Add new" option if allowed
  if (allowNew) {
    const addNewOption = document.createElement('option');
    addNewOption.value = '__add_new__';
    addNewOption.textContent = '➕ הוסף חדש';
    select.appendChild(addNewOption);
  }
  
  // Replace cell content with select
  cell.innerHTML = '';
  cell.appendChild(select);
  select.focus();
  
  // Function to save changes
  const saveChanges = () => {
    const newValue = select.value;
    
    if (newValue === '__add_new__') {
      // Prompt for new value
      let promptText = '';
      switch(type) {
        case 'factory': promptText = 'הזן שם מפעל חדש:'; break;
        case 'factoryManager': promptText = 'הזן שם מפקח עבודה חדש:'; break;
        case 'maintenanceManager': promptText = 'הזן שם מנהל עבודה חדש:'; break;
        case 'department': promptText = 'הזן שם מחלקה חדשה:'; break;
      }
      
      const newItem = prompt(promptText);
      if (newItem && newItem.trim()) {
        // Add to appropriate set
        switch(type) {
          case 'factory': FACTORIES.add(newItem.trim()); break;
          case 'factoryManager': FACTORY_MANAGERS.add(newItem.trim()); break;
          case 'maintenanceManager': MAINTENANCE_MANAGERS.add(newItem.trim()); break;
          case 'department': DEPARTMENTS.add(newItem.trim()); break;
        }
        
        // Update job
        const jobIndex = JOBS.findIndex(j => j.id === jobId);
        if (jobIndex >= 0) {
          JOBS[jobIndex][field] = newItem.trim();
          refreshAll();
        }
      } else {
        // Restore original content
        cell.innerHTML = originalContent;
      }
    } else if (newValue !== currentValue) {
      // Update job
      const jobIndex = JOBS.findIndex(j => j.id === jobId);
      if (jobIndex >= 0) {
        JOBS[jobIndex][field] = newValue;
        refreshAll();
      }
    } else {
      // Restore original content if no changes
      cell.innerHTML = originalContent;
    }
  };
  
  // Save on change
  select.addEventListener('change', () => {
    saveChanges();
  });
  
  // Save on blur (clicking away)
  select.addEventListener('blur', () => {
    setTimeout(() => {
      if (select.value !== '__add_new__') {
        saveChanges();
      }
    }, 100);
  });
  
  // Handle Escape key
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cell.innerHTML = originalContent;
    }
  });
}

function initEventListeners(){
  // Open modal to create job
  $('#btnOpenJobModal').addEventListener('click', () => {
    openJobModal();
  });

  // Close modal
  $('#btnCloseModal').addEventListener('click', () => {
    closeJobModal();
  });

  // Save job from modal
  $('#btnSaveJob').addEventListener('click', ()=>{
    const data = getForm();
    const vr = validateRange(data.start, data.end);
    if(!vr.ok){ alert(vr.msg); return; }
    
    // Save to undo history before making changes
    saveToUndoHistory(editingId ? 'edit' : 'create');
    
    if(editingId){
      const i = JOBS.findIndex(x=>x.id===editingId);
      if(i>=0) JOBS[i] = { ...JOBS[i], ...data };
      editingId = null;
    } else {
      JOBS.push({ id: uid(), ...data });
    }
    closeJobModal();
    refreshAll();
  });

  // Reset form in modal
  $('#btnResetModal').addEventListener('click', ()=>{ 
    setForm({});
    updateWorkerDisplay();
  });

  // Delete job from modal
  $('#btnDeleteModal').addEventListener('click', ()=>{
    if(editingId && confirm('למחוק משימה זו?')){
      JOBS = JOBS.filter(j => j.id !== editingId);
      closeJobModal();
      refreshAll();
    }
  });

  // Sort by column header click
  $$('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if(sortState.column === column) {
        sortState.ascending = !sortState.ascending;
      } else {
        sortState.column = column;
        sortState.ascending = true;
      }
      renderTable();
      updateColumnVisibility();
    });
  });

  // Toggle filter top panel
  $('#btnToggleTopFilters').addEventListener('click', () => {
    $('#filterTopPanel').classList.toggle('collapsed');
  });
  
  // Also allow clicking the header to toggle
  $('#filterTopPanel .filter-top-header').addEventListener('click', () => {
    $('#filterTopPanel').classList.toggle('collapsed');
  });

  // Toggle column controls visibility
  $('#btnToggleColumnControls').addEventListener('click', () => {
    const columnControls = $('#columnControls');
    const toggleBtn = $('#btnToggleColumnControls');
    
    if (columnControls.style.display === 'none') {
      columnControls.style.display = 'block';
      toggleBtn.title = 'הסתר בקרות עמודות';
    } else {
      columnControls.style.display = 'none';
      toggleBtn.title = 'הצג בקרות עמודות';
    }
  });

  $('#tbody').addEventListener('click', (e)=>{
    // Check if clicked on editable date cell
    const dateCell = e.target.closest('.editable-date');
    if (dateCell && !dateCell.querySelector('input')) {
      makeEditableDate(dateCell);
      return;
    }
    
    // Check if clicked on editable worker cell
    const workerCell = e.target.closest('.editable-worker');
    if (workerCell && !workerCell.querySelector('input') && !workerCell.querySelector('.inline-worker-editor')) {
      makeEditableWorker(workerCell);
      return;
    }
    
    // Check if clicked on editable text cell
    const textCell = e.target.closest('.editable-text');
    if (textCell && !textCell.querySelector('input')) {
      makeEditableText(textCell);
      return;
    }
    
    // Check if clicked on editable dropdown cell
    const dropdownCell = e.target.closest('.editable-dropdown');
    if (dropdownCell && !dropdownCell.querySelector('select')) {
      makeEditableDropdown(dropdownCell);
      return;
    }
    
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const job = JOBS.find(j=>j.id===id);
    if(!job) return;
    if(act==='finish'){
      saveToUndoHistory('finish');
      job.finished = !job.finished;
      refreshAll();
    } else if(act==='clone'){
      cloneJob(id);
    } else if(act==='edit'){
      openJobModal(job);
    } else if(act==='del'){
      if(confirm('למחוק משימה זו?')){ 
        saveToUndoHistory('delete');
        JOBS = JOBS.filter(j=>j.id!==id); 
        refreshAll(); 
      }
    }
  });

  // Filters
  ['fltFactory','fltWorker','fltFactoryManager','fltMaintenanceManager','fltFrom','fltTo','fltSearch','fltPriority','fltEquipmentNumber','fltServiceCall','fltDepartment','fltStatus','fltConflictsOnly','fltDependencyIssuesOnly','fltShowBoth'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{ renderTable(); renderTimeline(); updateColumnVisibility(); });
  });

  $('#btnClearFilters').addEventListener('click', ()=>{
    $('#fltFactory').value=''; 
    $('#fltWorker').value=''; 
    $('#fltFactoryManager').value=''; 
    $('#fltMaintenanceManager').value=''; 
    $('#fltFrom').value=''; 
    $('#fltTo').value=''; 
    $('#fltSearch').value=''; 
    $('#fltPriority').value='';
    $('#fltEquipmentNumber').value='';
    $('#fltServiceCall').value='';
    $('#fltDepartment').value='';
    $('#fltStatus').value='';
    $('#fltConflictsOnly').checked=false; 
    $('#fltDependencyIssuesOnly').checked=false;
    $('#fltShowBoth').checked=false;
    renderTable(); 
    renderTimeline();
    updateColumnVisibility();
  });
  
  // Undo button
  $('#btnUndo').addEventListener('click', undoLastAction);

  // Tabs
  $$('.tab').forEach(tab=> tab.addEventListener('click', ()=>{
    $$('.tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active');
    const name = tab.getAttribute('data-tab');
    $('#view-table').style.display = name==='table'? 'block':'none';
    $('#view-timeline').style.display = name==='timeline'? 'block':'none';
    $('#view-gantt').style.display = name==='gantt'? 'block':'none';
    $('#view-team').style.display = name==='team'? 'block':'none';
    if(name==='timeline') renderTimeline();
    if(name==='gantt') {
      // Initialize Gantt if not already done
      if (typeof initGantt === 'function') {
        initGantt();
      }
    }
    if(name==='team') renderTeamManagement();
  }));

  // Timeline date range default = first job date or today + 3 days
  function getFirstJobDate() {
    const jobsWithDates = JOBS.filter(j => j.start && dayjs(j.start).isValid());
    if (jobsWithDates.length === 0) {
      return dayjs().format('YYYY-MM-DD');
    }
    const sortedJobs = jobsWithDates.sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf());
    return dayjs(sortedJobs[0].start).format('YYYY-MM-DD');
  }
  
  const defaultStartDate = getFirstJobDate();
  const defaultEndDate = dayjs(defaultStartDate).add(3, 'days').format('YYYY-MM-DD');
  $('#tl-start-date').value = defaultStartDate;
  $('#tl-end-date').value = defaultEndDate;
  
  // Apply date range button
  $('#btnApplyTimelineRange')?.addEventListener('click', renderTimeline);
  
  // Date input changes
  $('#tl-start-date')?.addEventListener('input', renderTimeline);
  $('#tl-end-date')?.addEventListener('input', renderTimeline);
  
  // Today button - set range to today + 3 days
  $('#btnToday').addEventListener('click', () => {
    const today = dayjs().format('YYYY-MM-DD');
    $('#tl-start-date').value = today;
    $('#tl-end-date').value = dayjs(today).add(3, 'days').format('YYYY-MM-DD');
    renderTimeline();
  });

  // Import/Export
  $('#btnImport').addEventListener('click', ()=> $('#fileInput').click());
  $('#fileInput').addEventListener('change', handleFile, false);
  $('#btnExport').addEventListener('click', exportExcel);

  // Auto-fill end time when start time is set
  $('#f-start').addEventListener('change', ()=>{
    const startVal = $('#f-start').value;
    const endVal = $('#f-end').value;
    if(startVal && !endVal) {
      // Set end time to 1 hour after start time
      const startTime = dayjs(startVal);
      const endTime = startTime.add(1, 'hour');
      $('#f-end').value = endTime.format('YYYY-MM-DDTHH:mm');
    }
  });

  // Handle "Add new factory" option
  $('#f-factory').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newFactory = prompt('הזן שם מפעל חדש:');
      if(newFactory && newFactory.trim()) {
        FACTORIES.add(newFactory.trim());
        updateFormDropdowns();
        $('#f-factory').value = newFactory.trim();
      } else {
        $('#f-factory').value = '';
      }
    }
  });

  // Handle multi-select worker component
  $('#f-worker-selected').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWorkerDropdown();
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const container = $('#f-worker-container');
    if (container && !container.contains(e.target)) {
      closeWorkerDropdown();
    }
  });
  
  // Handle checkbox changes
  document.addEventListener('change', (e) => {
    if (e.target.matches('#f-worker-options input[type="checkbox"]')) {
      updateWorkerDisplay();
    }
  });
  
  // Handle "Add new worker" button
  $('#btn-add-worker').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newWorker = prompt('הזן שם עובד מבצע חדש:');
    if(newWorker && newWorker.trim()) {
      WORKERS.add(newWorker.trim());
      updateFormDropdowns();
      // Auto-select the new worker
      const checkbox = $(`#f-worker-options input[value="${newWorker.trim()}"]`);
      if (checkbox) {
        checkbox.checked = true;
        updateWorkerDisplay();
      }
    }
  });

  // Handle "Add new factory manager" option
  $('#f-factoryManager').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newFactoryManager = prompt('הזן שם מפקח עבודה חדש:');
      if(newFactoryManager && newFactoryManager.trim()) {
        FACTORY_MANAGERS.add(newFactoryManager.trim());
        updateFormDropdowns();
        $('#f-factoryManager').value = newFactoryManager.trim();
      } else {
        $('#f-factoryManager').value = '';
      }
    }
  });

  // Handle "Add new maintenance manager" option
  $('#f-maintenanceManager').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newMaintenanceManager = prompt('הזן שם מנהל עבודה חדש:');
      if(newMaintenanceManager && newMaintenanceManager.trim()) {
        MAINTENANCE_MANAGERS.add(newMaintenanceManager.trim());
        updateFormDropdowns();
        $('#f-maintenanceManager').value = newMaintenanceManager.trim();
      } else {
        $('#f-maintenanceManager').value = '';
      }
    }
  });

  // Handle "Add new department" option
  $('#f-department').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newDepartment = prompt('הזן שם מחלקה חדשה:');
      if(newDepartment && newDepartment.trim()) {
        DEPARTMENTS.add(newDepartment.trim());
        updateFormDropdowns();
        $('#f-department').value = newDepartment.trim();
      } else {
        $('#f-department').value = '';
      }
    }
  });

  // Handle column visibility controls
  $$('.column-controls input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const column = e.target.dataset.column;
      COLUMN_VISIBILITY[column] = e.target.checked;
      updateColumnVisibility();
      saveColumnVisibility();
    });
  });

  // Handle theme toggle
  $('#themeToggle').addEventListener('click', toggleTheme);
  
  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Z or Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoLastAction();
    }
    
    // Arrow keys for timeline navigation (when timeline is visible)
    const timelineView = $('#view-timeline');
    if (timelineView && timelineView.style.display !== 'none') {
      if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea, select')) {
        e.preventDefault();
        $('#btnPrevDay').click();
      } else if (e.key === 'ArrowRight' && !e.target.matches('input, textarea, select')) {
        e.preventDefault();
        $('#btnNextDay').click();
      }
    }
  });
  
  // Team management event listeners
  $('#btnAddWorker')?.addEventListener('click', () => addTeamMember('worker'));
  $('#btnAddFactoryManager')?.addEventListener('click', () => addTeamMember('factoryManager'));
  $('#btnAddMaintenanceManager')?.addEventListener('click', () => addTeamMember('maintenanceManager'));
  $('#btnAddFactory')?.addEventListener('click', () => addTeamMember('factory'));
  $('#btnAddDepartment')?.addEventListener('click', () => addTeamMember('department'));
  
  // Initialize hover info panel
  initHoverInfoPanel();
  
  // Team management button - toggle between table and team view
  $('#btnTeamManagement')?.addEventListener('click', () => {
    const teamView = $('#view-team');
    const isTeamViewActive = teamView && teamView.style.display === 'block';
    
    if (isTeamViewActive) {
      // Go back to table view
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab[data-tab="table"]').forEach(t => t.classList.add('active'));
      $('#view-table').style.display = 'block';
      $('#view-timeline').style.display = 'none';
      $('#view-gantt').style.display = 'none';
      $('#view-team').style.display = 'none';
      $('#btnTeamManagement').textContent = '👥 ניהול צוות';
      renderTable();
    } else {
      // Show team management view
      $$('.tab').forEach(t => t.classList.remove('active'));
      $('#view-table').style.display = 'none';
      $('#view-timeline').style.display = 'none';
      $('#view-gantt').style.display = 'none';
      $('#view-team').style.display = 'block';
      $('#btnTeamManagement').textContent = '🏭 חזרה למשימות';
      renderTeamManagement();
    }
  });
}

async function handleFile(evt){
  const file = evt.target.files[0]; if(!file) return;
  
  if(typeof XLSX === 'undefined') {
    alert('ספריית ייבוא Excel לא נטענה. אנא רענן את הדף ונסה שוב.');
    evt.target.value = '';
    return;
  }
  
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:'array' });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const json = XLSX.utils.sheet_to_json(ws, { defval:'' });
  if(!json.length){ alert('הגיליון ריק'); return; }

  // Column mapping UI (basic prompt-based to keep single-file)
  const headers = Object.keys(json[0]);
  const ask = (label, fallback)=>{
    const choice = prompt(`שם עמודה עבור ${label}?\nזמינות: ${headers.join(', ')}`, fallback);
    return choice && headers.includes(choice) ? choice : fallback;
  };
  
  // Map all available fields with improved pattern matching
  const colTitle = ask('משימה', headers.find(h=>/title|job|task|משימה|name|שם/i.test(h))||headers[0]);
  const colFactory = ask('מפעל', headers.find(h=>/factory|מפעל|plant|facility/i.test(h))||'');
  const colWorker = ask('עובד מבצע', headers.find(h=>/worker|עובד|employee|staff|מבצע|executor/i.test(h))||'');
  const colFactoryManager = ask('מפקח עבודה', headers.find(h=>/factory.*manager|מפקח|supervisor|supervise|מנהל.*מפעל/i.test(h))||'');
  const colMaintenanceManager = ask('מנהל עבודה', headers.find(h=>/maintenance.*manager|מנהל.*עבודה|maintenance|אחזקה/i.test(h))||'');
  const colPriority = ask('עדיפות', headers.find(h=>/priority|עדיפות|urgent|importance/i.test(h))||'');
  const colEquipmentNumber = ask('מספר ציוד', headers.find(h=>/equipment|ציוד|number|מספר|machine|device|מכונה/i.test(h))||'');
  const colServiceCall = ask('קריאת שירות', headers.find(h=>/service.*call|קריאת.*שירות|service|ticket|call|שירות/i.test(h))||'');
  const colDepartment = ask('מחלקה מבצעת', headers.find(h=>/department|מחלקה|dept|unit|יחידה/i.test(h))||'');
  const colStart = ask('התחלה', headers.find(h=>/start|begin|התחלה|from|start.*time|start.*date/i.test(h))||'');
  const colEnd = ask('סיום', headers.find(h=>/end|finish|סיום|to|end.*time|end.*date|due/i.test(h))||'');
  const colDependsOn = ask('תלוי ב', headers.find(h=>/depend|תלוי|dependency|prerequisite|קודם/i.test(h))||'');
  const colNotes = ask('הערות', headers.find(h=>/note|remark|remarks|הערה|comment|comments|הערות|תיאור|description|desc|details|פרטים/i.test(h))||'');

  // Clear existing data BEFORE importing new data
  JOBS = [];
  FACTORIES.clear();
  WORKERS.clear();
  FACTORY_MANAGERS.clear();
  MAINTENANCE_MANAGERS.clear();
  DEPARTMENTS.clear();
  nextId = 1;

  // Import all mapped fields
  const imported = json.map(row=>{
    const factory = String(row[colFactory]||'').trim();
    // Handle multiple workers - split by comma or semicolon
    const workerStr = String(row[colWorker]||'').trim();
    const workers = workerStr ? workerStr.split(/[,;]/).map(w => w.trim()).filter(Boolean) : [];
    const factoryManager = String(row[colFactoryManager]||'').trim();
    const maintenanceManager = String(row[colMaintenanceManager]||'').trim();
    const department = String(row[colDepartment]||'').trim();
    
    // Add to sets
    if(factory) FACTORIES.add(factory);
    workers.forEach(w => { if(w) WORKERS.add(w); });
    if(factoryManager) FACTORY_MANAGERS.add(factoryManager);
    if(maintenanceManager) MAINTENANCE_MANAGERS.add(maintenanceManager);
    if(department) DEPARTMENTS.add(department);
    
    // Parse dates if available
    let startDate = '';
    let endDate = '';
    if(colStart && row[colStart]) {
      const start = dayjs(row[colStart]);
      startDate = start.isValid() ? start.format() : '';
    }
    if(colEnd && row[colEnd]) {
      const end = dayjs(row[colEnd]);
      endDate = end.isValid() ? end.format() : '';
    }
    
    return {
      id: uid(),
      title: String(row[colTitle]||'').trim(),
      factory: factory,
      workers: workers,
      factoryManager: factoryManager,
      maintenanceManager: maintenanceManager,
      priority: String(row[colPriority]||'').trim(),
      equipmentNumber: String(row[colEquipmentNumber]||'').trim(),
      serviceCall: String(row[colServiceCall]||'').trim(),
      department: department,
      start: startDate,
      end: endDate,
      dependsOn: String(row[colDependsOn]||'').trim(),
      notes: String(row[colNotes]||'').trim(),
      finished: false
    };
  });
  
  // Import new data
  JOBS = imported;
  refreshAll();
  alert(`יובאו ${imported.length} שורות מ-"${wsName}". כעת הגדר התחלה/סיום לכל משימה.`);
  evt.target.value = '';
}

function exportExcel(){
  // Use ExcelExportService to export with multiple sheets
  if (typeof ExcelExportService !== 'undefined') {
    ExcelExportService.exportToExcel(JOBS, fmt, durationStr);
  } else {
    alert('שירות ייצוא Excel לא נטען. אנא רענן את הדף ונסה שוב.');
  }
}

// No seed data - start with empty data or load from db.xlsx/localStorage

function loadFromLocalStorage(){
  const raw = localStorage.getItem('jobs.v1');
  if(!raw) return false; // No saved data
  
  const data = JSON.parse(raw);
  // Handle both old format (just array) and new format (object with jobs, factories, workers)
  if(Array.isArray(data)) {
    JOBS = data;
    // Rebuild factories, workers, managers, and departments from jobs
    FACTORIES.clear();
    WORKERS.clear();
    FACTORY_MANAGERS.clear();
    MAINTENANCE_MANAGERS.clear();
    DEPARTMENTS.clear();
    JOBS.forEach(j=>{
      // Migrate old worker string format to new workers array format
      if(j.worker && !j.workers) {
        j.workers = [j.worker];
        delete j.worker;
      }
      if(j.factory) FACTORIES.add(j.factory);
      const workers = Array.isArray(j.workers) ? j.workers : [];
      workers.forEach(w => { if(w) WORKERS.add(w); });
      if(j.factoryManager) FACTORY_MANAGERS.add(j.factoryManager);
      if(j.maintenanceManager) MAINTENANCE_MANAGERS.add(j.maintenanceManager);
      if(j.department) DEPARTMENTS.add(j.department);
    });
  } else {
    JOBS = data.jobs || [];
    // Migrate old worker string format to new workers array format
    JOBS.forEach(j=>{
      if(j.worker && !j.workers) {
        j.workers = [j.worker];
        delete j.worker;
      }
    });
    FACTORIES = new Set(data.factories || []);
    WORKERS = new Set(data.workers || []);
    FACTORY_MANAGERS = new Set(data.factoryManagers || []);
    MAINTENANCE_MANAGERS = new Set(data.maintenanceManagers || []);
    DEPARTMENTS = new Set(data.departments || []);
  }
  nextId = 1 + Math.max(0, ...JOBS.map(j=>+j.id||0));
  return true;
}

// Theme management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeIcon = $('#themeIcon');
  if(themeIcon) {
    themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  }
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

// Auto-load db.xlsx if it exists
async function autoLoadDatabase() {
  try {
    const response = await fetch('db.xlsx');
    if (!response.ok) {
      console.log('Couldnt get db.xlsx ');
      return false;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (!json.length) {
      console.log('db.xlsx is empty');
      return false;
    }
    
    // Column mapping - auto-detect common patterns
    const headers = Object.keys(json[0]);
    const findCol = (patterns) => headers.find(h => patterns.some(p => p.test(h))) || '';
    
    const colTitle = findCol([/title|job|task|משימה|name|שם/i]);
    const colFactory = findCol([/factory|מפעל|plant|facility/i]);
    const colWorker = findCol([/worker|עובד|employee|staff|מבצע|executor/i]);
    const colFactoryManager = findCol([/factory.*manager|מפקח|supervisor|supervise|מנהל.*מפעל/i]);
    const colMaintenanceManager = findCol([/maintenance.*manager|מנהל.*עבודה|maintenance|אחזקה/i]);
    const colPriority = findCol([/priority|עדיפות|urgent|importance/i]);
    const colEquipmentNumber = findCol([/equipment|ציוד|number|מספר|machine|device|מכונה/i]);
    const colServiceCall = findCol([/service.*call|קריאת.*שירות|service|ticket|call|שירות/i]);
    const colDepartment = findCol([/department|מחלקה|dept|unit|יחידה/i]);
    const colStart = findCol([/start|begin|התחלה|from|start.*time|start.*date/i]);
    const colEnd = findCol([/end|finish|סיום|to|end.*time|end.*date|due/i]);
    const colDependsOn = findCol([/depend|תלוי|dependency|prerequisite|קודם/i]);
    const colNotes = findCol([/note|remark|remarks|הערה|comment|comments|הערות|תיאור|description|desc|details|פרטים/i]);
    
    // Clear existing data before importing
    JOBS = [];
    FACTORIES.clear();
    WORKERS.clear();
    FACTORY_MANAGERS.clear();
    MAINTENANCE_MANAGERS.clear();
    DEPARTMENTS.clear();
    nextId = 1;
    
    // Import data
    const imported = json.map(row => {
      const factory = String(row[colFactory] || '').trim();
      const workerStr = String(row[colWorker] || '').trim();
      const workers = workerStr ? workerStr.split(/[,;]/).map(w => w.trim()).filter(Boolean) : [];
      const factoryManager = String(row[colFactoryManager] || '').trim();
      const maintenanceManager = String(row[colMaintenanceManager] || '').trim();
      const department = String(row[colDepartment] || '').trim();
      
      // Add to sets
      if (factory) FACTORIES.add(factory);
      workers.forEach(w => { if (w) WORKERS.add(w); });
      if (factoryManager) FACTORY_MANAGERS.add(factoryManager);
      if (maintenanceManager) MAINTENANCE_MANAGERS.add(maintenanceManager);
      if (department) DEPARTMENTS.add(department);
      
      // Parse dates
      let startDate = '';
      let endDate = '';
      if (colStart && row[colStart]) {
        const start = dayjs(row[colStart]);
        startDate = start.isValid() ? start.format() : '';
      }
      if (colEnd && row[colEnd]) {
        const end = dayjs(row[colEnd]);
        endDate = end.isValid() ? end.format() : '';
      }
      
      return {
        id: uid(),
        title: String(row[colTitle] || '').trim(),
        factory: factory,
        workers: workers,
        factoryManager: factoryManager,
        maintenanceManager: maintenanceManager,
        priority: String(row[colPriority] || '').trim(),
        equipmentNumber: String(row[colEquipmentNumber] || '').trim(),
        serviceCall: String(row[colServiceCall] || '').trim(),
        department: department,
        start: startDate,
        end: endDate,
        dependsOn: String(row[colDependsOn] || '').trim(),
        notes: String(row[colNotes] || '').trim(),
        finished: false
      };
    });
    
    JOBS = imported;
    console.log(`Loaded ${imported.length} jobs from db.xlsx`);
    return true;
  } catch (error) {
    console.log('db.xlsx not found or error loading:', error.message);
    return false;
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async ()=>{
  // Initialize theme
  initTheme();
  
  // Load column visibility settings
  loadColumnVisibility();
  
  // Try to load from db.xlsx first, then localStorage
  const dbLoaded = await autoLoadDatabase();
  if (!dbLoaded) {
    loadFromLocalStorage();
    // If localStorage is also empty, start with empty data
  }
  
  initEventListeners();
  refreshAll();
});

// Team Management Functions
function renderTeamManagement() {
  renderTeamList('workersList', WORKERS, 'worker', 'עובד');
  renderTeamList('factoryManagersList', FACTORY_MANAGERS, 'factoryManager', 'מפקח');
  renderTeamList('maintenanceManagersList', MAINTENANCE_MANAGERS, 'maintenanceManager', 'מנהל');
  renderTeamList('factoriesList', FACTORIES, 'factory', 'מפעל');
  renderTeamList('departmentsList', DEPARTMENTS, 'department', 'מחלקה');
}

function renderTeamList(containerId, dataSet, type, label) {
  const container = $(`#${containerId}`);
  if (!container) return;
  
  if (dataSet.size === 0) {
    container.innerHTML = `<div class="team-empty">אין ${label}ים להצגה</div>`;
    return;
  }
  
  const items = Array.from(dataSet).sort();
  container.innerHTML = items.map(name => {
    const count = countJobsForTeamMember(type, name);
    return `
      <div class="team-item" data-type="${type}" data-name="${escapeHtml(name)}">
        <span class="team-item-name" onclick="editTeamMember('${type}', '${escapeHtml(name).replace(/'/g, "\\'")}')">${escapeHtml(name)}<span class="team-item-count">${count}</span></span>
        <div class="team-item-actions">
          <button class="team-item-delete btn-icon" onclick="deleteTeamMember('${type}', '${escapeHtml(name).replace(/'/g, "\\'")}')">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function countJobsForTeamMember(type, name) {
  if (type === 'worker') {
    return JOBS.filter(j => {
      const workers = Array.isArray(j.workers) ? j.workers : [];
      return workers.includes(name);
    }).length;
  } else if (type === 'factory') {
    return JOBS.filter(j => j.factory === name).length;
  } else if (type === 'factoryManager') {
    return JOBS.filter(j => j.factoryManager === name).length;
  } else if (type === 'maintenanceManager') {
    return JOBS.filter(j => j.maintenanceManager === name).length;
  } else if (type === 'department') {
    return JOBS.filter(j => j.department === name).length;
  }
  return 0;
}

function addTeamMember(type) {
  const labels = {
    worker: 'עובד מבצע',
    factoryManager: 'מפקח עבודה',
    maintenanceManager: 'מנהל עבודה',
    factory: 'מפעל',
    department: 'מחלקה'
  };
  
  const name = prompt(`הזן שם ${labels[type]} חדש:`);
  if (!name || !name.trim()) return;
  
  const trimmedName = name.trim();
  const dataSet = getDataSet(type);
  
  if (dataSet.has(trimmedName)) {
    alert(`${labels[type]} "${trimmedName}" כבר קיים`);
    return;
  }
  
  saveToUndoHistory('add-team-member');
  dataSet.add(trimmedName);
  refreshAll();
  renderTeamManagement();
}

function editTeamMember(type, oldName) {
  const labels = {
    worker: 'עובד מבצע',
    factoryManager: 'מפקח עבודה',
    maintenanceManager: 'מנהל עבודה',
    factory: 'מפעל',
    department: 'מחלקה'
  };
  
  const newName = prompt(`ערוך ${labels[type]}:`, oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  
  const trimmedName = newName.trim();
  const dataSet = getDataSet(type);
  
  if (dataSet.has(trimmedName)) {
    alert(`${labels[type]} "${trimmedName}" כבר קיים`);
    return;
  }
  
  saveToUndoHistory('edit-team-member');
  
  // Update in set
  dataSet.delete(oldName);
  dataSet.add(trimmedName);
  
  // Update in all jobs
  JOBS.forEach(job => {
    if (type === 'worker') {
      if (Array.isArray(job.workers)) {
        const index = job.workers.indexOf(oldName);
        if (index !== -1) {
          job.workers[index] = trimmedName;
        }
      }
    } else if (job[type] === oldName) {
      job[type] = trimmedName;
    }
  });
  
  refreshAll();
  renderTeamManagement();
}

function deleteTeamMember(type, name) {
  const labels = {
    worker: 'עובד מבצע',
    factoryManager: 'מפקח עבודה',
    maintenanceManager: 'מנהל עבודה',
    factory: 'מפעל',
    department: 'מחלקה'
  };
  
  const count = countJobsForTeamMember(type, name);
  const confirmMsg = count > 0 
    ? `האם למחוק את ${labels[type]} "${name}"?\nהוא/היא משוייך/ת ל-${count} משימות. המשימות יישארו אבל בלי ${labels[type]} זה.`
    : `האם למחוק את ${labels[type]} "${name}"?`;
  
  if (!confirm(confirmMsg)) return;
  
  saveToUndoHistory('delete-team-member');
  
  // Remove from set
  const dataSet = getDataSet(type);
  dataSet.delete(name);
  
  // Remove from all jobs
  JOBS.forEach(job => {
    if (type === 'worker') {
      if (Array.isArray(job.workers)) {
        job.workers = job.workers.filter(w => w !== name);
      }
    } else if (job[type] === name) {
      job[type] = '';
    }
  });
  
  refreshAll();
  renderTeamManagement();
}

function getDataSet(type) {
  switch(type) {
    case 'worker': return WORKERS;
    case 'factoryManager': return FACTORY_MANAGERS;
    case 'maintenanceManager': return MAINTENANCE_MANAGERS;
    case 'factory': return FACTORIES;
    case 'department': return DEPARTMENTS;
    default: return new Set();
  }
}

// Hover Info Panel Functions
function initHoverInfoPanel() {
  const panel = $('#hoverInfoPanel');
  if (!panel) return;
  
  let currentJobId = null;
  
  // Track mouse movement to position panel
  document.addEventListener('mousemove', (e) => {
    // Check if hovering over timeline task (in main timeline view)
    const timelineTask = e.target.closest('.jobbar');
    if (timelineTask) {
      const jobId = timelineTask.dataset.jobId;
      if (jobId !== currentJobId) {
        currentJobId = jobId;
        showHoverInfo(jobId, e);
      } else {
        updateHoverInfoPosition(e);
      }
      return;
    }
    
    // Check if hovering over gantt task
    const ganttTask = e.target.closest('.gantt-task-bar');
    if (ganttTask) {
      const jobId = ganttTask.dataset.jobId;
      if (jobId !== currentJobId) {
        currentJobId = jobId;
        showHoverInfo(jobId, e);
      } else {
        updateHoverInfoPosition(e);
      }
      return;
    }
    
    // If not hovering over any task, hide panel
    if (currentJobId !== null) {
      currentJobId = null;
      hideHoverInfo();
    }
  });
}

function showHoverInfo(jobId, event) {
  const panel = $('#hoverInfoPanel');
  if (!panel) return;
  
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return;
  
  // Update panel content
  $('#hoverInfoTitle').textContent = job.title || 'ללא כותרת';
  
  const workers = Array.isArray(job.workers) ? job.workers : [];
  $('#hoverInfoWorkers').textContent = workers.length > 0 ? workers.join(', ') : '-';
  
  $('#hoverInfoFactory').textContent = job.factory || '-';
  $('#hoverInfoStart').textContent = fmt(job.start) || '-';
  $('#hoverInfoEnd').textContent = fmt(job.end) || '-';
  $('#hoverInfoDuration').textContent = durationStr(job.start, job.end) || '-';
  
  // Position panel near cursor
  updateHoverInfoPosition(event);
  
  // Show panel
  panel.classList.add('visible');
}

function updateHoverInfoPosition(event) {
  const panel = $('#hoverInfoPanel');
  if (!panel || !panel.classList.contains('visible')) return;
  
  const offset = 15; // Offset from cursor
  const panelWidth = 280;
  const panelHeight = panel.offsetHeight;
  
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  
  // Adjust if panel goes off screen
  if (left + panelWidth > window.innerWidth) {
    left = event.clientX - panelWidth - offset;
  }
  
  if (top + panelHeight > window.innerHeight) {
    top = event.clientY - panelHeight - offset;
  }
  
  // Keep within bounds
  left = Math.max(10, Math.min(left, window.innerWidth - panelWidth - 10));
  top = Math.max(10, Math.min(top, window.innerHeight - panelHeight - 10));
  
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}

function hideHoverInfo() {
  const panel = $('#hoverInfoPanel');
  if (panel) {
    panel.classList.remove('visible');
  }
}


