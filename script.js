// منع زر الفأرة الأيمن
document.addEventListener('contextmenu', e => e.preventDefault());

// منع تحديد النصوص وقصها أو نسخها
document.addEventListener('selectstart', e => e.preventDefault());

// منع اختصارات لوحة المفاتيح (F12, Ctrl+U, Ctrl+Shift+I, Ctrl+S)
document.onkeydown = function(e) {
  if (e.keyCode === 123) return false; // F12
  if (e.ctrlKey && e.keyCode === 85) return false; // Ctrl+U
  if (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) return false; // Ctrl+Shift+I/J/C
  if (e.ctrlKey && e.keyCode === 83) return false; // Ctrl+S
};

// إرباك أدوات المطورين إذا حاول شخص فتحها
setInterval(function() {
  debugger;
}, 100);
