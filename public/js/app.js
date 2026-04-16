// ===== THEME TOGGLE =====
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
}

(function () {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = saved === 'dark' ? '🌙' : '☀️';
})();

// ===== TAB SWITCHING =====
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const content = document.getElementById('tab-' + name);
  if (content) content.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === "switchTab('" + name + "')") t.classList.add('active');
  });
  try { sessionStorage.setItem('activeTab_' + window.location.pathname, name); } catch(e) {}
  if (name === 'charts') setTimeout(renderCharts, 50);
}

(function () {
  const key = 'activeTab_' + window.location.pathname;
  const saved = sessionStorage.getItem(key);
  if (saved && document.getElementById('tab-' + saved)) {
    switchTab(saved);
  }
})();

// ===== STAGGER REVEAL OBSERVER =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry, index) => {
    if (entry.isIntersecting) {
      const staggers = entry.target.querySelectorAll('[data-stagger]');
      staggers.forEach((el, i) => {
        el.classList.add('animate-stagger', `animate-stagger-${(i % 6) + 1}`);
      });
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.2, rootMargin: '0px 0px -50px 0px' });

// Observe lists
document.querySelectorAll('.expense-list, .groups-grid, .balances-grid, .history-list').forEach(list => {
  list.setAttribute('data-stagger', '');
  observer.observe(list);
});





// ===== AUTO-DISMISS FLASH =====
setTimeout(function() {
  document.querySelectorAll('.flash').forEach(function(el) {
    el.style.transition = 'opacity 0.5s ease';
    el.style.opacity = '0';
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
  });
}, 4000);
