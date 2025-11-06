// Global variables
let currentUser = null;
let transactions = [];
let categories = [];
let incomes = [];
let budgets = [];
let accounts = [];
let goals = [];
let charts = {};

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

    // Load all data
    await loadAllData();
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Initialize charts
    initializeCharts();
}

function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const body = document.body;

    const savedTheme = localStorage.getItem('theme') || 'light';
    body.setAttribute('data-theme', savedTheme);
    themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    themeToggle.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        updateChartsTheme();
    });
}

function initializeEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Menu toggle for mobile
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('open');
        });
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateToPage(page);
        });
    });

    // Overview account selector
    const overviewSelectedAccount = document.getElementById('overviewSelectedAccount');
    if (overviewSelectedAccount) {
        overviewSelectedAccount.addEventListener('change', onOverviewAccountSelectionChanged);
    }

    // Income events
    document.getElementById('addIncomeBtn').addEventListener('click', () => openIncomeModal());
    document.getElementById('incomeForm').addEventListener('submit', saveIncome);
    document.getElementById('incomeMonthFilter').addEventListener('change', filterIncomes);
    document.getElementById('incomeAccountFilter').addEventListener('change', filterIncomes);
    document.getElementById('selectedAccount').addEventListener('change', onAccountSelectionChanged);

    // Expense events
    document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal());
    document.getElementById('expenseForm').addEventListener('submit', saveExpense);
    document.getElementById('expenseMonthFilter').addEventListener('change', filterExpenses);
    document.getElementById('expenseCategoryFilter').addEventListener('change', filterExpenses);
    document.getElementById('expenseSearchFilter').addEventListener('input', filterExpenses);

    // Budget events
    document.getElementById('addBudgetBtn').addEventListener('click', () => openBudgetModal());
    document.getElementById('budgetForm').addEventListener('submit', saveBudget);
    document.getElementById('budgetMonthFilter').addEventListener('change', filterBudgets);

    // Account events
    document.getElementById('addAccountBtn').addEventListener('click', () => openAccountModal());
    document.getElementById('accountForm').addEventListener('submit', saveAccount);

    // Goal events
    document.getElementById('addGoalBtn').addEventListener('click', () => openGoalModal());
    document.getElementById('goalForm').addEventListener('submit', saveGoal);

    // Category events
    document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
    document.getElementById('categoryForm').addEventListener('submit', saveCategory);

    // Comparison
    document.getElementById('compareBtn').addEventListener('click', compareMonths);

    // Modal close
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            closeAllModals();
        });
    });

    // Close modal on outside click
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
}

// Navigation
function navigateToPage(page) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    // Update active page
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`${page}-page`).classList.add('active');

    // Update page title
    const titles = {
        'overview': 'Visão Geral',
        'incomes': 'Receitas',
        'expenses': 'Despesas',
        'budgets': 'Orçamentos',
        'accounts': 'Contas',
        'goals': 'Metas',
        'categories': 'Categorias',
        'reports': 'Relatórios'
    };
    document.getElementById('pageTitle').textContent = titles[page];

    // Load page-specific data
    if (page === 'categories') {
        displayCategories();
    }

    // Close sidebar on mobile
    document.querySelector('.sidebar').classList.remove('open');
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

// Load Data Functions
async function loadAllData() {
    try {
        await Promise.all([
            loadCategories(),
            loadTransactions(),
            loadIncomes(),
            loadBudgets(),
            loadAccounts(),
            loadGoals()
        ]);
        
        // FORÇAR ATUALIZAÇÃO DE TODAS AS LISTAS APÓS CARREGAR TODOS OS DADOS
        await updateAllDisplays();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
}

async function updateAllDisplays() {
    // Aguardar um pequeno delay para garantir que todos os dados foram processados
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Diagnóstico - verificar se os dados foram carregados
    console.log('🔄 Atualizando displays...', {
        transactions: transactions.length,
        categories: categories.length,
        accounts: accounts.length,
        budgets: budgets.length
    });
    
    // Atualizar todas as displays na ordem correta
    displayExpenses();
    displayIncomes();
    displayBudgets();
    displayAccounts();
    displayGoals();
    
    // Atualizar todos os seletores e resumos
    updateCategorySelects();
    updateAccountSelects();
    updateIncomeAccountSelects();
    updateOverviewAccountSelect();
    updateAccountBalances();
    updateAccountSummary();
    updateOverviewAccountSummary();
    updateOverview();
    
    console.log('✅ Displays atualizados com sucesso');
}

// Função de debug para verificar se os dados estão sendo carregados
function debugDataLoading() {
    console.log('🔍 Estado dos dados:', {
        'Transações': transactions.length,
        'Categorias': categories.length,
        'Contas': accounts.length,
        'Orçamentos': budgets.length,
        'Receitas': incomes.length,
        'Metas': goals.length
    });
}

async function loadCategories() {
    try {
        const data = await apiCall('/api/categories');
        categories = data.categories || [];
        updateCategorySelects();
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

async function loadTransactions() {
    try {
        const data = await apiCall('/api/transactions');
        transactions = data.transactions || [];
        // Remover displayExpenses() aqui - será chamado após todos os dados carregarem
    } catch (error) {
        console.error('Erro ao carregar transações:', error);
    }
}

async function loadIncomes() {
    try {
        const data = await apiCall('/api/incomes');
        incomes = data.incomes || [];
        
        // Popular selects de conta
        updateIncomeAccountSelects();
        
        displayIncomes();
        updateAccountSummary(); // Atualiza resumo se houver conta selecionada
    } catch (error) {
        console.error('Erro ao carregar receitas:', error);
    }
}

// Atualizar selects de conta na página de receitas
function updateIncomeAccountSelects() {
    const selects = ['incomeAccountFilter', 'selectedAccount'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        // Manter valor atual
        const currentValue = select.value;
        
        // Limpar opções (exceto a primeira)
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }
        
        // Adicionar contas disponíveis
        accounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account._id;
            option.textContent = account.name;
            select.appendChild(option);
        });
        
        // Restaurar valor selecionado
        select.value = currentValue;
    });
}

async function loadBudgets() {
    try {
        const data = await apiCall('/api/budgets');
        budgets = data.budgets || [];
        displayBudgets();
    } catch (error) {
        console.error('Erro ao carregar orçamentos:', error);
    }
}

async function loadAccounts() {
    try {
        const data = await apiCall('/api/accounts');
        accounts = data.accounts || [];
        updateAccountSelects();
        updateIncomeAccountSelects(); // Popular selects específicos de receitas
        updateOverviewAccountSelect(); // Popular select da overview
        displayAccounts();
        updateAccountBalances(); // Atualiza o cálculo de saldos automático
        updateAccountSummary(); // Atualizar resumo se houver conta selecionada
        updateOverviewAccountSummary(); // Atualizar resumo da overview
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
    }
}

// Função para calcular e atualizar saldos automáticos das contas
function updateAccountBalances() {
    accounts.forEach(account => {
        if (account._id) {
            // Busca receitas vinculadas a esta conta
            const accountIncomes = incomes.filter(income => income.account_id === account._id);
            const totalIncomes = accountIncomes.reduce((sum, income) => sum + (parseFloat(income.amount) || 0), 0);
            
            // Busca transações vinculadas a esta conta
            const accountTransactions = transactions.filter(transaction => transaction.account_id === account._id);
            const totalTransactionIncomes = accountTransactions.reduce((sum, transaction) => sum + (parseFloat(transaction.income) || 0), 0);
            const totalTransactionExpenses = accountTransactions.reduce((sum, transaction) => sum + (parseFloat(transaction.expense) || 0), 0);
            
            // Calcula o saldo total
            const calculatedBalance = totalIncomes + totalTransactionIncomes - totalTransactionExpenses;
            
            // ATUALIZA o objeto account para que o saldo total seja calculado corretamente
            account.balance = calculatedBalance;
            
            // Atualiza visualmente o saldo na interface
            const balanceElement = document.querySelector(`[data-account-id="${account._id}"] .account-balance`);
            if (balanceElement) {
                balanceElement.textContent = `R$ ${formatCurrency(calculatedBalance)}`;
                
                // Adiciona classes CSS para cores baseadas no saldo
                balanceElement.classList.remove('positive', 'negative', 'zero');
                if (calculatedBalance > 0) {
                    balanceElement.classList.add('positive');
                } else if (calculatedBalance < 0) {
                    balanceElement.classList.add('negative');
                } else {
                    balanceElement.classList.add('zero');
                }
            }
        }
    });
    
    // Atualizar o saldo total na overview após recalcular todos os saldos
    updateTotalBalanceInOverview();
}

// Função para recalcular todos os saldos das contas no backend
async function recalculateAllBalances() {
    try {
        // Chama o endpoint para recalcular saldos (precisa ser implementado no backend)
        // Por enquanto, vamos usar a função updateAccountBalances()
        updateAccountBalances();
        
        // Opcionalmente, poderia adicionar uma chamada para o backend:
        // await apiCall('/api/accounts/recalculate', { method: 'POST' });
        
        console.log('Saldos das contas atualizados automaticamente!');
        showNotification('Saldos das contas atualizados!', 'success');
    } catch (error) {
        console.error('Erro ao recalcular saldos:', error);
        showNotification('Erro ao atualizar saldos', 'error');
    }
}

// Função para atualizar o saldo total na overview
function updateTotalBalanceInOverview() {
    const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const totalBalanceElement = document.getElementById('totalBalance');
    if (totalBalanceElement) {
        totalBalanceElement.textContent = `R$ ${formatCurrency(totalBalance)}`;
        
        // Adiciona cor baseada no saldo
        totalBalanceElement.style.color = totalBalance >= 0 ? 'var(--success)' : 'var(--danger)';
    }
}

// Função para mostrar notificações
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? 'var(--success, #10b981)' : 'var(--error, #ef4444)'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

async function loadGoals() {
    try {
        const data = await apiCall('/api/goals');
        goals = data.goals || [];
        displayGoals();
    } catch (error) {
        console.error('Erro ao carregar metas:', error);
    }
}

// Update Selects
function updateCategorySelects() {
    const selects = ['expenseCategory', 'budgetCategory', 'expenseCategoryFilter'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = selectId.includes('Filter') ? 
                '<option value="">Todas as categorias</option>' : 
                '<option value="">Selecione uma categoria</option>';
            
            categories.forEach(category => {
                const option = new Option(category.name, category._id);
                select.add(option);
            });
            
            if (currentValue) select.value = currentValue;
        }
    });
}

function updateAccountSelects() {
    const selects = ['incomeAccount', 'expenseAccount', 'incomeAccountFilter'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = selectId.includes('Filter') ? 
                '<option value="">Todas as contas</option>' : 
                '<option value="">Selecione uma conta</option>';
            
            accounts.forEach(account => {
                const option = new Option(account.name, account._id);
                select.add(option);
            });
            
            if (currentValue) select.value = currentValue;
        }
    });
}

// Overview Functions
function updateOverview() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Calculate totals
    const monthIncomes = incomes.filter(i => i.month === currentMonth);
    const monthExpenses = transactions.filter(t => t.month === currentMonth);
    
    const totalIncome = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
    const totalExpense = monthExpenses.reduce((sum, t) => sum + (t.expense || 0), 0);
    const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const monthSavings = totalIncome - totalExpense;
    
    // Update UI
    document.getElementById('totalBalance').textContent = `R$ ${formatCurrency(totalBalance)}`;
    document.getElementById('monthIncome').textContent = `R$ ${formatCurrency(totalIncome)}`;
    document.getElementById('monthExpense').textContent = `R$ ${formatCurrency(totalExpense)}`;
    document.getElementById('monthSavings').textContent = `R$ ${formatCurrency(monthSavings)}`;
    
    // Color savings based on positive/negative
    const savingsElement = document.getElementById('monthSavings');
    savingsElement.style.color = monthSavings >= 0 ? 'var(--success)' : 'var(--danger)';
    
    // Display recent transactions
    displayRecentTransactions();
    
    // Update charts
    updateOverviewCharts();
}

function displayRecentTransactions() {
    const container = document.getElementById('recentTransactions');
    const recent = [...transactions, ...incomes.map(i => ({...i, isIncome: true}))]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5);
    
    container.innerHTML = recent.map(item => {
        const isIncome = item.isIncome;
        const amount = isIncome ? item.amount : item.expense;
        const description = isIncome ? item.source : item.reason;
        const icon = isIncome ? '💵' : '💸';
        const amountClass = isIncome ? 'income' : 'expense';
        const sign = isIncome ? '+' : '-';
        
        return `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-icon">${icon}</div>
                    <div class="transaction-details">
                        <h4>${description}</h4>
                        <p>${formatMonth(item.month)}</p>
                    </div>
                </div>
                <div class="transaction-amount ${amountClass}">
                    ${sign} R$ ${formatCurrency(amount)}
                </div>
            </div>
        `;
    }).join('');
}

// Income Functions
// Event handler para mudança na seleção de conta
function onAccountSelectionChanged() {
    const selectedAccountId = document.getElementById('selectedAccount').value;
    
    // Atualizar o filtro de conta também
    const incomeAccountFilter = document.getElementById('incomeAccountFilter');
    if (selectedAccountId) {
        incomeAccountFilter.value = selectedAccountId;
    }
    
    // Atualizar resumo e filtros
    updateAccountSummary();
    filterIncomes();
}

// Atualizar resumo da conta selecionada
function updateAccountSummary() {
    const selectedAccountId = document.getElementById('selectedAccount').value;
    const summaryContainer = document.getElementById('accountSummary');
    
    if (!selectedAccountId) {
        summaryContainer.style.display = 'none';
        return;
    }
    
    const selectedAccount = accounts.find(a => a._id === selectedAccountId);
    if (!selectedAccount) {
        summaryContainer.style.display = 'none';
        return;
    }
    
    // Filtrar receitas da conta selecionada
    const accountIncomes = incomes.filter(income => income.account_id === selectedAccountId);
    
    // Calcular estatísticas
    const totalIncomes = accountIncomes.reduce((sum, income) => sum + income.amount, 0);
    
    // Mês atual (YYYY-MM)
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthIncomes = accountIncomes
        .filter(income => income.month === currentMonth)
        .reduce((sum, income) => sum + income.amount, 0);
    
    // Maior receita
    const largestIncome = accountIncomes.length > 0 
        ? Math.max(...accountIncomes.map(income => income.amount))
        : 0;
    
    // Última receita (mais recente)
    const sortedIncomes = [...accountIncomes].sort((a, b) => {
        if (a.month === b.month) return 0;
        return a.month > b.month ? -1 : 1;
    });
    const lastIncome = sortedIncomes.length > 0 ? sortedIncomes[0] : null;
    
    // Atualizar elementos do resumo
    document.getElementById('summaryAccountName').textContent = selectedAccount.name;
    document.getElementById('summaryAccountType').textContent = getAccountTypeLabel(selectedAccount.type);
    document.getElementById('summaryTotalIncomes').textContent = `R$ ${formatCurrency(totalIncomes)}`;
    document.getElementById('summaryCurrentMonth').textContent = `R$ ${formatCurrency(currentMonthIncomes)}`;
    document.getElementById('summaryLargestIncome').textContent = `R$ ${formatCurrency(largestIncome)}`;
    document.getElementById('summaryLastIncome').textContent = lastIncome 
        ? `${formatMonth(lastIncome.month)} - R$ ${formatCurrency(lastIncome.amount)}`
        : '-';
    
    // Mostrar resumo
    summaryContainer.style.display = 'block';
}

// Helper para obter label do tipo de conta
function getAccountTypeLabel(type) {
    const typeLabels = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'cartao': 'Cartão de Crédito',
        'investimento': 'Investimento'
    };
    return typeLabels[type] || type;
}

// Overview Account Functions
function onOverviewAccountSelectionChanged() {
    updateOverviewAccountSummary();
    updateOverview(); // Recalcular estatísticas gerais se necessário
}

function updateOverviewAccountSummary() {
    const selectedAccountId = document.getElementById('overviewSelectedAccount').value;
    const summaryContainer = document.getElementById('overviewAccountSummary');
    
    if (!selectedAccountId) {
        summaryContainer.style.display = 'none';
        return;
    }
    
    const selectedAccount = accounts.find(a => a._id === selectedAccountId);
    if (!selectedAccount) {
        summaryContainer.style.display = 'none';
        return;
    }
    
    // Filtrar receitas e transações da conta selecionada
    const accountIncomes = incomes.filter(income => income.account_id === selectedAccountId);
    const accountTransactions = transactions.filter(t => t.account_id === selectedAccountId);
    
    // Calcular estatísticas
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    
    // Receitas do mês atual
    const monthIncomes = accountIncomes
        .filter(income => income.month === currentMonth)
        .reduce((sum, income) => sum + income.amount, 0);
    
    // Despesas do mês atual (transações com expense > 0)
    const monthExpenses = accountTransactions
        .filter(t => t.month === currentMonth && t.expense > 0)
        .reduce((sum, t) => sum + t.expense, 0);
    
    // Balanço do mês (receitas - despesas)
    const monthBalance = monthIncomes - monthExpenses;
    
    // Atualizar elementos do resumo
    document.getElementById('overviewSummaryAccountName').textContent = selectedAccount.name;
    document.getElementById('overviewSummaryAccountType').textContent = getAccountTypeLabel(selectedAccount.type);
    document.getElementById('overviewAccountBalance').textContent = `R$ ${formatCurrency(selectedAccount.balance || 0)}`;
    document.getElementById('overviewAccountIncomes').textContent = `R$ ${formatCurrency(monthIncomes)}`;
    document.getElementById('overviewAccountExpenses').textContent = `R$ ${formatCurrency(monthExpenses)}`;
    document.getElementById('overviewMonthBalance').textContent = `R$ ${formatCurrency(monthBalance)}`;
    
    // Mostrar resumo
    summaryContainer.style.display = 'block';
}

// Popular select de conta na overview
function updateOverviewAccountSelect() {
    const select = document.getElementById('overviewSelectedAccount');
    if (!select) return;
    
    // Manter valor atual
    const currentValue = select.value;
    
    // Limpar opções (exceto a primeira)
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }
    
    // Adicionar contas disponíveis
    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account._id;
        option.textContent = account.name;
        select.appendChild(option);
    });
    
    // Restaurar valor selecionado
    select.value = currentValue;
}

function displayIncomes(filtered = incomes) {
    const tbody = document.querySelector('#incomesTable tbody');
    
    // Se há conta selecionada, destacar apenas suas receitas
    const selectedAccountId = document.getElementById('selectedAccount').value;
    let displayIncomes = filtered;
    
    if (selectedAccountId) {
        displayIncomes = filtered.filter(income => income.account_id === selectedAccountId);
    }
    
    tbody.innerHTML = displayIncomes.map(income => {
        const account = accounts.find(a => a._id === income.account_id);
        const accountName = account ? account.name : '-';
        const isSelectedAccount = income.account_id === selectedAccountId;
        
        // Adicionar destaque visual se for da conta selecionada
        const rowClass = isSelectedAccount ? 'selected-account-income' : '';
        
        return `
            <tr class="${rowClass}">
                <td>${formatMonth(income.month)}</td>
                <td>${income.source}</td>
                <td>R$ ${formatCurrency(income.amount)}</td>
                <td>${accountName}</td>
                <td>
                    <button onclick="editIncome('${income._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem; margin-right: 0.5rem;">
                        Editar
                    </button>
                    <button onclick="deleteIncome('${income._id}')" class="btn-danger">
                        Excluir
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterIncomes() {
    const monthFilter = document.getElementById('incomeMonthFilter').value;
    const accountFilter = document.getElementById('incomeAccountFilter').value;
    const selectedAccount = document.getElementById('selectedAccount').value;
    
    let filtered = incomes.filter(income => {
        const matchesMonth = !monthFilter || income.month === monthFilter;
        const matchesAccount = !accountFilter || income.account_id === accountFilter;
        
        // Se há conta selecionada, dar prioridade a ela
        if (selectedAccount) {
            return matchesMonth && income.account_id === selectedAccount;
        }
        
        return matchesMonth && matchesAccount;
    });
    
    displayIncomes(filtered);
}

function openIncomeModal(income = null) {
    const modal = document.getElementById('incomeModal');
    const form = document.getElementById('incomeForm');
    
    form.reset();
    
    if (income) {
        document.getElementById('incomeModalTitle').textContent = 'Editar Receita';
        document.getElementById('incomeId').value = income._id;
        document.getElementById('incomeMonth').value = income.month;
        document.getElementById('incomeSource').value = income.source;
        document.getElementById('incomeAmount').value = income.amount;
        document.getElementById('incomeAccount').value = income.account_id || '';
    } else {
        document.getElementById('incomeModalTitle').textContent = 'Nova Receita';
        const now = new Date();
        document.getElementById('incomeMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    modal.style.display = 'block';
}

function closeIncomeModal() {
    document.getElementById('incomeModal').style.display = 'none';
}

async function saveIncome(event) {
    event.preventDefault();
    
    const incomeId = document.getElementById('incomeId').value;
    const incomeData = {
        month: document.getElementById('incomeMonth').value,
        source: document.getElementById('incomeSource').value,
        amount: parseFloat(document.getElementById('incomeAmount').value),
        account_id: document.getElementById('incomeAccount').value || null
    };
    
    try {
        if (incomeId) {
            await apiCall(`/api/incomes/${incomeId}`, {
                method: 'PUT',
                body: JSON.stringify(incomeData)
            });
        } else {
            await apiCall('/api/incomes', {
                method: 'POST',
                body: JSON.stringify(incomeData)
            });
        }
        
        closeIncomeModal();
        await loadIncomes();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        recalculateAllBalances(); // Recalcula todos os saldos automaticamente
        updateOverview();
        showNotification('Receita salva com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao salvar receita:', error);
        showNotification('Erro ao salvar receita', 'error');
    }
}

function editIncome(incomeId) {
    const income = incomes.find(i => i._id === incomeId);
    if (income) {
        openIncomeModal(income);
    }
}

async function deleteIncome(incomeId) {
    if (!confirm('Tem certeza que deseja excluir esta receita?')) {
        return;
    }
    
    try {
        await apiCall(`/api/incomes/${incomeId}`, {
            method: 'DELETE'
        });
        
        await loadIncomes();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        recalculateAllBalances(); // Recalcula todos os saldos automaticamente
        updateOverview();
        showNotification('Receita excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir receita:', error);
        showNotification('Erro ao excluir receita', 'error');
    }
}

// Expense Functions
function displayExpenses(filtered = transactions) {
    const tbody = document.querySelector('#expensesTable tbody');
    
    // Aguardar um pouco se os dados ainda não estiverem carregados
    if (categories.length === 0 || accounts.length === 0) {
        console.log('⏳ Aguardando carregamento de dados para exibir despesas...');
        setTimeout(() => displayExpenses(filtered), 200);
        return;
    }
    
    tbody.innerHTML = filtered.map(transaction => {
        const category = categories.find(c => c._id === transaction.category_id);
        const account = accounts.find(a => a._id === transaction.account_id);
        const categoryName = category ? category.name : '-';
        const accountName = account ? account.name : '-';
        
        return `
            <tr>
                <td>${formatMonth(transaction.month)}</td>
                <td>${transaction.reason}</td>
                <td>R$ ${formatCurrency(transaction.expense || 0)}</td>
                <td>${categoryName}</td>
                <td>${accountName}</td>
                <td>
                    <button onclick="editExpense('${transaction._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem; margin-right: 0.5rem;">
                        Editar
                    </button>
                    <button onclick="deleteExpense('${transaction._id}')" class="btn-danger">
                        Excluir
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExpenses() {
    const monthFilter = document.getElementById('expenseMonthFilter').value;
    const categoryFilter = document.getElementById('expenseCategoryFilter').value;
    const searchFilter = document.getElementById('expenseSearchFilter').value.toLowerCase();
    
    let filtered = transactions.filter(transaction => {
        const matchesMonth = !monthFilter || transaction.month === monthFilter;
        const matchesCategory = !categoryFilter || transaction.category_id === categoryFilter;
        const matchesSearch = !searchFilter || transaction.reason.toLowerCase().includes(searchFilter);
        return matchesMonth && matchesCategory && matchesSearch;
    });
    
    displayExpenses(filtered);
}

function openExpenseModal(expense = null) {
    const modal = document.getElementById('expenseModal');
    const form = document.getElementById('expenseForm');
    
    form.reset();
    
    if (expense) {
        document.getElementById('expenseModalTitle').textContent = 'Editar Despesa';
        document.getElementById('expenseId').value = expense._id;
        document.getElementById('expenseMonth').value = expense.month;
        document.getElementById('expenseReason').value = expense.reason;
        document.getElementById('expenseAmount').value = expense.expense;
        document.getElementById('expenseCategory').value = expense.category_id;
        document.getElementById('expenseAccount').value = expense.account_id || '';
    } else {
        document.getElementById('expenseModalTitle').textContent = 'Nova Despesa';
        const now = new Date();
        document.getElementById('expenseMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    modal.style.display = 'block';
}

function closeExpenseModal() {
    document.getElementById('expenseModal').style.display = 'none';
}

async function saveExpense(event) {
    event.preventDefault();
    
    const expenseId = document.getElementById('expenseId').value;
    const expenseAmount = parseFloat(document.getElementById('expenseAmount').value);
    const expenseMonth = document.getElementById('expenseMonth').value;
    const categoryId = document.getElementById('expenseCategory').value;
    
    const expenseData = {
        month: expenseMonth,
        reason: document.getElementById('expenseReason').value,
        expense: expenseAmount,
        category_id: categoryId,
        account_id: document.getElementById('expenseAccount').value || null,
        current_value: 0,
        income: 0
    };
    
    // Verificar orçamento antes de salvar
    const budgetValidation = await checkBudgetLimit(expenseAmount, categoryId, expenseMonth);
    
    if (budgetValidation.exceedsBudget) {
        const confirmExceed = confirm(
            `⚠️ ATENÇÃO: Esta despesa irá exceder o orçamento!\n\n` +
            `Categoria: ${budgetValidation.categoryName}\n` +
            `Orçamento atual: R$ ${formatCurrency(budgetValidation.budgetAmount)}\n` +
            `Já gasto: R$ ${formatCurrency(budgetValidation.spent)}\n` +
            `Nova despesa: R$ ${formatCurrency(expenseAmount)}\n` +
            `Total após esta despesa: R$ ${formatCurrency(budgetValidation.totalAfter)}\n` +
            `Excedente: R$ ${formatCurrency(budgetValidation.exceededAmount)}\n\n` +
            `Deseja continuar mesmo assim?`
        );
        
        if (!confirmExceed) {
            showToast('Operação cancelada pelo usuário', 'warning');
            return;
        }
        
        // Mostrar notificação de alerta
        showToast(`⚠️ Orçamento da categoria "${budgetValidation.categoryName}" será excedido!`, 'warning');
    }
    
    // Mostrar loading
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';
    
    try {
        if (expenseId) {
            await apiCall(`/api/transactions/${expenseId}`, {
                method: 'PUT',
                body: JSON.stringify(expenseData)
            });
            showToast('Despesa atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/transactions', {
                method: 'POST',
                body: JSON.stringify(expenseData)
            });
            showToast('Despesa salva com sucesso!', 'success');
        }
        
        closeExpenseModal();
        
        // Atualizar dados com refresh automático
        await refreshAllData();
        
        // Se excedeu o orçamento, mostrar aviso adicional
        if (budgetValidation.exceedsBudget) {
            setTimeout(() => {
                showToast('Revise os orçamentos das categorias em vermelho!', 'error');
            }, 2000);
        }
        
    } catch (error) {
        console.error('Erro ao salvar despesa:', error);
        showToast('Erro ao salvar despesa: ' + error.message, 'error');
    } finally {
        // Restaurar botão
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

function editExpense(expenseId) {
    const expense = transactions.find(t => t._id === expenseId);
    if (expense) {
        openExpenseModal(expense);
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('Tem certeza que deseja excluir esta despesa?')) {
        return;
    }
    
    try {
        await apiCall(`/api/transactions/${expenseId}`, {
            method: 'DELETE'
        });
        
        await loadTransactions();
        await loadAccounts(); // Recarrega as contas para atualizar os saldos
        recalculateAllBalances(); // Recalcula todos os saldos automaticamente
        updateOverview();
        showNotification('Despesa excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir despesa:', error);
        showNotification('Erro ao excluir despesa', 'error');
    }
}

// Budget Validation Functions
async function checkBudgetLimit(newExpenseAmount, categoryId, month) {
    // Encontrar orçamento para a categoria e mês
    const budget = budgets.find(b => b.category_id === categoryId && b.month === month);
    
    if (!budget) {
        return { 
            hasBudget: false, 
            exceedsBudget: false, 
            categoryName: getCategoryName(categoryId),
            budgetAmount: 0,
            spent: 0,
            totalAfter: newExpenseAmount,
            exceededAmount: 0
        };
    }
    
    // Calcular valor já gasto (usando campo spent do backend se disponível)
    const spent = budget.spent !== undefined ? budget.spent : 
        transactions
            .filter(t => t.month === month && t.category_id === categoryId)
            .reduce((sum, t) => sum + (t.expense || 0), 0);
    
    const totalAfter = spent + newExpenseAmount;
    const exceededAmount = Math.max(0, totalAfter - budget.amount);
    const exceedsBudget = totalAfter > budget.amount;
    
    return {
        hasBudget: true,
        exceedsBudget,
        categoryName: getCategoryName(categoryId),
        budgetAmount: budget.amount,
        spent,
        totalAfter,
        exceededAmount,
        percentage: (spent / budget.amount) * 100,
        newPercentage: (totalAfter / budget.amount) * 100
    };
}

function getCategoryName(categoryId) {
    const category = categories.find(c => c._id === categoryId);
    return category ? category.name : 'Categoria não encontrada';
}

// Enhanced Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
    const toastContainer = getOrCreateToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Auto remove
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'toastOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

// Refresh all data automatically
async function refreshAllData() {
    try {
        showToast('Atualizando dados...', 'info', 2000);
        
        await Promise.all([
            loadCategories(),
            loadTransactions(),
            loadIncomes(),
            loadBudgets(),
            loadAccounts(),
            loadGoals()
        ]);
        
        // Usar a função centralizada de atualização
        await updateAllDisplays();
        
        showToast('Dados atualizados!', 'success', 2000);
    } catch (error) {
        console.error('Erro ao atualizar dados:', error);
        showToast('Erro ao atualizar alguns dados', 'error');
    }
}

// Budget Functions
function displayBudgets(filtered = budgets) {
    const container = document.getElementById('budgetsList');
    
    // Aguardar um pouco se os dados ainda não estiverem carregados
    if (categories.length === 0 || transactions.length === 0) {
        console.log('⏳ Aguardando carregamento de dados para exibir orçamentos...');
        setTimeout(() => displayBudgets(filtered), 200);
        return;
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhum orçamento encontrado</p>';
        return;
    }
    
    // Loading state
    container.innerHTML = '<div style="text-align: center; padding: 2rem;"><div class="loading-spinner"></div><p>Carregando orçamentos...</p></div>';
    
    container.innerHTML = filtered.map(budget => {
        const category = categories.find(c => c._id === budget.category_id);
        const categoryName = category ? category.name : 'Categoria não encontrada';
        
        // Usar o campo 'spent' do backend ou calcular se não existir
        const spent = budget.spent !== undefined ? budget.spent : 
            transactions
                .filter(t => t.month === budget.month && t.category_id === budget.category_id)
                .reduce((sum, t) => sum + (t.expense || 0), 0);
        
        const percentage = (spent / budget.amount) * 100;
        const remaining = budget.amount - spent;
        
        // Definir classes de progresso baseadas no percentual
        let progressClass = '';
        let statusBadge = '';
        let statusColor = '';
        
        if (percentage >= 90) {
            progressClass = 'danger';
            statusBadge = 'danger';
            statusColor = '#ef4444';
        } else if (percentage >= 70) {
            progressClass = 'warning';
            statusBadge = 'warning';
            statusColor = '#f59e0b';
        } else {
            progressClass = 'success';
            statusBadge = 'success';
            statusColor = '#10b981';
        }
        
        // Definir status do orçamento
        let statusText = '';
        if (percentage >= 100) {
            statusText = 'EXCEDIDO';
        } else if (percentage >= 90) {
            statusText = 'CRÍTICO';
        } else if (percentage >= 70) {
            statusText = 'ATENÇÃO';
        } else {
            statusText = 'OK';
        }
        
        return `
            <div class="budget-card" data-budget-id="${budget._id}">
                <div class="budget-header">
                    <div class="budget-category-info">
                        <h4>${categoryName}</h4>
                        <span class="budget-status-badge ${statusBadge}">${statusText}</span>
                    </div>
                    <div class="budget-amount-info">
                        <div class="budget-amount">Orçamento: R$ ${formatCurrency(budget.amount)}</div>
                        <div class="budget-spent">Gasto: R$ ${formatCurrency(spent)}</div>
                    </div>
                </div>
                <div class="budget-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <div class="progress-text">
                        <div class="progress-main">
                            <strong>${percentage.toFixed(1)}%</strong> usado
                        </div>
                        <div class="progress-details">
                            <span class="remaining">Restante: R$ ${formatCurrency(remaining)}</span>
                            ${percentage >= 100 ? `<span class="exceeded" style="color: var(--danger); font-weight: bold;">Excedido: R$ ${formatCurrency(Math.abs(remaining))}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="budget-visual-indicator">
                    <div class="budget-meter">
                        <div class="meter-segment ${percentage >= 100 ? 'exceeded' : percentage >= 90 ? 'critical' : percentage >= 70 ? 'warning' : 'safe'}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                </div>
                <div class="budget-actions">
                    <button onclick="editBudget('${budget._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        Editar
                    </button>
                    <button onclick="deleteBudget('${budget._id}')" class="btn-danger">
                        Excluir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filterBudgets() {
    const monthFilter = document.getElementById('budgetMonthFilter').value;
    
    let filtered = budgets;
    if (monthFilter) {
        filtered = budgets.filter(b => b.month === monthFilter);
    }
    
    displayBudgets(filtered);
}

function openBudgetModal(budget = null) {
    const modal = document.getElementById('budgetModal');
    const form = document.getElementById('budgetForm');
    
    form.reset();
    
    if (budget) {
        document.getElementById('budgetModalTitle').textContent = 'Editar Orçamento';
        document.getElementById('budgetId').value = budget._id;
        document.getElementById('budgetMonth').value = budget.month;
        document.getElementById('budgetCategory').value = budget.category_id;
        document.getElementById('budgetAmount').value = budget.amount;
    } else {
        document.getElementById('budgetModalTitle').textContent = 'Novo Orçamento';
        const now = new Date();
        document.getElementById('budgetMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    modal.style.display = 'block';
}

function closeBudgetModal() {
    document.getElementById('budgetModal').style.display = 'none';
}

async function saveBudget(event) {
    event.preventDefault();
    
    const budgetId = document.getElementById('budgetId').value;
    const budgetData = {
        month: document.getElementById('budgetMonth').value,
        category_id: document.getElementById('budgetCategory').value,
        amount: parseFloat(document.getElementById('budgetAmount').value)
    };
    
    try {
        if (budgetId) {
            await apiCall(`/api/budgets/${budgetId}`, {
                method: 'PUT',
                body: JSON.stringify(budgetData)
            });
        } else {
            await apiCall('/api/budgets', {
                method: 'POST',
                body: JSON.stringify(budgetData)
            });
        }
        
        closeBudgetModal();
        await loadBudgets();
    } catch (error) {
        console.error('Erro ao salvar orçamento:', error);
    }
}

function editBudget(budgetId) {
    const budget = budgets.find(b => b._id === budgetId);
    if (budget) {
        openBudgetModal(budget);
    }
}

async function deleteBudget(budgetId) {
    if (!confirm('Tem certeza que deseja excluir este orçamento?')) {
        return;
    }
    
    try {
        await apiCall(`/api/budgets/${budgetId}`, {
            method: 'DELETE'
        });
        
        await loadBudgets();
    } catch (error) {
        console.error('Erro ao excluir orçamento:', error);
    }
}

// Account Functions
function displayAccounts() {
    const container = document.getElementById('accountsList');
    
    if (accounts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhuma conta encontrada</p>';
        return;
    }
    
    const typeLabels = {
        'corrente': 'Conta Corrente',
        'poupanca': 'Poupança',
        'cartao': 'Cartão de Crédito',
        'investimento': 'Investimento'
    };
    
    container.innerHTML = accounts.map(account => {
        return `
            <div class="account-card" data-account-id="${account._id}">
                <div class="account-header">
                    <span class="account-type">${typeLabels[account.type] || account.type}</span>
                </div>
                <div class="account-balance">R$ ${formatCurrency(account.balance || 0)}</div>
                <div class="account-name">${account.name}</div>
                <div class="account-actions">
                    <button onclick="editAccount('${account._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        Editar
                    </button>
                    <button onclick="deleteAccount('${account._id}')" class="btn-danger">
                        Excluir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openAccountModal(account = null) {
    const modal = document.getElementById('accountModal');
    const form = document.getElementById('accountForm');
    
    form.reset();
    
    if (account) {
        document.getElementById('accountModalTitle').textContent = 'Editar Conta';
        document.getElementById('accountId').value = account._id;
        document.getElementById('accountName').value = account.name;
        document.getElementById('accountType').value = account.type;
        document.getElementById('accountBalance').value = account.balance || 0;
    } else {
        document.getElementById('accountModalTitle').textContent = 'Nova Conta';
    }
    
    modal.style.display = 'block';
}

function closeAccountModal() {
    document.getElementById('accountModal').style.display = 'none';
}

async function saveAccount(event) {
    event.preventDefault();
    
    const accountId = document.getElementById('accountId').value;
    const accountData = {
        name: document.getElementById('accountName').value,
        type: document.getElementById('accountType').value,
        balance: parseFloat(document.getElementById('accountBalance').value)
    };
    
    try {
        if (accountId) {
            await apiCall(`/api/accounts/${accountId}`, {
                method: 'PUT',
                body: JSON.stringify(accountData)
            });
        } else {
            await apiCall('/api/accounts', {
                method: 'POST',
                body: JSON.stringify(accountData)
            });
        }
        
        closeAccountModal();
        await loadAccounts();
        updateOverview();
    } catch (error) {
        console.error('Erro ao salvar conta:', error);
    }
}

function editAccount(accountId) {
    const account = accounts.find(a => a._id === accountId);
    if (account) {
        openAccountModal(account);
    }
}

async function deleteAccount(accountId) {
    if (!confirm('Tem certeza que deseja excluir esta conta?')) {
        return;
    }
    
    try {
        await apiCall(`/api/accounts/${accountId}`, {
            method: 'DELETE'
        });
        
        await loadAccounts();
        updateOverview();
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
    }
}

// Goal Functions
function displayGoals() {
    const container = document.getElementById('goalsList');
    
    if (goals.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhuma meta encontrada</p>';
        return;
    }
    
    container.innerHTML = goals.map(goal => {
        const percentage = (goal.current_amount / goal.target_amount) * 100;
        const remaining = goal.target_amount - goal.current_amount;
        const isCompleted = percentage >= 100;
        
        let progressClass = '';
        if (percentage >= 100) progressClass = 'success';
        else if (percentage >= 70) progressClass = 'warning';
        
        return `
            <div class="goal-card">
                <div class="goal-header">
                    <h4>${goal.name}</h4>
                    <span class="goal-status ${isCompleted ? 'completed' : 'active'}">
                        ${isCompleted ? 'Concluída' : 'Ativa'}
                    </span>
                </div>
                <div class="goal-amounts">
                    <span class="goal-current">R$ ${formatCurrency(goal.current_amount || 0)}</span>
                    <span class="goal-target">/ R$ ${formatCurrency(goal.target_amount)}</span>
                </div>
                <div class="goal-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <div class="progress-text">
                        ${percentage.toFixed(1)}% alcançado
                        ${!isCompleted ? `<br>Faltam: R$ ${formatCurrency(remaining)}` : ''}
                    </div>
                </div>
                <div class="goal-deadline">
                    Prazo: ${formatMonth(goal.deadline)}
                </div>
                <div class="goal-actions">
                    <button onclick="editGoal('${goal._id}')" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        Editar
                    </button>
                    <button onclick="deleteGoal('${goal._id}')" class="btn-danger">
                        Excluir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openGoalModal(goal = null) {
    const modal = document.getElementById('goalModal');
    const form = document.getElementById('goalForm');
    
    form.reset();
    
    if (goal) {
        document.getElementById('goalModalTitle').textContent = 'Editar Meta';
        document.getElementById('goalId').value = goal._id;
        document.getElementById('goalName').value = goal.name;
        document.getElementById('goalTarget').value = goal.target_amount;
        document.getElementById('goalCurrent').value = goal.current_amount || 0;
        document.getElementById('goalDeadline').value = goal.deadline;
    } else {
        document.getElementById('goalModalTitle').textContent = 'Nova Meta';
    }
    
    modal.style.display = 'block';
}

function closeGoalModal() {
    document.getElementById('goalModal').style.display = 'none';
}

async function saveGoal(event) {
    event.preventDefault();
    
    const goalId = document.getElementById('goalId').value;
    const goalData = {
        name: document.getElementById('goalName').value,
        target_amount: parseFloat(document.getElementById('goalTarget').value),
        current_amount: parseFloat(document.getElementById('goalCurrent').value),
        deadline: document.getElementById('goalDeadline').value
    };
    
    try {
        if (goalId) {
            await apiCall(`/api/goals/${goalId}`, {
                method: 'PUT',
                body: JSON.stringify(goalData)
            });
        } else {
            await apiCall('/api/goals', {
                method: 'POST',
                body: JSON.stringify(goalData)
            });
        }
        
        closeGoalModal();
        await loadGoals();
    } catch (error) {
        console.error('Erro ao salvar meta:', error);
    }
}

function editGoal(goalId) {
    const goal = goals.find(g => g._id === goalId);
    if (goal) {
        openGoalModal(goal);
    }
}

async function deleteGoal(goalId) {
    if (!confirm('Tem certeza que deseja excluir esta meta?')) {
        return;
    }
    
    try {
        await apiCall(`/api/goals/${goalId}`, {
            method: 'DELETE'
        });
        
        await loadGoals();
    } catch (error) {
        console.error('Erro ao excluir meta:', error);
    }
}

// Category Functions
function displayCategories() {
    const container = document.getElementById('categoriesList');
    
    if (categories.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhuma categoria encontrada</p>';
        return;
    }
    
    container.innerHTML = categories.map(category => {
        // Conta quantas transações e orçamentos usam esta categoria
        const transactionsCount = transactions.filter(t => t.category_id === category._id).length;
        const budgetsCount = budgets.filter(b => b.category_id === category._id).length;
        const totalUsage = transactionsCount + budgetsCount;
        
        return `
            <div class="category-card">
                <div class="category-header">
                    <h4>${category.name}</h4>
                    <div class="category-actions">
                        <button onclick="editCategory('${category._id}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                            Editar
                        </button>
                        <button onclick="deleteCategory('${category._id}')" class="btn-danger" ${totalUsage > 0 ? 'disabled title="Categoria em uso"' : ''}>
                            Excluir
                        </button>
                    </div>
                </div>
                ${category.description ? `<div class="category-description">${category.description}</div>` : ''}
                <div class="category-usage">
                    <small>
                        📊 Usada em ${transactionsCount} transação${transactionsCount !== 1 ? 'ões' : ''} 
                        e ${budgetsCount} orçamento${budgetsCount !== 1 ? 's' : ''}
                    </small>
                </div>
            </div>
        `;
    }).join('');
}

function openCategoryModal(category = null) {
    const modal = document.getElementById('categoryModal');
    const form = document.getElementById('categoryForm');
    
    form.reset();
    
    if (category) {
        document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
        document.getElementById('categoryId').value = category._id;
        document.getElementById('categoryName').value = category.name;
        document.getElementById('categoryDescription').value = category.description || '';
    } else {
        document.getElementById('categoryModalTitle').textContent = 'Nova Categoria';
    }
    
    modal.style.display = 'block';
}

function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
}

async function saveCategory(event) {
    event.preventDefault();
    
    const categoryId = document.getElementById('categoryId').value;
    const categoryData = {
        name: document.getElementById('categoryName').value,
        description: document.getElementById('categoryDescription').value
    };
    
    try {
        if (categoryId) {
            await apiCall(`/api/categories/${categoryId}`, {
                method: 'PUT',
                body: JSON.stringify(categoryData)
            });
            showNotification('Categoria atualizada com sucesso!', 'success');
        } else {
            await apiCall('/api/categories', {
                method: 'POST',
                body: JSON.stringify(categoryData)
            });
            showNotification('Categoria criada com sucesso!', 'success');
        }
        
        await loadCategories();
        displayCategories();
        updateCategorySelects();
        closeCategoryModal();
        updateOverview();
    } catch (error) {
        console.error('Erro ao salvar categoria:', error);
        showNotification(error.message || 'Erro ao salvar categoria', 'error');
    }
}

async function editCategory(categoryId) {
    const category = categories.find(c => c._id === categoryId);
    if (category) {
        openCategoryModal(category);
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
        updateCategorySelects();
        showNotification('Categoria excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        showNotification(error.message || 'Erro ao excluir categoria', 'error');
    }
}

// Comparison Functions
async function compareMonths() {
    const month1 = document.getElementById('compareMonth1').value;
    const month2 = document.getElementById('compareMonth2').value;
    
    if (!month1 || !month2) {
        alert('Selecione dois meses para comparar');
        return;
    }
    
    // Calculate data for both months
    const data1 = calculateMonthData(month1);
    const data2 = calculateMonthData(month2);
    
    const container = document.getElementById('comparisonResults');
    
    const items = [
        { label: 'Receitas', value1: data1.income, value2: data2.income },
        { label: 'Despesas', value1: data1.expenses, value2: data2.expenses },
        { label: 'Economia', value1: data1.savings, value2: data2.savings }
    ];
    
    container.innerHTML = items.map(item => {
        const diff = item.value2 - item.value1;
        const diffPercent = item.value1 !== 0 ? ((diff / item.value1) * 100).toFixed(1) : 0;
        const isPositive = diff >= 0;
        
        return `
            <div class="comparison-item">
                <h4>${item.label}</h4>
                <div class="comparison-values">
                    <span>R$ ${formatCurrency(item.value1)}</span>
                    <span>→</span>
                    <span>R$ ${formatCurrency(item.value2)}</span>
                </div>
                <div class="comparison-change ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '↑' : '↓'} R$ ${formatCurrency(Math.abs(diff))} (${Math.abs(diffPercent)}%)
                </div>
            </div>
        `;
    }).join('');
}

function calculateMonthData(month) {
    const monthIncomes = incomes.filter(i => i.month === month);
    const monthExpenses = transactions.filter(t => t.month === month);
    
    const income = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
    const expenses = monthExpenses.reduce((sum, t) => sum + (t.expense || 0), 0);
    const savings = income - expenses;
    
    return { income, expenses, savings };
}

// Charts Functions
function initializeCharts() {
    createMonthlyTrendChart();
    createCategoryPieChart();
    createAnnualChart();
    createExpenseDistributionChart();
}

function createMonthlyTrendChart() {
    const ctx = document.getElementById('monthlyTrendChart');
    if (!ctx) return;
    
    charts.monthlyTrend = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Receitas',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Despesas',
                    data: [],
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
            }
        }
    });
}

function createCategoryPieChart() {
    const ctx = document.getElementById('categoryPieChart');
    if (!ctx) return;
    
    charts.categoryPie = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#4f46e5', '#10b981', '#f59e0b', '#ef4444',
                    '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

function createAnnualChart() {
    const ctx = document.getElementById('annualChart');
    if (!ctx) return;
    
    charts.annual = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Economia Mensal',
                data: [],
                backgroundColor: '#4f46e5'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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

function createExpenseDistributionChart() {
    const ctx = document.getElementById('expenseDistributionChart');
    if (!ctx) return;
    
    charts.expenseDistribution = new Chart(ctx.getContext('2d'), {
        type: 'polarArea',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#4f46e5', '#10b981', '#f59e0b', '#ef4444',
                    '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function updateOverviewCharts() {
    updateMonthlyTrendChart();
    updateCategoryPieChart();
    updateAnnualChart();
    updateExpenseDistributionChart();
}

function updateMonthlyTrendChart() {
    if (!charts.monthlyTrend) return;
    
    // Get last 6 months
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    
    const incomeData = months.map(month => {
        return incomes
            .filter(i => i.month === month)
            .reduce((sum, i) => sum + (i.amount || 0), 0);
    });
    
    const expenseData = months.map(month => {
        return transactions
            .filter(t => t.month === month)
            .reduce((sum, t) => sum + (t.expense || 0), 0);
    });
    
    const labels = months.map(month => {
        const [year, m] = month.split('-');
        const date = new Date(year, m - 1);
        return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    });
    
    charts.monthlyTrend.data.labels = labels;
    charts.monthlyTrend.data.datasets[0].data = incomeData;
    charts.monthlyTrend.data.datasets[1].data = expenseData;
    charts.monthlyTrend.update();
}

function updateCategoryPieChart() {
    if (!charts.categoryPie) return;
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthExpenses = transactions.filter(t => t.month === currentMonth);
    
    const categoryData = {};
    monthExpenses.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Outros';
        categoryData[categoryName] = (categoryData[categoryName] || 0) + (t.expense || 0);
    });
    
    // Atualizar cores baseadas no status do orçamento
    const backgroundColors = Object.keys(categoryData).map(categoryName => {
        const category = categories.find(c => c.name === categoryName);
        if (!category) return '#6b7280';
        
        const budget = budgets.find(b => b.category_id === category._id && b.month === currentMonth);
        if (!budget) return '#6b7280'; // Cinza para categorias sem orçamento
        
        const spent = budget.spent !== undefined ? budget.spent : 
            monthExpenses.filter(t => t.category_id === category._id)
                .reduce((sum, t) => sum + (t.expense || 0), 0);
        
        const percentage = (spent / budget.amount) * 100;
        
        // Cores baseadas no status do orçamento
        if (percentage >= 100) return '#ef4444'; // Vermelho - excedido
        if (percentage >= 90) return '#f59e0b'; // Amarelo - crítico
        if (percentage >= 70) return '#eab308'; // Amarelo claro - atenção
        return '#10b981'; // Verde - OK
    });
    
    charts.categoryPie.data.labels = Object.keys(categoryData);
    charts.categoryPie.data.datasets[0].data = Object.values(categoryData);
    charts.categoryPie.data.datasets[0].backgroundColor = backgroundColors;
    
    // Adicionar tooltips com informações de orçamento
    charts.categoryPie.options.plugins.tooltip = {
        callbacks: {
            label: function(context) {
                const categoryName = context.label;
                const amount = context.parsed;
                const category = categories.find(c => c.name === categoryName);
                
                if (!category) {
                    return `${categoryName}: R$ ${formatCurrency(amount)}`;
                }
                
                const budget = budgets.find(b => b.category_id === category._id && b.month === currentMonth);
                
                if (!budget) {
                    return `${categoryName}: R$ ${formatCurrency(amount)} (Sem orçamento)`;
                }
                
                const spent = budget.spent !== undefined ? budget.spent : amount;
                const percentage = (spent / budget.amount) * 100;
                const remaining = budget.amount - spent;
                
                return [
                    `${categoryName}: R$ ${formatCurrency(amount)}`,
                    `Orçamento: R$ ${formatCurrency(budget.amount)}`,
                    `Usado: ${percentage.toFixed(1)}%`,
                    `Restante: R$ ${formatCurrency(remaining)}`
                ];
            }
        }
    };
    
    charts.categoryPie.update();
}

function updateAnnualChart() {
    if (!charts.annual) return;
    
    // Get last 12 months
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    
    const savingsData = months.map(month => {
        const income = incomes
            .filter(i => i.month === month)
            .reduce((sum, i) => sum + (i.amount || 0), 0);
        const expense = transactions
            .filter(t => t.month === month)
            .reduce((sum, t) => sum + (t.expense || 0), 0);
        return income - expense;
    });
    
    const labels = months.map(month => {
        const [year, m] = month.split('-');
        const date = new Date(year, m - 1);
        return date.toLocaleDateString('pt-BR', { month: 'short' });
    });
    
    charts.annual.data.labels = labels;
    charts.annual.data.datasets[0].data = savingsData;
    charts.annual.update();
}

function updateExpenseDistributionChart() {
    if (!charts.expenseDistribution) return;
    
    const categoryData = {};
    transactions.forEach(t => {
        const category = categories.find(c => c._id === t.category_id);
        const categoryName = category ? category.name : 'Outros';
        categoryData[categoryName] = (categoryData[categoryName] || 0) + (t.expense || 0);
    });
    
    charts.expenseDistribution.data.labels = Object.keys(categoryData);
    charts.expenseDistribution.data.datasets[0].data = Object.values(categoryData);
    charts.expenseDistribution.update();
}

function updateChartsTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1a202c';
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    
    Object.values(charts).forEach(chart => {
        if (chart && chart.options) {
            if (chart.options.plugins && chart.options.plugins.legend) {
                chart.options.plugins.legend.labels = chart.options.plugins.legend.labels || {};
                chart.options.plugins.legend.labels.color = textColor;
            }
            
            if (chart.options.scales) {
                ['x', 'y'].forEach(axis => {
                    if (chart.options.scales[axis]) {
                        chart.options.scales[axis].ticks = chart.options.scales[axis].ticks || {};
                        chart.options.scales[axis].ticks.color = textColor;
                        chart.options.scales[axis].grid = chart.options.scales[axis].grid || {};
                        chart.options.scales[axis].grid.color = gridColor;
                    }
                });
            }
            
            chart.update();
        }
    });
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

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Auth Functions
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}
