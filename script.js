// Global variables
let currentUser = null;
let transactions = [];
let categories = [];
let charts = {};
let currentPage = 'dashboard';

// API Base URL
const API_BASE = window.location.origin;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    // Check authentication
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Set user info
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    currentUser = user;
    document.getElementById('userInfo').textContent = `Olá, ${user.name}`;

    // Initialize theme
    initializeTheme();

    // Initialize navigation
    initializeNavigation();

    // Load data
    await loadCategories();
    await loadTransactions();
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Initialize charts
    initializeCharts();

    // Inicializa as metas (será chamado a partir de goals.js)
    if (typeof initializeGoals === 'function') {
        await initializeGoals();
    }
}

function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const body = document.body;

    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    body.setAttribute('data-theme', savedTheme);
    themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    themeToggle.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        
        // Atualiza o tema dos gráficos se a função existir
        if (typeof updateChartsTheme === 'function') {
            updateChartsTheme();
        }
    });
}

function initializeNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const page = tab.getAttribute('data-page');
            switchPage(page);
        });
    });

    // Set initial page
    switchPage('dashboard');
}

function switchPage(pageName) {
    // Update navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

    // Update page content
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(`${pageName}-page`).classList.add('active');

    currentPage = pageName;

    // Page-specific initialization
    switch (pageName) {
        case 'goals':
            if (typeof loadGoals === 'function') {
                loadGoals();
            }
            break;
        case 'reports':
            initializeReports();
            break;
        case 'transactions':
            displayTransactions();
            break;
        case 'dashboard':
            updateStats();
            updateCharts();
            if (typeof displayGoalsPreview === 'function') {
                displayGoalsPreview();
            }
            break;
    }
}

function initializeEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Add transaction
    document.getElementById('addTransactionBtn').addEventListener('click', () => {
        openTransactionModal();
    });

    // Manage categories
    document.getElementById('manageCategoriesBtn').addEventListener('click', () => {
        openCategoriesModal();
    });

    // Import
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    document.getElementById('importFile').addEventListener('change', handleImport);

    // Filters
    document.getElementById('monthFilter').addEventListener('change', applyFilters);
    document.getElementById('categoryFilter').addEventListener('change', applyFilters);
    document.getElementById('searchFilter').addEventListener('input', applyFilters);

    // Transaction form
    document.getElementById('transactionForm').addEventListener('submit', saveTransaction);

    // Modal close
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Close modal on outside click
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });

    // Reports
    const generateReportBtn = document.getElementById('generateReportBtn');
    if (generateReportBtn) {
        generateReportBtn.addEventListener('click', generateReport);
    }
}

// API Functions
async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    
    const config = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        ...options
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, config);
        
        if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Erro na requisição');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        alert(error.message || 'Erro de conexão');
        throw error;
    }
}

// Categories Functions
async function loadCategories() {
    try {
        const data = await apiCall('/api/categories');
        categories = data.categories || [];
        updateCategorySelects();
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

function updateCategorySelects() {
    const categorySelect = document.getElementById('category');
    const categoryFilter = document.getElementById('categoryFilter');
    
    // Clear existing options
    categorySelect.innerHTML = '<option value="">Selecione uma categoria</option>';
    categoryFilter.innerHTML = '<option value="">Todas as categorias</option>';
    
    // Add categories
    categories.forEach(category => {
        const option1 = new Option(category.name, category._id);
        const option2 = new Option(category.name, category._id);
        categorySelect.add(option1);
        categoryFilter.add(option2);
    });

    // Atualiza o select de categoria das metas se a função existir
    if (typeof updateGoalCategorySelect === 'function') {
        updateGoalCategorySelect();
    }
}

async function addCategory() {
    const name = document.getElementById('newCategoryName').value.trim();
    
    if (!name) {
        alert('Digite o nome da categoria');
        return;
    }

    try {
        await apiCall('/api/categories', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        
        document.getElementById('newCategoryName').value = '';
        await loadCategories();
        displayCategories();
    } catch (error) {
        console.error('Erro ao adicionar categoria:', error);
    }
}

async function deleteCategory(categoryId) {
    if (!confirm('Tem certeza que deseja excluir esta categoria?')) {
        return;
    }

    try {
        await apiCall(`/api/categories/${categoryId}`, {
            method: 'DELETE'
        });
        
        await loadCategories();
        displayCategories();
        await loadTransactions(); // Reload transactions as they might be affected
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
    }
}

function displayCategories() {
    const categoriesList = document.getElementById('categoriesList');
    
    categoriesList.innerHTML = categories.map(category => `
        <div class="category-item">
            <span class="category-name">${category.name}</span>
            <button onclick="deleteCategory('${category._id}')" class="btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                Excluir
            </button>
        </div>
    `).join('');
}

// Transactions Functions
async function loadTransactions() {
    try {
        const data = await apiCall('/api/transactions');
        transactions = data.transactions || [];
        displayTransactions();
        updateStats();
        updateCharts();
        
        // Atualiza o progresso das metas pelas transações se a função existir
        if (typeof updateGoalProgressFromTransactions === 'function') {
            updateGoalProgressFromTransactions();
        }
    } catch (error) {
        console.error('Erro ao carregar transações:', error);
    }
}

function displayTransactions(filteredTransactions = transactions) {
    const tbody = document.querySelector('#transactionsTable tbody');
    
    tbody.innerHTML = filteredTransactions.map(transaction => {
        const category = categories.find(c => c._id === transaction.category_id);
        const categoryName = category ? category.name : 'Categoria não encontrada';
        
        return `
            <tr>
                <td>${formatMonth(transaction.month)}</td>
                <td>${transaction.reason}</td>
                <td>R$ ${formatCurrency(transaction.expense || 0)}</td>
                <td>R$ ${formatCurrency(transaction.current_value || 0)}</td>
                <td>${categoryName}</td>
                <td>R$ ${formatCurrency(transaction.income || 0)}</td>
                <td>
                    <button onclick="editTransaction('${transaction._id}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin-right: 0.5rem;">
                        Editar
                    </button>
                    <button onclick="deleteTransaction('${transaction._id}')" class="btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                        Excluir
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function saveTransaction(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const transactionId = document.getElementById('transactionId').value;
    
    const transactionData = {
        month: formData.get('month') || document.getElementById('month').value,
        reason: formData.get('reason') || document.getElementById('reason').value,
        expense: parseFloat(document.getElementById('expense').value) || 0,
        current_value: parseFloat(document.getElementById('currentValue').value) || 0,
        category_id: document.getElementById('category').value,
        income: parseFloat(document.getElementById('income').value) || 0
    };

    try {
        if (transactionId) {
            // Update existing transaction
            await apiCall(`/api/transactions/${transactionId}`, {
                method: 'PUT',
                body: JSON.stringify(transactionData)
            });
        } else {
            // Create new transaction
            await apiCall('/api/transactions', {
                method: 'POST',
                body: JSON.stringify(transactionData)
            });
        }
        
        closeModal();
        await loadTransactions();
    } catch (error) {
        console.error('Erro ao salvar transação:', error);
    }
}

async function deleteTransaction(transactionId) {
    if (!confirm('Tem certeza que deseja excluir esta transação?')) {
        return;
    }

    try {
        await apiCall(`/api/transactions/${transactionId}`, {
            method: 'DELETE'
        });
        
        await loadTransactions();
    } catch (error) {
        console.error('Erro ao excluir transação:', error);
    }
}

function editTransaction(transactionId) {
    const transaction = transactions.find(t => t._id === transactionId);
    
    if (!transaction) {
        alert('Transação não encontrada');
        return;
    }

    // Fill form with transaction data
    document.getElementById('transactionId').value = transaction._id;
    document.getElementById('month').value = transaction.month;
    document.getElementById('reason').value = transaction.reason;
    document.getElementById('expense').value = transaction.expense || 0;
    document.getElementById('currentValue').value = transaction.current_value || 0;
    document.getElementById('category').value = transaction.category_id;
    document.getElementById('income').value = transaction.income || 0;
    
    document.getElementById('modalTitle').textContent = 'Editar Transação';
    document.getElementById('transactionModal').style.display = 'block';
}

// Modal Functions
function openTransactionModal() {
    // Clear form
    document.getElementById('transactionForm').reset();
    document.getElementById('transactionId').value = '';
    document.getElementById('modalTitle').textContent = 'Nova Transação';
    
    // Set current month as default
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('month').value = currentMonth;
    
    document.getElementById('transactionModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('transactionModal').style.display = 'none';
}

function openCategoriesModal() {
    displayCategories();
    document.getElementById('categoriesModal').style.display = 'block';
}

function closeCategoriesModal() {
    document.getElementById('categoriesModal').style.display = 'none';
}

// Filter Functions
function applyFilters() {
    const monthFilter = document.getElementById('monthFilter').value;
    const categoryFilter = document.getElementById('categoryFilter').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase();

    let filtered = transactions.filter(transaction => {
        const matchesMonth = !monthFilter || transaction.month === monthFilter;
        const matchesCategory = !categoryFilter || transaction.category_id === categoryFilter;
        const matchesSearch = !searchFilter || transaction.reason.toLowerCase().includes(searchFilter);
        
        return matchesMonth && matchesCategory && matchesSearch;
    });

    displayTransactions(filtered);
    updateStats(filtered);
    updateCharts(filtered);
}

// Stats Functions
function updateStats(filteredTransactions = transactions) {
    const totalIncome = filteredTransactions.reduce((sum, t) => sum + (t.income || 0), 0);
    const totalExpense = filteredTransactions.reduce((sum, t) => sum + (t.expense || 0), 0);
    const totalBalance = totalIncome - totalExpense;
    
    // Calculate average monthly expense
    const monthlyExpenses = {};
    filteredTransactions.forEach(t => {
        if (!monthlyExpenses[t.month]) {
            monthlyExpenses[t.month] = 0;
        }
        monthlyExpenses[t.month] += (t.expense || 0);
    });
    
    const months = Object.keys(monthlyExpenses);
    const avgExpense = months.length > 0 ? 
        Object.values(monthlyExpenses).reduce((sum, exp) => sum + exp, 0) / months.length : 0;

    // Find top category
    const categoryExpenses = {};
    filteredTransactions.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Sem categoria';
        
        if (!categoryExpenses[categoryName]) {
            categoryExpenses[categoryName] = 0;
        }
        categoryExpenses[categoryName] += (t.expense || 0);
    });
    
    const topCategory = Object.keys(categoryExpenses).reduce((a, b) => 
        categoryExpenses[a] > categoryExpenses[b] ? a : b, '-');

    // Update UI
    document.getElementById('totalBalance').textContent = `R$ ${formatCurrency(totalBalance)}`;
    document.getElementById('avgExpense').textContent = `R$ ${formatCurrency(avgExpense)}`;
    document.getElementById('topCategory').textContent = topCategory;
    document.getElementById('totalIncome').textContent = `R$ ${formatCurrency(totalIncome)}`;

    // Color balance based on positive/negative
    const balanceElement = document.getElementById('totalBalance');
    balanceElement.style.color = totalBalance >= 0 ? 'var(--success)' : 'var(--danger)';
}

// Funções de Relatórios
function initializeReports() {
    // Define o intervalo de datas padrão para o ano atual
    const now = new Date();
    const currentYear = now.getFullYear();
    const startMonth = `${currentYear}-01`;
    const endMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    document.getElementById('reportStartMonth').value = startMonth;
    document.getElementById('reportEndMonth').value = endMonth;
}

function generateReport() {
    const startMonth = document.getElementById('reportStartMonth').value;
    const endMonth = document.getElementById('reportEndMonth').value;
    const reportType = document.getElementById('reportType').value;
    
    if (!startMonth || !endMonth) {
        alert('Selecione o período do relatório');
        return;
    }
    
    // Filter transactions by date range
    const filteredTransactions = transactions.filter(t => {
        return t.month >= startMonth && t.month <= endMonth;
    });
    
    const reportResults = document.getElementById('reportResults');
    
    switch (reportType) {
        case 'summary':
            generateSummaryReport(filteredTransactions, reportResults);
            break;
        case 'category':
            generateCategoryReport(filteredTransactions, reportResults);
            break;
        case 'monthly':
            generateMonthlyReport(filteredTransactions, reportResults);
            break;
        case 'goals':
            generateGoalsReport(reportResults);
            break;
    }
}

function generateSummaryReport(transactions, container) {
    const totalIncome = transactions.reduce((sum, t) => sum + (t.income || 0), 0);
    const totalExpense = transactions.reduce((sum, t) => sum + (t.expense || 0), 0);
    const balance = totalIncome - totalExpense;
    
    container.innerHTML = `
        <h3>Resumo Geral</h3>
        <div class="report-summary">
            <div class="report-item">
                <h4>Total de Receitas</h4>
                <div class="value" style="color: var(--success)">R$ ${formatCurrency(totalIncome)}</div>
            </div>
            <div class="report-item">
                <h4>Total de Gastos</h4>
                <div class="value" style="color: var(--danger)">R$ ${formatCurrency(totalExpense)}</div>
            </div>
            <div class="report-item">
                <h4>Saldo Final</h4>
                <div class="value" style="color: ${balance >= 0 ? 'var(--success)' : 'var(--danger)'}">R$ ${formatCurrency(balance)}</div>
            </div>
            <div class="report-item">
                <h4>Transações</h4>
                <div class="value">${transactions.length}</div>
            </div>
        </div>
    `;
}

function generateCategoryReport(transactions, container) {
    const categoryData = {};
    
    transactions.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Sem categoria';
        
        if (!categoryData[categoryName]) {
            categoryData[categoryName] = { expense: 0, income: 0, count: 0 };
        }
        
        categoryData[categoryName].expense += (t.expense || 0);
        categoryData[categoryName].income += (t.income || 0);
        categoryData[categoryName].count += 1;
    });
    
    const sortedCategories = Object.entries(categoryData)
        .sort(([,a], [,b]) => b.expense - a.expense);
    
    container.innerHTML = `
        <h3>Relatório por Categoria</h3>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Categoria</th>
                        <th>Gastos</th>
                        <th>Receitas</th>
                        <th>Saldo</th>
                        <th>Transações</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedCategories.map(([name, data]) => `
                        <tr>
                            <td>${name}</td>
                            <td style="color: var(--danger)">R$ ${formatCurrency(data.expense)}</td>
                            <td style="color: var(--success)">R$ ${formatCurrency(data.income)}</td>
                            <td style="color: ${(data.income - data.expense) >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                R$ ${formatCurrency(data.income - data.expense)}
                            </td>
                            <td>${data.count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function generateMonthlyReport(transactions, container) {
    const monthlyData = {};
    
    transactions.forEach(t => {
        if (!monthlyData[t.month]) {
            monthlyData[t.month] = { expense: 0, income: 0, count: 0 };
        }
        
        monthlyData[t.month].expense += (t.expense || 0);
        monthlyData[t.month].income += (t.income || 0);
        monthlyData[t.month].count += 1;
    });
    
    const sortedMonths = Object.entries(monthlyData).sort(([a], [b]) => b.localeCompare(a));
    
    container.innerHTML = `
        <h3>Evolução Mensal</h3>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Mês</th>
                        <th>Gastos</th>
                        <th>Receitas</th>
                        <th>Saldo</th>
                        <th>Transações</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedMonths.map(([month, data]) => `
                        <tr>
                            <td>${formatMonth(month)}</td>
                            <td style="color: var(--danger)">R$ ${formatCurrency(data.expense)}</td>
                            <td style="color: var(--success)">R$ ${formatCurrency(data.income)}</td>
                            <td style="color: ${(data.income - data.expense) >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                R$ ${formatCurrency(data.income - data.expense)}
                            </td>
                            <td>${data.count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function generateGoalsReport(container) {
    if (typeof goals === 'undefined' || goals.length === 0) {
        container.innerHTML = `
            <h3>Relatório de Metas</h3>
            <p>Nenhuma meta encontrada.</p>
        `;
        return;
    }
    
    const activeGoals = goals.filter(g => g.status === 'active').length;
    const completedGoals = goals.filter(g => g.status === 'completed').length;
    const totalProgress = goals.reduce((sum, g) => sum + calculateProgress(g), 0) / goals.length;
    
    container.innerHTML = `
        <h3>Relatório de Metas</h3>
        <div class="report-summary">
            <div class="report-item">
                <h4>Metas Ativas</h4>
                <div class="value">${activeGoals}</div>
            </div>
            <div class="report-item">
                <h4>Metas Concluídas</h4>
                <div class="value">${completedGoals}</div>
            </div>
            <div class="report-item">
                <h4>Progresso Médio</h4>
                <div class="value">${totalProgress.toFixed(1)}%</div>
            </div>
            <div class="report-item">
                <h4>Total de Metas</h4>
                <div class="value">${goals.length}</div>
            </div>
        </div>
        
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Meta</th>
                        <th>Tipo</th>
                        <th>Progresso</th>
                        <th>Status</th>
                        <th>Data Alvo</th>
                    </tr>
                </thead>
                <tbody>
                    ${goals.map(goal => `
                        <tr>
                            <td>${goal.title}</td>
                            <td>${getGoalTypeLabel(goal.goal_type)}</td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div style="flex: 1; background: var(--bg-secondary); height: 8px; border-radius: 4px;">
                                        <div style="width: ${Math.min(calculateProgress(goal), 100)}%; height: 100%; background: var(--success); border-radius: 4px;"></div>
                                    </div>
                                    <span>${calculateProgress(goal).toFixed(1)}%</span>
                                </div>
                            </td>
                            <td><span class="goal-status ${goal.status}">${getStatusLabel(goal.status)}</span></td>
                            <td>${formatDate(goal.target_date)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Export Functions
async function exportData(format) {
    try {
        const response = await fetch(`${API_BASE}/api/export/${format}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao exportar dados');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        const date = new Date().toISOString().split('T')[0];
        a.download = `financeiro_${date}.${format === 'excel' ? 'xlsx' : format}`;
        
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Erro ao exportar:', error);
        alert('Erro ao exportar dados');
    }
}

// Import Functions
async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_BASE}/api/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Erro ao importar dados');
        }

        alert(`Importação concluída! ${data.imported} registros importados.`);
        await loadTransactions();
        
        // Clear file input
        event.target.value = '';
    } catch (error) {
        console.error('Erro ao importar:', error);
        alert(error.message || 'Erro ao importar dados');
    }
}

// Utility Functions
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatMonth(monthString) {
    const [year, month] = monthString.split('-');
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('pt-BR', { 
        year: 'numeric', 
        month: 'long' 
    });
}

// Auth Functions
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}
