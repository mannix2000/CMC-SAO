(function () {
  const postUrlBase = window.ATTENDANCE_POST_URL_BASE;
  const rows = document.getElementById('attendance-rows');
  const summary = document.getElementById('attendance-summary');

  const STATUS_BADGE_CLASS = {
    present: 'bg-success',
    late: 'bg-warning',
    excused: 'bg-info',
    absent: 'bg-danger',
  };

  function updateSummary() {
    const rowEls = rows.querySelectorAll('tr[data-row-id]');
    let present = 0;
    rowEls.forEach((row) => {
      if (row.dataset.status === 'present') present += 1;
    });
    summary.textContent = `${present} of ${rowEls.length} marked present`;
  }

  function paintRow(row) {
    const status = row.dataset.status;
    const badge = row.querySelector('.status-badge');
    badge.classList.remove('bg-success', 'bg-warning', 'bg-info', 'bg-danger', 'bg-secondary');
    badge.classList.add(STATUS_BADGE_CLASS[status] || 'bg-secondary');
    badge.textContent = status || 'unmarked';

    const excuseBtn = row.querySelector('.excuse-btn');
    if (status === 'excused') {
      excuseBtn.textContent = 'Un-excuse';
      excuseBtn.classList.remove('btn-outline-info');
      excuseBtn.classList.add('btn-info');
    } else {
      excuseBtn.textContent = 'Excuse';
      excuseBtn.classList.remove('btn-info');
      excuseBtn.classList.add('btn-outline-info');
    }
  }

  function setRowStatus(row, status) {
    row.dataset.status = status || '';
    paintRow(row);
    updateSummary();
  }

  rows.querySelectorAll('tr[data-row-id]').forEach(paintRow);

  rows.addEventListener('click', async (e) => {
    const btn = e.target.closest('.excuse-btn');
    if (!btn) return;
    const row = btn.closest('tr[data-row-id]');
    const rowId = row.dataset.rowId;
    const nextStatus = row.dataset.status === 'excused' ? null : 'excused';

    btn.disabled = true;
    try {
      const res = await fetch(`${postUrlBase}/${rowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setRowStatus(row, data.status);
    } catch (err) {
      alert('Could not save attendance. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  function formatClockTime(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  rows.addEventListener('change', async (e) => {
    const select = e.target.closest('.session-select');
    if (!select) return;
    const type = select.value;
    if (!type) return;

    const row = select.closest('tr[data-row-id]');
    const rowId = row.dataset.rowId;
    const session = select.dataset.session;
    const timesEl = row.querySelector(`.session-times[data-session="${session}"]`);

    select.disabled = true;
    try {
      const res = await fetch(`${postUrlBase}/${rowId}/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, type }),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      const inField = session === 'am' ? data.timeInAm : data.timeInPm;
      const outField = session === 'am' ? data.timeOutAm : data.timeOutPm;
      timesEl.querySelector('.time-in').textContent = formatClockTime(inField);
      timesEl.querySelector('.time-out').textContent = formatClockTime(outField);
      setRowStatus(row, data.status);
    } catch (err) {
      alert('Could not save the time. Please try again.');
    } finally {
      select.value = '';
      select.disabled = false;
    }
  });

  updateSummary();
})();
