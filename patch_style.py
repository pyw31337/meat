import pathlib
p = pathlib.Path('index.html')
c = p.read_text(encoding='utf-8')
old = '''    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { 
          position: 'bottom', 
          labels: { boxWidth: 10, padding: 8, font: { size: 11 }, color: '#374151' } 
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y ? ctx.parsed.y.toLocaleString() + '\uc6d0' : '-')
          }
        }
      },
      scales: {
        x: { ticks: { color: '#6b7280', maxRotation: 40, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
        y: {
          ticks: { color: '#6b7280', callback: v => v.toLocaleString() },
          grid: { color: '#f3f4f6' },
          title: { display: true, text: '\uc6d0 / 100g', color: '#6b7280', font: { size: 11 } }
        }
      }
    }'''
new = '''    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 12,
            font: { size: 12, family: "'Noto Sans KR', sans-serif" },
            color: '#374151',
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleFont: { size: 13, family: "'Noto Sans KR', sans-serif", weight: '600' },
          bodyFont: { size: 12, family: "'Noto Sans KR', sans-serif" },
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            label: (ctx) => ' ' + ctx.dataset.label + ': ' + (ctx.parsed.y ? ctx.parsed.y.toLocaleString() + '\uc6d0' : '-')
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#6b7280', maxRotation: 40, font: { size: 11, family: "'Noto Sans KR', sans-serif" } },
          grid: { color: '#f3f4f6', drawBorder: false },
          border: { display: false }
        },
        y: {
          ticks: { color: '#6b7280', font: { size: 11, family: "'Noto Sans KR', sans-serif" }, callback: v => v.toLocaleString() },
          grid: { color: '#f3f4f6', drawBorder: false },
          border: { display: false },
          title: { display: true, text: '\uc6d0 / 100g', color: '#6b7280', font: { size: 12, family: "'Noto Sans KR', sans-serif" } }
        }
      },
      elements: {
        line: { borderWidth: 2.5, tension: 0.3 },
        point: { radius: 3, hoverRadius: 6, borderWidth: 2, hoverBorderWidth: 2 }
      }
    }'''
if old in c:
    c = c.replace(old, new)
    print('patched')
else:
    print('not found')
p.write_text(c, encoding='utf-8')
