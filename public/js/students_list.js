(function () {
  const selectAll = document.getElementById('selectAllStudents');
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  const bulkForm = document.getElementById('bulkDeleteForm');

  function checkboxes() {
    return Array.from(document.querySelectorAll('.student-select'));
  }

  function updateDeleteButton() {
    if (!deleteBtn) return;
    const all = checkboxes();
    const checked = all.filter((c) => c.checked);
    deleteBtn.disabled = checked.length === 0;
    deleteBtn.textContent = checked.length > 0 ? `Delete Selected (${checked.length})` : 'Delete Selected';
    if (selectAll) {
      selectAll.checked = all.length > 0 && checked.length === all.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    }
  }

  if (selectAll) {
    selectAll.addEventListener('change', function () {
      checkboxes().forEach((c) => { c.checked = selectAll.checked; });
      updateDeleteButton();
    });
  }

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('student-select')) {
      updateDeleteButton();
    }
  });

  if (bulkForm) {
    bulkForm.addEventListener('submit', function (e) {
      const count = checkboxes().filter((c) => c.checked).length;
      if (count === 0) {
        e.preventDefault();
      }
    });
  }

  updateDeleteButton();
})();
