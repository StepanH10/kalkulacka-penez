import {
  Chart,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  LinearScale,
  Tooltip,
} from 'chart.js'
import { cssVar } from '../utils/theme.js'
import { formatMoney } from '../utils/format.js'

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, LinearScale, Tooltip)

function baseOptions() {
  Chart.defaults.font.family = cssVar('--font')
  Chart.defaults.color = cssVar('--text-muted')
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    plugins: {
      tooltip: {
        backgroundColor: cssVar('--text'),
        titleColor: cssVar('--bg'),
        bodyColor: cssVar('--bg'),
        padding: 10,
        cornerRadius: 10,
        displayColors: false,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${formatMoney(ctx.raw)}` },
      },
    },
  }
}

export function donutChart(canvas, { labels, values, colors }) {
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: cssVar('--card'), borderWidth: 2, hoverOffset: 4 }],
    },
    options: { ...baseOptions(), cutout: '72%' },
  })
}

export function barChart(canvas, { labels, income, expense }) {
  const grid = cssVar('--border')
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Příjmy', data: income, backgroundColor: cssVar('--income'), borderRadius: 6, maxBarThickness: 18 },
        { label: 'Výdaje', data: expense, backgroundColor: cssVar('--expense'), borderRadius: 6, maxBarThickness: 18 },
      ],
    },
    options: {
      ...baseOptions(),
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          grid: { color: grid },
          border: { display: false },
          ticks: {
            maxTicksLimit: 5,
            callback: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} tis.` : v),
          },
        },
      },
    },
  })
}
