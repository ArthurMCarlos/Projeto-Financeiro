// Chart.js configuration and management
let categoryChart, monthlyChart, pieChart;

function initializeCharts() {
    // Initialize empty charts
    createCategoryChart();
    createMonthlyChart();
    createPieChart();
}
function updateCharts(filteredTransactions = transactions) {
    updateCategoryChart(filteredTransactions);
    updateMonthlyChart(filteredTransactions);
    updatePieChart(filteredTransactions);
}
// Category Bar Chart
function createCategoryChart() {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    
    categoryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Gastos por Categoria (R$)',
                data: [],
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
                ],
                borderColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + value.toLocaleString('pt-BR');
                        }
                    }
                }
            }
        }
    });
}
function updateCategoryChart(filteredTransactions) {
    const categoryExpenses = {};
    
    filteredTransactions.forEach(transaction => {
        const category = categories.find(c => c._id === transaction.category_id);
        const categoryName = category ? category.name : 'Sem categoria';
        
        if (!categoryExpenses[categoryName]) {
            categoryExpenses[categoryName] = 0;
        }
        categoryExpenses[categoryName] += (transaction.expense || 0);
    });

    const labels = Object.keys(categoryExpenses);
    const data = Object.values(categoryExpenses);

    categoryChart.data.labels = labels;
    categoryChart.data.datasets[0].data = data;
    categoryChart.update();
}
// Monthly Line Chart
function createMonthlyChart() {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    
    monthlyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Gastos (R$)',
                    data: [],
                    borderColor: '#FF6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Receitas (R$)',
                    data: [],
                    borderColor: '#36A2EB',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + value.toLocaleString('pt-BR');
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

function updateMonthlyChart(filteredTransactions) {
    const monthlyData = {};
    
    filteredTransactions.forEach(transaction => {
        const month = transaction.month;
        
        if (!monthlyData[month]) {
            monthlyData[month] = { expenses: 0, income: 0 };
        }
        
        monthlyData[month].expenses += (transaction.expense || 0);
        monthlyData[month].income += (transaction.income || 0);
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(monthlyData).sort();
    
    const labels = sortedMonths.map(month => {
        const [year, monthNum] = month.split('-');
        const date = new Date(year, monthNum - 1);
        return date.toLocaleDateString('pt-BR', { 
            year: '2-digit', 
            month: 'short' 
        });
    });
    
    const expenseData = sortedMonths.map(month => monthlyData[month].expenses);
    const incomeData = sortedMonths.map(month => monthlyData[month].income);

    monthlyChart.data.labels = labels;
    monthlyChart.data.datasets[0].data = expenseData;
    monthlyChart.data.datasets[1].data = incomeData;
    monthlyChart.update();
}

// Pie Chart
function createPieChart() {
    const ctx = document.getElementById('pieChart').getContext('2d');
    
    pieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF',
                    '#4BC0C0', '#9966FF'
                ],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 20,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: R$ ${value.toLocaleString('pt-BR')} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function updatePieChart(filteredTransactions) {
    const categoryExpenses = {};
    
    filteredTransactions.forEach(transaction => {
        const category = categories.find(c => c._id === transaction.category_id);
        const categoryName = category ? category.name : 'Sem categoria';
        
        if (!categoryExpenses[categoryName]) {
            categoryExpenses[categoryName] = 0;
        }
        categoryExpenses[categoryName] += (transaction.expense || 0);
    });

    // Filter out categories with zero expenses
    const filteredCategories = Object.entries(categoryExpenses)
        .filter(([_, value]) => value > 0)
        .sort(([_, a], [__, b]) => b - a); // Sort by value descending

    const labels = filteredCategories.map(([label, _]) => label);
    const data = filteredCategories.map(([_, value]) => value);

    pieChart.data.labels = labels;
    pieChart.data.datasets[0].data = data;
    pieChart.update();
}

// Chart theme update function
function updateChartsTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f7fafc' : '#1a202c';
    const gridColor = isDark ? '#4a5568' : '#e2e8f0';

    const chartOptions = {
        plugins: {
            legend: {
                labels: {
                    color: textColor
                }
            }
        },
        scales: {
            x: {
                ticks: {
                    color: textColor
                },
                grid: {
                    color: gridColor
                }
            },
            y: {
                ticks: {
                    color: textColor
                },
                grid: {
                    color: gridColor
                }
            }
        }
    };

    // Atualiza todos os gráficos com o novo tema
    if (categoryChart) {
        categoryChart.options = { ...categoryChart.options, ...chartOptions };
        categoryChart.update();
    }

    if (monthlyChart) {
        monthlyChart.options = { ...monthlyChart.options, ...chartOptions };
        monthlyChart.update();
    }

    if (pieChart) {
        pieChart.options.plugins.legend.labels.color = textColor;
        pieChart.update();
    }
}

// Listen for theme changes
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            updateChartsTheme();
        }
    });
});

if (document.body) {
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
}
