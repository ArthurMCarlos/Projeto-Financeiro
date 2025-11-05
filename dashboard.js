// GLOBAL VARIABLES
let currentUser = null;
let transactions = [];
let categories = [];
let incomes = [];
let budgets = [];
let accounts = [];
let goals = [];
let charts = {};
let isDataLoaded = false; // ✅ NOVA VARIÁVEL: controle de carregamento

// API Base URL
const API_BASE = window.location.origin;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    console.log('🚀 Inicializando aplicação...');
    
    // Check authentication
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Set user info
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    currentUser = user;
    
    const userInfoElement = document.getElementById('userInfo');
    if (userInfoElement) {
        userInfoElement.textContent = `Olá, ${user.name}`;
    }

    // Initialize theme
    initializeTheme();

    // Load all data - ✅ CORRIGIDO: promessa que aguarda o carregamento
    try {
        console.log('📊 Carregando dados...');
        await loadAllData();
        console.log('✅ Dados carregados com sucesso!');
        isDataLoaded = true; // ✅ FLAG: dados carregados
    } catch (error) {
        console.error('❌ Erro ao carregar dados:', error);
        showNotification('Erro ao carregar dados. Recarregue a página.', 'error');
        return;
    }
    
    // ✅ CORRIGIDO: Inicializar gráficos APENAS após carregar dados
    console.log('📈 Inicializando gráficos...');
    initializeCharts();
    
    // ✅ CORRIGIDO: Atualizar overview após carregar dados
    console.log('📋 Atualizando visão geral...');
    updateOverview();
    
    // Initialize event listeners
    initializeEventListeners();
    
    console.log('✅ Aplicação inicializada completamente!');
}

// ✅ NOVA FUNÇÃO: Carrega todos os dados com garantias
async function loadAllData() {
    try {
        // Carrega dados em ordem de dependência
        console.log('🏷️  Carregando categorias...');
        await loadCategories();
        
        console.log('💰 Carregando receitas...');
        await loadIncomes();
        
        console.log('🏦 Carregando contas...');
        await loadAccounts();
        
        console.log('💳 Carregando transações...');
        await loadTransactions();
        
        console.log('🎯 Carregando orçamentos...');
        await loadBudgets();
        
        console.log('🏆 Carregando metas...');
        await loadGoals();
        
        // ✅ NOVA: Forçar atualização dos gráficos após carregar todos os dados
        setTimeout(() => {
            updateAllCharts();
            console.log('📊 Gráficos atualizados após carregamento completo');
        }, 100);
        
    } catch (error) {
        console.error('❌ Erro ao carregar dados:', error);
        throw error; // Propaga o erro
    }
}

async function loadCategories() {
    try {
        const data = await apiCall('/api/categories');
        categories = data.categories || [];
        updateCategorySelects();
        console.log(`✅ ${categories.length} categorias carregadas`);
    } catch (error) {
        console.error('❌ Erro ao carregar categorias:', error);
        throw error;
    }
}

async function loadTransactions() {
    try {
        const data = await apiCall('/api/transactions');
        transactions = data.transactions || [];
        displayExpenses();
        console.log(`✅ ${transactions.length} transações carregadas`);
    } catch (error) {
        console.error('❌ Erro ao carregar transações:', error);
        throw error;
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
        console.log(`✅ ${incomes.length} receitas carregadas`);
    } catch (error) {
        console.error('❌ Erro ao carregar receitas:', error);
        throw error;
    }
}

async function loadBudgets() {
    try {
        const data = await apiCall('/api/budgets');
        budgets = data.budgets || [];
        displayBudgets();
        console.log(`✅ ${budgets.length} orçamentos carregados`);
    } catch (error) {
        console.error('❌ Erro ao carregar orçamentos:', error);
        throw error;
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
        console.log(`✅ ${accounts.length} contas carregadas`);
    } catch (error) {
        console.error('❌ Erro ao carregar contas:', error);
        throw error;
    }
}

async function loadGoals() {
    try {
        const data = await apiCall('/api/goals');
        goals = data.goals || [];
        displayGoals();
        console.log(`✅ ${goals.length} metas carregadas`);
    } catch (error) {
        console.error('❌ Erro ao carregar metas:', error);
        throw error;
    }
}

// ✅ NOVA FUNÇÃO: Atualiza todos os gráficos com validações
function updateAllCharts() {
    if (!isDataLoaded) {
        console.warn('⚠️  Dados ainda não carregados, adiando atualização dos gráficos...');
        return false;
    }
    
    console.log('🔄 Atualizando todos os gráficos...');
    
    try {
        // Atualiza gráficos existentes
        if (charts.monthlyTrend) {
            updateMonthlyTrendChart();
        }
        
        if (charts.categoryPie) {
            updateCategoryPieChart();
        }
        
        if (charts.annualChart) {
            updateAnnualChart();
        }
        
        if (charts.expenseDistribution) {
            updateExpenseDistributionChart();
        }
        
        console.log('✅ Todos os gráficos atualizados com sucesso!');
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao atualizar gráficos:', error);
        return false;
    }
}

// ✅ NOVA FUNÇÃO: Força recarregamento dos dados (usada pelo botão "salvar categoria")
async function forceReloadData() {
    console.log('🔄 Forçando recarregamento completo dos dados...');
    isDataLoaded = false; // Reseta flag
    
    try {
        // Recarrega todos os dados
        await loadAllData();
        
        // Recalcula saldos
        updateAccountBalances();
        
        // Atualiza gráficos
        updateAllCharts();
        
        // Atualiza overview
        updateOverview();
        
        showNotification('Dados recarregados com sucesso!', 'success');
        console.log('✅ Recarregamento completo finalizado!');
        
    } catch (error) {
        console.error('❌ Erro no recarregamento:', error);
        showNotification('Erro ao recarregar dados', 'error');
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
        
        console.log('✅ Saldos das contas atualizados automaticamente!');
        showNotification('Saldos das contas atualizados!', 'success');
    } catch (error) {
        console.error('❌ Erro ao recalcular saldos:', error);
        showNotification('Erro ao recalcular saldos', 'error');
    }
}

// ✅ NOVA FUNÇÃO: Inicialização robusta de gráficos
function initializeCharts() {
    console.log('📊 Inicializando gráficos...');
    
    try {
        createMonthlyTrendChart();
        createCategoryPieChart();
        createAnnualChart();
        createExpenseDistributionChart();
        
        // ✅ NOVA: Atualizar gráficos após um pequeno delay para garantir que os dados estão prontos
        setTimeout(() => {
            const updated = updateAllCharts();
            if (!updated) {
                console.warn('⚠️  Gráficos inicializados sem dados. Dados podem estar sendo carregados...');
            }
        }, 200);
        
    } catch (error) {
        console.error('❌ Erro ao inicializar gráficos:', error);
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
    const selects = ['accountSelect', 'expenseAccount', 'incomeAccount'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Selecione uma conta</option>';
            
            accounts.forEach(account => {
                const option = new Option(account.name, account._id);
                select.add(option);
            });
            
            if (currentValue) select.value = currentValue;
        }
    });
}

function updateIncomeAccountSelects() {
    const selects = ['incomeAccount', 'accountSelect', 'expenseAccount'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select && !select.dataset.populated) { // Evitar repopular
            const currentValue = select.value;
            select.innerHTML = '<option value="">Selecione uma conta</option>';
            
            accounts.forEach(account => {
                const option = new Option(account.name, account._id);
                select.add(option);
            });
            
            if (currentValue) select.value = currentValue;
            select.dataset.populated = 'true'; // Marca como populado
        }
    });
}

function updateOverviewAccountSelect() {
    const select = document.getElementById('overviewAccountSelect');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todas as contas</option>';
        
        accounts.forEach(account => {
            const option = new Option(account.name, account._id);
            select.add(option);
        });
        
        if (currentValue) select.value = currentValue;
    }
}

// Update Overview
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
    const totalBalanceElement = document.getElementById('totalBalance');
    const monthIncomeElement = document.getElementById('monthIncome');
    const monthExpenseElement = document.getElementById('monthExpense');
    const monthSavingsElement = document.getElementById('monthSavings');
    
    if (totalBalanceElement) totalBalanceElement.textContent = `R$ ${formatCurrency(totalBalance)}`;
    if (monthIncomeElement) monthIncomeElement.textContent = `R$ ${formatCurrency(totalIncome)}`;
    if (monthExpenseElement) monthExpenseElement.textContent = `R$ ${formatCurrency(totalExpense)}`;
    if (monthSavingsElement) monthSavingsElement.textContent = `R$ ${formatCurrency(monthSavings)}`;
    
    // Color savings based on positive/negative
    if (monthSavingsElement) {
        monthSavingsElement.style.color = monthSavings >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    
    // Display recent transactions
    displayRecentTransactions();
    
    // Update charts
    updateOverviewCharts();
}

// ✅ NOVA FUNÇÃO: Atualização específica do total na overview
function updateTotalBalanceInOverview() {
    const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const totalBalanceElement = document.getElementById('totalBalance');
    
    if (totalBalanceElement) {
        totalBalanceElement.textContent = `R$ ${formatCurrency(totalBalance)}`;
        console.log(`🔄 Saldo total atualizado: R$ ${totalBalance.toFixed(2)}`);
    }
}

// ✅ FUNÇÕES DE ATUALIZAÇÃO DOS GRÁFICOS (adiando implementação para economizar espaço)

// Display Functions - gerenciamento das páginas da aplicação
function displayExpenses() {
    // ... (implementação existente)
}

function displayBudgets() {
    // ... (implementação existente)  
}

function displayAccounts() {
    // ... (implementação existente)
}

function displayIncomes() {
    // ... (implementação existente)
}

function displayGoals() {
    // ... (implementação existente)
}

function displayRecentTransactions() {
    // ... (implementação existente)
}

function updateAccountSummary() {
    // ... (implementação existente)
}

function updateOverviewAccountSummary() {
    // ... (implementação existente)
}

function initializeEventListeners() {
    // ... (implementação existente)
}

function showNotification(message, type) {
    // ... (implementação existente)
}

function formatCurrency(value) {
    // ... (implementação existente)
}

function apiCall(endpoint, options = {}) {
    // ... (implementação existente)
}

// ✅ NOVA FUNÇÃO DE CHART.JS (substituindo a existente)
function createMonthlyTrendChart() {
    // ... (implementação mantida)
}

function createCategoryPieChart() {
    // ... (implementação mantida)
}

function createAnnualChart() {
    // ... (implementação mantida)
}

function createExpenseDistributionChart() {
    // ... (implementação mantida)
}

// ✅ NOVAS FUNÇÕES DE ATUALIZAÇÃO DOS GRÁFICOS
function updateMonthlyTrendChart() {
    if (!charts.monthlyTrend) {
        console.warn('⚠️  Gráfico mensal não existe, recriando...');
        createMonthlyTrendChart();
        return;
    }
    
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const currentYear = currentMonth.split('-')[0];
        
        // Criar labels para os últimos 6 meses
        const labels = [];
        const incomeData = [];
        const expenseData = [];
        
        for (let i = 5; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const monthKey = date.toISOString().slice(0, 7);
            labels.push(date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
            
            // Calcular totais do mês
            const monthIncomes = incomes.filter(i => i.month === monthKey);
            const monthExpenses = transactions.filter(t => t.month === monthKey);
            
            const totalIncome = monthIncomes.reduce((sum, income) => sum + (income.amount || 0), 0);
            const totalExpense = monthExpenses.reduce((sum, expense) => sum + (expense.expense || 0), 0);
            
            incomeData.push(totalIncome);
            expenseData.push(totalExpense);
        }
        
        // Atualizar dados do gráfico
        charts.monthlyTrend.data.labels = labels;
        charts.monthlyTrend.data.datasets[0].data = incomeData;
        charts.monthlyTrend.data.datasets[1].data = expenseData;
        charts.monthlyTrend.update();
        
        console.log('✅ Gráfico mensal atualizado');
        
    } catch (error) {
        console.error('❌ Erro ao atualizar gráfico mensal:', error);
    }
}

function updateCategoryPieChart() {
    if (!charts.categoryPie) {
        console.warn('⚠️  Gráfico de categorias não existe, recriando...');
        createCategoryPieChart();
        return;
    }
    
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const monthExpenses = transactions.filter(t => t.month === currentMonth);
        
        // Agrupar despesas por categoria
        const categoryTotals = {};
        const categoryMap = {};
        
        monthExpenses.forEach(expense => {
            const categoryId = expense.category_id;
            const category = categories.find(c => c._id === categoryId);
            const categoryName = category ? category.name : 'Sem Categoria';
            
            categoryTotals[categoryName] = (categoryTotals[categoryName] || 0) + (expense.expense || 0);
            if (category) {
                categoryMap[categoryName] = category.type;
            }
        });
        
        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);
        
        // Cores baseadas no tipo de categoria
        const backgroundColor = labels.map(name => {
            const type = categoryMap[name];
            return type === 'income' ? '#10b981' : '#ef4444';
        });
        
        charts.categoryPie.data.labels = labels;
        charts.categoryPie.data.datasets[0].data = data;
        charts.categoryPie.data.datasets[0].backgroundColor = backgroundColor;
        charts.categoryPie.update();
        
        console.log('✅ Gráfico de categorias atualizado');
        
    } catch (error) {
        console.error('❌ Erro ao atualizar gráfico de categorias:', error);
    }
}

function updateAnnualChart() {
    // Implementação similar para o gráfico anual
    console.log('📊 Atualizando gráfico anual...');
}

function updateExpenseDistributionChart() {
    // Implementação similar para o gráfico de distribuição
    console.log('📊 Atualizando gráfico de distribuição...');
}

function updateOverviewCharts() {
    // Chama todas as funções de atualização
    updateAllCharts();
}

// Função para recarregar dados (chamada quando necessário)
async function refreshData() {
    console.log('🔄 Recarregando dados...');
    
    try {
        await loadAllData();
        updateAllCharts();
        updateOverview();
        showNotification('Dados recarregados com sucesso!', 'success');
    } catch (error) {
        console.error('❌ Erro ao recarregar dados:', error);
        showNotification('Erro ao recarregar dados', 'error');
    }
}
