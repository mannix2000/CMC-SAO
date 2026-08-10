(function () {
  const postUrlBase = window.ATTENDANCE_POST_URL_BASE;
  const rows = document.getElementById('attendance-rows');
  const summary = document.getElementById('attendance-summary');

  const STATUS_CLASS = {
    present: 'btn-success',
    late: 'btn-warning',
    excused: 'btn-info',
    absent: 'btn-danger',
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
    row.querySelectorAll('.status-btn').forEach((btn) => {
      btn.classList.remove('active', 'btn-success', 'btn-warning', 'btn-info', 'btn-danger');
      btn.classList.add('btn-outline-secondary');
      if (btn.dataset.status === status) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add(STATUS_CLASS[status]);
      }
    });
  }

  rows.querySelectorAll('tr[data-row-id]').forEach(paintRow);

  rows.addEventListener('click', async (e) => {
    const btn = e.target.closest('.status-btn');
    if (!btn) return;
    const row = btn.closest('tr[data-row-id]');
    const rowId = row.dataset.rowId;
    const status = btn.dataset.status;

    btn.disabled = true;
    try {
      const res = await fetch(`${postUrlBase}/${rowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Request failed');
      row.dataset.status = status;
      paintRow(row);
      updateSummary();
    } catch (err) {
      alert('Could not save attendance. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  updateSummary();
})();
