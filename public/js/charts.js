// SplitWise Charts - Clean Production Version
(function() {
  'use strict';
  
  function renderCharts() {
    // Data from EJS
    const SPENDING_DATA = window.SPENDING_DATA || { labels: [], values: [] };
    const CATEGORY_DATA = window.CATEGORY_DATA || { labels: [], values: [] };
    const MONTHLY_DATA = window.MONTHLY_DATA || { labels: [], values: [] };
    
    if (SPENDING_DATA.labels.length === 0 && CATEGORY_DATA.labels.length === 0) {
      document.querySelectorAll('.chart-card canvas').forEach(canvas => canvas.remove());
      document.querySelectorAll('.chart-card').forEach(card => {
        if (!card.querySelector('.no-data')) {
          card.innerHTML += '<div class="no-data" style="color:var(--text-muted);padding:2rem;text-align:center;font-style:italic;">Add expenses to see charts! 📊</div>';
        }
      });
      return;
    }
    
    // Theme
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#e8e8f0' : '#1a1a2e';
    
    Chart.defaults.font.family = "'Space Grotesk', -apple-system, sans-serif";
    Chart.defaults.color = textColor;
    Chart.defaults.font.size = 13;
    Chart.defaults.font.weight = 500;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.titleFont = { size: 14, weight: 600 };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 13 };
    
    // 1. Spending by Person (horizontal bar)
    const spendingCtx = document.getElementById('spendingChart');
    if (spendingCtx && SPENDING_DATA.labels.length) {
      new Chart(spendingCtx, {
        type: 'bar',
        data: {
          labels: SPENDING_DATA.labels.slice(0, 8),
          datasets: [{
            label: '₹ Spent',
            data: SPENDING_DATA.values.slice(0, 8),
            backgroundColor: 'rgba(139, 92, 246, 0.8)',
            borderColor: '#8b5cf6',
            borderRadius: 8,
            borderWidth: 2
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: { 
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(0,0,0,0.9)',
              titleColor: 'white',
              bodyColor: 'white',
              borderColor: 'var(--accent)',
              borderWidth: 1,
              cornerRadius: 8,
              displayColors: false,
              callbacks: {
                title: function(context) { return context[0].label; },
                label: function(context) { return '₹' + context.parsed.x.toLocaleString(); }
              }
            }
          },
            scales: { 
            x: { 
              ticks: { 
                callback: v => '₹' + Math.round(v),
                color: textColor,
                font: { size: 12, weight: 600 }
              },
              grid: { color: 'rgba(139, 92, 246, 0.2)' },
              border: { color: 'rgba(139, 92, 246, 0.3)' }
            },
            y: { ticks: { font: { size: 11 } } }
          },
          onHover: (event, elements) => {
            event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
          },
          animation: { duration: 800, easing: 'easeOutQuart' },
          hover: {
            animationDuration: 200,
            mode: 'nearest'
          }
        },
        plugins: [{
          beforeDatasetsDraw(chart) {
            const ctx = chart.ctx;
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
          }
        }] 
      });
    }
    
    // 2. Category (doughnut)
    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx && CATEGORY_DATA.labels.length) {
      new Chart(categoryCtx, {
        type: 'doughnut',
        data: {
          labels: CATEGORY_DATA.labels,
          datasets: [{
            data: CATEGORY_DATA.values,
            backgroundColor: ['#8b5cf6', '#22c55e', '#eab308', '#dc2626', '#3b82f6', '#ec4899'],
            borderWidth: 3,
            hoverBorderWidth: 5,
            hoverOffset: 6,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          cutout: '65%',
          interaction: { intersect: false },
          plugins: { 
            legend: { 
              position: 'bottom', 
              labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' }
            },
            tooltip: {
              backgroundColor: 'rgba(0,0,0,0.9)',
              titleColor: 'white',
              bodyColor: 'white',
              borderColor: 'var(--accent)',
              borderWidth: 1,
              cornerRadius: 8,
              displayColors: false,
              callbacks: {
                title: function(context) { return context[0].label; },
                label: function(context) { return '₹' + context.parsed.toLocaleString(); }
              }
            }
          },
          hoverOffset: 8,
          animation: { duration: 1000, easing: 'easeOutBounce' },
          onHover: (event, elements) => {
            event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
          }
        }
      });
    }
    
    // 3. Monthly Trends (line)
    const monthlyCtx = document.getElementById('monthlyChart');
    if (monthlyCtx && MONTHLY_DATA.labels.length) {
      new Chart(monthlyCtx, {
        type: 'line',
        data: {
          labels: MONTHLY_DATA.labels,
          datasets: [{
            label: '₹ Monthly',
            data: MONTHLY_DATA.values,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            tension: 0.4,
            fill: true,
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          interaction: { intersect: false },
          plugins: { 
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(0,0,0,0.9)',
              titleColor: 'white',
              bodyColor: 'white',
              borderColor: 'var(--accent)',
              borderWidth: 1,
              cornerRadius: 8,
              displayColors: false,
              callbacks: {
                title: function(context) { return context[0].label; },
                label: function(context) { return '₹' + context.parsed.y.toLocaleString(); }
              }
            }
          },
          scales: { 
            y: { 
              beginAtZero: true, 
              grid: { color: 'rgba(139, 92, 246, 0.2)' },
              ticks: { color: textColor, font: { size: 12, weight: 500 } },
              border: { color: 'rgba(139, 92, 246, 0.3)' }
            },
            x: { 
              grid: { color: 'rgba(139, 92, 246, 0.1)' },
              ticks: { color: textColor, font: { size: 11 } }
            }
          },
          hover: {
            animationDuration: 200,
            mode: 'index'
          },
          animation: { duration: 1000, easing: 'easeOutQuart' },
          onHover: (event, elements) => {
            event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
          },
          pointHoverRadius: 8,
          pointHoverBorderWidth: 4
        }
      });
    }
  }
  
  // Instant render - no delays
  if (document.querySelector('.chart-card')) {
    renderCharts();
  }
  
  // Tab switch - instant
  window.addEventListener('load', () => {
    const btn = document.querySelector('.tab[onclick*="charts"]');
    if (btn) {
      btn.addEventListener('click', renderCharts);
    }
  });
  
  window.renderCharts = renderCharts;
})();


